<?php
declare(strict_types=1);

/**
 * Inventory / Production model for the pellet plant.
 *
 * Keeps three things consistent inside transactions:
 *   - raw_materials.current_stock  (via raw_material_movements)
 *   - products.stock_quantity      (finished goods, via stock_movements)
 *   - production_runs              (consume raw materials -> produce finished goods)
 *
 * Stock levels are maintained counters (single source of truth); every change
 * also writes a ledger row so history is auditable.
 */
class Inventory
{
    // ---- Raw materials --------------------------------------------------------

    public static function rawMaterials(bool $activeOnly = true): array
    {
        $where = $activeOnly ? 'WHERE is_active = 1' : '';
        $rows = Database::fetchAll(
            "SELECT raw_material_id, name, unit, current_stock, reorder_level, supplier, is_active
               FROM raw_materials $where
              ORDER BY name ASC"
        );
        return array_map([self::class, 'formatRawMaterial'], $rows);
    }

    public static function createRawMaterial(array $d): array
    {
        $id = Database::insert(
            "INSERT INTO raw_materials (name, unit, current_stock, reorder_level, supplier)
             VALUES (?, ?, ?, ?, ?)",
            [
                trim((string)($d['name'] ?? '')),
                trim((string)($d['unit'] ?? 'kg')) ?: 'kg',
                (float)($d['current_stock'] ?? 0),
                (float)($d['reorder_level'] ?? 0),
                ($d['supplier'] ?? null) ? trim((string)$d['supplier']) : null,
            ]
        );
        // opening stock becomes an "in" ledger row
        if ((float)($d['current_stock'] ?? 0) > 0) {
            Database::insert(
                "INSERT INTO raw_material_movements (raw_material_id, movement_type, quantity, reference, movement_date)
                 VALUES (?, 'in', ?, 'Opening stock', CURDATE())",
                [$id, (float)$d['current_stock']]
            );
        }
        return self::findRawMaterial($id);
    }

    public static function updateRawMaterial(int $id, array $d): array
    {
        $fields = [];
        $params = [];
        foreach (['name' => 'name', 'unit' => 'unit', 'reorder_level' => 'reorder_level', 'supplier' => 'supplier'] as $key => $col) {
            if (array_key_exists($key, $d)) {
                $fields[] = "$col = ?";
                $params[] = in_array($key, ['reorder_level'], true) ? (float)$d[$key] : ($d[$key] === null ? null : trim((string)$d[$key]));
            }
        }
        if ($fields) {
            $params[] = $id;
            Database::execute("UPDATE raw_materials SET " . implode(', ', $fields) . " WHERE raw_material_id = ?", $params);
        }
        return self::findRawMaterial($id);
    }

    public static function deleteRawMaterial(int $id): void
    {
        Database::execute("UPDATE raw_materials SET is_active = 0 WHERE raw_material_id = ?", [$id]);
    }

    /** Record a raw-material movement and keep current_stock in sync. */
    public static function rawMaterialMovement(int $id, string $type, float $qty, ?string $reference, ?string $notes, ?string $date, ?int $userId): array
    {
        $material = self::findRawMaterialRow($id);
        if (!$material) Response::error('Raw material not found', 404);

        $date = self::validDate($date);
        Database::beginTransaction();
        try {
            Database::insert(
                "INSERT INTO raw_material_movements (raw_material_id, movement_type, quantity, reference, notes, movement_date, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
                [$id, $type, $qty, $reference, $notes, $date, $userId]
            );
            self::applyRawStock($id, $type, $qty);
            Database::commit();
        } catch (\Throwable $e) {
            Database::rollBack();
            throw $e;
        }
        return self::findRawMaterial($id);
    }

    /**
     * Resolve a purchased line's stock type from the purchase-items catalog (matched by
     * name). Guarded so a not-yet-migrated `item_type` column can't break receiving —
     * it just falls back to 'stock'.
     */
    public static function itemTypeByName(string $name): string
    {
        $name = trim($name);
        if ($name === '') return 'stock';
        try {
            $row = Database::fetch('SELECT item_type FROM purchase_items WHERE name = ? LIMIT 1', [$name]);
            return PurchaseItem::normalizeType($row['item_type'] ?? 'stock');
        } catch (\Throwable $e) {
            return 'stock';
        }
    }

    /**
     * Post received goods into the correct stock home. TRANSACTION-FREE — must be called
     * inside an already-open transaction (the goods-receipt insert). Matches by name and
     * auto-creates the target when missing (the "auto-match by name" rule). Auto-created
     * products are is_available = 0 so purchased/pellet stock never leaks into the sales
     * catalog.
     *   raw_material -> raw_materials.current_stock  (+ raw_material_movements)
     *   pellet       -> products.stock_quantity       (finished goods; auto-create product_type 'pellets')
     *   stock        -> spares_assets.current_stock    (spares & assets; auto-create by name)
     */
    public static function receiveIn(string $name, string $itemType, float $qty, ?string $unit, string $reference, string $date, ?int $userId): void
    {
        $name = trim($name);
        if ($name === '' || $qty <= 0) return;
        $type = PurchaseItem::normalizeType($itemType);
        $unit = ($unit ?? '') !== '' ? trim((string)$unit) : null;
        $date = self::validDate($date);

        if ($type === 'raw_material') {
            $row  = Database::fetch('SELECT raw_material_id FROM raw_materials WHERE name = ? LIMIT 1', [$name]);
            $rmId = $row
                ? (int)$row['raw_material_id']
                : (int)Database::insert('INSERT INTO raw_materials (name, unit, current_stock, reorder_level) VALUES (?, ?, 0, 0)', [$name, $unit ?: 'kg']);
            Database::execute('UPDATE raw_materials SET current_stock = current_stock + ? WHERE raw_material_id = ?', [$qty, $rmId]);
            Database::insert(
                'INSERT INTO raw_material_movements (raw_material_id, movement_type, quantity, reference, movement_date, created_by)
                 VALUES (?, "in", ?, ?, ?, ?)',
                [$rmId, $qty, $reference, $date, $userId]
            );
            return;
        }

        if ($type === 'pellet') {
            // Finished pellets bought in -> products.stock_quantity (auto-create, hidden from sales).
            $row = Database::fetch('SELECT product_id FROM products WHERE product_name = ? AND is_deleted = 0 LIMIT 1', [$name]);
            $pid = $row
                ? (int)$row['product_id']
                : (int)Database::insert(
                    'INSERT INTO products (product_name, product_type, base_price, unit, is_available, is_deleted, stock_quantity, reorder_level, created_at)
                     VALUES (?, "pellets", 0, ?, 0, 0, 0, 0, NOW())',
                    [$name, $unit ?: 'nos']
                );
            Database::execute('UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?', [$qty, $pid]);
            Database::insert(
                'INSERT INTO stock_movements (product_id, movement_type, source, quantity, reference, movement_date, created_by)
                 VALUES (?, "in", "manual", ?, ?, ?, ?)',
                [$pid, $qty, $reference, $date, $userId]
            );
            return;
        }

        // stock (spares & assets) -> spares_assets.current_stock (auto-create by name)
        $row = Database::fetch('SELECT spare_id FROM spares_assets WHERE name = ? LIMIT 1', [$name]);
        $spareId = $row
            ? (int)$row['spare_id']
            : (int)Database::insert('INSERT INTO spares_assets (name, unit, current_stock, reorder_level) VALUES (?, ?, 0, 0)', [$name, $unit ?: 'nos']);
        Database::execute('UPDATE spares_assets SET current_stock = current_stock + ? WHERE spare_id = ?', [$qty, $spareId]);
        Database::insert(
            'INSERT INTO spare_asset_movements (spare_id, movement_type, quantity, reference, movement_date, created_by)
             VALUES (?, "in", ?, ?, ?, ?)',
            [$spareId, $qty, $reference, $date, $userId]
        );
    }

    /**
     * Reverse a previously-received line when its goods receipt is voided. TRANSACTION-FREE.
     * Match-only (never creates) and clamps at 0, so voiding can't push stock negative or
     * resurrect a deleted record. Mirrors receiveIn's routing.
     */
    public static function receiveReverse(string $name, string $itemType, float $qty, string $reference, string $date, ?int $userId): void
    {
        $name = trim($name);
        if ($name === '' || $qty <= 0) return;
        $type = PurchaseItem::normalizeType($itemType);
        $date = self::validDate($date);

        if ($type === 'raw_material') {
            $row = Database::fetch('SELECT raw_material_id FROM raw_materials WHERE name = ? LIMIT 1', [$name]);
            if (!$row) return;
            $rmId = (int)$row['raw_material_id'];
            Database::execute('UPDATE raw_materials SET current_stock = GREATEST(current_stock - ?, 0) WHERE raw_material_id = ?', [$qty, $rmId]);
            Database::insert(
                'INSERT INTO raw_material_movements (raw_material_id, movement_type, quantity, reference, movement_date, created_by)
                 VALUES (?, "out", ?, ?, ?, ?)',
                [$rmId, $qty, $reference, $date, $userId]
            );
            return;
        }

        if ($type === 'pellet') {
            $row = Database::fetch('SELECT product_id FROM products WHERE product_name = ? AND is_deleted = 0 LIMIT 1', [$name]);
            if (!$row) return;
            $pid = (int)$row['product_id'];
            Database::execute('UPDATE products SET stock_quantity = GREATEST(stock_quantity - ?, 0) WHERE product_id = ?', [$qty, $pid]);
            Database::insert(
                'INSERT INTO stock_movements (product_id, movement_type, source, quantity, reference, movement_date, created_by)
                 VALUES (?, "out", "manual", ?, ?, ?, ?)',
                [$pid, $qty, $reference, $date, $userId]
            );
            return;
        }

        // stock (spares & assets)
        $row = Database::fetch('SELECT spare_id FROM spares_assets WHERE name = ? LIMIT 1', [$name]);
        if (!$row) return;
        $spareId = (int)$row['spare_id'];
        Database::execute('UPDATE spares_assets SET current_stock = GREATEST(current_stock - ?, 0) WHERE spare_id = ?', [$qty, $spareId]);
        Database::insert(
            'INSERT INTO spare_asset_movements (spare_id, movement_type, quantity, reference, movement_date, created_by)
             VALUES (?, "out", ?, ?, ?, ?)',
            [$spareId, $qty, $reference, $date, $userId]
        );
    }

    private static function applyRawStock(int $id, string $type, float $qty): void
    {
        if ($type === 'in') {
            Database::execute("UPDATE raw_materials SET current_stock = current_stock + ? WHERE raw_material_id = ?", [$qty, $id]);
        } elseif ($type === 'out') {
            Database::execute("UPDATE raw_materials SET current_stock = GREATEST(current_stock - ?, 0) WHERE raw_material_id = ?", [$qty, $id]);
        } else { // adjust -> absolute set
            Database::execute("UPDATE raw_materials SET current_stock = ? WHERE raw_material_id = ?", [$qty, $id]);
        }
    }

    // ---- Spares & Assets ------------------------------------------------------

    public static function sparesAssets(?string $category = null, bool $activeOnly = true): array
    {
        $where = ['1=1']; $params = [];
        if ($activeOnly) $where[] = 'is_active = 1';
        if ($category && $category !== 'all') { $where[] = 'category = ?'; $params[] = $category; }
        $rows = Database::fetchAll(
            "SELECT spare_id, name, category, unit, current_stock, reorder_level, location, is_active
               FROM spares_assets WHERE " . implode(' AND ', $where) . "
              ORDER BY is_active DESC, name ASC",
            $params
        );
        return array_map([self::class, 'formatSpare'], $rows);
    }

    private static function formatSpare(array $r): array
    {
        $stock   = (float)$r['current_stock'];
        $reorder = (float)$r['reorder_level'];
        return [
            'spare_id'      => (int)$r['spare_id'],
            'name'          => $r['name'],
            'category'      => $r['category'],
            'unit'          => $r['unit'] ?? 'nos',
            'current_stock' => $stock,
            'reorder_level' => $reorder,
            'location'      => $r['location'] ?? null,
            'is_active'     => (bool)$r['is_active'],
            'low_stock'     => $reorder > 0 && $stock <= $reorder,
        ];
    }

    private static function findSpare(int $id): ?array
    {
        $row = Database::fetch('SELECT * FROM spares_assets WHERE spare_id = ? LIMIT 1', [$id]);
        return $row ? self::formatSpare($row) : null;
    }

    public static function createSpare(array $d): array
    {
        $name = trim((string)($d['name'] ?? ''));
        if ($name === '') Response::error('Name is required', 422);
        $opening = (float)($d['current_stock'] ?? 0);
        $id = (int)Database::insert(
            'INSERT INTO spares_assets (name, category, unit, current_stock, reorder_level, location)
             VALUES (?, ?, ?, ?, ?, ?)',
            [
                $name,
                ($d['category'] ?? '') !== '' ? trim((string)$d['category']) : null,
                ($d['unit'] ?? '') !== '' ? trim((string)$d['unit']) : 'nos',
                $opening,
                (float)($d['reorder_level'] ?? 0),
                ($d['location'] ?? '') !== '' ? trim((string)$d['location']) : null,
            ]
        );
        if ($opening > 0) {
            Database::insert(
                'INSERT INTO spare_asset_movements (spare_id, movement_type, quantity, reference, movement_date)
                 VALUES (?, "in", ?, "Opening stock", CURDATE())',
                [$id, $opening]
            );
        }
        return self::findSpare($id) ?? [];
    }

    public static function updateSpare(int $id, array $d): array
    {
        $fields = []; $params = [];
        foreach (['name', 'category', 'unit', 'reorder_level', 'location', 'is_active'] as $f) {
            if (!array_key_exists($f, $d)) continue;
            $fields[] = "$f = ?";
            if ($f === 'is_active')          $params[] = (int)(bool)$d[$f];
            elseif ($f === 'reorder_level')  $params[] = (float)($d[$f] ?: 0);
            else                             $params[] = ($d[$f] !== '' && $d[$f] !== null) ? $d[$f] : null;
        }
        if ($fields) {
            $params[] = $id;
            Database::execute('UPDATE spares_assets SET ' . implode(', ', $fields) . ' WHERE spare_id = ?', $params);
        }
        return self::findSpare($id) ?? [];
    }

    public static function deleteSpare(int $id): void
    {
        Database::execute('UPDATE spares_assets SET is_active = 0 WHERE spare_id = ?', [$id]);
    }

    /** Record a spares/assets movement and keep current_stock in sync. */
    public static function spareMovement(int $id, string $type, float $qty, ?string $reference, ?string $notes, ?string $date, ?int $userId): array
    {
        if (!Database::fetch('SELECT spare_id FROM spares_assets WHERE spare_id = ? LIMIT 1', [$id])) {
            Response::error('Spare/asset not found', 404);
        }
        $date = self::validDate($date);
        Database::beginTransaction();
        try {
            Database::insert(
                'INSERT INTO spare_asset_movements (spare_id, movement_type, quantity, reference, notes, movement_date, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$id, $type, $qty, $reference, $notes, $date, $userId]
            );
            if ($type === 'in')          Database::execute('UPDATE spares_assets SET current_stock = current_stock + ? WHERE spare_id = ?', [$qty, $id]);
            elseif ($type === 'out')     Database::execute('UPDATE spares_assets SET current_stock = GREATEST(current_stock - ?, 0) WHERE spare_id = ?', [$qty, $id]);
            else                         Database::execute('UPDATE spares_assets SET current_stock = ? WHERE spare_id = ?', [$qty, $id]);
            Database::commit();
        } catch (\Throwable $e) {
            Database::rollBack();
            throw $e;
        }
        return self::findSpare($id) ?? [];
    }

    // ---- Production -----------------------------------------------------------

    public static function productionRuns(?string $from, ?string $to, int $limit = 100): array
    {
        $where = ['1=1'];
        $params = [];
        if ($from) { $where[] = 'pr.run_date >= ?'; $params[] = $from; }
        if ($to)   { $where[] = 'pr.run_date <= ?'; $params[] = $to; }
        $params[] = $limit;
        $rows = Database::fetchAll(
            "SELECT pr.run_id, pr.run_date, pr.product_id, p.product_name, pr.batch_number,
                    pr.output_quantity, pr.unit, pr.shift, pr.operator_name, pr.notes, pr.created_at
               FROM production_runs pr
               JOIN products p ON p.product_id = pr.product_id
              WHERE " . implode(' AND ', $where) . "
              ORDER BY pr.run_date DESC, pr.run_id DESC
              LIMIT ?",
            $params
        );
        return self::hydrateRuns($rows);
    }

    /** Fetch a single run with its full consumption / outputs / quality detail. */
    public static function productionRun(int $runId): ?array
    {
        $rows = Database::fetchAll(
            "SELECT pr.run_id, pr.run_date, pr.product_id, p.product_name, pr.batch_number,
                    pr.output_quantity, pr.unit, pr.shift, pr.operator_name, pr.notes, pr.created_at
               FROM production_runs pr
               JOIN products p ON p.product_id = pr.product_id
              WHERE pr.run_id = ? LIMIT 1",
            [$runId]
        );
        $hydrated = self::hydrateRuns($rows);
        return $hydrated[0] ?? null;
    }

    /**
     * Attach consumption, finished outputs and quality to a set of run rows. All three
     * are batch-loaded in one query each (grouped in PHP) to avoid N+1 per run.
     */
    private static function hydrateRuns(array $rows): array
    {
        if (!$rows) return [];
        $runIds       = array_map(static fn($r) => (int)$r['run_id'], $rows);
        $placeholders = implode(',', array_fill(0, count($runIds), '?'));

        $consumption = Database::fetchAll(
            "SELECT pc.run_id, pc.raw_material_id, rm.name, pc.quantity, rm.unit
               FROM production_consumption pc
               JOIN raw_materials rm ON rm.raw_material_id = pc.raw_material_id
              WHERE pc.run_id IN ($placeholders)",
            $runIds
        );
        $consByRun = [];
        foreach ($consumption as $c) {
            $consByRun[(int)$c['run_id']][] = [
                'raw_material_id' => (int)$c['raw_material_id'],
                'name'            => $c['name'],
                'quantity'        => (float)$c['quantity'],
                'unit'            => $c['unit'],
            ];
        }

        // Spares & assets consumed as inputs (dies, filters, consumables). Optional
        // table — a run may have none. Guarded so runs still load if the migration
        // hasn't been applied yet.
        $spareByRun = [];
        try {
            $spareCons = Database::fetchAll(
                "SELECT psc.run_id, psc.spare_id, sa.name, psc.quantity, sa.unit
                   FROM production_spare_consumption psc
                   JOIN spares_assets sa ON sa.spare_id = psc.spare_id
                  WHERE psc.run_id IN ($placeholders)",
                $runIds
            );
            foreach ($spareCons as $c) {
                $spareByRun[(int)$c['run_id']][] = [
                    'spare_id' => (int)$c['spare_id'],
                    'name'     => $c['name'],
                    'quantity' => (float)$c['quantity'],
                    'unit'     => $c['unit'],
                ];
            }
        } catch (\Throwable $e) {
            // no spare-consumption table yet — treat every run as having none
        }

        $outputs = Database::fetchAll(
            "SELECT po.run_id, po.product_id, p.product_name, po.quantity, po.unit
               FROM production_outputs po
               JOIN products p ON p.product_id = po.product_id
              WHERE po.run_id IN ($placeholders)
              ORDER BY po.output_id ASC",
            $runIds
        );
        $outByRun = [];
        foreach ($outputs as $o) {
            $outByRun[(int)$o['run_id']][] = [
                'product_id'   => (int)$o['product_id'],
                'product_name' => $o['product_name'],
                'quantity'     => (float)$o['quantity'],
                'unit'         => $o['unit'],
            ];
        }

        $quality = Database::fetchAll(
            "SELECT * FROM production_quality WHERE run_id IN ($placeholders)",
            $runIds
        );
        $qByRun = [];
        foreach ($quality as $q) {
            $num = static fn($v) => $v === null ? null : (float)$v;
            $qByRun[(int)$q['run_id']] = [
                'moisture_pct'   => $num($q['moisture_pct']),
                'ash_pct'        => $num($q['ash_pct']),
                'gcv'            => $num($q['gcv']),
                'fines_pct'      => $num($q['fines_pct']),
                'diameter_mm'    => $num($q['diameter_mm']),
                'durability_pct' => $num($q['durability_pct']),
                'result'         => $q['result'],
                'inspector'      => $q['inspector'],
                'notes'          => $q['notes'],
                'checked_at'     => $q['checked_at'],
            ];
        }

        return array_map(static function (array $r) use ($consByRun, $outByRun, $qByRun, $spareByRun): array {
            $id = (int)$r['run_id'];
            $r['run_id']          = $id;
            $r['product_id']      = (int)$r['product_id'];
            $r['output_quantity'] = (float)$r['output_quantity'];
            $r['consumption']     = $consByRun[$id] ?? [];
            $r['spare_consumption'] = $spareByRun[$id] ?? [];
            // outputs always includes the primary; fall back to the denormalized run
            // fields for legacy runs logged before the outputs table existed.
            $r['outputs']         = $outByRun[$id] ?? [[
                'product_id'   => (int)$r['product_id'],
                'product_name' => $r['product_name'],
                'quantity'     => (float)$r['output_quantity'],
                'unit'         => $r['unit'],
            ]];
            $r['quality']         = $qByRun[$id] ?? null;
            return $r;
        }, $rows);
    }

    /** Insert (or replace) the quality inspection for a run. Transaction-free. */
    private static function insertQuality(int $runId, array $q): void
    {
        $num = static function ($v) {
            if ($v === null || $v === '') return null;
            return is_numeric($v) ? (float)$v : null;
        };
        $result = in_array(($q['result'] ?? 'pending'), ['pass', 'fail', 'pending'], true) ? $q['result'] : 'pending';
        Database::execute('DELETE FROM production_quality WHERE run_id = ?', [$runId]);
        Database::insert(
            "INSERT INTO production_quality
                (run_id, moisture_pct, ash_pct, gcv, fines_pct, diameter_mm, durability_pct, result, inspector, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                $runId,
                $num($q['moisture_pct'] ?? null), $num($q['ash_pct'] ?? null), $num($q['gcv'] ?? null),
                $num($q['fines_pct'] ?? null), $num($q['diameter_mm'] ?? null), $num($q['durability_pct'] ?? null),
                $result,
                ($q['inspector'] ?? '') !== '' ? trim((string)$q['inspector']) : null,
                ($q['notes'] ?? '') !== '' ? trim((string)$q['notes']) : null,
            ]
        );
    }

    /** Parse + validate the outputs array (multi-output, legacy single-field fallback). */
    private static function resolveOutputs(array $d): array
    {
        $outputs = [];
        if (isset($d['outputs']) && is_array($d['outputs'])) {
            foreach ($d['outputs'] as $o) {
                $pid = (int)($o['product_id'] ?? 0);
                $q   = (float)($o['quantity'] ?? 0);
                if ($pid > 0 && $q > 0) {
                    $outputs[] = ['product_id' => $pid, 'quantity' => $q, 'unit' => trim((string)($o['unit'] ?? '')) ?: null];
                }
            }
        }
        if (!$outputs && (int)($d['product_id'] ?? 0) > 0 && (float)($d['output_quantity'] ?? 0) > 0) {
            $outputs[] = ['product_id' => (int)$d['product_id'], 'quantity' => (float)$d['output_quantity'], 'unit' => trim((string)($d['unit'] ?? '')) ?: null];
        }
        if (!$outputs) Response::error('At least one output (product + quantity) is required', 422);
        foreach ($outputs as &$o) {
            $product = Database::fetch("SELECT product_id, unit FROM products WHERE product_id = ? AND is_deleted = 0 LIMIT 1", [$o['product_id']]);
            if (!$product) Response::error('Output product not found', 404);
            $o['unit'] = $o['unit'] ?: (trim((string)($product['unit'] ?? '')) ?: 'kg');
        }
        unset($o);
        return $outputs;
    }

    /**
     * Insert a run's children (consumption, outputs, quality) and apply their stock
     * effects — deduct raw materials, add finished output. TRANSACTION-FREE.
     */
    private static function applyRunChildren(int $runId, array $outputs, array $consumption, string $date, array $d, ?int $userId): void
    {
        foreach ($consumption as $c) {
            $rmId = (int)($c['raw_material_id'] ?? 0);
            $qty  = (float)($c['quantity'] ?? 0);
            if ($rmId <= 0 || $qty <= 0) continue;
            Database::insert("INSERT INTO production_consumption (run_id, raw_material_id, quantity) VALUES (?, ?, ?)", [$runId, $rmId, $qty]);
            Database::insert(
                "INSERT INTO raw_material_movements (raw_material_id, movement_type, quantity, reference, movement_date, run_id, created_by)
                 VALUES (?, 'out', ?, ?, ?, ?, ?)",
                [$rmId, $qty, 'Production run #' . $runId, $date, $runId, $userId]
            );
            self::applyRawStock($rmId, 'out', $qty);
        }
        // Spares & assets consumed as inputs — deduct their stock and log the movement.
        if (isset($d['spare_consumption']) && is_array($d['spare_consumption'])) {
            foreach ($d['spare_consumption'] as $c) {
                $spId = (int)($c['spare_id'] ?? 0);
                $qty  = (float)($c['quantity'] ?? 0);
                if ($spId <= 0 || $qty <= 0) continue;
                Database::insert("INSERT INTO production_spare_consumption (run_id, spare_id, quantity) VALUES (?, ?, ?)", [$runId, $spId, $qty]);
                Database::insert(
                    "INSERT INTO spare_asset_movements (spare_id, movement_type, quantity, reference, movement_date, created_by)
                     VALUES (?, 'out', ?, ?, ?, ?)",
                    [$spId, $qty, 'Production run #' . $runId, $date, $userId]
                );
                Database::execute("UPDATE spares_assets SET current_stock = GREATEST(current_stock - ?, 0) WHERE spare_id = ?", [$qty, $spId]);
            }
        }
        foreach ($outputs as $o) {
            Database::insert("INSERT INTO production_outputs (run_id, product_id, quantity, unit) VALUES (?, ?, ?, ?)", [$runId, $o['product_id'], $o['quantity'], $o['unit']]);
            Database::insert(
                "INSERT INTO stock_movements (product_id, movement_type, source, quantity, reference, movement_date, run_id, created_by)
                 VALUES (?, 'in', 'production', ?, ?, ?, ?, ?)",
                [$o['product_id'], $o['quantity'], 'Production run #' . $runId, $date, $runId, $userId]
            );
            Database::execute("UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?", [$o['quantity'], $o['product_id']]);
        }
        if (isset($d['quality']) && is_array($d['quality']) && self::qualityHasData($d['quality'])) {
            self::insertQuality($runId, $d['quality']);
        }
    }

    /** Reverse a run's stock effects (raw back, finished out) and delete its child rows. TRANSACTION-FREE. */
    private static function reverseRunChildren(int $runId): void
    {
        foreach (Database::fetchAll("SELECT raw_material_id, quantity FROM production_consumption WHERE run_id = ?", [$runId]) as $c) {
            Database::execute("UPDATE raw_materials SET current_stock = current_stock + ? WHERE raw_material_id = ?", [(float)$c['quantity'], (int)$c['raw_material_id']]);
        }
        // Restore spare stock consumed by this run, then drop its movements + rows.
        try {
            foreach (Database::fetchAll("SELECT spare_id, quantity FROM production_spare_consumption WHERE run_id = ?", [$runId]) as $c) {
                Database::execute("UPDATE spares_assets SET current_stock = current_stock + ? WHERE spare_id = ?", [(float)$c['quantity'], (int)$c['spare_id']]);
            }
            Database::execute("DELETE FROM spare_asset_movements WHERE reference = ? AND movement_type = 'out'", ['Production run #' . $runId]);
            Database::execute("DELETE FROM production_spare_consumption WHERE run_id = ?", [$runId]);
        } catch (\Throwable $e) {
            // spare-consumption table not present — nothing to reverse
        }
        $outs = Database::fetchAll("SELECT product_id, quantity FROM production_outputs WHERE run_id = ?", [$runId]);
        if ($outs) {
            foreach ($outs as $o) {
                Database::execute("UPDATE products SET stock_quantity = GREATEST(stock_quantity - ?, 0) WHERE product_id = ?", [(float)$o['quantity'], (int)$o['product_id']]);
            }
        } else {
            $r = Database::fetch("SELECT product_id, output_quantity FROM production_runs WHERE run_id = ?", [$runId]);
            if ($r) Database::execute("UPDATE products SET stock_quantity = GREATEST(stock_quantity - ?, 0) WHERE product_id = ?", [(float)$r['output_quantity'], (int)$r['product_id']]);
        }
        Database::execute("DELETE FROM raw_material_movements WHERE run_id = ?", [$runId]);
        Database::execute("DELETE FROM stock_movements WHERE run_id = ?", [$runId]);
        Database::execute("DELETE FROM production_consumption WHERE run_id = ?", [$runId]);
        Database::execute("DELETE FROM production_outputs WHERE run_id = ?", [$runId]);
        Database::execute("DELETE FROM production_quality WHERE run_id = ?", [$runId]);
    }

    /**
     * Log a production run: consume raw materials and add finished goods, all atomic.
     * $consumption = [ ['raw_material_id'=>int,'quantity'=>float], ... ]
     */
    public static function createProductionRun(array $d, array $consumption, ?int $userId): array
    {
        $outputs = self::resolveOutputs($d);
        $primary = $outputs[0];
        $shift = in_array(($d['shift'] ?? 'general'), ['day', 'night', 'general'], true) ? $d['shift'] : 'general';
        $date  = self::validDate($d['run_date'] ?? null);

        Database::beginTransaction();
        try {
            // production_runs keeps the primary output denormalized (product_id/output_quantity).
            $runId = Database::insert(
                "INSERT INTO production_runs (run_date, product_id, batch_number, output_quantity, unit, shift, operator_name, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    $date, $primary['product_id'],
                    ($d['batch_number'] ?? null) ? trim((string)$d['batch_number']) : null,
                    $primary['quantity'], $primary['unit'], $shift,
                    ($d['operator_name'] ?? null) ? trim((string)$d['operator_name']) : null,
                    ($d['notes'] ?? null) ? trim((string)$d['notes']) : null,
                    $userId,
                ]
            );
            self::applyRunChildren($runId, $outputs, $consumption, $date, $d, $userId);
            Database::commit();
        } catch (\Throwable $e) {
            Database::rollBack();
            throw $e;
        }

        return self::productionRun($runId) ?? ['run_id' => 0];
    }

    /**
     * Edit a run in place: reverse its previous stock effects, then re-apply the new
     * outputs / consumption / quality. Atomic, so stock stays correct after an edit.
     */
    public static function updateProductionRun(int $runId, array $d, array $consumption, ?int $userId): array
    {
        if (!Database::fetch("SELECT run_id FROM production_runs WHERE run_id = ? LIMIT 1", [$runId])) {
            Response::error('Production run not found', 404);
        }
        $outputs = self::resolveOutputs($d);
        $primary = $outputs[0];
        $shift = in_array(($d['shift'] ?? 'general'), ['day', 'night', 'general'], true) ? $d['shift'] : 'general';
        $date  = self::validDate($d['run_date'] ?? null);

        Database::beginTransaction();
        try {
            self::reverseRunChildren($runId);
            Database::execute(
                "UPDATE production_runs SET run_date = ?, product_id = ?, batch_number = ?, output_quantity = ?, unit = ?, shift = ?, operator_name = ?, notes = ? WHERE run_id = ?",
                [
                    $date, $primary['product_id'],
                    ($d['batch_number'] ?? null) ? trim((string)$d['batch_number']) : null,
                    $primary['quantity'], $primary['unit'], $shift,
                    ($d['operator_name'] ?? null) ? trim((string)$d['operator_name']) : null,
                    ($d['notes'] ?? null) ? trim((string)$d['notes']) : null,
                    $runId,
                ]
            );
            self::applyRunChildren($runId, $outputs, $consumption, $date, $d, $userId);
            Database::commit();
        } catch (\Throwable $e) {
            Database::rollBack();
            throw $e;
        }

        return self::productionRun($runId) ?? ['run_id' => 0];
    }

    /** True if any quality field carries a value worth persisting. */
    private static function qualityHasData(array $q): bool
    {
        foreach (['moisture_pct', 'ash_pct', 'gcv', 'fines_pct', 'diameter_mm', 'durability_pct', 'inspector', 'notes'] as $k) {
            if (($q[$k] ?? '') !== '' && ($q[$k] ?? null) !== null) return true;
        }
        return ($q['result'] ?? 'pending') !== 'pending';
    }

    // ---- Finished goods stock -------------------------------------------------

    public static function stock(?string $category = null): array
    {
        $where = ['is_deleted = 0'];
        $params = [];
        if ($category && $category !== 'all') { $where[] = 'category = ?'; $params[] = $category; }
        $rows = Database::fetchAll(
            "SELECT product_id, product_name, product_type, category, unit,
                    stock_quantity, reorder_level, base_price
               FROM products
              WHERE " . implode(' AND ', $where) . "
              ORDER BY category ASC, product_name ASC",
            $params
        );
        return array_map(static function (array $r): array {
            $stock  = (float)$r['stock_quantity'];
            $reorder = (float)$r['reorder_level'];
            return [
                'product_id'     => (int)$r['product_id'],
                'product_name'   => $r['product_name'],
                'product_type'   => $r['product_type'],
                'category'       => $r['category'] ?? $r['product_type'],
                'unit'           => $r['unit'] ?? 'kg',
                'stock_quantity' => $stock,
                'reorder_level'  => $reorder,
                'base_price'     => (float)$r['base_price'],
                'stock_value'    => round($stock * (float)$r['base_price'], 2),
                'low_stock'      => $reorder > 0 && $stock <= $reorder,
            ];
        }, $rows);
    }

    public static function stockByCategory(): array
    {
        $rows = Database::fetchAll(
            "SELECT COALESCE(NULLIF(category, ''), product_type) AS category,
                    COUNT(*) AS sku_count,
                    SUM(stock_quantity) AS total_stock,
                    SUM(stock_quantity * base_price) AS stock_value,
                    SUM(CASE WHEN reorder_level > 0 AND stock_quantity <= reorder_level THEN 1 ELSE 0 END) AS low_count
               FROM products
              WHERE is_deleted = 0
              GROUP BY COALESCE(NULLIF(category, ''), product_type)
              ORDER BY category ASC"
        );
        return array_map(static function (array $r): array {
            return [
                'category'    => $r['category'],
                'sku_count'   => (int)$r['sku_count'],
                'total_stock' => (float)$r['total_stock'],
                'stock_value' => round((float)$r['stock_value'], 2),
                'low_count'   => (int)$r['low_count'],
            ];
        }, $rows);
    }

    /** Manual finished-goods stock movement (adjustment/return/etc). */
    public static function stockMovement(int $productId, string $type, float $qty, string $source, ?string $reference, ?string $notes, ?string $date, ?int $userId, ?int $orderId = null): array
    {
        $product = Database::fetch("SELECT product_id FROM products WHERE product_id = ? LIMIT 1", [$productId]);
        if (!$product) Response::error('Product not found', 404);
        $date = self::validDate($date);

        Database::beginTransaction();
        try {
            Database::insert(
                "INSERT INTO stock_movements (product_id, movement_type, source, quantity, reference, notes, movement_date, order_id, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [$productId, $type, $source, $qty, $reference, $notes, $date, $orderId, $userId]
            );
            if ($type === 'in') {
                Database::execute("UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?", [$qty, $productId]);
            } elseif ($type === 'out') {
                Database::execute("UPDATE products SET stock_quantity = GREATEST(stock_quantity - ?, 0) WHERE product_id = ?", [$qty, $productId]);
            } else {
                Database::execute("UPDATE products SET stock_quantity = ? WHERE product_id = ?", [$qty, $productId]);
            }
            Database::commit();
        } catch (\Throwable $e) {
            Database::rollBack();
            throw $e;
        }
        $rows = self::stock();
        foreach ($rows as $r) if ($r['product_id'] === $productId) return $r;
        return ['product_id' => $productId];
    }

    /**
     * Deduct finished-goods stock for a dispatched order. Idempotent per order:
     * if an 'order' movement already exists for this order it is a no-op, so
     * re-running across shipped/delivered transitions never double-deducts.
     */
    public static function deductForOrder(int $orderId, ?int $userId): void
    {
        $already = Database::fetch(
            "SELECT 1 FROM stock_movements WHERE order_id = ? AND source = 'order' AND movement_type = 'out' LIMIT 1",
            [$orderId]
        );
        if ($already) return;

        $items = Database::fetchAll(
            "SELECT product_id, SUM(quantity) AS qty FROM order_items WHERE order_id = ? GROUP BY product_id",
            [$orderId]
        );
        if (!$items) return;

        Database::beginTransaction();
        try {
            foreach ($items as $it) {
                $pid = (int)$it['product_id'];
                $q   = (float)$it['qty'];
                if ($pid <= 0 || $q <= 0) continue;
                Database::insert(
                    "INSERT INTO stock_movements (product_id, movement_type, source, quantity, reference, movement_date, order_id, created_by)
                     VALUES (?, 'out', 'order', ?, ?, CURDATE(), ?, ?)",
                    [$pid, $q, 'Order dispatch #' . $orderId, $orderId, $userId]
                );
                Database::execute("UPDATE products SET stock_quantity = GREATEST(stock_quantity - ?, 0) WHERE product_id = ?", [$q, $pid]);
            }
            Database::commit();
        } catch (\Throwable $e) {
            Database::rollBack();
            throw $e;
        }
    }

    /**
     * Restore finished-goods stock previously deducted for an order that is now
     * cancelled or returned. Idempotent: it only reverses a real prior 'out'
     * deduction, restores exactly the quantities read back from the movement
     * ledger (not from order_items, which may have changed), and never runs
     * twice — a guard on an existing 'in' order-return movement makes repeated
     * cancel/return transitions a no-op.
     */
    public static function restoreForOrder(int $orderId, ?int $userId): void
    {
        // Only reverse an order that was actually dispatched (has an 'out' movement).
        $deducted = Database::fetchAll(
            "SELECT product_id, SUM(quantity) AS qty
               FROM stock_movements
              WHERE order_id = ? AND source = 'order' AND movement_type = 'out'
              GROUP BY product_id",
            [$orderId]
        );
        if (!$deducted) return;

        // Already restored once — no-op so cancel/return can be re-applied safely.
        $already = Database::fetch(
            "SELECT 1 FROM stock_movements WHERE order_id = ? AND source = 'order' AND movement_type = 'in' LIMIT 1",
            [$orderId]
        );
        if ($already) return;

        Database::beginTransaction();
        try {
            foreach ($deducted as $it) {
                $pid = (int)$it['product_id'];
                $q   = (float)$it['qty'];
                if ($pid <= 0 || $q <= 0) continue;
                Database::insert(
                    "INSERT INTO stock_movements (product_id, movement_type, source, quantity, reference, movement_date, order_id, created_by)
                     VALUES (?, 'in', 'order', ?, ?, CURDATE(), ?, ?)",
                    [$pid, $q, 'Order return/cancel #' . $orderId, $orderId, $userId]
                );
                Database::execute("UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?", [$q, $pid]);
            }
            Database::commit();
        } catch (\Throwable $e) {
            Database::rollBack();
            throw $e;
        }
    }

    // ---- Movements ledger -----------------------------------------------------

    public static function finishedMovements(int $limit = 100): array
    {
        $rows = Database::fetchAll(
            "SELECT sm.stock_movement_id, sm.product_id, p.product_name, sm.movement_type, sm.source,
                    sm.quantity, sm.reference, sm.notes, sm.movement_date, sm.created_at
               FROM stock_movements sm
               JOIN products p ON p.product_id = sm.product_id
              ORDER BY sm.movement_date DESC, sm.stock_movement_id DESC
              LIMIT ?",
            [$limit]
        );
        return array_map(static function (array $r): array {
            $r['stock_movement_id'] = (int)$r['stock_movement_id'];
            $r['product_id']        = (int)$r['product_id'];
            $r['quantity']          = (float)$r['quantity'];
            $r['kind']              = 'finished';
            return $r;
        }, $rows);
    }

    public static function rawMovements(int $limit = 100): array
    {
        $rows = Database::fetchAll(
            "SELECT rmm.movement_id, rmm.raw_material_id, rm.name AS material_name, rmm.movement_type,
                    rmm.quantity, rmm.reference, rmm.notes, rmm.movement_date, rmm.created_at
               FROM raw_material_movements rmm
               JOIN raw_materials rm ON rm.raw_material_id = rmm.raw_material_id
              ORDER BY rmm.movement_date DESC, rmm.movement_id DESC
              LIMIT ?",
            [$limit]
        );
        return array_map(static function (array $r): array {
            $r['movement_id']     = (int)$r['movement_id'];
            $r['raw_material_id'] = (int)$r['raw_material_id'];
            $r['quantity']        = (float)$r['quantity'];
            $r['kind']            = 'raw';
            return $r;
        }, $rows);
    }

    public static function spareMovements(int $limit = 100): array
    {
        $rows = Database::fetchAll(
            "SELECT sam.movement_id, sam.spare_id, sa.name AS spare_name, sam.movement_type,
                    sam.quantity, sam.reference, sam.notes, sam.movement_date, sam.created_at
               FROM spare_asset_movements sam
               JOIN spares_assets sa ON sa.spare_id = sam.spare_id
              ORDER BY sam.movement_date DESC, sam.movement_id DESC
              LIMIT ?",
            [$limit]
        );
        return array_map(static function (array $r): array {
            $r['movement_id'] = (int)$r['movement_id'];
            $r['spare_id']    = (int)$r['spare_id'];
            $r['quantity']    = (float)$r['quantity'];
            $r['kind']        = 'spare';
            return $r;
        }, $rows);
    }

    // ---- Suggestions ----------------------------------------------------------

    public static function suggestions(): array
    {
        $raw = Database::fetchAll(
            "SELECT raw_material_id, name, unit, current_stock, reorder_level
               FROM raw_materials
              WHERE is_active = 1 AND reorder_level > 0 AND current_stock <= reorder_level
              ORDER BY (current_stock / NULLIF(reorder_level,0)) ASC"
        );
        $finished = Database::fetchAll(
            "SELECT product_id, product_name, COALESCE(NULLIF(category,''),product_type) AS category,
                    unit, stock_quantity, reorder_level
               FROM products
              WHERE is_deleted = 0 AND reorder_level > 0 AND stock_quantity <= reorder_level
              ORDER BY (stock_quantity / NULLIF(reorder_level,0)) ASC"
        );
        $mapRaw = array_map(static function (array $r): array {
            $reorder = (float)$r['reorder_level'];
            $cur = (float)$r['current_stock'];
            return [
                'kind' => 'raw', 'id' => (int)$r['raw_material_id'], 'name' => $r['name'],
                'unit' => $r['unit'], 'current' => $cur, 'reorder_level' => $reorder,
                'suggested_order' => round(max($reorder * 2 - $cur, $reorder), 2),
            ];
        }, $raw);
        $mapFin = array_map(static function (array $r): array {
            $reorder = (float)$r['reorder_level'];
            $cur = (float)$r['stock_quantity'];
            return [
                'kind' => 'finished', 'id' => (int)$r['product_id'], 'name' => $r['product_name'],
                'category' => $r['category'], 'unit' => $r['unit'], 'current' => $cur, 'reorder_level' => $reorder,
                'suggested_order' => round(max($reorder * 2 - $cur, $reorder), 2),
            ];
        }, $finished);
        return array_merge($mapRaw, $mapFin);
    }

    // ---- Dashboard overview ---------------------------------------------------

    public static function overview(): array
    {
        $rawAgg = Database::fetch(
            "SELECT COUNT(*) AS cnt,
                    SUM(CASE WHEN reorder_level > 0 AND current_stock <= reorder_level THEN 1 ELSE 0 END) AS low
               FROM raw_materials WHERE is_active = 1"
        ) ?: [];
        $finAgg = Database::fetch(
            "SELECT COUNT(*) AS cnt,
                    SUM(stock_quantity) AS total_stock,
                    SUM(stock_quantity * base_price) AS stock_value,
                    SUM(CASE WHEN reorder_level > 0 AND stock_quantity <= reorder_level THEN 1 ELSE 0 END) AS low
               FROM products WHERE is_deleted = 0"
        ) ?: [];
        $prod7 = Database::fetch(
            "SELECT COUNT(*) AS runs, COALESCE(SUM(output_quantity),0) AS output
               FROM production_runs WHERE run_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)"
        ) ?: [];
        $prod30 = Database::fetch(
            "SELECT COUNT(*) AS runs, COALESCE(SUM(output_quantity),0) AS output
               FROM production_runs WHERE run_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)"
        ) ?: [];
        // last 14 days production trend
        $trend = Database::fetchAll(
            "SELECT run_date, SUM(output_quantity) AS output
               FROM production_runs
              WHERE run_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
              GROUP BY run_date ORDER BY run_date ASC"
        );

        return [
            'raw_materials' => [
                'count'     => (int)($rawAgg['cnt'] ?? 0),
                'low_stock' => (int)($rawAgg['low'] ?? 0),
            ],
            'finished_goods' => [
                'sku_count'    => (int)($finAgg['cnt'] ?? 0),
                'total_stock'  => (float)($finAgg['total_stock'] ?? 0),
                'stock_value'  => round((float)($finAgg['stock_value'] ?? 0), 2),
                'low_stock'    => (int)($finAgg['low'] ?? 0),
            ],
            'production' => [
                'runs_7d'    => (int)($prod7['runs'] ?? 0),
                'output_7d'  => (float)($prod7['output'] ?? 0),
                'runs_30d'   => (int)($prod30['runs'] ?? 0),
                'output_30d' => (float)($prod30['output'] ?? 0),
            ],
            'trend' => array_map(static fn(array $r) => [
                'date' => $r['run_date'], 'output' => (float)$r['output'],
            ], $trend),
            'category_stock'    => self::stockByCategory(),
            'recent_movements'  => array_slice(self::finishedMovements(8), 0, 8),
            'suggestions'       => self::suggestions(),
        ];
    }

    // ---- helpers --------------------------------------------------------------

    private static function findRawMaterial(int $id): array
    {
        $row = self::findRawMaterialRow($id);
        return $row ? self::formatRawMaterial($row) : ['raw_material_id' => $id];
    }

    private static function findRawMaterialRow(int $id): ?array
    {
        return Database::fetch(
            "SELECT raw_material_id, name, unit, current_stock, reorder_level, supplier, is_active
               FROM raw_materials WHERE raw_material_id = ? LIMIT 1",
            [$id]
        );
    }

    private static function formatRawMaterial(array $r): array
    {
        $stock = (float)$r['current_stock'];
        $reorder = (float)$r['reorder_level'];
        return [
            'raw_material_id' => (int)$r['raw_material_id'],
            'name'            => $r['name'],
            'unit'            => $r['unit'],
            'current_stock'   => $stock,
            'reorder_level'   => $reorder,
            'supplier'        => $r['supplier'],
            'is_active'       => (int)$r['is_active'] === 1,
            'low_stock'       => $reorder > 0 && $stock <= $reorder,
        ];
    }

    private static function validDate(?string $date): string
    {
        if ($date && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return $date;
        return date('Y-m-d');
    }
}

<?php
declare(strict_types=1);

/**
 * Admin Inventory / Production Controller
 *
 * Dashboard, raw materials, daily production runs, finished-goods stock,
 * stock ledgers and reorder suggestions for the pellet plant.
 */
class AdminInventoryController
{
    private function userId(Request $request): ?int
    {
        return isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
    }

    /**
     * Central audit trail for master-data + production mutations, matching the
     * pattern used across the app (AdminPurchaseOrderController etc.). Routine
     * stock in/out movements are already logged in the *_movements ledger.
     */
    private function audit(Request $request, string $action, string $table, int $id, mixed $before, mixed $after): void
    {
        Database::execute(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $this->userId($request),
                $action,
                $table,
                $id,
                $before !== null ? json_encode($before, JSON_UNESCAPED_UNICODE) : null,
                $after !== null ? json_encode($after, JSON_UNESCAPED_UNICODE) : null,
                $request->ip(),
            ]
        );
    }

    // ---- Dashboard ----
    public function overview(Request $request): void
    {
        Response::success(Inventory::overview(), 'Inventory overview');
    }

    // ---- Raw materials ----
    public function rawMaterials(Request $request): void
    {
        Response::success(Inventory::rawMaterials(), 'Raw materials');
    }

    public function storeRawMaterial(Request $request): void
    {
        $name = trim((string)$request->input('name', ''));
        if ($name === '') Response::error('Name is required', 422);
        $material = Inventory::createRawMaterial($request->all());
        $this->audit($request, 'create', 'raw_materials', (int)($material['raw_material_id'] ?? 0), null, $material);
        Response::success($material, 'Raw material added', 201);
    }

    public function updateRawMaterial(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) Response::error('Invalid id', 400);
        $material = Inventory::updateRawMaterial($id, $request->all());
        $this->audit($request, 'update', 'raw_materials', $id, null, $material);
        Response::success($material, 'Raw material updated');
    }

    public function destroyRawMaterial(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) Response::error('Invalid id', 400);
        Inventory::deleteRawMaterial($id);
        $this->audit($request, 'delete', 'raw_materials', $id, null, ['is_active' => 0]);
        Response::success(null, 'Raw material deactivated');
    }

    public function rawMaterialMovement(Request $request): void
    {
        $id   = (int)$request->param('id');
        $type = (string)$request->input('movement_type', 'in');
        if (!in_array($type, ['in', 'out', 'adjust'], true)) Response::error('movement_type must be in, out or adjust', 422);
        $qty  = (float)$request->input('quantity', 0);
        if ($qty < 0) Response::error('quantity must be >= 0', 422);
        $result = Inventory::rawMaterialMovement(
            $id, $type, $qty,
            $request->input('reference') ? trim((string)$request->input('reference')) : null,
            $request->input('notes') ? trim((string)$request->input('notes')) : null,
            $request->input('movement_date'),
            $this->userId($request)
        );
        Response::success($result, 'Stock movement recorded');
    }

    // ---- Production ----
    public function production(Request $request): void
    {
        Response::success(
            Inventory::productionRuns(
                $request->query('from'),
                $request->query('to'),
                min(500, max(1, (int)$request->query('limit', 100)))
            ),
            'Production runs'
        );
    }

    public function storeProduction(Request $request): void
    {
        $consumption = $request->input('consumption');
        $consumption = is_array($consumption) ? $consumption : [];
        $run = Inventory::createProductionRun($request->all(), $consumption, $this->userId($request));
        $this->audit($request, 'create', 'production_runs', (int)($run['run_id'] ?? 0), null, $run);
        Response::success($run, 'Production run logged', 201);
    }

    public function showProduction(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) Response::error('Invalid id', 400);
        $run = Inventory::productionRun($id);
        if (!$run) Response::error('Production run not found', 404);
        Response::success($run, 'Production run');
    }

    public function updateProduction(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) Response::error('Invalid id', 400);
        $consumption = $request->input('consumption');
        $consumption = is_array($consumption) ? $consumption : [];
        $run = Inventory::updateProductionRun($id, $request->all(), $consumption, $this->userId($request));
        $this->audit($request, 'update', 'production_runs', $id, null, $run);
        Response::success($run, 'Production run updated');
    }

    // ---- Finished-goods stock ----
    public function stock(Request $request): void
    {
        Response::success(Inventory::stock($request->query('category')), 'Finished goods stock');
    }

    public function stockCategories(Request $request): void
    {
        Response::success(Inventory::stockByCategory(), 'Stock by category');
    }

    public function stockMovement(Request $request): void
    {
        $productId = (int)$request->param('id');
        $type = (string)$request->input('movement_type', 'in');
        if (!in_array($type, ['in', 'out', 'adjust'], true)) Response::error('movement_type must be in, out or adjust', 422);
        $source = (string)$request->input('source', 'manual');
        if (!in_array($source, ['production', 'order', 'manual', 'return'], true)) $source = 'manual';
        $qty = (float)$request->input('quantity', 0);
        if ($qty < 0) Response::error('quantity must be >= 0', 422);
        $result = Inventory::stockMovement(
            $productId, $type, $qty, $source,
            $request->input('reference') ? trim((string)$request->input('reference')) : null,
            $request->input('notes') ? trim((string)$request->input('notes')) : null,
            $request->input('movement_date'),
            $this->userId($request)
        );
        Response::success($result, 'Stock movement recorded');
    }

    // ---- Spares & Assets ----
    public function spares(Request $request): void
    {
        Response::success(Inventory::sparesAssets($request->query('category')), 'Spares & assets');
    }

    public function storeSpare(Request $request): void
    {
        if (trim((string)$request->input('name', '')) === '') Response::error('Name is required', 422);
        $spare = Inventory::createSpare($request->all());
        $this->audit($request, 'create', 'spares_assets', (int)($spare['spare_id'] ?? 0), null, $spare);
        Response::success($spare, 'Spare / asset added', 201);
    }

    public function updateSpare(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) Response::error('Invalid id', 400);
        $spare = Inventory::updateSpare($id, $request->all());
        $this->audit($request, 'update', 'spares_assets', $id, null, $spare);
        Response::success($spare, 'Spare / asset updated');
    }

    public function destroySpare(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) Response::error('Invalid id', 400);
        Inventory::deleteSpare($id);
        $this->audit($request, 'delete', 'spares_assets', $id, null, ['is_active' => 0]);
        Response::success(null, 'Spare / asset deactivated');
    }

    public function spareMovement(Request $request): void
    {
        $id   = (int)$request->param('id');
        $type = (string)$request->input('movement_type', 'in');
        if (!in_array($type, ['in', 'out', 'adjust'], true)) Response::error('movement_type must be in, out or adjust', 422);
        $qty = (float)$request->input('quantity', 0);
        if ($qty < 0) Response::error('quantity must be >= 0', 422);
        $result = Inventory::spareMovement(
            $id, $type, $qty,
            $request->input('reference') ? trim((string)$request->input('reference')) : null,
            $request->input('notes') ? trim((string)$request->input('notes')) : null,
            $request->input('movement_date'),
            $this->userId($request)
        );
        Response::success($result, 'Spare movement recorded');
    }

    // ---- Movements ledger ----
    public function movements(Request $request): void
    {
        $kind  = (string)$request->query('kind', 'finished');
        $limit = min(300, max(1, (int)$request->query('limit', 100)));
        if ($kind === 'raw') {
            Response::success(Inventory::rawMovements($limit), 'Raw material movements');
        } elseif ($kind === 'spare') {
            Response::success(Inventory::spareMovements($limit), 'Spares & assets movements');
        } elseif ($kind === 'all') {
            $all = array_merge(Inventory::finishedMovements($limit), Inventory::rawMovements($limit), Inventory::spareMovements($limit));
            usort($all, static fn($a, $b) => strcmp((string)$b['movement_date'], (string)$a['movement_date']));
            Response::success(array_slice($all, 0, $limit), 'All stock movements');
        } else {
            Response::success(Inventory::finishedMovements($limit), 'Finished goods movements');
        }
    }

    // ---- Suggestions ----
    public function suggestions(Request $request): void
    {
        Response::success(Inventory::suggestions(), 'Reorder suggestions');
    }
}

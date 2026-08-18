<?php
declare(strict_types=1);

/**
 * Public Quote Controller (Minimal)
 */
class QuoteController
{
    // ─── POST /quotes ─────────────────────────────────────────────────────────
    public function store(Request $request): void
    {
        Validator::make($request->only(['name', 'email', 'phone', 'message']), [
            'name'    => 'required|string|max:100',
            'email'   => 'required|email|max:100',
            'phone'   => 'required|string|max:15',
            'message' => 'required|string',
        ])->validate();

        $userId = $request->user['user_id'] ?? null;
        if (!$userId) {
            Response::error('Authentication required. Must be logged in to request quotes.', 401);
        }

        // Savings calculator fields (optional — sent when quote comes from the calculator)
        $product          = Request::sanitize((string)($request->input('product') ?? '')) ?: null;
        $quantityPerMonth = ($v = $request->input('quantity_per_month')) !== null ? (float)$v : null;
        $currentFuel      = Request::sanitize((string)($request->input('current_fuel') ?? '')) ?: null;
        $currentCost      = ($v = $request->input('current_cost'))      !== null ? (float)$v : null;
        $biomassCost      = ($v = $request->input('biomass_cost'))       !== null ? (float)$v : null;
        $monthlySavings   = ($v = $request->input('monthly_savings'))    !== null ? (float)$v : null;
        $annualSavings    = ($v = $request->input('annual_savings'))     !== null ? (float)$v : null;

        Database::beginTransaction();
        try {
            $tempQuoteNum = 'QT-TEMP-' . uniqid();

            $quoteId = Database::insert(
                'INSERT INTO quotes (
                    user_id, quote_number, name, email, phone, message,
                    product, quantity_per_month, current_fuel, current_cost,
                    biomass_cost, monthly_savings, annual_savings,
                    status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "pending", NOW())',
                [
                    $userId,
                    $tempQuoteNum,
                    Request::sanitize((string)$request->input('name')),
                    Request::sanitize((string)$request->input('email')),
                    $request->input('phone'),
                    Request::sanitize((string)$request->input('message')),
                    $product,
                    $quantityPerMonth,
                    $currentFuel,
                    $currentCost,
                    $biomassCost,
                    $monthlySavings,
                    $annualSavings,
                ]
            );

            $quoteNumber = 'QT-' . date('Y') . '-' . str_pad((string)$quoteId, 4, '0', STR_PAD_LEFT);
            Database::execute('UPDATE quotes SET quote_number = ? WHERE quote_id = ?', [$quoteNumber, $quoteId]);

            Database::commit();
        } catch (\Throwable $e) {
            Database::rollBack();
            throw $e;
        }

        Response::success([
            'quote_id'     => $quoteId,
            'quote_number' => $quoteNumber,
            'status'       => 'pending',
            'created_at'   => date('Y-m-d\TH:i:s\Z'),
        ], 'Quote request submitted successfully', 201);
    }
}

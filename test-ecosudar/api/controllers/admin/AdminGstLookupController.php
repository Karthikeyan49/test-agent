<?php
declare(strict_types=1);

class AdminGstLookupController
{
    // GET /admin/gst-lookup?gstin=XXXXX
    public function lookup(Request $request): void
    {
        $gstin = strtoupper(trim((string)($request->query('gstin') ?? '')));
        $sellerState = trim((string)($request->query('seller_state') ?? ''));

        try {
            $details = GstinLookupService::lookup($gstin, $sellerState);
        } catch (InvalidArgumentException $e) {
            Response::error('Invalid GSTIN format', 422);
        }

        Response::success($details);
    }
}

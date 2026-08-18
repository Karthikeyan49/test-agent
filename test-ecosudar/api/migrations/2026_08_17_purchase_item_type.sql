-- Add item type (stock vs raw material) to the purchase items catalog.
-- 'stock'        → finished/tradeable goods bought for inventory
-- 'raw_material' → inputs consumed in production
ALTER TABLE purchase_items
  ADD COLUMN item_type VARCHAR(20) NOT NULL DEFAULT 'stock' AFTER category,
  ADD KEY idx_pi_type (item_type);

-- Normalization fix: link PO line items to the purchase catalog by a surrogate
-- key instead of the item name. Previously purchase_order_items only had a
-- `product_id` column pointing at the *sales* products table (always NULL for
-- purchases), and item↔PO matching relied on description = purchase_items.name
-- (breaks if an item is renamed). Add purchase_item_id and backfill by name.
ALTER TABLE purchase_order_items
  ADD COLUMN purchase_item_id INT NULL AFTER po_id,
  ADD KEY idx_poi_purchase_item (purchase_item_id);

-- Backfill existing rows by matching the line description to the catalog name.
UPDATE purchase_order_items poi
  JOIN purchase_items pi ON pi.name = poi.description
  SET poi.purchase_item_id = pi.purchase_item_id
  WHERE poi.purchase_item_id IS NULL;

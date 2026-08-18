-- ============================================================
-- Migration 006: Inventory Enhancements
-- Adds batch tracking, expiry dates, and zone min/max levels
-- Run once: php artisan migrate or execute directly in MySQL
-- ============================================================

-- 1. Batch number and expiry date on stock movements
ALTER TABLE inventory_stock_movements
  ADD COLUMN IF NOT EXISTS batch_number VARCHAR(50)  NULL COMMENT 'Auto-generated batch code e.g. ECO-20260613-4521' AFTER remarks,
  ADD COLUMN IF NOT EXISTS expiry_date  DATE          NULL COMMENT 'Product expiry/best-before date for this batch'  AFTER batch_number;

-- Index for fast expiry lookups (Intelligence expiring-soon queries)
CREATE INDEX IF NOT EXISTS idx_inv_movements_expiry
  ON inventory_stock_movements (expiry_date)
  WHERE expiry_date IS NOT NULL;

-- 2. Min / Max stock thresholds per zone
ALTER TABLE inventory_zones
  ADD COLUMN IF NOT EXISTS min_quantity DECIMAL(15,3) NOT NULL DEFAULT 0
    COMMENT 'Alert when zone stock falls below this level' AFTER capacity,
  ADD COLUMN IF NOT EXISTS max_quantity DECIMAL(15,3) NOT NULL DEFAULT 0
    COMMENT '0 = no upper limit; alert when zone stock exceeds this' AFTER min_quantity;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================

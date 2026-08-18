-- Migration 005: Add tracking_number, cancel_reason, refund_status to orders
--               Expand order_status enum to include 'out for delivery' and 'returned'
-- Run once on the server: mysql -u user -p db_name < 005_orders_extra_fields.sql

ALTER TABLE `orders`
  MODIFY COLUMN `order_status` ENUM('pending','confirmed','processing','shipped','out for delivery','delivered','cancelled','returned') NOT NULL DEFAULT 'pending',
  ADD COLUMN `tracking_number` VARCHAR(100)                             DEFAULT NULL AFTER `payment_method`,
  ADD COLUMN `cancel_reason`   TEXT                                     DEFAULT NULL AFTER `tracking_number`,
  ADD COLUMN `refund_status`   ENUM('N/A','Initiated','Processed') NOT NULL DEFAULT 'N/A' AFTER `cancel_reason`;

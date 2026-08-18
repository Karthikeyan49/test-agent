-- Purchase Items catalog — reusable master of items bought from vendors.
-- Feeds Purchase Order line items: choosing an item auto-fills its rate + GST.
CREATE TABLE IF NOT EXISTS purchase_items (
    purchase_item_id INT AUTO_INCREMENT PRIMARY KEY,
    item_code     VARCHAR(40)   NULL,
    name          VARCHAR(200)  NOT NULL,
    specification VARCHAR(500)  NULL,
    category      VARCHAR(120)  NULL,
    unit          VARCHAR(40)   NOT NULL DEFAULT 'nos',
    rate          DECIMAL(14,2) NOT NULL DEFAULT 0,
    gst_rate      DECIMAL(5,2)  NOT NULL DEFAULT 18,
    hsn_code      VARCHAR(20)   NULL,
    is_active     TINYINT(1)    NOT NULL DEFAULT 1,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP     NULL DEFAULT NULL,
    UNIQUE KEY uq_pi_code (item_code),
    KEY idx_pi_active (is_active),
    KEY idx_pi_name (name),
    KEY idx_pi_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

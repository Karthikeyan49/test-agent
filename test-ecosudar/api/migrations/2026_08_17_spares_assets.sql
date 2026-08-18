-- Spares & Assets: the third stock bucket — spare parts, tools, consumables and
-- assets bought via POs (item type 'stock'). Kept separate from products (the sales
-- catalog / finished goods) and raw_materials (production inputs).
CREATE TABLE IF NOT EXISTS spares_assets (
  spare_id      INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(200)  NOT NULL,
  category      VARCHAR(120)  NULL,
  unit          VARCHAR(40)   NOT NULL DEFAULT 'nos',
  current_stock DECIMAL(14,2) NOT NULL DEFAULT 0,
  reorder_level DECIMAL(14,2) NOT NULL DEFAULT 0,
  location      VARCHAR(120)  NULL,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_spare_name (name),
  KEY idx_spare_category (category),
  KEY idx_spare_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS spare_asset_movements (
  movement_id   INT AUTO_INCREMENT PRIMARY KEY,
  spare_id      INT NOT NULL,
  movement_type ENUM('in','out','adjust') NOT NULL,
  quantity      DECIMAL(14,2) NOT NULL,
  reference     VARCHAR(150) NULL,
  notes         VARCHAR(255) NULL,
  movement_date DATE NOT NULL,
  created_by    INT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sam_spare (spare_id),
  KEY idx_sam_date (movement_date),
  CONSTRAINT fk_sam_spare FOREIGN KEY (spare_id)
    REFERENCES spares_assets(spare_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

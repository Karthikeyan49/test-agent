-- Inventory / Production module for the pellet plant.
-- Finished-goods stock lives on products (single source of truth per SKU);
-- raw materials, production runs, and both stock ledgers are new normalized tables.
-- All FKs are InnoDB-enforced with explicit ON DELETE / ON UPDATE rules.

-- 1) Finished-goods stock counters on the product master ------------------------
ALTER TABLE products
  ADD COLUMN stock_quantity DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER is_available,
  ADD COLUMN reorder_level  DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER stock_quantity;

-- 2) Raw material master ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_materials (
  raw_material_id INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  unit          VARCHAR(20)  NOT NULL DEFAULT 'kg',
  current_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  reorder_level DECIMAL(12,2) NOT NULL DEFAULT 0,
  supplier      VARCHAR(150) NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_raw_material_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Production runs (daily output) ---------------------------------------------
CREATE TABLE IF NOT EXISTS production_runs (
  run_id          INT AUTO_INCREMENT PRIMARY KEY,
  run_date        DATE NOT NULL,
  product_id      INT NOT NULL,
  batch_number    VARCHAR(50) NULL,
  output_quantity DECIMAL(12,2) NOT NULL,
  unit            VARCHAR(20) NOT NULL DEFAULT 'kg',
  shift           ENUM('day','night','general') NOT NULL DEFAULT 'general',
  operator_name   VARCHAR(120) NULL,
  notes           TEXT NULL,
  created_by      INT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_prun_date (run_date),
  KEY idx_prun_product (product_id),
  CONSTRAINT fk_prun_product FOREIGN KEY (product_id)
    REFERENCES products(product_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) Raw material consumed by a production run (interlink) -----------------------
CREATE TABLE IF NOT EXISTS production_consumption (
  consumption_id  INT AUTO_INCREMENT PRIMARY KEY,
  run_id          INT NOT NULL,
  raw_material_id INT NOT NULL,
  quantity        DECIMAL(12,2) NOT NULL,
  KEY idx_pc_run (run_id),
  KEY idx_pc_material (raw_material_id),
  CONSTRAINT fk_pc_run FOREIGN KEY (run_id)
    REFERENCES production_runs(run_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pc_material FOREIGN KEY (raw_material_id)
    REFERENCES raw_materials(raw_material_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5) Raw material stock ledger ---------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_material_movements (
  movement_id     INT AUTO_INCREMENT PRIMARY KEY,
  raw_material_id INT NOT NULL,
  movement_type   ENUM('in','out','adjust') NOT NULL,
  quantity        DECIMAL(12,2) NOT NULL,
  reference       VARCHAR(150) NULL,
  notes           VARCHAR(255) NULL,
  movement_date   DATE NOT NULL,
  run_id          INT NULL,
  created_by      INT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rmm_material (raw_material_id),
  KEY idx_rmm_date (movement_date),
  CONSTRAINT fk_rmm_material FOREIGN KEY (raw_material_id)
    REFERENCES raw_materials(raw_material_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rmm_run FOREIGN KEY (run_id)
    REFERENCES production_runs(run_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6) Finished goods stock ledger -------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
  stock_movement_id INT AUTO_INCREMENT PRIMARY KEY,
  product_id     INT NOT NULL,
  movement_type  ENUM('in','out','adjust') NOT NULL,
  source         ENUM('production','order','manual','return') NOT NULL DEFAULT 'manual',
  quantity       DECIMAL(12,2) NOT NULL,
  reference      VARCHAR(150) NULL,
  notes          VARCHAR(255) NULL,
  movement_date  DATE NOT NULL,
  run_id         INT NULL,
  order_id       INT NULL,
  created_by     INT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sm_product (product_id),
  KEY idx_sm_date (movement_date),
  CONSTRAINT fk_sm_product FOREIGN KEY (product_id)
    REFERENCES products(product_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sm_run FOREIGN KEY (run_id)
    REFERENCES production_runs(run_id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_sm_order FOREIGN KEY (order_id)
    REFERENCES orders(order_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

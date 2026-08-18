-- Production tracking rebuild: multiple finished outputs per run + per-run quality.
-- production_runs keeps its primary product_id/output_quantity (denormalized first
-- output, back-compat with the overview/stock pages); production_outputs is the full
-- source of truth for what a run produced.

-- 1) Multiple finished outputs per run (pellets + byproduct/stock) ---------------
CREATE TABLE IF NOT EXISTS production_outputs (
  output_id  INT AUTO_INCREMENT PRIMARY KEY,
  run_id     INT NOT NULL,
  product_id INT NOT NULL,
  quantity   DECIMAL(12,2) NOT NULL,
  unit       VARCHAR(20)   NOT NULL DEFAULT 'kg',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pout_run (run_id),
  KEY idx_pout_product (product_id),
  CONSTRAINT fk_pout_run FOREIGN KEY (run_id)
    REFERENCES production_runs(run_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pout_product FOREIGN KEY (product_id)
    REFERENCES products(product_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Per-run quality inspection --------------------------------------------------
CREATE TABLE IF NOT EXISTS production_quality (
  quality_id     INT AUTO_INCREMENT PRIMARY KEY,
  run_id         INT NOT NULL,
  moisture_pct   DECIMAL(6,2) NULL,
  ash_pct        DECIMAL(6,2) NULL,
  gcv            DECIMAL(8,2) NULL,   -- gross calorific value (kcal/kg)
  fines_pct      DECIMAL(6,2) NULL,
  diameter_mm    DECIMAL(6,2) NULL,
  durability_pct DECIMAL(6,2) NULL,
  result         ENUM('pass','fail','pending') NOT NULL DEFAULT 'pending',
  inspector      VARCHAR(120) NULL,
  notes          VARCHAR(500) NULL,
  checked_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pq_run (run_id),
  CONSTRAINT fk_pq_run FOREIGN KEY (run_id)
    REFERENCES production_runs(run_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

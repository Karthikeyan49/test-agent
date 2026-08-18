-- Spares & Assets consumed as a production input (dies, filters, lubricants,
-- consumables used up during a run). Kept in its own table so the existing
-- raw-material consumption path (production_consumption) is untouched.
CREATE TABLE IF NOT EXISTS production_spare_consumption (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  run_id    INT NOT NULL,
  spare_id  INT NOT NULL,
  quantity  DECIMAL(14,2) NOT NULL,
  KEY idx_psc_run (run_id),
  KEY idx_psc_spare (spare_id),
  CONSTRAINT fk_psc_run FOREIGN KEY (run_id)
    REFERENCES production_runs(run_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_psc_spare FOREIGN KEY (spare_id)
    REFERENCES spares_assets(spare_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

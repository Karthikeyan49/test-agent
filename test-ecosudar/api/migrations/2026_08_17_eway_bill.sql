-- E-way bill (Option A: portal-assisted). One per invoice. Holds the transport
-- details entered in the ERP + the EWB number/validity returned from the NIC portal.
-- No legally-valid number is minted here; the ERP produces the NIC bulk JSON and stores
-- what the portal gives back.
CREATE TABLE IF NOT EXISTS eway_bills (
  eway_id            INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id         INT NOT NULL,
  supply_type        VARCHAR(4)   NULL DEFAULT 'O',   -- O outward / I inward
  sub_supply         VARCHAR(4)   NULL DEFAULT '1',   -- 1 supply
  doc_type           VARCHAR(8)   NULL DEFAULT 'INV',
  trans_mode         VARCHAR(4)   NULL DEFAULT '1',   -- 1 road 2 rail 3 air 4 ship
  vehicle_no         VARCHAR(20)  NULL,
  vehicle_type       VARCHAR(2)   NULL DEFAULT 'R',   -- R regular / O over-dimensional
  transporter_id     VARCHAR(20)  NULL,
  transporter_name   VARCHAR(150) NULL,
  transport_doc_no   VARCHAR(40)  NULL,
  transport_doc_date DATE         NULL,
  distance_km        INT          NULL DEFAULT 0,
  from_gstin         VARCHAR(20)  NULL,
  from_name          VARCHAR(150) NULL,
  from_addr          VARCHAR(200) NULL,
  from_place         VARCHAR(120) NULL,
  from_pincode       VARCHAR(10)  NULL,
  from_state         VARCHAR(60)  NULL,
  to_place           VARCHAR(120) NULL,
  to_pincode         VARCHAR(10)  NULL,
  ewb_no             VARCHAR(20)  NULL,
  ewb_date           DATE         NULL,
  valid_until        DATE         NULL,
  notes              VARCHAR(255) NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_eway_invoice (invoice_id),
  CONSTRAINT fk_eway_invoice FOREIGN KEY (invoice_id)
    REFERENCES invoices(invoice_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

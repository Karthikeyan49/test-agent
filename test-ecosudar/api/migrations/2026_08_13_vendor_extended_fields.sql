-- Zoho-style extended vendor fields.
-- Additive + nullable/defaulted, so existing rows and code paths keep working.
-- Legacy columns are reused: name = Display Name, phone = Work Phone,
-- address/city/state/pincode = Billing street1/city/state/pincode, notes = Remarks.

ALTER TABLE vendors
  -- Primary contact + company
  ADD COLUMN salutation          VARCHAR(20)  NULL AFTER name,
  ADD COLUMN first_name          VARCHAR(100) NULL AFTER salutation,
  ADD COLUMN last_name           VARCHAR(100) NULL AFTER first_name,
  ADD COLUMN company_name        VARCHAR(200) NULL AFTER last_name,
  ADD COLUMN mobile              VARCHAR(30)  NULL AFTER phone,
  -- Other details
  ADD COLUMN pan                 VARCHAR(20)  NULL AFTER gstin,
  ADD COLUMN msme_registered     TINYINT(1)   NOT NULL DEFAULT 0 AFTER pan,
  ADD COLUMN opening_balance     DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER msme_registered,
  -- Billing address extras (street1/city/state/pincode reuse address/city/state/pincode)
  ADD COLUMN billing_attention   VARCHAR(150) NULL,
  ADD COLUMN billing_country     VARCHAR(100) NULL,
  ADD COLUMN billing_street2     VARCHAR(255) NULL,
  ADD COLUMN billing_phone       VARCHAR(30)  NULL,
  ADD COLUMN billing_fax         VARCHAR(30)  NULL,
  -- Shipping address (full set)
  ADD COLUMN shipping_attention  VARCHAR(150) NULL,
  ADD COLUMN shipping_country    VARCHAR(100) NULL,
  ADD COLUMN shipping_street1    VARCHAR(255) NULL,
  ADD COLUMN shipping_street2    VARCHAR(255) NULL,
  ADD COLUMN shipping_city       VARCHAR(100) NULL,
  ADD COLUMN shipping_state      VARCHAR(100) NULL,
  ADD COLUMN shipping_pincode    VARCHAR(20)  NULL,
  ADD COLUMN shipping_phone      VARCHAR(30)  NULL,
  ADD COLUMN shipping_fax        VARCHAR(30)  NULL,
  -- Bank details
  ADD COLUMN bank_account_holder VARCHAR(150) NULL,
  ADD COLUMN bank_name           VARCHAR(150) NULL,
  ADD COLUMN bank_account_number VARCHAR(50)  NULL,
  ADD COLUMN bank_ifsc           VARCHAR(20)  NULL;

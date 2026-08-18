-- Add delivery challan + sales order to the sales document types.
ALTER TABLE sales_documents
  MODIFY COLUMN document_type ENUM('quotation','proforma','delivery_challan','sales_order') NOT NULL;

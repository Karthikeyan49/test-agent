-- Demo ERP Database Schema: PostgreSQL / SQLite Compatible
-- Represents core entities: Customer, Product, Inventory, Sales Order, Invoice, Payment, Accounting

CREATE TABLE customers (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    credit_limit DECIMAL(12, 2) DEFAULT 10000.00,
    outstanding_balance DECIMAL(12, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id VARCHAR(36) PRIMARY KEY,
    sku VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    stock_quantity INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sales_orders (
    id VARCHAR(36) PRIMARY KEY,
    order_number VARCHAR(64) UNIQUE NOT NULL,
    customer_id VARCHAR(36) NOT NULL,
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) DEFAULT 'DRAFT', -- DRAFT, CONFIRMED, INVOICED, CANCELLED
    subtotal DECIMAL(12, 2) NOT NULL,
    tax DECIMAL(12, 2) NOT NULL,
    discount DECIMAL(12, 2) DEFAULT 0.00,
    grand_total DECIMAL(12, 2) NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE sales_order_items (
    id VARCHAR(36) PRIMARY KEY,
    sales_order_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    line_total DECIMAL(12, 2) NOT NULL,
    FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE invoices (
    id VARCHAR(36) PRIMARY KEY,
    invoice_number VARCHAR(64) UNIQUE NOT NULL,
    sales_order_id VARCHAR(36) NOT NULL,
    customer_id VARCHAR(36) NOT NULL,
    issue_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    due_date TIMESTAMP NOT NULL,
    amount_due DECIMAL(12, 2) NOT NULL,
    status VARCHAR(32) DEFAULT 'UNPAID', -- UNPAID, PARTIAL, PAID
    FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE payments (
    id VARCHAR(36) PRIMARY KEY,
    payment_number VARCHAR(64) UNIQUE NOT NULL,
    invoice_id VARCHAR(36) NOT NULL,
    customer_id VARCHAR(36) NOT NULL,
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    amount_paid DECIMAL(12, 2) NOT NULL,
    payment_method VARCHAR(32) NOT NULL, -- CREDIT_CARD, BANK_TRANSFER, CASH
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE ledger_entries (
    id VARCHAR(36) PRIMARY KEY,
    reference_type VARCHAR(32) NOT NULL, -- INVOICE, PAYMENT
    reference_id VARCHAR(36) NOT NULL,
    account_code VARCHAR(32) NOT NULL,
    debit DECIMAL(12, 2) DEFAULT 0.00,
    credit DECIMAL(12, 2) DEFAULT 0.00,
    entry_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

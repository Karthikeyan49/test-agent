-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3306
-- Generation Time: Aug 17, 2026 at 02:53 PM
-- Server version: 11.8.8-MariaDB-log
-- PHP Version: 7.2.34

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `u952547820_test`
--

DELIMITER $$
--
-- Procedures
--
CREATE DEFINER=`u952547820_test`@`localhost` PROCEDURE `sp_generate_order_number` (OUT `new_order_number` VARCHAR(50))   BEGIN
    DECLARE order_count INT;
    DECLARE order_prefix VARCHAR(10);
    
    SELECT setting_value INTO order_prefix 
    FROM settings 
    WHERE setting_key = 'order_prefix';
    
    SELECT COUNT(*) INTO order_count FROM orders;
    
    SET new_order_number = CONCAT(
        order_prefix,
        '-',
        DATE_FORMAT(NOW(), '%Y%m%d'),
        LPAD(order_count + 1, 4, '0')
    );
END$$

CREATE DEFINER=`u952547820_test`@`localhost` PROCEDURE `sp_get_active_orders_count` ()   BEGIN
    SELECT COUNT(*) AS active_orders_count
    FROM orders
    WHERE order_status IN ('pending', 'confirmed', 'processing', 'shipped');
END$$

CREATE DEFINER=`u952547820_test`@`localhost` PROCEDURE `sp_get_order_details` (IN `p_order_id` INT)   BEGIN
    
    SELECT 
        o.*,
        u.name AS customer_name,
        u.email,
        u.phone,
        u.user_type,
        u.company_name,
        u.gst_number
    FROM orders o
    JOIN users u ON o.user_id = u.user_id
    WHERE o.order_id = p_order_id;
    
    
    SELECT 
        oi.*,
        p.product_name,
        p.product_type,
        p.description
    FROM order_items oi
    JOIN products p ON oi.product_id = p.product_id
    WHERE oi.order_id = p_order_id;
END$$

CREATE DEFINER=`u952547820_test`@`localhost` PROCEDURE `sp_get_order_statistics` (IN `p_days` INT)   BEGIN
    SELECT 
        DATE(created_at) AS order_date,
        COUNT(*) AS total_orders,
        SUM(total_amount) AS total_revenue,
        AVG(total_amount) AS avg_order_value,
        COUNT(CASE WHEN order_status = 'delivered' THEN 1 END) AS delivered_orders,
        COUNT(CASE WHEN order_status = 'cancelled' THEN 1 END) AS cancelled_orders
    FROM orders
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL p_days DAY)
    GROUP BY DATE(created_at)
    ORDER BY order_date DESC;
END$$

CREATE DEFINER=`u952547820_test`@`localhost` PROCEDURE `sp_get_user_orders` (IN `p_user_id` INT)   BEGIN
    SELECT 
        o.order_id,
        o.order_number,
        o.total_amount,
        o.delivery_fee,
        o.order_status,
        o.payment_status,
        o.created_at,
        COUNT(oi.item_id) AS total_items,
        SUM(oi.quantity) AS total_quantity
    FROM orders o
    LEFT JOIN order_items oi ON o.order_id = oi.order_id
    WHERE o.user_id = p_user_id
    GROUP BY o.order_id
    ORDER BY o.created_at DESC;
END$$

DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `attachments`
--

CREATE TABLE `attachments` (
  `attachment_id` int(11) NOT NULL,
  `entity_type` varchar(40) NOT NULL,
  `entity_id` int(11) NOT NULL,
  `category` varchar(40) DEFAULT NULL,
  `caption` varchar(255) DEFAULT NULL,
  `file_path` varchar(500) NOT NULL,
  `thumbnail_path` varchar(500) DEFAULT NULL,
  `original_name` varchar(255) DEFAULT NULL,
  `mime_type` varchar(100) DEFAULT NULL,
  `size_bytes` int(11) DEFAULT NULL,
  `storage_disk` enum('local','external') NOT NULL DEFAULT 'local',
  `metadata_json` text DEFAULT NULL,
  `uploaded_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `attendance`
--

CREATE TABLE `attendance` (
  `attendance_id` int(11) NOT NULL,
  `employee_key` varchar(12) NOT NULL,
  `date` date NOT NULL,
  `shift_id` int(11) DEFAULT NULL,
  `check_in` datetime DEFAULT NULL,
  `check_out` datetime DEFAULT NULL,
  `hours_worked` decimal(4,2) DEFAULT NULL,
  `scheduled_hours` decimal(5,2) NOT NULL DEFAULT 8.00,
  `late_minutes` int(11) NOT NULL DEFAULT 0,
  `overtime_hours` decimal(8,2) NOT NULL DEFAULT 0.00,
  `status` enum('Present','Half-day','Absent','Leave') NOT NULL DEFAULT 'Present',
  `is_auto_marked` tinyint(1) NOT NULL DEFAULT 0,
  `source` enum('manual','qr','auto','tms') NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `attendance_punches`
--

CREATE TABLE `attendance_punches` (
  `punch_id` int(11) NOT NULL,
  `employee_key` varchar(12) NOT NULL,
  `punch_timestamp` datetime NOT NULL,
  `direction` varchar(10) NOT NULL DEFAULT 'unknown',
  `external_punch_id` varchar(120) DEFAULT NULL,
  `import_job_id` int(11) DEFAULT NULL,
  `raw_json` text DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'imported',
  `error_text` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `attendance_shifts`
--

CREATE TABLE `attendance_shifts` (
  `shift_id` int(11) NOT NULL,
  `name` varchar(120) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `working_hours` decimal(5,2) NOT NULL DEFAULT 8.00,
  `grace_minutes` int(11) NOT NULL DEFAULT 0,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `audit_log`
--

CREATE TABLE `audit_log` (
  `log_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `table_name` varchar(50) DEFAULT NULL,
  `record_id` int(11) DEFAULT NULL,
  `old_value` text DEFAULT NULL,
  `new_value` text DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `backup_runs`
--

CREATE TABLE `backup_runs` (
  `backup_id` int(11) NOT NULL,
  `backup_type` varchar(20) NOT NULL DEFAULT 'database',
  `file_path` varchar(500) DEFAULT NULL,
  `size_bytes` bigint(20) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'running',
  `started_at` datetime NOT NULL DEFAULT current_timestamp(),
  `finished_at` datetime DEFAULT NULL,
  `error_text` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `benchmarks`
--

CREATE TABLE `benchmarks` (
  `benchmark_id` int(11) NOT NULL,
  `metric` varchar(60) NOT NULL,
  `target_value` decimal(14,4) NOT NULL,
  `unit` varchar(10) DEFAULT NULL,
  `comparison` varchar(4) NOT NULL DEFAULT 'gte',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `notes` varchar(255) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `budgets`
--

CREATE TABLE `budgets` (
  `budget_id` int(11) NOT NULL,
  `name` varchar(120) NOT NULL,
  `fiscal_year` varchar(9) NOT NULL,
  `period_type` varchar(10) NOT NULL DEFAULT 'monthly',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `notes` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `budget_lines`
--

CREATE TABLE `budget_lines` (
  `line_id` int(11) NOT NULL,
  `budget_id` int(11) NOT NULL,
  `category` varchar(80) NOT NULL,
  `period` varchar(7) NOT NULL,
  `amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `notes` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `chat_knowledge_base`
--

CREATE TABLE `chat_knowledge_base` (
  `id` int(10) UNSIGNED NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` text NOT NULL,
  `category` varchar(100) DEFAULT 'general',
  `tags` varchar(500) DEFAULT '',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `chat_messages`
--

CREATE TABLE `chat_messages` (
  `id` int(10) UNSIGNED NOT NULL,
  `session_id` varchar(64) NOT NULL,
  `role` enum('user','assistant') NOT NULL,
  `content` text NOT NULL,
  `sources` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`sources`)),
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `chat_sessions`
--

CREATE TABLE `chat_sessions` (
  `id` int(10) UNSIGNED NOT NULL,
  `session_id` varchar(64) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `customer_metrics`
--

CREATE TABLE `customer_metrics` (
  `customer_id` int(11) NOT NULL,
  `total_orders` int(11) NOT NULL DEFAULT 0,
  `total_spend` decimal(14,2) NOT NULL DEFAULT 0.00,
  `avg_order_value` decimal(12,2) NOT NULL DEFAULT 0.00,
  `outstanding` decimal(14,2) NOT NULL DEFAULT 0.00,
  `avg_payment_days` decimal(6,1) DEFAULT NULL,
  `last_order_date` date DEFAULT NULL,
  `last_invoice_date` date DEFAULT NULL,
  `segment` varchar(40) NOT NULL DEFAULT 'Dormant',
  `payment_behavior` varchar(20) NOT NULL DEFAULT 'unknown',
  `churn_risk` tinyint(1) NOT NULL DEFAULT 0,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `customer_queries`
--

CREATE TABLE `customer_queries` (
  `query_id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED DEFAULT NULL,
  `name` varchar(150) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `subject` varchar(255) DEFAULT NULL,
  `message` text NOT NULL,
  `reply` text DEFAULT NULL,
  `status` enum('open','replied','closed') NOT NULL DEFAULT 'open',
  `replied_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `dealer_customers`
--

CREATE TABLE `dealer_customers` (
  `dealer_customer_id` int(11) NOT NULL,
  `dealer_id` int(11) NOT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `price_list_id` int(11) DEFAULT NULL,
  `name` varchar(200) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `normalized_phone` varchar(15) DEFAULT NULL,
  `email` varchar(120) DEFAULT NULL,
  `normalized_email` varchar(120) DEFAULT NULL,
  `gstin` varchar(20) DEFAULT NULL,
  `normalized_gstin` varchar(20) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `city` varchar(80) DEFAULT NULL,
  `state` varchar(80) DEFAULT NULL,
  `pincode` varchar(10) DEFAULT NULL,
  `link_status` varchar(20) NOT NULL DEFAULT 'dealer_added',
  `conflict_user_id` int(11) DEFAULT NULL,
  `resolution_notes` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `dealer_price_items`
--

CREATE TABLE `dealer_price_items` (
  `price_item_id` int(11) NOT NULL,
  `price_list_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `unit_price` decimal(12,2) NOT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `dealer_price_lists`
--

CREATE TABLE `dealer_price_lists` (
  `price_list_id` int(11) NOT NULL,
  `dealer_id` int(11) NOT NULL,
  `name` varchar(120) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `notes` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `document_sequences`
--

CREATE TABLE `document_sequences` (
  `doc_type` varchar(20) NOT NULL,
  `period` varchar(7) NOT NULL,
  `next_value` int(11) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `employees`
--

CREATE TABLE `employees` (
  `employee_id` int(11) NOT NULL,
  `employee_key` varchar(12) NOT NULL COMMENT 'EMP-001',
  `name` varchar(120) NOT NULL,
  `email` varchar(180) DEFAULT NULL,
  `phone` varchar(25) NOT NULL,
  `alternate_phone` varchar(25) DEFAULT NULL,
  `department` enum('Production','Quality','Sales','Admin','Dispatch','Maintenance') DEFAULT NULL,
  `designation` varchar(100) DEFAULT NULL,
  `employment_type` varchar(20) NOT NULL DEFAULT 'permanent',
  `bank_account_holder` varchar(120) DEFAULT NULL,
  `bank_name` varchar(120) DEFAULT NULL,
  `bank_account_number` varchar(40) DEFAULT NULL,
  `bank_ifsc` varchar(20) DEFAULT NULL,
  `bank_branch` varchar(120) DEFAULT NULL,
  `base_salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `site_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `da` decimal(10,2) NOT NULL DEFAULT 0.00,
  `pf_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `pf_percent` decimal(5,2) NOT NULL DEFAULT 12.00,
  `bonus_percent` decimal(5,2) NOT NULL DEFAULT 0.00,
  `attendance_bonus_amount` decimal(10,2) NOT NULL DEFAULT 750.00,
  `default_shift_id` int(11) DEFAULT NULL,
  `esi_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `esi_employee_percent` decimal(5,2) NOT NULL DEFAULT 0.75,
  `food_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `travel_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `insurance_pdf_path` varchar(500) DEFAULT NULL,
  `insurance_pdf_name` varchar(255) DEFAULT NULL,
  `uniform_issued` tinyint(1) NOT NULL DEFAULT 0,
  `uniform_issued_at` date DEFAULT NULL,
  `uniform_valid_until` date DEFAULT NULL,
  `shoes_issued` tinyint(1) NOT NULL DEFAULT 0,
  `shoes_issued_at` date DEFAULT NULL,
  `shoes_valid_until` date DEFAULT NULL,
  `photo_path` varchar(500) DEFAULT NULL COMMENT 'Relative path to employee photo stored in uploads/employee-photos/',
  `joined_at` date DEFAULT NULL,
  `communication_address` text DEFAULT NULL,
  `permanent_address` text DEFAULT NULL,
  `same_as_communication_address` tinyint(1) NOT NULL DEFAULT 0,
  `aadhaar_number` varchar(20) DEFAULT NULL,
  `dob` date DEFAULT NULL,
  `blood_group` varchar(10) DEFAULT NULL,
  `experience` varchar(120) DEFAULT NULL,
  `relatives_working` tinyint(1) NOT NULL DEFAULT 0,
  `relatives_details` text DEFAULT NULL,
  `qualification_json` longtext DEFAULT NULL,
  `qr_token` varchar(32) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `employee_advances`
--

CREATE TABLE `employee_advances` (
  `advance_id` int(11) NOT NULL,
  `employee_key` varchar(12) NOT NULL,
  `advance_date` date NOT NULL,
  `payroll_month` varchar(7) NOT NULL COMMENT 'YYYY-MM',
  `amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `notes` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `employee_compliance`
--

CREATE TABLE `employee_compliance` (
  `compliance_id` int(11) NOT NULL,
  `employee_key` varchar(12) NOT NULL,
  `type` varchar(30) NOT NULL,
  `provider` varchar(120) DEFAULT NULL,
  `policy_number` varchar(80) DEFAULT NULL,
  `coverage_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `premium` decimal(14,2) NOT NULL DEFAULT 0.00,
  `start_date` date DEFAULT NULL,
  `expiry_date` date NOT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'active',
  `attachment_id` int(11) DEFAULT NULL,
  `notes` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `eway_bills`
--

CREATE TABLE `eway_bills` (
  `eway_id` int(11) NOT NULL,
  `invoice_id` int(11) NOT NULL,
  `supply_type` varchar(4) DEFAULT 'O',
  `sub_supply` varchar(4) DEFAULT '1',
  `doc_type` varchar(8) DEFAULT 'INV',
  `trans_mode` varchar(4) DEFAULT '1',
  `vehicle_no` varchar(20) DEFAULT NULL,
  `vehicle_type` varchar(2) DEFAULT 'R',
  `transporter_id` varchar(20) DEFAULT NULL,
  `transporter_name` varchar(150) DEFAULT NULL,
  `transport_doc_no` varchar(40) DEFAULT NULL,
  `transport_doc_date` date DEFAULT NULL,
  `distance_km` int(11) DEFAULT 0,
  `from_gstin` varchar(20) DEFAULT NULL,
  `from_name` varchar(150) DEFAULT NULL,
  `from_addr` varchar(200) DEFAULT NULL,
  `from_place` varchar(120) DEFAULT NULL,
  `from_pincode` varchar(10) DEFAULT NULL,
  `from_state` varchar(60) DEFAULT NULL,
  `to_place` varchar(120) DEFAULT NULL,
  `to_pincode` varchar(10) DEFAULT NULL,
  `ewb_no` varchar(20) DEFAULT NULL,
  `ewb_date` date DEFAULT NULL,
  `valid_until` date DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `expenses`
--

CREATE TABLE `expenses` (
  `expense_id` int(11) NOT NULL,
  `expense_code` varchar(20) NOT NULL,
  `expense_date` date NOT NULL,
  `category` varchar(80) NOT NULL,
  `vendor` varchar(150) NOT NULL,
  `description` text DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `payment_mode` enum('Cash','Bank Transfer','UPI','Cheque','Card') NOT NULL DEFAULT 'Cash',
  `bill_url` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `faqs`
--

CREATE TABLE `faqs` (
  `faq_id` int(10) UNSIGNED NOT NULL,
  `question` text NOT NULL,
  `answer` text NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `finance_config`
--

CREATE TABLE `finance_config` (
  `config_key` varchar(60) NOT NULL,
  `config_value` decimal(14,2) NOT NULL DEFAULT 0.00,
  `notes` varchar(255) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `finance_records`
--

CREATE TABLE `finance_records` (
  `record_id` int(11) NOT NULL,
  `record_type` enum('Income','Expense','Asset','Liability') NOT NULL,
  `category` varchar(100) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `record_date` date NOT NULL,
  `description` text DEFAULT NULL,
  `reference_id` int(11) DEFAULT NULL COMMENT 'invoice_id or expense_id',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `goods_receipts`
--

CREATE TABLE `goods_receipts` (
  `grn_id` int(11) NOT NULL,
  `grn_number` varchar(30) NOT NULL,
  `po_id` int(11) NOT NULL,
  `received_on` date NOT NULL,
  `received_by` int(11) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'posted',
  `notes` varchar(500) DEFAULT NULL,
  `voided_by` int(11) DEFAULT NULL,
  `voided_at` datetime DEFAULT NULL,
  `void_reason` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `goods_receipt_items`
--

CREATE TABLE `goods_receipt_items` (
  `item_id` int(11) NOT NULL,
  `grn_id` int(11) NOT NULL,
  `po_item_id` int(11) NOT NULL,
  `quantity` decimal(12,3) NOT NULL DEFAULT 0.000,
  `unit_cost` decimal(12,2) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `gst_compliance_periods`
--

CREATE TABLE `gst_compliance_periods` (
  `period_id` int(11) NOT NULL,
  `period_key` char(7) NOT NULL,
  `from_date` date NOT NULL,
  `to_date` date NOT NULL,
  `sales_taxable` decimal(14,2) NOT NULL DEFAULT 0.00,
  `sales_cgst` decimal(14,2) NOT NULL DEFAULT 0.00,
  `sales_sgst` decimal(14,2) NOT NULL DEFAULT 0.00,
  `sales_igst` decimal(14,2) NOT NULL DEFAULT 0.00,
  `input_tax` decimal(14,2) NOT NULL DEFAULT 0.00,
  `net_payable` decimal(14,2) NOT NULL DEFAULT 0.00,
  `status` enum('draft','reviewed','filed','locked') NOT NULL DEFAULT 'draft',
  `filed_on` date DEFAULT NULL,
  `reference_no` varchar(120) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `locked_by` int(11) DEFAULT NULL,
  `locked_at` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `historical_invoices`
--

CREATE TABLE `historical_invoices` (
  `historical_invoice_id` int(11) NOT NULL,
  `invoice_number` varchar(50) NOT NULL,
  `invoice_date` date NOT NULL,
  `due_date` date DEFAULT NULL,
  `customer_name` varchar(150) DEFAULT NULL,
  `customer_gstin` varchar(20) DEFAULT NULL,
  `customer_state` varchar(60) DEFAULT NULL,
  `customer_address` text DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `seller_state` varchar(60) DEFAULT 'Tamil Nadu',
  `subtotal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT 0.00,
  `gst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `cgst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `sgst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `igst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `delivery_fee` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `status` varchar(20) NOT NULL DEFAULT 'Unpaid',
  `payment_method` varchar(40) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `import_job_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `historical_invoice_items`
--

CREATE TABLE `historical_invoice_items` (
  `item_id` int(11) NOT NULL,
  `historical_invoice_id` int(11) NOT NULL,
  `description` varchar(255) NOT NULL,
  `hsn_code` varchar(20) DEFAULT NULL,
  `quantity` decimal(12,3) NOT NULL DEFAULT 1.000,
  `unit` varchar(20) DEFAULT 'Nos',
  `unit_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT 0.00,
  `line_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `sort_order` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `import_jobs`
--

CREATE TABLE `import_jobs` (
  `job_id` int(11) NOT NULL,
  `module` varchar(40) NOT NULL,
  `file_path` varchar(500) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `total_rows` int(11) NOT NULL DEFAULT 0,
  `valid_rows` int(11) NOT NULL DEFAULT 0,
  `error_rows` int(11) NOT NULL DEFAULT 0,
  `mapping_json` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `import_job_rows`
--

CREATE TABLE `import_job_rows` (
  `row_id` int(11) NOT NULL,
  `job_id` int(11) NOT NULL,
  `row_number` int(11) NOT NULL,
  `raw_json` text DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `error_text` varchar(500) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `invoices`
--

CREATE TABLE `invoices` (
  `invoice_id` int(11) NOT NULL,
  `invoice_number` varchar(50) NOT NULL,
  `order_id` int(11) DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `customer_name` varchar(150) DEFAULT NULL,
  `customer_gstin` varchar(20) DEFAULT NULL,
  `customer_state` varchar(60) DEFAULT NULL,
  `customer_address` text DEFAULT NULL,
  `customer_city` varchar(100) DEFAULT NULL,
  `customer_pincode` varchar(20) DEFAULT NULL,
  `customer_country` varchar(100) DEFAULT NULL,
  `seller_state` varchar(60) DEFAULT 'Tamil Nadu',
  `due_date` date DEFAULT NULL,
  `invoice_date` date DEFAULT NULL,
  `payment_terms` varchar(100) DEFAULT NULL,
  `place_of_supply` varchar(100) DEFAULT NULL,
  `ship_to` text DEFAULT NULL,
  `subject` varchar(255) DEFAULT NULL,
  `subtotal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT 18.00,
  `gst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `cgst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `sgst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `igst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `delivery_fee` decimal(12,2) NOT NULL DEFAULT 0.00,
  `discount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `amount_paid` decimal(12,2) NOT NULL DEFAULT 0.00,
  `status` enum('Draft','Sent','Cancelled') NOT NULL DEFAULT 'Draft',
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_status` varchar(20) NOT NULL DEFAULT 'unpaid',
  `last_payment_at` datetime DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `invoice_items`
--

CREATE TABLE `invoice_items` (
  `item_id` int(11) NOT NULL,
  `invoice_id` int(11) NOT NULL,
  `product_id` int(11) DEFAULT NULL,
  `description` varchar(255) NOT NULL,
  `hsn_code` varchar(20) DEFAULT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT 1.00,
  `unit` varchar(20) NOT NULL DEFAULT 'Nos',
  `unit_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `discount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT 18.00,
  `line_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `sort_order` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `meetings`
--

CREATE TABLE `meetings` (
  `meeting_id` int(11) NOT NULL,
  `title` varchar(200) NOT NULL,
  `date` date NOT NULL,
  `time` time NOT NULL,
  `location` varchar(150) DEFAULT NULL,
  `agenda` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `raci` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'RACI matrix' CHECK (json_valid(`raci`)),
  `action_items` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Action items array' CHECK (json_valid(`action_items`)),
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `meeting_attendees`
--

CREATE TABLE `meeting_attendees` (
  `meeting_id` int(11) NOT NULL,
  `attendee_key` varchar(12) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `orders`
--

CREATE TABLE `orders` (
  `order_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `order_number` varchar(50) NOT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `delivery_fee` decimal(10,2) DEFAULT 150.00,
  `order_status` enum('pending','confirmed','processing','shipped','out for delivery','delivered','cancelled','returned') NOT NULL DEFAULT 'pending',
  `payment_status` enum('pending','paid','failed','refunded') DEFAULT 'pending',
  `payment_method` varchar(50) DEFAULT NULL,
  `tracking_number` varchar(100) DEFAULT NULL,
  `cancel_reason` text DEFAULT NULL,
  `refund_status` enum('N/A','Initiated','Processed') NOT NULL DEFAULT 'N/A',
  `delivery_address` text DEFAULT NULL,
  `delivery_city` varchar(50) DEFAULT NULL,
  `delivery_state` varchar(50) DEFAULT NULL,
  `delivery_pincode` varchar(10) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `order_items`
--

CREATE TABLE `order_items` (
  `item_id` int(11) NOT NULL,
  `order_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `config_id` int(11) DEFAULT NULL,
  `quantity` int(11) NOT NULL DEFAULT 1,
  `unit_price` decimal(10,2) NOT NULL,
  `total_price` decimal(10,2) NOT NULL,
  `size` varchar(50) DEFAULT NULL,
  `purpose` varchar(100) DEFAULT NULL,
  `sub_purpose` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `otp_verifications`
--

CREATE TABLE `otp_verifications` (
  `otp_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `identifier` varchar(100) NOT NULL,
  `identifier_type` enum('phone','email') NOT NULL,
  `otp_code` varchar(6) NOT NULL,
  `purpose` enum('password_reset','phone_verification','email_verification') NOT NULL,
  `expires_at` timestamp NOT NULL,
  `verified_at` timestamp NULL DEFAULT NULL,
  `attempts` int(11) DEFAULT 0,
  `max_attempts` int(11) DEFAULT 5,
  `is_used` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `payments`
--

CREATE TABLE `payments` (
  `payment_id` int(11) NOT NULL,
  `payment_number` varchar(50) NOT NULL,
  `direction` enum('in','out') NOT NULL DEFAULT 'in',
  `invoice_id` int(11) DEFAULT NULL,
  `po_id` int(11) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `vendor_id` int(11) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `payment_mode` varchar(30) NOT NULL,
  `reference_no` varchar(120) DEFAULT NULL,
  `paid_on` date NOT NULL,
  `notes` text DEFAULT NULL,
  `status` enum('posted','void') NOT NULL DEFAULT 'posted',
  `voided_by` int(11) DEFAULT NULL,
  `voided_at` datetime DEFAULT NULL,
  `void_reason` varchar(255) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `payroll`
--

CREATE TABLE `payroll` (
  `payroll_id` int(11) NOT NULL,
  `employee_key` varchar(12) NOT NULL,
  `month` varchar(7) NOT NULL COMMENT 'YYYY-MM',
  `working_days` int(11) NOT NULL DEFAULT 0,
  `present_days` decimal(5,1) NOT NULL DEFAULT 0.0,
  `salary_per_day` decimal(10,2) NOT NULL DEFAULT 0.00,
  `leaves` decimal(5,1) NOT NULL DEFAULT 0.0,
  `leave_availed_this_month` decimal(5,1) NOT NULL DEFAULT 0.0,
  `leave_credit` decimal(5,1) NOT NULL DEFAULT 0.0,
  `leave_salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `travel_allow` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total_salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `salary_advance_paid` decimal(10,2) NOT NULL DEFAULT 0.00,
  `deducted_advance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `base_salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `site_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `da` decimal(10,2) NOT NULL DEFAULT 0.00,
  `food_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `gross_salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `overtime_rate` decimal(10,2) NOT NULL DEFAULT 0.00,
  `overtime_hrs` decimal(8,2) NOT NULL DEFAULT 0.00,
  `overtime_salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `attend_bonus` decimal(10,2) NOT NULL DEFAULT 0.00,
  `earned_salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `hra` decimal(10,2) NOT NULL DEFAULT 0.00,
  `allowances` decimal(10,2) NOT NULL DEFAULT 0.00,
  `pf` decimal(10,2) NOT NULL DEFAULT 0.00,
  `professional_tax` decimal(10,2) NOT NULL DEFAULT 0.00,
  `deductions` decimal(10,2) NOT NULL DEFAULT 0.00,
  `net_pay` decimal(10,2) NOT NULL DEFAULT 0.00,
  `status` enum('Draft','Processed','Paid') NOT NULL DEFAULT 'Draft',
  `generated_at` datetime NOT NULL DEFAULT current_timestamp(),
  `processed_at` datetime DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `production_consumption`
--

CREATE TABLE `production_consumption` (
  `consumption_id` int(11) NOT NULL,
  `run_id` int(11) NOT NULL,
  `raw_material_id` int(11) NOT NULL,
  `quantity` decimal(12,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `production_outputs`
--

CREATE TABLE `production_outputs` (
  `output_id` int(11) NOT NULL,
  `run_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `quantity` decimal(12,2) NOT NULL,
  `unit` varchar(20) NOT NULL DEFAULT 'kg',
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `production_quality`
--

CREATE TABLE `production_quality` (
  `quality_id` int(11) NOT NULL,
  `run_id` int(11) NOT NULL,
  `moisture_pct` decimal(6,2) DEFAULT NULL,
  `ash_pct` decimal(6,2) DEFAULT NULL,
  `gcv` decimal(8,2) DEFAULT NULL,
  `fines_pct` decimal(6,2) DEFAULT NULL,
  `diameter_mm` decimal(6,2) DEFAULT NULL,
  `durability_pct` decimal(6,2) DEFAULT NULL,
  `result` enum('pass','fail','pending') NOT NULL DEFAULT 'pending',
  `inspector` varchar(120) DEFAULT NULL,
  `notes` varchar(500) DEFAULT NULL,
  `checked_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `production_runs`
--

CREATE TABLE `production_runs` (
  `run_id` int(11) NOT NULL,
  `run_date` date NOT NULL,
  `product_id` int(11) NOT NULL,
  `batch_number` varchar(50) DEFAULT NULL,
  `output_quantity` decimal(12,2) NOT NULL,
  `unit` varchar(20) NOT NULL DEFAULT 'kg',
  `shift` enum('day','night','general') NOT NULL DEFAULT 'general',
  `operator_name` varchar(120) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `production_spare_consumption`
--

CREATE TABLE `production_spare_consumption` (
  `id` int(11) NOT NULL,
  `run_id` int(11) NOT NULL,
  `spare_id` int(11) NOT NULL,
  `quantity` decimal(14,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `products`
--

CREATE TABLE `products` (
  `product_id` int(11) NOT NULL,
  `product_name` varchar(100) NOT NULL,
  `product_type` enum('pellets','biomass-stove','biomass-burner','other') NOT NULL,
  `description` text DEFAULT NULL,
  `base_price` decimal(10,2) NOT NULL,
  `unit` varchar(20) DEFAULT NULL,
  `hsn_code` varchar(20) DEFAULT NULL,
  `gst_rate` decimal(5,2) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `gcv` varchar(50) DEFAULT NULL,
  `ash_content` varchar(50) DEFAULT NULL,
  `moisture_content` varchar(50) DEFAULT NULL,
  `tag` varchar(100) DEFAULT NULL,
  `tag_color` varchar(20) DEFAULT NULL,
  `suitable_for` text DEFAULT NULL,
  `image_url` varchar(500) DEFAULT NULL,
  `is_available` tinyint(1) DEFAULT 1,
  `stock_quantity` decimal(12,2) NOT NULL DEFAULT 0.00,
  `reorder_level` decimal(12,2) NOT NULL DEFAULT 0.00,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_configurations`
--

CREATE TABLE `product_configurations` (
  `config_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `size` varchar(50) NOT NULL,
  `purpose` varchar(100) DEFAULT NULL,
  `sub_purpose` varchar(200) DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `is_available` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `purchase_items`
--

CREATE TABLE `purchase_items` (
  `purchase_item_id` int(11) NOT NULL,
  `item_code` varchar(40) DEFAULT NULL,
  `name` varchar(200) NOT NULL,
  `specification` varchar(500) DEFAULT NULL,
  `category` varchar(120) DEFAULT NULL,
  `item_type` varchar(20) NOT NULL DEFAULT 'stock',
  `unit` varchar(40) NOT NULL DEFAULT 'nos',
  `rate` decimal(14,2) NOT NULL DEFAULT 0.00,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT 18.00,
  `hsn_code` varchar(20) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `purchase_orders`
--

CREATE TABLE `purchase_orders` (
  `po_id` int(11) NOT NULL,
  `po_number` varchar(30) NOT NULL,
  `reference_number` varchar(80) DEFAULT NULL,
  `vendor_id` int(11) NOT NULL,
  `pr_id` int(11) DEFAULT NULL,
  `order_date` date NOT NULL,
  `expected_date` date DEFAULT NULL,
  `shipment_preference` varchar(80) DEFAULT NULL,
  `deliver_to_type` varchar(40) DEFAULT NULL,
  `deliver_to_name` varchar(160) DEFAULT NULL,
  `deliver_to_address` text DEFAULT NULL,
  `payment_terms` varchar(120) DEFAULT NULL,
  `seller_state` varchar(80) DEFAULT NULL,
  `vendor_state` varchar(80) DEFAULT NULL,
  `vendor_gstin` varchar(30) DEFAULT NULL,
  `gst_treatment` varchar(80) DEFAULT NULL,
  `reverse_charge` tinyint(1) NOT NULL DEFAULT 0,
  `subtotal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tax_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `other_charges` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `payment_status` varchar(20) NOT NULL DEFAULT 'unpaid',
  `notes` varchar(500) DEFAULT NULL,
  `terms_conditions` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `billed_expense_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `purchase_order_items`
--

CREATE TABLE `purchase_order_items` (
  `item_id` int(11) NOT NULL,
  `po_id` int(11) NOT NULL,
  `purchase_item_id` int(11) DEFAULT NULL,
  `description` varchar(255) NOT NULL,
  `product_id` int(11) DEFAULT NULL,
  `hsn_code` varchar(20) DEFAULT NULL,
  `quantity` decimal(12,3) NOT NULL DEFAULT 0.000,
  `received_qty` decimal(12,3) NOT NULL DEFAULT 0.000,
  `unit` varchar(20) NOT NULL DEFAULT 'Nos',
  `unit_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT 0.00,
  `line_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `sort_order` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `purchase_requests`
--

CREATE TABLE `purchase_requests` (
  `pr_id` int(11) NOT NULL,
  `pr_number` varchar(30) NOT NULL,
  `requested_by` int(11) DEFAULT NULL,
  `department` varchar(80) DEFAULT NULL,
  `need_by_date` date DEFAULT NULL,
  `priority` varchar(10) NOT NULL DEFAULT 'normal',
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `notes` varchar(500) DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejected_by` int(11) DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `rejection_reason` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `purchase_request_items`
--

CREATE TABLE `purchase_request_items` (
  `item_id` int(11) NOT NULL,
  `pr_id` int(11) NOT NULL,
  `description` varchar(255) NOT NULL,
  `product_id` int(11) DEFAULT NULL,
  `quantity` decimal(12,3) NOT NULL DEFAULT 0.000,
  `unit` varchar(20) NOT NULL DEFAULT 'Nos',
  `est_unit_price` decimal(12,2) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `queries`
--

CREATE TABLE `queries` (
  `query_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `query_number` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `message` text NOT NULL,
  `admin_reply` text DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `quotes`
--

CREATE TABLE `quotes` (
  `quote_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `quote_number` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `phone` varchar(15) NOT NULL,
  `message` text NOT NULL COMMENT 'Pre-formatted calculation summary',
  `product` varchar(255) DEFAULT NULL,
  `quantity_per_month` decimal(10,2) DEFAULT NULL,
  `current_fuel` varchar(100) DEFAULT NULL,
  `current_cost` decimal(12,2) DEFAULT NULL,
  `biomass_cost` decimal(12,2) DEFAULT NULL,
  `monthly_savings` decimal(12,2) DEFAULT NULL,
  `annual_savings` decimal(12,2) DEFAULT NULL,
  `admin_notes` text DEFAULT NULL,
  `quoted_price` varchar(100) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `quote_requests`
--

CREATE TABLE `quote_requests` (
  `quote_id` int(10) UNSIGNED NOT NULL,
  `customer_name` varchar(150) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `product` varchar(200) NOT NULL,
  `quantity_per_month` varchar(100) DEFAULT NULL,
  `current_fuel` varchar(100) DEFAULT NULL,
  `current_cost` decimal(12,2) DEFAULT NULL,
  `biomass_cost` decimal(12,2) DEFAULT NULL,
  `monthly_savings` decimal(12,2) DEFAULT NULL,
  `annual_savings` decimal(12,2) DEFAULT NULL,
  `status` enum('new','contacted','quoted','closed') NOT NULL DEFAULT 'new',
  `admin_notes` text DEFAULT NULL,
  `quoted_price` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `raw_materials`
--

CREATE TABLE `raw_materials` (
  `raw_material_id` int(11) NOT NULL,
  `name` varchar(120) NOT NULL,
  `unit` varchar(20) NOT NULL DEFAULT 'kg',
  `current_stock` decimal(12,2) NOT NULL DEFAULT 0.00,
  `reorder_level` decimal(12,2) NOT NULL DEFAULT 0.00,
  `supplier` varchar(150) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `raw_material_movements`
--

CREATE TABLE `raw_material_movements` (
  `movement_id` int(11) NOT NULL,
  `raw_material_id` int(11) NOT NULL,
  `movement_type` enum('in','out','adjust') NOT NULL,
  `quantity` decimal(12,2) NOT NULL,
  `reference` varchar(150) DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `movement_date` date NOT NULL,
  `run_id` int(11) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `refresh_tokens`
--

CREATE TABLE `refresh_tokens` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `token_hash` varchar(64) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `revoked_tokens`
--

CREATE TABLE `revoked_tokens` (
  `id` int(11) NOT NULL,
  `token_hash` varchar(64) NOT NULL,
  `expired_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sales_documents`
--

CREATE TABLE `sales_documents` (
  `document_id` int(11) NOT NULL,
  `document_type` enum('quotation','proforma','delivery_challan','sales_order') NOT NULL,
  `document_number` varchar(50) NOT NULL,
  `source_quote_id` int(11) DEFAULT NULL,
  `source_document_id` int(11) DEFAULT NULL,
  `converted_document_id` int(11) DEFAULT NULL,
  `invoice_id` int(11) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `customer_name` varchar(150) NOT NULL,
  `customer_email` varchar(150) DEFAULT NULL,
  `customer_phone` varchar(30) DEFAULT NULL,
  `customer_gstin` varchar(20) DEFAULT NULL,
  `customer_state` varchar(60) DEFAULT NULL,
  `customer_address` text DEFAULT NULL,
  `customer_city` varchar(80) DEFAULT NULL,
  `customer_pincode` varchar(10) DEFAULT NULL,
  `customer_country` varchar(80) DEFAULT NULL,
  `seller_state` varchar(60) DEFAULT 'Tamil Nadu',
  `document_date` date NOT NULL,
  `valid_until` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `payment_terms` varchar(100) DEFAULT NULL,
  `place_of_supply` varchar(100) DEFAULT NULL,
  `ship_to` text DEFAULT NULL,
  `subject` varchar(255) DEFAULT NULL,
  `subtotal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT 0.00,
  `gst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `cgst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `sgst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `igst_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `delivery_fee` decimal(12,2) NOT NULL DEFAULT 0.00,
  `discount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `status` enum('draft','sent','accepted','rejected','expired','converted','cancelled') NOT NULL DEFAULT 'draft',
  `terms` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sales_document_items`
--

CREATE TABLE `sales_document_items` (
  `item_id` int(11) NOT NULL,
  `document_id` int(11) NOT NULL,
  `product_id` int(11) DEFAULT NULL,
  `description` varchar(255) NOT NULL,
  `hsn_code` varchar(20) DEFAULT NULL,
  `quantity` decimal(12,2) NOT NULL DEFAULT 1.00,
  `unit` varchar(20) DEFAULT 'Nos',
  `unit_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT 18.00,
  `line_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `sort_order` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `settings`
--

CREATE TABLE `settings` (
  `setting_id` int(11) NOT NULL,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sops`
--

CREATE TABLE `sops` (
  `sop_id` int(11) NOT NULL,
  `code` varchar(20) NOT NULL,
  `title` varchar(200) NOT NULL,
  `department` enum('Procurement','Production','Quality Control','Packing','Sales','Marketing','Material Management','HR','Dispatch','Service','Customer Care') NOT NULL,
  `description` text DEFAULT NULL,
  `owner_id` int(11) DEFAULT NULL,
  `access_role` enum('All Staff','Managers','Department Only','Admin Only') NOT NULL DEFAULT 'All Staff',
  `current_version_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sop_tags`
--

CREATE TABLE `sop_tags` (
  `sop_id` int(11) NOT NULL,
  `tag` varchar(60) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sop_versions`
--

CREATE TABLE `sop_versions` (
  `version_id` int(11) NOT NULL,
  `sop_id` int(11) NOT NULL,
  `version` varchar(20) NOT NULL COMMENT '1.0, 1.1, 2.0',
  `uploaded_by` int(11) DEFAULT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_path` varchar(500) DEFAULT NULL,
  `file_size` int(11) NOT NULL COMMENT 'bytes',
  `mime_type` varchar(120) DEFAULT NULL,
  `change_log` text DEFAULT NULL,
  `status` enum('Draft','Pending Approval','Approved','Archived') NOT NULL DEFAULT 'Draft',
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `uploaded_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `spares_assets`
--

CREATE TABLE `spares_assets` (
  `spare_id` int(11) NOT NULL,
  `name` varchar(200) NOT NULL,
  `category` varchar(120) DEFAULT NULL,
  `unit` varchar(40) NOT NULL DEFAULT 'nos',
  `current_stock` decimal(14,2) NOT NULL DEFAULT 0.00,
  `reorder_level` decimal(14,2) NOT NULL DEFAULT 0.00,
  `location` varchar(120) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `spare_asset_movements`
--

CREATE TABLE `spare_asset_movements` (
  `movement_id` int(11) NOT NULL,
  `spare_id` int(11) NOT NULL,
  `movement_type` enum('in','out','adjust') NOT NULL,
  `quantity` decimal(14,2) NOT NULL,
  `reference` varchar(150) DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `movement_date` date NOT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `stock_movements`
--

CREATE TABLE `stock_movements` (
  `stock_movement_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `movement_type` enum('in','out','adjust') NOT NULL,
  `source` enum('production','order','manual','return') NOT NULL DEFAULT 'manual',
  `quantity` decimal(12,2) NOT NULL,
  `reference` varchar(150) DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `movement_date` date NOT NULL,
  `run_id` int(11) DEFAULT NULL,
  `order_id` int(11) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `tasks`
--

CREATE TABLE `tasks` (
  `task_id` int(11) NOT NULL,
  `task_key` varchar(20) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `assignee_id` varchar(12) DEFAULT NULL,
  `assigned_by` varchar(100) NOT NULL DEFAULT 'Admin',
  `priority` enum('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
  `status` enum('Pending','In Progress','Completed','Blocked') NOT NULL DEFAULT 'Pending',
  `due_date` date NOT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `task_comments`
--

CREATE TABLE `task_comments` (
  `comment_id` int(11) NOT NULL,
  `task_key` varchar(20) NOT NULL,
  `author` varchar(150) NOT NULL,
  `body` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `task_tags`
--

CREATE TABLE `task_tags` (
  `task_key` varchar(20) NOT NULL,
  `tag` varchar(60) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `test_certificates`
--

CREATE TABLE `test_certificates` (
  `certificate_id` int(11) NOT NULL,
  `certificate_number` varchar(50) NOT NULL,
  `invoice_id` int(11) DEFAULT NULL,
  `invoice_item_id` int(11) DEFAULT NULL,
  `product_id` int(11) DEFAULT NULL,
  `batch_no` varchar(80) DEFAULT NULL,
  `certificate_type` varchar(80) NOT NULL DEFAULT 'quality',
  `sample_date` date DEFAULT NULL,
  `issue_date` date NOT NULL,
  `parameters_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`parameters_json`)),
  `result_summary` text DEFAULT NULL,
  `status` enum('draft','issued','void') NOT NULL DEFAULT 'draft',
  `attachment_id` int(11) DEFAULT NULL,
  `issued_by` int(11) DEFAULT NULL,
  `voided_by` int(11) DEFAULT NULL,
  `voided_at` datetime DEFAULT NULL,
  `void_reason` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `tms_tasks`
--

CREATE TABLE `tms_tasks` (
  `tms_task_id` int(11) NOT NULL,
  `employee_key` varchar(12) NOT NULL,
  `task_date` date NOT NULL,
  `task` varchar(255) NOT NULL DEFAULT '',
  `completed` tinyint(1) NOT NULL DEFAULT 0,
  `status` varchar(10) NOT NULL DEFAULT 'red',
  `import_job_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `user_id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `phone` varchar(15) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `user_type` enum('customer','dealer','admin') NOT NULL DEFAULT 'customer',
  `staff_role` varchar(30) DEFAULT NULL,
  `company_name` varchar(150) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `city` varchar(50) DEFAULT NULL,
  `state` varchar(50) DEFAULT NULL,
  `pincode` varchar(10) DEFAULT NULL,
  `gst_number` varchar(20) DEFAULT NULL,
  `udyam_number` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_active` tinyint(1) DEFAULT 1,
  `approval_status` enum('pending','approved','rejected') DEFAULT 'pending',
  `approved_at` timestamp NULL DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `rejection_reason` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`user_id`, `name`, `email`, `phone`, `password_hash`, `user_type`, `staff_role`, `company_name`, `address`, `city`, `state`, `pincode`, `gst_number`, `udyam_number`, `created_at`, `updated_at`, `is_active`, `approval_status`, `approved_at`, `approved_by`, `rejection_reason`) VALUES
(37, 'Admin', 'admin@ecosudar.com', '9000000001', '$2y$12$6uOP9cEtZvwSysGDX6QWS.bSi7jtqOdwHPZwU3L9hIpFaOdZnbJwC', 'admin', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-04-17 16:51:16', '2026-04-26 16:33:46', 1, 'approved', NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `vendors`
--

CREATE TABLE `vendors` (
  `vendor_id` int(11) NOT NULL,
  `vendor_code` varchar(30) DEFAULT NULL,
  `name` varchar(200) NOT NULL,
  `salutation` varchar(20) DEFAULT NULL,
  `first_name` varchar(100) DEFAULT NULL,
  `last_name` varchar(100) DEFAULT NULL,
  `company_name` varchar(200) DEFAULT NULL,
  `gstin` varchar(20) DEFAULT NULL,
  `pan` varchar(20) DEFAULT NULL,
  `msme_registered` tinyint(1) NOT NULL DEFAULT 0,
  `opening_balance` decimal(14,2) NOT NULL DEFAULT 0.00,
  `contact_name` varchar(120) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `mobile` varchar(30) DEFAULT NULL,
  `email` varchar(120) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `city` varchar(80) DEFAULT NULL,
  `state` varchar(80) DEFAULT NULL,
  `pincode` varchar(10) DEFAULT NULL,
  `payment_terms` varchar(60) DEFAULT NULL,
  `notes` varchar(500) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `billing_attention` varchar(150) DEFAULT NULL,
  `billing_country` varchar(100) DEFAULT NULL,
  `billing_street2` varchar(255) DEFAULT NULL,
  `billing_phone` varchar(30) DEFAULT NULL,
  `billing_fax` varchar(30) DEFAULT NULL,
  `shipping_attention` varchar(150) DEFAULT NULL,
  `shipping_country` varchar(100) DEFAULT NULL,
  `shipping_street1` varchar(255) DEFAULT NULL,
  `shipping_street2` varchar(255) DEFAULT NULL,
  `shipping_city` varchar(100) DEFAULT NULL,
  `shipping_state` varchar(100) DEFAULT NULL,
  `shipping_pincode` varchar(20) DEFAULT NULL,
  `shipping_phone` varchar(30) DEFAULT NULL,
  `shipping_fax` varchar(30) DEFAULT NULL,
  `bank_account_holder` varchar(150) DEFAULT NULL,
  `bank_name` varchar(150) DEFAULT NULL,
  `bank_account_number` varchar(50) DEFAULT NULL,
  `bank_ifsc` varchar(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_active_orders`
-- (See below for the actual view)
--
CREATE TABLE `v_active_orders` (
`order_id` int(11)
,`order_number` varchar(50)
,`customer_name` varchar(100)
,`email` varchar(100)
,`phone` varchar(15)
,`user_type` enum('customer','dealer','admin')
,`total_amount` decimal(10,2)
,`order_status` enum('pending','confirmed','processing','shipped','out for delivery','delivered','cancelled','returned')
,`payment_status` enum('pending','paid','failed','refunded')
,`created_at` timestamp
,`total_items` bigint(21)
);

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_order_statistics`
-- (See below for the actual view)
--
CREATE TABLE `v_order_statistics` (
`order_date` date
,`total_orders` bigint(21)
,`total_revenue` decimal(32,2)
,`avg_order_value` decimal(14,6)
,`delivered_orders` bigint(21)
,`cancelled_orders` bigint(21)
,`active_orders` bigint(21)
);

-- --------------------------------------------------------

--
-- Table structure for table `workflows`
--

CREATE TABLE `workflows` (
  `workflow_id` int(11) NOT NULL,
  `title` varchar(200) NOT NULL,
  `type` enum('Purchase Request','Leave Request','Expense Claim','Production Order','Quality Hold Release','Dispatch Approval','Marketing Campaign','Other') NOT NULL,
  `description` text DEFAULT NULL,
  `requester_id` varchar(12) DEFAULT NULL,
  `requester_name` varchar(120) DEFAULT NULL,
  `approver_id` varchar(12) DEFAULT NULL,
  `approver_name` varchar(120) DEFAULT NULL,
  `priority` enum('Low','Medium','High','Urgent') NOT NULL DEFAULT 'Medium',
  `amount` decimal(12,2) DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `stage` enum('Pending','In Progress','Approved','Completed','Rejected') NOT NULL DEFAULT 'Pending',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `workflow_history`
--

CREATE TABLE `workflow_history` (
  `history_id` int(11) NOT NULL,
  `workflow_id` int(11) NOT NULL,
  `actor_id` varchar(12) DEFAULT NULL,
  `actor_name` varchar(120) DEFAULT NULL,
  `from_stage` enum('Pending','In Progress','Approved','Completed','Rejected') DEFAULT NULL,
  `to_stage` enum('Pending','In Progress','Approved','Completed','Rejected') NOT NULL,
  `note` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `attachments`
--
ALTER TABLE `attachments`
  ADD PRIMARY KEY (`attachment_id`),
  ADD KEY `idx_attach_entity` (`entity_type`,`entity_id`),
  ADD KEY `idx_attach_uploaded_by` (`uploaded_by`),
  ADD KEY `idx_attach_category` (`category`);

--
-- Indexes for table `attendance`
--
ALTER TABLE `attendance`
  ADD PRIMARY KEY (`attendance_id`),
  ADD KEY `idx_date` (`date`),
  ADD KEY `idx_employee_key` (`employee_key`),
  ADD KEY `idx_attendance_shift_id` (`shift_id`),
  ADD KEY `idx_attendance_employee_date_shift` (`employee_key`,`date`,`shift_id`);

--
-- Indexes for table `attendance_punches`
--
ALTER TABLE `attendance_punches`
  ADD PRIMARY KEY (`punch_id`),
  ADD UNIQUE KEY `uq_att_punch_emp_ts_dir` (`employee_key`,`punch_timestamp`,`direction`),
  ADD UNIQUE KEY `uq_att_punch_external` (`external_punch_id`),
  ADD KEY `idx_att_punch_job` (`import_job_id`),
  ADD KEY `idx_att_punch_employee_day` (`employee_key`,`punch_timestamp`);

--
-- Indexes for table `attendance_shifts`
--
ALTER TABLE `attendance_shifts`
  ADD PRIMARY KEY (`shift_id`),
  ADD KEY `idx_attendance_shifts_active` (`is_active`),
  ADD KEY `idx_attendance_shifts_default` (`is_default`);

--
-- Indexes for table `audit_log`
--
ALTER TABLE `audit_log`
  ADD PRIMARY KEY (`log_id`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_action` (`action`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Indexes for table `backup_runs`
--
ALTER TABLE `backup_runs`
  ADD PRIMARY KEY (`backup_id`),
  ADD KEY `idx_backup_runs_status` (`status`),
  ADD KEY `idx_backup_runs_started` (`started_at`),
  ADD KEY `fk_backup_runs_created_by` (`created_by`);

--
-- Indexes for table `benchmarks`
--
ALTER TABLE `benchmarks`
  ADD PRIMARY KEY (`benchmark_id`),
  ADD UNIQUE KEY `uq_benchmark_metric` (`metric`),
  ADD KEY `idx_benchmarks_active` (`is_active`),
  ADD KEY `fk_benchmarks_created_by` (`created_by`);

--
-- Indexes for table `budgets`
--
ALTER TABLE `budgets`
  ADD PRIMARY KEY (`budget_id`),
  ADD KEY `idx_budgets_active_year` (`is_active`,`fiscal_year`),
  ADD KEY `fk_budgets_created_by` (`created_by`);

--
-- Indexes for table `budget_lines`
--
ALTER TABLE `budget_lines`
  ADD PRIMARY KEY (`line_id`),
  ADD UNIQUE KEY `uq_budget_cat_period` (`budget_id`,`category`,`period`),
  ADD KEY `idx_budget_lines_period` (`period`);

--
-- Indexes for table `chat_knowledge_base`
--
ALTER TABLE `chat_knowledge_base`
  ADD PRIMARY KEY (`id`);
ALTER TABLE `chat_knowledge_base` ADD FULLTEXT KEY `ft_search` (`title`,`content`,`tags`);

--
-- Indexes for table `chat_messages`
--
ALTER TABLE `chat_messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_session` (`session_id`),
  ADD KEY `idx_created` (`created_at`),
  ADD KEY `idx_chat_session_created` (`session_id`,`created_at`);

--
-- Indexes for table `chat_sessions`
--
ALTER TABLE `chat_sessions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `session_id` (`session_id`),
  ADD KEY `idx_user` (`user_id`);

--
-- Indexes for table `customer_metrics`
--
ALTER TABLE `customer_metrics`
  ADD PRIMARY KEY (`customer_id`),
  ADD KEY `idx_customer_metrics_segment` (`segment`),
  ADD KEY `idx_customer_metrics_spend` (`total_spend`),
  ADD KEY `idx_customer_metrics_payment` (`avg_payment_days`);

--
-- Indexes for table `customer_queries`
--
ALTER TABLE `customer_queries`
  ADD PRIMARY KEY (`query_id`),
  ADD KEY `idx_cq_status` (`status`),
  ADD KEY `idx_cq_user_id` (`user_id`);

--
-- Indexes for table `dealer_customers`
--
ALTER TABLE `dealer_customers`
  ADD PRIMARY KEY (`dealer_customer_id`),
  ADD KEY `idx_dc_dealer` (`dealer_id`),
  ADD KEY `idx_dc_customer` (`customer_id`),
  ADD KEY `idx_dc_price_list` (`price_list_id`),
  ADD KEY `idx_dc_status` (`link_status`),
  ADD KEY `idx_dc_phone` (`normalized_phone`),
  ADD KEY `idx_dc_email` (`normalized_email`),
  ADD KEY `idx_dc_gstin` (`normalized_gstin`),
  ADD KEY `fk_dc_conflict_user` (`conflict_user_id`),
  ADD KEY `fk_dc_created_by` (`created_by`);

--
-- Indexes for table `dealer_price_items`
--
ALTER TABLE `dealer_price_items`
  ADD PRIMARY KEY (`price_item_id`),
  ADD UNIQUE KEY `uq_dpi_list_product` (`price_list_id`,`product_id`),
  ADD KEY `idx_dpi_product` (`product_id`);

--
-- Indexes for table `dealer_price_lists`
--
ALTER TABLE `dealer_price_lists`
  ADD PRIMARY KEY (`price_list_id`),
  ADD KEY `idx_dpl_dealer` (`dealer_id`),
  ADD KEY `idx_dpl_active` (`is_active`,`is_default`),
  ADD KEY `fk_dpl_created_by` (`created_by`);

--
-- Indexes for table `document_sequences`
--
ALTER TABLE `document_sequences`
  ADD PRIMARY KEY (`doc_type`,`period`);

--
-- Indexes for table `employees`
--
ALTER TABLE `employees`
  ADD PRIMARY KEY (`employee_id`),
  ADD UNIQUE KEY `uk_employee_key` (`employee_key`),
  ADD UNIQUE KEY `uk_qr_token` (`qr_token`),
  ADD UNIQUE KEY `uk_email` (`email`),
  ADD KEY `idx_department` (`department`),
  ADD KEY `idx_is_active` (`is_active`),
  ADD KEY `idx_employees_employment_type` (`employment_type`),
  ADD KEY `idx_employees_aadhaar` (`aadhaar_number`),
  ADD KEY `idx_employees_default_shift` (`default_shift_id`);

--
-- Indexes for table `employee_advances`
--
ALTER TABLE `employee_advances`
  ADD PRIMARY KEY (`advance_id`),
  ADD KEY `idx_employee_advances_month` (`payroll_month`),
  ADD KEY `idx_employee_advances_employee_month` (`employee_key`,`payroll_month`);

--
-- Indexes for table `employee_compliance`
--
ALTER TABLE `employee_compliance`
  ADD PRIMARY KEY (`compliance_id`),
  ADD KEY `idx_emp_compliance_employee` (`employee_key`),
  ADD KEY `idx_emp_compliance_status_expiry` (`status`,`expiry_date`),
  ADD KEY `idx_emp_compliance_type` (`type`),
  ADD KEY `idx_emp_compliance_attachment` (`attachment_id`);

--
-- Indexes for table `eway_bills`
--
ALTER TABLE `eway_bills`
  ADD PRIMARY KEY (`eway_id`),
  ADD UNIQUE KEY `uq_eway_invoice` (`invoice_id`);

--
-- Indexes for table `expenses`
--
ALTER TABLE `expenses`
  ADD PRIMARY KEY (`expense_id`),
  ADD UNIQUE KEY `uk_expense_code` (`expense_code`),
  ADD KEY `idx_expense_date` (`expense_date`),
  ADD KEY `idx_expense_category` (`category`),
  ADD KEY `fk_expense_creator` (`created_by`);

--
-- Indexes for table `faqs`
--
ALTER TABLE `faqs`
  ADD PRIMARY KEY (`faq_id`);

--
-- Indexes for table `finance_config`
--
ALTER TABLE `finance_config`
  ADD PRIMARY KEY (`config_key`);

--
-- Indexes for table `finance_records`
--
ALTER TABLE `finance_records`
  ADD PRIMARY KEY (`record_id`),
  ADD KEY `idx_record_type` (`record_type`),
  ADD KEY `idx_record_date` (`record_date`),
  ADD KEY `idx_category` (`category`);

--
-- Indexes for table `goods_receipts`
--
ALTER TABLE `goods_receipts`
  ADD PRIMARY KEY (`grn_id`),
  ADD UNIQUE KEY `uq_grn_number` (`grn_number`),
  ADD KEY `idx_grn_po` (`po_id`),
  ADD KEY `idx_grn_status` (`status`);

--
-- Indexes for table `goods_receipt_items`
--
ALTER TABLE `goods_receipt_items`
  ADD PRIMARY KEY (`item_id`),
  ADD KEY `idx_grni_grn` (`grn_id`),
  ADD KEY `idx_grni_po_item` (`po_item_id`);

--
-- Indexes for table `gst_compliance_periods`
--
ALTER TABLE `gst_compliance_periods`
  ADD PRIMARY KEY (`period_id`),
  ADD UNIQUE KEY `uq_gst_compliance_period_key` (`period_key`),
  ADD KEY `idx_gst_compliance_status` (`status`),
  ADD KEY `fk_gst_compliance_locked_by` (`locked_by`),
  ADD KEY `fk_gst_compliance_created_by` (`created_by`);

--
-- Indexes for table `historical_invoices`
--
ALTER TABLE `historical_invoices`
  ADD PRIMARY KEY (`historical_invoice_id`),
  ADD UNIQUE KEY `uq_historical_invoices_number` (`invoice_number`),
  ADD KEY `idx_historical_invoices_date` (`invoice_date`),
  ADD KEY `idx_historical_invoices_status` (`status`),
  ADD KEY `idx_historical_invoices_import_job` (`import_job_id`),
  ADD KEY `fk_hist_customer` (`customer_id`);

--
-- Indexes for table `historical_invoice_items`
--
ALTER TABLE `historical_invoice_items`
  ADD PRIMARY KEY (`item_id`),
  ADD UNIQUE KEY `uq_hist_item_invoice_desc` (`historical_invoice_id`,`description`(150)),
  ADD KEY `idx_hist_item_invoice` (`historical_invoice_id`);

--
-- Indexes for table `import_jobs`
--
ALTER TABLE `import_jobs`
  ADD PRIMARY KEY (`job_id`),
  ADD KEY `idx_import_jobs_module` (`module`),
  ADD KEY `idx_import_jobs_status` (`status`),
  ADD KEY `idx_import_jobs_created_by` (`created_by`);

--
-- Indexes for table `import_job_rows`
--
ALTER TABLE `import_job_rows`
  ADD PRIMARY KEY (`row_id`),
  ADD KEY `idx_import_rows_job` (`job_id`,`status`);

--
-- Indexes for table `invoices`
--
ALTER TABLE `invoices`
  ADD PRIMARY KEY (`invoice_id`),
  ADD UNIQUE KEY `invoice_number` (`invoice_number`),
  ADD KEY `idx_inv_order` (`order_id`),
  ADD KEY `idx_inv_status` (`status`),
  ADD KEY `idx_invoices_payment_order_created` (`payment_status`,`order_id`,`created_at`),
  ADD KEY `idx_invoices_created` (`created_at`),
  ADD KEY `fk_invoices_customer` (`customer_id`);

--
-- Indexes for table `invoice_items`
--
ALTER TABLE `invoice_items`
  ADD PRIMARY KEY (`item_id`),
  ADD KEY `idx_invoice_items_invoice` (`invoice_id`),
  ADD KEY `fk_invoice_items_product` (`product_id`);

--
-- Indexes for table `meetings`
--
ALTER TABLE `meetings`
  ADD PRIMARY KEY (`meeting_id`),
  ADD KEY `idx_date` (`date`),
  ADD KEY `idx_created_by` (`created_by`);

--
-- Indexes for table `meeting_attendees`
--
ALTER TABLE `meeting_attendees`
  ADD PRIMARY KEY (`meeting_id`,`attendee_key`),
  ADD KEY `idx_ma_attendee` (`attendee_key`);

--
-- Indexes for table `orders`
--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`order_id`),
  ADD UNIQUE KEY `order_number` (`order_number`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_order_number` (`order_number`),
  ADD KEY `idx_order_status` (`order_status`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_orders_user_status` (`user_id`,`order_status`),
  ADD KEY `idx_orders_status_created` (`order_status`,`created_at`),
  ADD KEY `idx_orders_payment_created` (`payment_status`,`created_at`);

--
-- Indexes for table `order_items`
--
ALTER TABLE `order_items`
  ADD PRIMARY KEY (`item_id`),
  ADD KEY `config_id` (`config_id`),
  ADD KEY `idx_order_id` (`order_id`),
  ADD KEY `idx_product_id` (`product_id`),
  ADD KEY `idx_order_items_order_product` (`order_id`,`product_id`);

--
-- Indexes for table `otp_verifications`
--
ALTER TABLE `otp_verifications`
  ADD PRIMARY KEY (`otp_id`),
  ADD KEY `idx_identifier` (`identifier`),
  ADD KEY `idx_otp_code` (`otp_code`),
  ADD KEY `idx_expires_at` (`expires_at`),
  ADD KEY `idx_user_id` (`user_id`);

--
-- Indexes for table `payments`
--
ALTER TABLE `payments`
  ADD PRIMARY KEY (`payment_id`),
  ADD UNIQUE KEY `uq_payments_number` (`payment_number`),
  ADD KEY `idx_payments_invoice` (`invoice_id`),
  ADD KEY `idx_payments_po` (`po_id`),
  ADD KEY `idx_payments_user` (`user_id`),
  ADD KEY `idx_payments_vendor` (`vendor_id`),
  ADD KEY `idx_payments_direction_date` (`direction`,`paid_on`),
  ADD KEY `idx_payments_status_date` (`status`,`paid_on`),
  ADD KEY `fk_payments_created_by` (`created_by`),
  ADD KEY `fk_payments_voided_by` (`voided_by`);

--
-- Indexes for table `payroll`
--
ALTER TABLE `payroll`
  ADD PRIMARY KEY (`payroll_id`),
  ADD UNIQUE KEY `uk_emp_month` (`employee_key`,`month`),
  ADD KEY `idx_month` (`month`),
  ADD KEY `idx_employee_key` (`employee_key`);

--
-- Indexes for table `production_consumption`
--
ALTER TABLE `production_consumption`
  ADD PRIMARY KEY (`consumption_id`),
  ADD KEY `idx_pc_run` (`run_id`),
  ADD KEY `idx_pc_material` (`raw_material_id`);

--
-- Indexes for table `production_outputs`
--
ALTER TABLE `production_outputs`
  ADD PRIMARY KEY (`output_id`),
  ADD KEY `idx_pout_run` (`run_id`),
  ADD KEY `idx_pout_product` (`product_id`);

--
-- Indexes for table `production_quality`
--
ALTER TABLE `production_quality`
  ADD PRIMARY KEY (`quality_id`),
  ADD UNIQUE KEY `uq_pq_run` (`run_id`);

--
-- Indexes for table `production_runs`
--
ALTER TABLE `production_runs`
  ADD PRIMARY KEY (`run_id`),
  ADD KEY `idx_prun_date` (`run_date`),
  ADD KEY `idx_prun_product` (`product_id`);

--
-- Indexes for table `production_spare_consumption`
--
ALTER TABLE `production_spare_consumption`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_psc_run` (`run_id`),
  ADD KEY `idx_psc_spare` (`spare_id`);

--
-- Indexes for table `products`
--
ALTER TABLE `products`
  ADD PRIMARY KEY (`product_id`),
  ADD KEY `idx_product_type` (`product_type`),
  ADD KEY `idx_category` (`category`),
  ADD KEY `idx_is_available` (`is_available`),
  ADD KEY `idx_products_type_available` (`product_type`,`is_available`);

--
-- Indexes for table `product_configurations`
--
ALTER TABLE `product_configurations`
  ADD PRIMARY KEY (`config_id`),
  ADD UNIQUE KEY `uq_product_size_purpose_sub` (`product_id`,`size`,`purpose`,`sub_purpose`),
  ADD KEY `idx_product_id` (`product_id`),
  ADD KEY `idx_size` (`size`);

--
-- Indexes for table `purchase_items`
--
ALTER TABLE `purchase_items`
  ADD PRIMARY KEY (`purchase_item_id`),
  ADD UNIQUE KEY `uq_pi_code` (`item_code`),
  ADD KEY `idx_pi_active` (`is_active`),
  ADD KEY `idx_pi_name` (`name`),
  ADD KEY `idx_pi_category` (`category`),
  ADD KEY `idx_pi_type` (`item_type`);

--
-- Indexes for table `purchase_orders`
--
ALTER TABLE `purchase_orders`
  ADD PRIMARY KEY (`po_id`),
  ADD UNIQUE KEY `uq_po_number` (`po_number`),
  ADD KEY `idx_po_vendor` (`vendor_id`),
  ADD KEY `idx_po_pr` (`pr_id`),
  ADD KEY `idx_po_status` (`status`),
  ADD KEY `idx_po_created` (`created_at`),
  ADD KEY `idx_purchase_orders_reference_number` (`reference_number`),
  ADD KEY `fk_po_billed_expense` (`billed_expense_id`);

--
-- Indexes for table `purchase_order_items`
--
ALTER TABLE `purchase_order_items`
  ADD PRIMARY KEY (`item_id`),
  ADD KEY `idx_poi_po` (`po_id`),
  ADD KEY `idx_poi_product` (`product_id`),
  ADD KEY `idx_poi_purchase_item` (`purchase_item_id`);

--
-- Indexes for table `purchase_requests`
--
ALTER TABLE `purchase_requests`
  ADD PRIMARY KEY (`pr_id`),
  ADD UNIQUE KEY `uq_pr_number` (`pr_number`),
  ADD KEY `idx_pr_status` (`status`),
  ADD KEY `idx_pr_created` (`created_at`),
  ADD KEY `idx_pr_requested_by` (`requested_by`);

--
-- Indexes for table `purchase_request_items`
--
ALTER TABLE `purchase_request_items`
  ADD PRIMARY KEY (`item_id`),
  ADD KEY `idx_pri_pr` (`pr_id`),
  ADD KEY `idx_pri_product` (`product_id`);

--
-- Indexes for table `queries`
--
ALTER TABLE `queries`
  ADD PRIMARY KEY (`query_id`),
  ADD UNIQUE KEY `query_number` (`query_number`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_queries_created` (`created_at`);

--
-- Indexes for table `quotes`
--
ALTER TABLE `quotes`
  ADD PRIMARY KEY (`quote_id`),
  ADD UNIQUE KEY `quote_number` (`quote_number`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_quotes_created` (`created_at`);

--
-- Indexes for table `quote_requests`
--
ALTER TABLE `quote_requests`
  ADD PRIMARY KEY (`quote_id`),
  ADD KEY `idx_qr_status` (`status`),
  ADD KEY `idx_qr_phone` (`phone`);

--
-- Indexes for table `raw_materials`
--
ALTER TABLE `raw_materials`
  ADD PRIMARY KEY (`raw_material_id`),
  ADD UNIQUE KEY `uq_raw_material_name` (`name`);

--
-- Indexes for table `raw_material_movements`
--
ALTER TABLE `raw_material_movements`
  ADD PRIMARY KEY (`movement_id`),
  ADD KEY `idx_rmm_material` (`raw_material_id`),
  ADD KEY `idx_rmm_date` (`movement_date`),
  ADD KEY `fk_rmm_run` (`run_id`);

--
-- Indexes for table `refresh_tokens`
--
ALTER TABLE `refresh_tokens`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `token_hash` (`token_hash`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `idx_expires_at` (`expires_at`);

--
-- Indexes for table `revoked_tokens`
--
ALTER TABLE `revoked_tokens`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `token_hash` (`token_hash`),
  ADD KEY `idx_expired_at` (`expired_at`);

--
-- Indexes for table `sales_documents`
--
ALTER TABLE `sales_documents`
  ADD PRIMARY KEY (`document_id`),
  ADD UNIQUE KEY `uq_sales_documents_number` (`document_number`),
  ADD KEY `idx_sales_documents_type_status` (`document_type`,`status`),
  ADD KEY `idx_sales_documents_customer` (`user_id`,`customer_name`),
  ADD KEY `idx_sales_documents_source_quote` (`source_quote_id`),
  ADD KEY `idx_sales_documents_invoice` (`invoice_id`),
  ADD KEY `fk_sales_documents_source_document` (`source_document_id`),
  ADD KEY `fk_sales_documents_converted_document` (`converted_document_id`),
  ADD KEY `fk_sales_documents_created_by` (`created_by`);

--
-- Indexes for table `sales_document_items`
--
ALTER TABLE `sales_document_items`
  ADD PRIMARY KEY (`item_id`),
  ADD KEY `idx_sales_document_items_document` (`document_id`),
  ADD KEY `idx_sales_document_items_product` (`product_id`);

--
-- Indexes for table `settings`
--
ALTER TABLE `settings`
  ADD PRIMARY KEY (`setting_id`),
  ADD UNIQUE KEY `setting_key` (`setting_key`),
  ADD KEY `idx_setting_key` (`setting_key`);

--
-- Indexes for table `sops`
--
ALTER TABLE `sops`
  ADD PRIMARY KEY (`sop_id`),
  ADD UNIQUE KEY `uk_code` (`code`),
  ADD KEY `idx_department` (`department`),
  ADD KEY `idx_owner_id` (`owner_id`),
  ADD KEY `idx_access_role` (`access_role`),
  ADD KEY `fk_sops_current_version` (`current_version_id`);

--
-- Indexes for table `sop_tags`
--
ALTER TABLE `sop_tags`
  ADD PRIMARY KEY (`sop_id`,`tag`),
  ADD KEY `idx_sop_tags_tag` (`tag`);

--
-- Indexes for table `sop_versions`
--
ALTER TABLE `sop_versions`
  ADD PRIMARY KEY (`version_id`),
  ADD KEY `idx_sop_id` (`sop_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_uploaded_by` (`uploaded_by`),
  ADD KEY `idx_approved_by` (`approved_by`);

--
-- Indexes for table `spares_assets`
--
ALTER TABLE `spares_assets`
  ADD PRIMARY KEY (`spare_id`),
  ADD UNIQUE KEY `uq_spare_name` (`name`),
  ADD KEY `idx_spare_category` (`category`),
  ADD KEY `idx_spare_active` (`is_active`);

--
-- Indexes for table `spare_asset_movements`
--
ALTER TABLE `spare_asset_movements`
  ADD PRIMARY KEY (`movement_id`),
  ADD KEY `idx_sam_spare` (`spare_id`),
  ADD KEY `idx_sam_date` (`movement_date`);

--
-- Indexes for table `stock_movements`
--
ALTER TABLE `stock_movements`
  ADD PRIMARY KEY (`stock_movement_id`),
  ADD KEY `idx_sm_product` (`product_id`),
  ADD KEY `idx_sm_date` (`movement_date`),
  ADD KEY `fk_sm_run` (`run_id`),
  ADD KEY `fk_sm_order` (`order_id`);

--
-- Indexes for table `tasks`
--
ALTER TABLE `tasks`
  ADD PRIMARY KEY (`task_id`),
  ADD UNIQUE KEY `uk_task_key` (`task_key`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_assignee_id` (`assignee_id`),
  ADD KEY `idx_due_date` (`due_date`);

--
-- Indexes for table `task_comments`
--
ALTER TABLE `task_comments`
  ADD PRIMARY KEY (`comment_id`),
  ADD KEY `idx_task_key` (`task_key`);

--
-- Indexes for table `task_tags`
--
ALTER TABLE `task_tags`
  ADD PRIMARY KEY (`task_key`,`tag`),
  ADD KEY `idx_task_tags_tag` (`tag`);

--
-- Indexes for table `test_certificates`
--
ALTER TABLE `test_certificates`
  ADD PRIMARY KEY (`certificate_id`),
  ADD UNIQUE KEY `uq_test_certificates_number` (`certificate_number`),
  ADD KEY `idx_test_certificates_invoice` (`invoice_id`),
  ADD KEY `idx_test_certificates_product` (`product_id`),
  ADD KEY `idx_test_certificates_status_issue` (`status`,`issue_date`),
  ADD KEY `fk_test_certificates_invoice_item` (`invoice_item_id`),
  ADD KEY `fk_test_certificates_attachment` (`attachment_id`),
  ADD KEY `fk_test_certificates_issued_by` (`issued_by`),
  ADD KEY `fk_test_certificates_voided_by` (`voided_by`);

--
-- Indexes for table `tms_tasks`
--
ALTER TABLE `tms_tasks`
  ADD PRIMARY KEY (`tms_task_id`),
  ADD UNIQUE KEY `uk_tms_emp_date_task` (`employee_key`,`task_date`,`task`),
  ADD KEY `idx_tms_date` (`task_date`),
  ADD KEY `idx_tms_emp` (`employee_key`),
  ADD KEY `fk_tms_import_job` (`import_job_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`user_id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `idx_email` (`email`),
  ADD KEY `idx_phone` (`phone`),
  ADD KEY `idx_user_type` (`user_type`),
  ADD KEY `idx_approval_status` (`approval_status`),
  ADD KEY `idx_users_created` (`created_at`),
  ADD KEY `idx_users_staff_role` (`staff_role`);

--
-- Indexes for table `vendors`
--
ALTER TABLE `vendors`
  ADD PRIMARY KEY (`vendor_id`),
  ADD UNIQUE KEY `uq_vendor_code` (`vendor_code`),
  ADD KEY `idx_vendors_active` (`is_active`),
  ADD KEY `idx_vendors_name` (`name`),
  ADD KEY `idx_vendors_gstin` (`gstin`);

--
-- Indexes for table `workflows`
--
ALTER TABLE `workflows`
  ADD PRIMARY KEY (`workflow_id`),
  ADD KEY `idx_type` (`type`),
  ADD KEY `idx_stage` (`stage`),
  ADD KEY `idx_priority` (`priority`),
  ADD KEY `idx_requester_id` (`requester_id`),
  ADD KEY `idx_approver_id` (`approver_id`);

--
-- Indexes for table `workflow_history`
--
ALTER TABLE `workflow_history`
  ADD PRIMARY KEY (`history_id`),
  ADD KEY `idx_workflow_id` (`workflow_id`),
  ADD KEY `idx_actor_id` (`actor_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `attachments`
--
ALTER TABLE `attachments`
  MODIFY `attachment_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `attendance`
--
ALTER TABLE `attendance`
  MODIFY `attendance_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `attendance_punches`
--
ALTER TABLE `attendance_punches`
  MODIFY `punch_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `attendance_shifts`
--
ALTER TABLE `attendance_shifts`
  MODIFY `shift_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `audit_log`
--
ALTER TABLE `audit_log`
  MODIFY `log_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `backup_runs`
--
ALTER TABLE `backup_runs`
  MODIFY `backup_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `benchmarks`
--
ALTER TABLE `benchmarks`
  MODIFY `benchmark_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `budgets`
--
ALTER TABLE `budgets`
  MODIFY `budget_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `budget_lines`
--
ALTER TABLE `budget_lines`
  MODIFY `line_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `chat_knowledge_base`
--
ALTER TABLE `chat_knowledge_base`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `chat_messages`
--
ALTER TABLE `chat_messages`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `chat_sessions`
--
ALTER TABLE `chat_sessions`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `customer_queries`
--
ALTER TABLE `customer_queries`
  MODIFY `query_id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `dealer_customers`
--
ALTER TABLE `dealer_customers`
  MODIFY `dealer_customer_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `dealer_price_items`
--
ALTER TABLE `dealer_price_items`
  MODIFY `price_item_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `dealer_price_lists`
--
ALTER TABLE `dealer_price_lists`
  MODIFY `price_list_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `employees`
--
ALTER TABLE `employees`
  MODIFY `employee_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `employee_advances`
--
ALTER TABLE `employee_advances`
  MODIFY `advance_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `employee_compliance`
--
ALTER TABLE `employee_compliance`
  MODIFY `compliance_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `eway_bills`
--
ALTER TABLE `eway_bills`
  MODIFY `eway_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `expenses`
--
ALTER TABLE `expenses`
  MODIFY `expense_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `faqs`
--
ALTER TABLE `faqs`
  MODIFY `faq_id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `finance_records`
--
ALTER TABLE `finance_records`
  MODIFY `record_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `goods_receipts`
--
ALTER TABLE `goods_receipts`
  MODIFY `grn_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `goods_receipt_items`
--
ALTER TABLE `goods_receipt_items`
  MODIFY `item_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `gst_compliance_periods`
--
ALTER TABLE `gst_compliance_periods`
  MODIFY `period_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `historical_invoices`
--
ALTER TABLE `historical_invoices`
  MODIFY `historical_invoice_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `historical_invoice_items`
--
ALTER TABLE `historical_invoice_items`
  MODIFY `item_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `import_jobs`
--
ALTER TABLE `import_jobs`
  MODIFY `job_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `import_job_rows`
--
ALTER TABLE `import_job_rows`
  MODIFY `row_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `invoices`
--
ALTER TABLE `invoices`
  MODIFY `invoice_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `invoice_items`
--
ALTER TABLE `invoice_items`
  MODIFY `item_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `meetings`
--
ALTER TABLE `meetings`
  MODIFY `meeting_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `orders`
--
ALTER TABLE `orders`
  MODIFY `order_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `order_items`
--
ALTER TABLE `order_items`
  MODIFY `item_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `otp_verifications`
--
ALTER TABLE `otp_verifications`
  MODIFY `otp_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `payments`
--
ALTER TABLE `payments`
  MODIFY `payment_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `payroll`
--
ALTER TABLE `payroll`
  MODIFY `payroll_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `production_consumption`
--
ALTER TABLE `production_consumption`
  MODIFY `consumption_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `production_outputs`
--
ALTER TABLE `production_outputs`
  MODIFY `output_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `production_quality`
--
ALTER TABLE `production_quality`
  MODIFY `quality_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `production_runs`
--
ALTER TABLE `production_runs`
  MODIFY `run_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `production_spare_consumption`
--
ALTER TABLE `production_spare_consumption`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `products`
--
ALTER TABLE `products`
  MODIFY `product_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `product_configurations`
--
ALTER TABLE `product_configurations`
  MODIFY `config_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `purchase_items`
--
ALTER TABLE `purchase_items`
  MODIFY `purchase_item_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `purchase_orders`
--
ALTER TABLE `purchase_orders`
  MODIFY `po_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `purchase_order_items`
--
ALTER TABLE `purchase_order_items`
  MODIFY `item_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `purchase_requests`
--
ALTER TABLE `purchase_requests`
  MODIFY `pr_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `purchase_request_items`
--
ALTER TABLE `purchase_request_items`
  MODIFY `item_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `queries`
--
ALTER TABLE `queries`
  MODIFY `query_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `quotes`
--
ALTER TABLE `quotes`
  MODIFY `quote_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `quote_requests`
--
ALTER TABLE `quote_requests`
  MODIFY `quote_id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `raw_materials`
--
ALTER TABLE `raw_materials`
  MODIFY `raw_material_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `raw_material_movements`
--
ALTER TABLE `raw_material_movements`
  MODIFY `movement_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `refresh_tokens`
--
ALTER TABLE `refresh_tokens`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `revoked_tokens`
--
ALTER TABLE `revoked_tokens`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sales_documents`
--
ALTER TABLE `sales_documents`
  MODIFY `document_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sales_document_items`
--
ALTER TABLE `sales_document_items`
  MODIFY `item_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `settings`
--
ALTER TABLE `settings`
  MODIFY `setting_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sops`
--
ALTER TABLE `sops`
  MODIFY `sop_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sop_versions`
--
ALTER TABLE `sop_versions`
  MODIFY `version_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `spares_assets`
--
ALTER TABLE `spares_assets`
  MODIFY `spare_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `spare_asset_movements`
--
ALTER TABLE `spare_asset_movements`
  MODIFY `movement_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `stock_movements`
--
ALTER TABLE `stock_movements`
  MODIFY `stock_movement_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `tasks`
--
ALTER TABLE `tasks`
  MODIFY `task_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `task_comments`
--
ALTER TABLE `task_comments`
  MODIFY `comment_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `test_certificates`
--
ALTER TABLE `test_certificates`
  MODIFY `certificate_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `tms_tasks`
--
ALTER TABLE `tms_tasks`
  MODIFY `tms_task_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `user_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=55;

--
-- AUTO_INCREMENT for table `vendors`
--
ALTER TABLE `vendors`
  MODIFY `vendor_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `workflows`
--
ALTER TABLE `workflows`
  MODIFY `workflow_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `workflow_history`
--
ALTER TABLE `workflow_history`
  MODIFY `history_id` int(11) NOT NULL AUTO_INCREMENT;

-- --------------------------------------------------------

--
-- Structure for view `v_active_orders`
--
DROP TABLE IF EXISTS `v_active_orders`;

CREATE ALGORITHM=UNDEFINED DEFINER=`u952547820_test`@`localhost` SQL SECURITY INVOKER VIEW `v_active_orders`  AS SELECT `o`.`order_id` AS `order_id`, `o`.`order_number` AS `order_number`, `u`.`name` AS `customer_name`, `u`.`email` AS `email`, `u`.`phone` AS `phone`, `u`.`user_type` AS `user_type`, `o`.`total_amount` AS `total_amount`, `o`.`order_status` AS `order_status`, `o`.`payment_status` AS `payment_status`, `o`.`created_at` AS `created_at`, count(`oi`.`item_id`) AS `total_items` FROM ((`orders` `o` join `users` `u` on(`o`.`user_id` = `u`.`user_id`)) left join `order_items` `oi` on(`o`.`order_id` = `oi`.`order_id`)) WHERE `o`.`order_status` not in ('delivered','cancelled') GROUP BY `o`.`order_id`, `o`.`order_number`, `u`.`name`, `u`.`email`, `u`.`phone`, `u`.`user_type`, `o`.`total_amount`, `o`.`order_status`, `o`.`payment_status`, `o`.`created_at` ;

-- --------------------------------------------------------

--
-- Structure for view `v_order_statistics`
--
DROP TABLE IF EXISTS `v_order_statistics`;

CREATE ALGORITHM=UNDEFINED DEFINER=`u952547820_test`@`localhost` SQL SECURITY INVOKER VIEW `v_order_statistics`  AS SELECT cast(`orders`.`created_at` as date) AS `order_date`, count(0) AS `total_orders`, sum(`orders`.`total_amount`) AS `total_revenue`, avg(`orders`.`total_amount`) AS `avg_order_value`, count(case when `orders`.`order_status` = 'delivered' then 1 end) AS `delivered_orders`, count(case when `orders`.`order_status` = 'cancelled' then 1 end) AS `cancelled_orders`, count(case when `orders`.`order_status` in ('pending','confirmed','processing','shipped') then 1 end) AS `active_orders` FROM `orders` GROUP BY cast(`orders`.`created_at` as date) ORDER BY cast(`orders`.`created_at` as date) DESC ;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `attendance`
--
ALTER TABLE `attendance`
  ADD CONSTRAINT `fk_attendance_employee` FOREIGN KEY (`employee_key`) REFERENCES `employees` (`employee_key`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_attendance_shift` FOREIGN KEY (`shift_id`) REFERENCES `attendance_shifts` (`shift_id`) ON DELETE SET NULL;

--
-- Constraints for table `attendance_punches`
--
ALTER TABLE `attendance_punches`
  ADD CONSTRAINT `fk_att_punch_employee` FOREIGN KEY (`employee_key`) REFERENCES `employees` (`employee_key`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_att_punch_job` FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs` (`job_id`) ON DELETE SET NULL;

--
-- Constraints for table `audit_log`
--
ALTER TABLE `audit_log`
  ADD CONSTRAINT `audit_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `backup_runs`
--
ALTER TABLE `backup_runs`
  ADD CONSTRAINT `fk_backup_runs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `benchmarks`
--
ALTER TABLE `benchmarks`
  ADD CONSTRAINT `fk_benchmarks_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `budgets`
--
ALTER TABLE `budgets`
  ADD CONSTRAINT `fk_budgets_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `budget_lines`
--
ALTER TABLE `budget_lines`
  ADD CONSTRAINT `fk_budget_lines_budget` FOREIGN KEY (`budget_id`) REFERENCES `budgets` (`budget_id`) ON DELETE CASCADE;

--
-- Constraints for table `chat_messages`
--
ALTER TABLE `chat_messages`
  ADD CONSTRAINT `fk_chat_messages_session` FOREIGN KEY (`session_id`) REFERENCES `chat_sessions` (`session_id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `chat_sessions`
--
ALTER TABLE `chat_sessions`
  ADD CONSTRAINT `fk_chat_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `customer_metrics`
--
ALTER TABLE `customer_metrics`
  ADD CONSTRAINT `fk_customer_metrics_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `dealer_customers`
--
ALTER TABLE `dealer_customers`
  ADD CONSTRAINT `fk_dc_conflict_user` FOREIGN KEY (`conflict_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_dc_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_dc_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_dc_dealer` FOREIGN KEY (`dealer_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_dc_price_list` FOREIGN KEY (`price_list_id`) REFERENCES `dealer_price_lists` (`price_list_id`) ON DELETE SET NULL;

--
-- Constraints for table `dealer_price_items`
--
ALTER TABLE `dealer_price_items`
  ADD CONSTRAINT `fk_dpi_list` FOREIGN KEY (`price_list_id`) REFERENCES `dealer_price_lists` (`price_list_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_dpi_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`);

--
-- Constraints for table `dealer_price_lists`
--
ALTER TABLE `dealer_price_lists`
  ADD CONSTRAINT `fk_dpl_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_dpl_dealer` FOREIGN KEY (`dealer_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `employees`
--
ALTER TABLE `employees`
  ADD CONSTRAINT `fk_employees_default_shift` FOREIGN KEY (`default_shift_id`) REFERENCES `attendance_shifts` (`shift_id`) ON DELETE SET NULL;

--
-- Constraints for table `employee_advances`
--
ALTER TABLE `employee_advances`
  ADD CONSTRAINT `fk_employee_advances_employee` FOREIGN KEY (`employee_key`) REFERENCES `employees` (`employee_key`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `employee_compliance`
--
ALTER TABLE `employee_compliance`
  ADD CONSTRAINT `fk_emp_compliance_attachment` FOREIGN KEY (`attachment_id`) REFERENCES `attachments` (`attachment_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_emp_compliance_employee` FOREIGN KEY (`employee_key`) REFERENCES `employees` (`employee_key`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `eway_bills`
--
ALTER TABLE `eway_bills`
  ADD CONSTRAINT `fk_eway_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`invoice_id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `expenses`
--
ALTER TABLE `expenses`
  ADD CONSTRAINT `fk_expense_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `goods_receipts`
--
ALTER TABLE `goods_receipts`
  ADD CONSTRAINT `fk_grn_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`po_id`);

--
-- Constraints for table `goods_receipt_items`
--
ALTER TABLE `goods_receipt_items`
  ADD CONSTRAINT `fk_grni_grn` FOREIGN KEY (`grn_id`) REFERENCES `goods_receipts` (`grn_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_grni_po_item` FOREIGN KEY (`po_item_id`) REFERENCES `purchase_order_items` (`item_id`) ON DELETE CASCADE;

--
-- Constraints for table `gst_compliance_periods`
--
ALTER TABLE `gst_compliance_periods`
  ADD CONSTRAINT `fk_gst_compliance_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_gst_compliance_locked_by` FOREIGN KEY (`locked_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `historical_invoices`
--
ALTER TABLE `historical_invoices`
  ADD CONSTRAINT `fk_hist_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_hist_import_job` FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs` (`job_id`) ON DELETE SET NULL;

--
-- Constraints for table `historical_invoice_items`
--
ALTER TABLE `historical_invoice_items`
  ADD CONSTRAINT `fk_hist_item_invoice` FOREIGN KEY (`historical_invoice_id`) REFERENCES `historical_invoices` (`historical_invoice_id`) ON DELETE CASCADE;

--
-- Constraints for table `import_job_rows`
--
ALTER TABLE `import_job_rows`
  ADD CONSTRAINT `fk_import_rows_job` FOREIGN KEY (`job_id`) REFERENCES `import_jobs` (`job_id`) ON DELETE CASCADE;

--
-- Constraints for table `invoices`
--
ALTER TABLE `invoices`
  ADD CONSTRAINT `fk_invoice_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_invoices_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `invoice_items`
--
ALTER TABLE `invoice_items`
  ADD CONSTRAINT `fk_invoice_items_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`invoice_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_invoice_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE SET NULL;

--
-- Constraints for table `meetings`
--
ALTER TABLE `meetings`
  ADD CONSTRAINT `fk_meetings_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `meeting_attendees`
--
ALTER TABLE `meeting_attendees`
  ADD CONSTRAINT `fk_ma_employee` FOREIGN KEY (`attendee_key`) REFERENCES `employees` (`employee_key`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_ma_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `meetings` (`meeting_id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `orders`
--
ALTER TABLE `orders`
  ADD CONSTRAINT `orders_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `order_items`
--
ALTER TABLE `order_items`
  ADD CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`),
  ADD CONSTRAINT `order_items_ibfk_3` FOREIGN KEY (`config_id`) REFERENCES `product_configurations` (`config_id`) ON DELETE SET NULL;

--
-- Constraints for table `otp_verifications`
--
ALTER TABLE `otp_verifications`
  ADD CONSTRAINT `otp_verifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `payments`
--
ALTER TABLE `payments`
  ADD CONSTRAINT `fk_payments_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_payments_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`invoice_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_payments_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`po_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_payments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_payments_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`vendor_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_payments_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `payroll`
--
ALTER TABLE `payroll`
  ADD CONSTRAINT `fk_payroll_employee` FOREIGN KEY (`employee_key`) REFERENCES `employees` (`employee_key`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `production_consumption`
--
ALTER TABLE `production_consumption`
  ADD CONSTRAINT `fk_pc_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`raw_material_id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_pc_run` FOREIGN KEY (`run_id`) REFERENCES `production_runs` (`run_id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `production_outputs`
--
ALTER TABLE `production_outputs`
  ADD CONSTRAINT `fk_pout_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_pout_run` FOREIGN KEY (`run_id`) REFERENCES `production_runs` (`run_id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `production_quality`
--
ALTER TABLE `production_quality`
  ADD CONSTRAINT `fk_pq_run` FOREIGN KEY (`run_id`) REFERENCES `production_runs` (`run_id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `production_runs`
--
ALTER TABLE `production_runs`
  ADD CONSTRAINT `fk_prun_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON UPDATE CASCADE;

--
-- Constraints for table `production_spare_consumption`
--
ALTER TABLE `production_spare_consumption`
  ADD CONSTRAINT `fk_psc_run` FOREIGN KEY (`run_id`) REFERENCES `production_runs` (`run_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_psc_spare` FOREIGN KEY (`spare_id`) REFERENCES `spares_assets` (`spare_id`) ON UPDATE CASCADE;

--
-- Constraints for table `product_configurations`
--
ALTER TABLE `product_configurations`
  ADD CONSTRAINT `product_configurations_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE CASCADE;

--
-- Constraints for table `purchase_orders`
--
ALTER TABLE `purchase_orders`
  ADD CONSTRAINT `fk_po_billed_expense` FOREIGN KEY (`billed_expense_id`) REFERENCES `expenses` (`expense_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_po_pr` FOREIGN KEY (`pr_id`) REFERENCES `purchase_requests` (`pr_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_po_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`vendor_id`);

--
-- Constraints for table `purchase_order_items`
--
ALTER TABLE `purchase_order_items`
  ADD CONSTRAINT `fk_poi_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`po_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_poi_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE SET NULL;

--
-- Constraints for table `purchase_request_items`
--
ALTER TABLE `purchase_request_items`
  ADD CONSTRAINT `fk_pri_pr` FOREIGN KEY (`pr_id`) REFERENCES `purchase_requests` (`pr_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_pri_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE SET NULL;

--
-- Constraints for table `queries`
--
ALTER TABLE `queries`
  ADD CONSTRAINT `queries_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `quotes`
--
ALTER TABLE `quotes`
  ADD CONSTRAINT `quotes_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `raw_material_movements`
--
ALTER TABLE `raw_material_movements`
  ADD CONSTRAINT `fk_rmm_material` FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials` (`raw_material_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_rmm_run` FOREIGN KEY (`run_id`) REFERENCES `production_runs` (`run_id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `refresh_tokens`
--
ALTER TABLE `refresh_tokens`
  ADD CONSTRAINT `refresh_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `sales_documents`
--
ALTER TABLE `sales_documents`
  ADD CONSTRAINT `fk_sales_documents_converted_document` FOREIGN KEY (`converted_document_id`) REFERENCES `sales_documents` (`document_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_sales_documents_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_sales_documents_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`invoice_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_sales_documents_source_document` FOREIGN KEY (`source_document_id`) REFERENCES `sales_documents` (`document_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_sales_documents_source_quote` FOREIGN KEY (`source_quote_id`) REFERENCES `quotes` (`quote_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_sales_documents_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `sales_document_items`
--
ALTER TABLE `sales_document_items`
  ADD CONSTRAINT `fk_sales_document_items_document` FOREIGN KEY (`document_id`) REFERENCES `sales_documents` (`document_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_sales_document_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE SET NULL;

--
-- Constraints for table `sops`
--
ALTER TABLE `sops`
  ADD CONSTRAINT `fk_sops_current_version` FOREIGN KEY (`current_version_id`) REFERENCES `sop_versions` (`version_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_sops_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `sop_tags`
--
ALTER TABLE `sop_tags`
  ADD CONSTRAINT `fk_sop_tags_sop` FOREIGN KEY (`sop_id`) REFERENCES `sops` (`sop_id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `sop_versions`
--
ALTER TABLE `sop_versions`
  ADD CONSTRAINT `fk_sop_versions_approver` FOREIGN KEY (`approved_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_sop_versions_sop` FOREIGN KEY (`sop_id`) REFERENCES `sops` (`sop_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_sop_versions_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `spare_asset_movements`
--
ALTER TABLE `spare_asset_movements`
  ADD CONSTRAINT `fk_sam_spare` FOREIGN KEY (`spare_id`) REFERENCES `spares_assets` (`spare_id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `stock_movements`
--
ALTER TABLE `stock_movements`
  ADD CONSTRAINT `fk_sm_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_sm_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_sm_run` FOREIGN KEY (`run_id`) REFERENCES `production_runs` (`run_id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `tasks`
--
ALTER TABLE `tasks`
  ADD CONSTRAINT `fk_tasks_assignee` FOREIGN KEY (`assignee_id`) REFERENCES `employees` (`employee_key`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `task_comments`
--
ALTER TABLE `task_comments`
  ADD CONSTRAINT `fk_comment_task` FOREIGN KEY (`task_key`) REFERENCES `tasks` (`task_key`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `task_tags`
--
ALTER TABLE `task_tags`
  ADD CONSTRAINT `fk_task_tags_task` FOREIGN KEY (`task_key`) REFERENCES `tasks` (`task_key`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `test_certificates`
--
ALTER TABLE `test_certificates`
  ADD CONSTRAINT `fk_test_certificates_attachment` FOREIGN KEY (`attachment_id`) REFERENCES `attachments` (`attachment_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_test_certificates_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`invoice_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_test_certificates_invoice_item` FOREIGN KEY (`invoice_item_id`) REFERENCES `invoice_items` (`item_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_test_certificates_issued_by` FOREIGN KEY (`issued_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_test_certificates_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_test_certificates_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `tms_tasks`
--
ALTER TABLE `tms_tasks`
  ADD CONSTRAINT `fk_tms_employee` FOREIGN KEY (`employee_key`) REFERENCES `employees` (`employee_key`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_tms_import_job` FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs` (`job_id`) ON DELETE SET NULL;

--
-- Constraints for table `workflows`
--
ALTER TABLE `workflows`
  ADD CONSTRAINT `fk_workflows_approver` FOREIGN KEY (`approver_id`) REFERENCES `employees` (`employee_key`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_workflows_requester` FOREIGN KEY (`requester_id`) REFERENCES `employees` (`employee_key`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `workflow_history`
--
ALTER TABLE `workflow_history`
  ADD CONSTRAINT `fk_wfh_actor` FOREIGN KEY (`actor_id`) REFERENCES `employees` (`employee_key`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_workflow_history_workflow` FOREIGN KEY (`workflow_id`) REFERENCES `workflows` (`workflow_id`) ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

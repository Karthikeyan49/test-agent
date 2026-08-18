<?php
declare(strict_types=1);

// --- Bootstrap ----------------------------------------------------------------
define('ROOT_PATH', __DIR__);

require_once ROOT_PATH . '/config/app.php';
require_once ROOT_PATH . '/core/Response.php';

// --- Error handling -----------------------------------------------------------
if (defined('APP_ENV') && APP_ENV === 'production') {
    error_reporting(0);
    ini_set('display_errors', '0');
} else {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
}

set_exception_handler(function (Throwable $e) {
    error_log('[Unhandled] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (class_exists('Response')) {
        Response::error(
            (!defined('APP_ENV') || APP_ENV === 'development') ? $e->getMessage() : 'Internal server error',
            500
        );
    } else {
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Internal server error']);
    }
});

// --- CORS ---------------------------------------------------------------------
$_allowedOrigins = array_filter(array_map('trim', explode(',', defined('CORS_ORIGIN') ? CORS_ORIGIN : '')));
$_allowedOrigins[] = 'http://localhost:8080';
$_allowedOrigins[] = 'http://localhost:8081';
$_allowedOrigins[] = 'https://dealer.ecosudar.com';   // standalone Dealer Portal site
$_allowedOrigins[] = 'http://localhost:8082';          // dealer dev preview
$_requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
$_corsHeader = in_array($_requestOrigin, $_allowedOrigins, true) ? $_requestOrigin : ($_allowedOrigins[0] ?? 'https://api.ecosudar.com');
header('Access-Control-Allow-Origin: ' . $_corsHeader);
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Client-Type');
header('Access-Control-Max-Age: 86400'); // cache preflight 24h so the browser stops re-sending OPTIONS before every request
unset($_allowedOrigins, $_requestOrigin, $_corsHeader);
header('Content-Type: application/json; charset=UTF-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- JWT secret guard ---------------------------------------------------------
if (
    !defined('JWT_SECRET') ||
    strlen(JWT_SECRET) < 32 ||
    JWT_SECRET === 'CHANGE_THIS_TO_A_LONG_RANDOM_STRING_AT_LEAST_64_CHARS'
) {
    error_log('[Config] JWT_SECRET is missing or is still the default placeholder');
    Response::error('Server misconfiguration', 500);
}

// --- 415 Unsupported Media Type -----------------------------------------------
$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$contentType   = $_SERVER['CONTENT_TYPE'] ?? '';

if (
    in_array($requestMethod, ['POST', 'PUT', 'PATCH'], true) &&
    !empty($contentType) &&
    !str_contains($contentType, 'application/json') &&
    !str_contains($contentType, 'application/x-www-form-urlencoded') &&
    !str_contains($contentType, 'multipart/form-data')
) {
    Response::error('Unsupported Media Type. Use application/json', 415);
}

// --- Requires -----------------------------------------------------------------
require_once ROOT_PATH . '/config/database.php';
require_once ROOT_PATH . '/core/AppException.php';
require_once ROOT_PATH . '/core/Database.php';
require_once ROOT_PATH . '/core/Request.php';
require_once ROOT_PATH . '/core/Router.php';
require_once ROOT_PATH . '/services/NumberSequence.php';
require_once ROOT_PATH . '/services/FileStore.php';
require_once ROOT_PATH . '/services/ImportEngine.php';
require_once ROOT_PATH . '/services/GstinLookupService.php';
require_once ROOT_PATH . '/helpers/JWT.php';
require_once ROOT_PATH . '/helpers/Validator.php';
require_once ROOT_PATH . '/middleware/AuthMiddleware.php';

require_once ROOT_PATH . '/models/User.php';
require_once ROOT_PATH . '/models/Product.php';
require_once ROOT_PATH . '/models/Order.php';
require_once ROOT_PATH . '/models/Employee.php';
require_once ROOT_PATH . '/models/AttendanceShift.php';
require_once ROOT_PATH . '/models/Attendance.php';
require_once ROOT_PATH . '/models/AttendanceAnalytics.php';
require_once ROOT_PATH . '/models/Payroll.php';
require_once ROOT_PATH . '/models/EmployeeAdvance.php';
require_once ROOT_PATH . '/models/Task.php';
require_once ROOT_PATH . '/models/Meeting.php';
require_once ROOT_PATH . '/models/EmployeeCompliance.php';
require_once ROOT_PATH . '/models/HrImport.php';
require_once ROOT_PATH . '/models/MeetingMedia.php';
require_once ROOT_PATH . '/models/DataImportMapper.php';
require_once ROOT_PATH . '/models/DataExportService.php';
require_once ROOT_PATH . '/models/BackupService.php';
require_once ROOT_PATH . '/models/Sop.php';
require_once ROOT_PATH . '/models/Workflow.php';
require_once ROOT_PATH . '/models/Insights.php';
require_once ROOT_PATH . '/models/Vendor.php';
require_once ROOT_PATH . '/models/PurchaseItem.php';
require_once ROOT_PATH . '/models/PurchaseRequest.php';
require_once ROOT_PATH . '/models/PurchaseOrder.php';
require_once ROOT_PATH . '/models/Payment.php';
require_once ROOT_PATH . '/models/SalesDocument.php';
require_once ROOT_PATH . '/models/TestCertificate.php';
require_once ROOT_PATH . '/models/GstCompliance.php';
require_once ROOT_PATH . '/models/DealerNetwork.php';
require_once ROOT_PATH . '/models/FinanceAnalytics.php';
require_once ROOT_PATH . '/helpers/GroqAPI.php';
require_once ROOT_PATH . '/controllers/AuthController.php';
require_once ROOT_PATH . '/controllers/UserController.php';
require_once ROOT_PATH . '/controllers/ProductController.php';
require_once ROOT_PATH . '/controllers/OrderController.php';
require_once ROOT_PATH . '/controllers/StatisticsController.php';
require_once ROOT_PATH . '/controllers/QueryController.php';
require_once ROOT_PATH . '/controllers/QuoteController.php';
require_once ROOT_PATH . '/controllers/DealerWorkspaceController.php';

// Admin
require_once ROOT_PATH . '/middleware/AdminMiddleware.php';
require_once ROOT_PATH . '/controllers/admin/AdminUserController.php';
require_once ROOT_PATH . '/controllers/admin/AdminProductController.php';
require_once ROOT_PATH . '/controllers/admin/AdminInvoiceController.php';
require_once ROOT_PATH . '/controllers/admin/HistoricalInvoiceController.php';
require_once ROOT_PATH . '/controllers/admin/AdminInvoiceProductController.php';
require_once ROOT_PATH . '/controllers/admin/AdminQuoteController.php';
require_once ROOT_PATH . '/controllers/admin/AdminQueryController.php';
require_once ROOT_PATH . '/controllers/admin/AdminSettingsController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPricingController.php';
require_once ROOT_PATH . '/controllers/admin/AdminExpenseController.php';
require_once ROOT_PATH . '/controllers/admin/AdminFinanceController.php';
require_once ROOT_PATH . '/controllers/admin/AdminReportsController.php';
require_once ROOT_PATH . '/controllers/admin/AdminTaskController.php';
require_once ROOT_PATH . '/controllers/admin/AdminEmployeeController.php';
require_once ROOT_PATH . '/controllers/admin/AdminAttendanceController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPayrollController.php';
require_once ROOT_PATH . '/controllers/admin/AdminEmployeeAdvanceController.php';
require_once ROOT_PATH . '/controllers/admin/AdminFaqController.php';
require_once ROOT_PATH . '/controllers/admin/AdminMeetingController.php';
require_once ROOT_PATH . '/controllers/admin/AdminWorkflowController.php';
require_once ROOT_PATH . '/controllers/admin/AdminSopController.php';
require_once ROOT_PATH . '/helpers/GroqClient.php';
require_once ROOT_PATH . '/helpers/DataBridge.php';
require_once ROOT_PATH . '/controllers/ChatController.php';
require_once ROOT_PATH . '/controllers/admin/AdminInsightsController.php';
require_once ROOT_PATH . '/controllers/admin/AdminNotificationController.php';
require_once ROOT_PATH . '/controllers/admin/AdminGstLookupController.php';
require_once ROOT_PATH . '/controllers/admin/AdminAttachmentController.php';
require_once ROOT_PATH . '/controllers/admin/AdminImportController.php';
require_once ROOT_PATH . '/controllers/admin/AdminVendorController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPurchaseItemController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPurchaseRequestController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPurchaseOrderController.php';
require_once ROOT_PATH . '/controllers/admin/AdminGoodsReceiptController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPaymentController.php';
require_once ROOT_PATH . '/controllers/admin/AdminSalesDocumentController.php';
require_once ROOT_PATH . '/controllers/admin/AdminTestCertificateController.php';
require_once ROOT_PATH . '/controllers/admin/AdminGstComplianceController.php';
require_once ROOT_PATH . '/controllers/admin/AdminDealerController.php';
require_once ROOT_PATH . '/controllers/admin/AdminFinancePlanningController.php';
require_once ROOT_PATH . '/controllers/admin/AdminComplianceController.php';
require_once ROOT_PATH . '/controllers/admin/AdminAttendanceAnalyticsController.php';
require_once ROOT_PATH . '/controllers/admin/AdminHrImportController.php';
require_once ROOT_PATH . '/controllers/admin/AdminMeetingMediaController.php';
require_once ROOT_PATH . '/controllers/admin/AdminDataInteropController.php';
require_once ROOT_PATH . '/controllers/admin/AdminSearchController.php';
require_once ROOT_PATH . '/models/Inventory.php';
require_once ROOT_PATH . '/controllers/admin/AdminInventoryController.php';

// --- Routes -------------------------------------------------------------------
$router = new Router();

// Auth - public
$router->post('/auth/register', [AuthController::class, 'register']);
$router->post('/auth/login',    [AuthController::class, 'login']);
$router->post('/auth/refresh',  [AuthController::class, 'refresh']);
$router->post('/auth/forgot-password', [AuthController::class, 'forgotPassword']);
$router->post('/auth/send-otp',        [AuthController::class, 'sendOtp']);
$router->post('/auth/verify-otp',      [AuthController::class, 'verifyOtp']);
$router->post('/auth/reset-password',  [AuthController::class, 'resetPassword']);
$router->post('/auth/logout',   [AuthController::class, 'logout'],  true);
$router->get('/auth/me',        [AuthController::class, 'me'],      true);

// Users
$router->get('/users/{id}',               [UserController::class, 'show'],           true);
$router->get('/users/email/{email}',      [UserController::class, 'findByEmail'],    true);
$router->put('/users/{id}',               [UserController::class, 'update'],         true);
$router->put('/users/{id}/password',      [UserController::class, 'changePassword'], true);
$router->delete('/users/{id}',            [UserController::class, 'deactivate'],     true);
$router->get('/users/{userId}/orders',    [UserController::class, 'orders'],         true);

// Products - public read
$router->get('/products',                              [ProductController::class, 'index']);
$router->get('/products/sub-purposes',                 [ProductController::class, 'subPurposes']);
$router->get('/products/{id}',                         [ProductController::class, 'show']);
$router->get('/products/{id}/configurations',          [ProductController::class, 'configurations']);
$router->get('/products/{id}/price',                   [ProductController::class, 'price']);   // ?size=8mm[&purpose=...]
$router->get('/products/{id}/sizes',                   [ProductController::class, 'sizes']);    // distinct available sizes

// Orders
$router->get('/orders',          [OrderController::class, 'index'],         true);
$router->post('/orders',         [OrderController::class, 'store'],         true);
$router->get('/orders/{id}',     [OrderController::class, 'show'],          true);
$router->put('/orders/{id}/status',         [OrderController::class, 'updateStatus'],        true);
$router->put('/orders/{id}/payment',        [OrderController::class, 'updatePayment'],       true);
$router->put('/orders/{id}/payment-status', [OrderController::class, 'updatePaymentStatus'], true);
$router->put('/orders/{id}/refund-status',  [OrderController::class, 'updateRefundStatus'],  true);

// Statistics
$router->get('/statistics/orders',        [StatisticsController::class, 'orders'],       true);
$router->get('/statistics/active-orders', [StatisticsController::class, 'activeOrders'], true);
$router->get('/statistics/overview',      [StatisticsController::class, 'overview'],     true);
$router->get('/statistics/employees',     [StatisticsController::class, 'employees'],    true);
$router->get('/statistics/tasks',         [StatisticsController::class, 'tasks'],        true);
$router->get('/statistics/sales',         [StatisticsController::class, 'sales'],        true);
$router->get('/statistics/revenue',       [StatisticsController::class, 'revenue'],      true);
$router->get('/statistics/customers',     [StatisticsController::class, 'customers'],    true);

// Public Queries & Quotes
$router->post('/queries', [QueryController::class, 'store']); // Auth optional (handled if token sent? Actually without AuthMiddleware user is null but that's fine for guests)

$router->post('/quotes',  [QuoteController::class, 'store'], true); // Auth REQUIRED for quotes

// Dealer Workspace (role-scoped)
$router->get('/dealer/profile',       [DealerWorkspaceController::class, 'profile'],       'dealer');
$router->get('/dealer/dashboard',     [DealerWorkspaceController::class, 'dashboard'],     'dealer');
$router->get('/dealer/customers',     [DealerWorkspaceController::class, 'customers'],     'dealer');
$router->post('/dealer/customers',    [DealerWorkspaceController::class, 'storeCustomer'], 'dealer');
$router->put('/dealer/customers/{id}',[DealerWorkspaceController::class, 'updateCustomer'],'dealer');
$router->get('/dealer/price-list',    [DealerWorkspaceController::class, 'priceList'],     'dealer');
$router->post('/dealer/orders',       [DealerWorkspaceController::class, 'storeOrder'],    'dealer');

// --- Admin Routes (auth = 'admin' -> AuthMiddleware + AdminMiddleware) ---------

// Admin Global Search (header search box — customers, dealers, orders, invoices, products)
$router->get('/admin/search',                  [AdminSearchController::class, 'index'],    'admin');

// Admin Inventory / Production
$router->get('/admin/inventory/overview',                 [AdminInventoryController::class, 'overview'],           'admin');
$router->get('/admin/inventory/suggestions',              [AdminInventoryController::class, 'suggestions'],        'admin');
$router->get('/admin/inventory/movements',                [AdminInventoryController::class, 'movements'],          'admin');
$router->get('/admin/inventory/raw-materials',            [AdminInventoryController::class, 'rawMaterials'],       'admin');
$router->post('/admin/inventory/raw-materials',           [AdminInventoryController::class, 'storeRawMaterial'],   'admin:owner,store_keeper');
$router->put('/admin/inventory/raw-materials/{id}',       [AdminInventoryController::class, 'updateRawMaterial'],  'admin:owner,store_keeper');
$router->delete('/admin/inventory/raw-materials/{id}',    [AdminInventoryController::class, 'destroyRawMaterial'], 'admin:owner,store_keeper');
$router->post('/admin/inventory/raw-materials/{id}/movement', [AdminInventoryController::class, 'rawMaterialMovement'], 'admin:owner,store_keeper');
$router->get('/admin/inventory/production',               [AdminInventoryController::class, 'production'],         'admin');
$router->post('/admin/inventory/production',              [AdminInventoryController::class, 'storeProduction'],    'admin:owner,store_keeper');
$router->get('/admin/inventory/production/{id}',          [AdminInventoryController::class, 'showProduction'],     'admin');
$router->put('/admin/inventory/production/{id}',          [AdminInventoryController::class, 'updateProduction'],   'admin:owner,store_keeper');
$router->get('/admin/inventory/stock/categories',         [AdminInventoryController::class, 'stockCategories'],    'admin');
$router->get('/admin/inventory/stock',                    [AdminInventoryController::class, 'stock'],              'admin');
$router->post('/admin/inventory/stock/{id}/movement',     [AdminInventoryController::class, 'stockMovement'],      'admin:owner,store_keeper');
$router->get('/admin/inventory/spares',                   [AdminInventoryController::class, 'spares'],             'admin');
$router->post('/admin/inventory/spares',                  [AdminInventoryController::class, 'storeSpare'],         'admin:owner,store_keeper');
$router->put('/admin/inventory/spares/{id}',              [AdminInventoryController::class, 'updateSpare'],        'admin:owner,store_keeper');
$router->delete('/admin/inventory/spares/{id}',           [AdminInventoryController::class, 'destroySpare'],       'admin:owner,store_keeper');
$router->post('/admin/inventory/spares/{id}/movement',    [AdminInventoryController::class, 'spareMovement'],      'admin:owner,store_keeper');

// Admin Users
$router->get('/admin/users/pending',           [AdminUserController::class, 'pending'],    'admin');
$router->post('/admin/users/{id}/approve',     [AdminUserController::class, 'approve'],    'admin');
$router->post('/admin/users/{id}/reject',      [AdminUserController::class, 'reject'],     'admin');
$router->get('/admin/users/{id}/stats',        [AdminUserController::class, 'orderStats'], 'admin');
$router->get('/admin/users',                   [AdminUserController::class, 'index'],      'admin');
$router->put('/admin/users/{id}/status',       [AdminUserController::class, 'updateStatus'],'admin');
$router->post('/admin/users',               [AdminUserController::class,    'store'],        'admin');
$router->put('/admin/users/{id}',           [AdminUserController::class,    'update'],       'admin');
$router->delete('/admin/users/{id}',        [AdminUserController::class,    'destroy'],      'admin');

// Admin Dealer Network and Customer Intelligence
$router->get('/admin/dealers',                       [AdminDealerController::class, 'index'],                 'admin:owner,sales,accountant');
$router->get('/admin/dealers/{id}',                   [AdminDealerController::class, 'show'],                  'admin:owner,sales,accountant');
$router->get('/admin/dealer-price-lists',             [AdminDealerController::class, 'priceLists'],            'admin:owner,sales');
$router->post('/admin/dealer-price-lists',            [AdminDealerController::class, 'createPriceList'],       'admin:owner,sales');
$router->put('/admin/dealer-price-lists/{id}/items',  [AdminDealerController::class, 'updatePriceItems'],      'admin:owner,sales');
$router->get('/admin/dealer-price-lists/{id}',        [AdminDealerController::class, 'showPriceList'],         'admin:owner,sales,accountant');
$router->put('/admin/dealer-price-lists/{id}',        [AdminDealerController::class, 'updatePriceList'],       'admin:owner,sales');
$router->get('/admin/dealer-customers/conflicts',     [AdminDealerController::class, 'conflicts'],             'admin:owner,sales');
$router->get('/admin/dealer-customers',               [AdminDealerController::class, 'dealerCustomers'],       'admin:owner,sales,accountant');
$router->post('/admin/dealer-customers/{id}/resolve', [AdminDealerController::class, 'resolveDealerCustomer'], 'admin:owner,sales');
$router->post('/admin/customers/merge',               [AdminDealerController::class, 'mergeCustomers'],        'admin:owner');
$router->get('/admin/customers/analytics/summary',    [AdminDealerController::class, 'analyticsSummary'],      'admin:owner,accountant,sales');
$router->post('/admin/customer-metrics/recompute',    [AdminDealerController::class, 'recomputeMetrics'],      'admin:owner,accountant');
$router->get('/admin/customers/{id}/analytics',       [AdminDealerController::class, 'customerAnalytics'],     'admin:owner,accountant,sales');
$router->get('/admin/dealer-price-simulation',        [AdminDealerController::class, 'priceSimulation'],       'admin:owner,sales,accountant');

// Admin Products
$router->post('/admin/products',             [AdminProductController::class,  'store'],   'admin');
$router->put('/admin/products/{id}',         [AdminProductController::class,  'update'],  'admin');
$router->delete('/admin/products/{id}',      [AdminProductController::class,  'destroy'], 'admin');

// Admin Product Pricing (size-based configurations)
$router->get('/admin/products/{id}/configurations',          [AdminPricingController::class, 'index'],   'admin');
$router->post('/admin/products/{id}/configurations',         [AdminPricingController::class, 'store'],   'admin');
$router->put('/admin/products/{id}/configurations/{cid}',    [AdminPricingController::class, 'update'],  'admin');
$router->delete('/admin/products/{id}/configurations/{cid}', [AdminPricingController::class, 'destroy'], 'admin');

// Admin Procurement - Vendors
$router->get('/admin/vendors',                  [AdminVendorController::class, 'index'],       'admin');
$router->post('/admin/vendors',                 [AdminVendorController::class, 'store'],       'admin:owner,accountant');
$router->get('/admin/vendors/{id}/performance', [AdminVendorController::class, 'performance'], 'admin');
$router->get('/admin/vendors/{id}',             [AdminVendorController::class, 'show'],        'admin');
$router->put('/admin/vendors/{id}',             [AdminVendorController::class, 'update'],      'admin:owner,accountant');
$router->delete('/admin/vendors/{id}',          [AdminVendorController::class, 'destroy'],     'admin:owner,accountant');

// Purchase Items catalog (feeds PO line-item auto-fill)
$router->get('/admin/purchase-items',           [AdminPurchaseItemController::class, 'index'],   'admin');
$router->post('/admin/purchase-items',          [AdminPurchaseItemController::class, 'store'],   'admin:owner,accountant,store_keeper');
$router->get('/admin/purchase-items/{id}/orders', [AdminPurchaseItemController::class, 'orders'],  'admin');
$router->get('/admin/purchase-items/{id}',      [AdminPurchaseItemController::class, 'show'],    'admin');
$router->put('/admin/purchase-items/{id}',      [AdminPurchaseItemController::class, 'update'],  'admin:owner,accountant,store_keeper');
$router->delete('/admin/purchase-items/{id}',   [AdminPurchaseItemController::class, 'destroy'], 'admin:owner,accountant,store_keeper');

// Admin Procurement - Purchase Requests
$router->get('/admin/purchase-requests',              [AdminPurchaseRequestController::class, 'index'],   'admin');
$router->post('/admin/purchase-requests',             [AdminPurchaseRequestController::class, 'store'],   'admin:owner,accountant,store_keeper');
$router->get('/admin/purchase-requests/{id}',         [AdminPurchaseRequestController::class, 'show'],    'admin');
$router->put('/admin/purchase-requests/{id}',         [AdminPurchaseRequestController::class, 'update'],  'admin:owner,accountant,store_keeper');
$router->post('/admin/purchase-requests/{id}/submit', [AdminPurchaseRequestController::class, 'submit'],  'admin:owner,accountant,store_keeper');
$router->post('/admin/purchase-requests/{id}/approve',[AdminPurchaseRequestController::class, 'approve'], 'admin:owner,accountant');
$router->post('/admin/purchase-requests/{id}/reject', [AdminPurchaseRequestController::class, 'reject'],  'admin:owner,accountant');
$router->delete('/admin/purchase-requests/{id}',      [AdminPurchaseRequestController::class, 'destroy'], 'admin:owner,accountant,store_keeper');

// Admin Procurement - Purchase Orders and Goods Receipts
$router->get('/admin/purchase-orders',                    [AdminPurchaseOrderController::class, 'index'],      'admin');
$router->post('/admin/purchase-orders',                   [AdminPurchaseOrderController::class, 'store'],      'admin:owner,accountant');
$router->get('/admin/purchase-orders/{id}/pdf',           [AdminPurchaseOrderController::class, 'pdf'],        'admin');
$router->post('/admin/purchase-orders/{id}/issue',        [AdminPurchaseOrderController::class, 'issue'],      'admin:owner,accountant');
$router->post('/admin/purchase-orders/{id}/cancel',       [AdminPurchaseOrderController::class, 'cancel'],     'admin:owner,accountant');
$router->post('/admin/purchase-orders/{id}/short-close',  [AdminPurchaseOrderController::class, 'shortClose'], 'admin:owner');
$router->post('/admin/purchase-orders/{id}/revert',       [AdminPurchaseOrderController::class, 'revert'],     'admin:owner,accountant');
$router->post('/admin/purchase-orders/{id}/bill',         [AdminPurchaseOrderController::class, 'bill'],       'admin:owner,accountant');
$router->post('/admin/purchase-orders/{id}/receipts',     [AdminPurchaseOrderController::class, 'receive'],    'admin:owner,store_keeper');
$router->get('/admin/purchase-orders/{id}/payments',      [AdminPaymentController::class, 'poPayments'],       'admin');
$router->post('/admin/purchase-orders/{id}/payments',     [AdminPaymentController::class, 'storeForPurchaseOrder'], 'admin:owner,accountant');
$router->get('/admin/purchase-orders/{id}',               [AdminPurchaseOrderController::class, 'show'],       'admin');
$router->put('/admin/purchase-orders/{id}',               [AdminPurchaseOrderController::class, 'update'],     'admin:owner,accountant');

$router->get('/admin/goods-receipts',                     [AdminGoodsReceiptController::class, 'index'],       'admin');
$router->get('/admin/goods-receipts/{id}',                [AdminGoodsReceiptController::class, 'show'],        'admin');
$router->post('/admin/goods-receipts/{id}/void',          [AdminGoodsReceiptController::class, 'void'],        'admin:owner');


// Admin Historical (Past) Invoices — imported via Data Upload, stored separately
$router->get('/admin/historical-invoices',     [HistoricalInvoiceController::class, 'index'], 'admin');

// Admin Invoices
$router->get('/admin/invoices',                [AdminInvoiceController::class, 'index'],    'admin');
$router->post('/admin/invoices',               [AdminInvoiceController::class, 'store'],    'admin');
$router->post('/admin/invoices/gst',           [AdminInvoiceController::class, 'storeGst'], 'admin');
$router->get('/admin/invoices/{id}/download',  [AdminInvoiceController::class, 'download'], 'admin');
$router->get('/admin/invoices/{id}/payments',  [AdminPaymentController::class, 'invoicePayments'], 'admin');
$router->post('/admin/invoices/{id}/payments', [AdminPaymentController::class, 'storeForInvoice'], 'admin:owner,accountant');
$router->get('/admin/invoices/{id}/eway-bill', [AdminInvoiceController::class, 'ewayBill'],     'admin');
$router->put('/admin/invoices/{id}/eway-bill', [AdminInvoiceController::class, 'saveEwayBill'],  'admin:owner,accountant');
$router->get('/admin/invoices/{id}',           [AdminInvoiceController::class, 'show'],     'admin');
$router->put('/admin/invoices/{id}',           [AdminInvoiceController::class, 'update'],   'admin');
$router->delete('/admin/invoices/{id}',        [AdminInvoiceController::class, 'destroy'],  'admin');

// Admin Sales Billing - Payments and Receivables
$router->get('/admin/payments',                [AdminPaymentController::class, 'index'],    'admin');
$router->post('/admin/payments',               [AdminPaymentController::class, 'store'],    'admin:owner,accountant');
$router->get('/admin/payments/{id}/receipt',   [AdminPaymentController::class, 'receipt'],  'admin');
$router->post('/admin/payments/{id}/void',     [AdminPaymentController::class, 'void'],     'admin:owner,accountant');
$router->get('/admin/payments/{id}',           [AdminPaymentController::class, 'show'],     'admin');
$router->get('/admin/receivables/ageing',      [AdminPaymentController::class, 'receivablesAgeing'], 'admin');

// Admin Sales Billing - Quotations and Proformas
$router->get('/admin/sales-documents',                 [AdminSalesDocumentController::class, 'index'],        'admin');
$router->post('/admin/sales-documents',                [AdminSalesDocumentController::class, 'store'],        'admin:owner,accountant,sales');
$router->get('/admin/sales-documents/{id}/document',   [AdminSalesDocumentController::class, 'documentData'], 'admin');
$router->post('/admin/sales-documents/{id}/send',      [AdminSalesDocumentController::class, 'send'],         'admin:owner,accountant,sales');
$router->post('/admin/sales-documents/{id}/accept',    [AdminSalesDocumentController::class, 'accept'],       'admin:owner,accountant,sales');
$router->post('/admin/sales-documents/{id}/reject',    [AdminSalesDocumentController::class, 'reject'],       'admin:owner,accountant,sales');
$router->post('/admin/sales-documents/{id}/cancel',    [AdminSalesDocumentController::class, 'cancel'],       'admin:owner,accountant,sales');
$router->post('/admin/sales-documents/{id}/convert',   [AdminSalesDocumentController::class, 'convert'],      'admin:owner,accountant,sales');
$router->get('/admin/sales-documents/{id}',            [AdminSalesDocumentController::class, 'show'],         'admin');
$router->put('/admin/sales-documents/{id}',            [AdminSalesDocumentController::class, 'update'],       'admin:owner,accountant,sales');

// Admin Sales Billing - Test Certificates
$router->get('/admin/test-certificates',                    [AdminTestCertificateController::class, 'index'],           'admin');
$router->post('/admin/test-certificates',                   [AdminTestCertificateController::class, 'store'],           'admin:owner,store_keeper,sales');
$router->get('/admin/test-certificates/{id}/document',      [AdminTestCertificateController::class, 'certificateData'], 'admin');
$router->post('/admin/test-certificates/{id}/document',     [AdminTestCertificateController::class, 'uploadDocument'],  'admin:owner,store_keeper,sales');
$router->get('/admin/test-certificates/{id}/download',      [AdminTestCertificateController::class, 'downloadDocument'],'admin');
$router->post('/admin/test-certificates/{id}/issue',        [AdminTestCertificateController::class, 'issue'],           'admin:owner,store_keeper,sales');
$router->post('/admin/test-certificates/{id}/void',         [AdminTestCertificateController::class, 'void'],            'admin:owner');
$router->get('/admin/test-certificates/{id}',               [AdminTestCertificateController::class, 'show'],            'admin');
$router->put('/admin/test-certificates/{id}',               [AdminTestCertificateController::class, 'update'],          'admin:owner,store_keeper,sales');

// Admin GST Compliance
$router->get('/admin/gst-compliance',                       [AdminGstComplianceController::class, 'index'],     'admin:owner,accountant');
$router->get('/admin/gst-compliance/calculate',             [AdminGstComplianceController::class, 'calculate'], 'admin:owner,accountant');
$router->get('/admin/gst-compliance/{period}/export',       [AdminGstComplianceController::class, 'export'],    'admin:owner,accountant');
$router->post('/admin/gst-compliance/{period}/save',        [AdminGstComplianceController::class, 'save'],      'admin:owner,accountant');
$router->post('/admin/gst-compliance/{period}/review',      [AdminGstComplianceController::class, 'review'],    'admin:owner,accountant');
$router->post('/admin/gst-compliance/{period}/file',        [AdminGstComplianceController::class, 'file'],      'admin:owner,accountant');
$router->post('/admin/gst-compliance/{period}/lock',        [AdminGstComplianceController::class, 'lock'],      'admin:owner');
$router->get('/admin/gst-compliance/{period}',              [AdminGstComplianceController::class, 'show'],      'admin:owner,accountant');

$router->get('/admin/invoice-products',        [AdminInvoiceProductController::class, 'index'],   'admin');
$router->post('/admin/invoice-products',       [AdminInvoiceProductController::class, 'store'],   'admin');
$router->put('/admin/invoice-products/{id}',   [AdminInvoiceProductController::class, 'update'],  'admin');
$router->delete('/admin/invoice-products/{id}',[AdminInvoiceProductController::class, 'destroy'], 'admin');

// Admin Expenses
$router->get('/admin/expenses/analytics',       [AdminFinancePlanningController::class, 'expenseAnalytics'], 'admin:owner,accountant');
$router->get('/admin/expenses',                [AdminExpenseController::class, 'index'],       'admin');
$router->get('/admin/expenses/summary',        [AdminExpenseController::class, 'summary'],     'admin');
$router->get('/admin/expenses/categories',     [AdminExpenseController::class, 'categories'],  'admin');
$router->post('/admin/expenses/extract-bill',  [AdminExpenseController::class, 'extractBill'], 'admin');
$router->get('/admin/expenses/{id}/bill',       [AdminExpenseController::class, 'bill'],        'admin');
$router->get('/admin/expenses/{id}',           [AdminExpenseController::class, 'show'],        'admin');
$router->post('/admin/expenses',               [AdminExpenseController::class, 'store'],       'admin');
$router->put('/admin/expenses/{id}',           [AdminExpenseController::class, 'update'],      'admin');
$router->delete('/admin/expenses/{id}',        [AdminExpenseController::class, 'destroy'],     'admin');

// Admin Finance (Profit & Loss, Ratios, Config)
$router->get('/admin/finance/overlay',          [AdminFinancePlanningController::class, 'overlay'],       'admin:owner,accountant');
$router->post('/admin/finance/ai-analysis',    [AdminFinanceController::class, 'aiAnalysis'],   'admin:owner,accountant');
$router->get('/admin/finance/pnl',             [AdminFinanceController::class, 'pnl'],          'admin');
$router->get('/admin/finance/cash-flow',       [AdminFinanceController::class, 'cashFlow'],     'admin');
$router->get('/admin/finance/payables',        [AdminFinanceController::class, 'payables'],     'admin');
$router->get('/admin/finance/ratios',          [AdminFinanceController::class, 'ratios'],       'admin');
$router->get('/admin/finance/config',          [AdminFinanceController::class, 'config'],       'admin');
$router->put('/admin/finance/config',          [AdminFinanceController::class, 'updateConfig'], 'admin:owner,accountant');

// Admin Finance Planning - Budgets and Benchmarks
$router->get('/admin/budgets',                  [AdminFinancePlanningController::class, 'budgets'],        'admin:owner,accountant');
$router->post('/admin/budgets',                 [AdminFinancePlanningController::class, 'createBudget'],   'admin:owner,accountant');
$router->get('/admin/budgets/{id}/vs-actual',   [AdminFinancePlanningController::class, 'budgetVsActual'], 'admin:owner,accountant');
$router->get('/admin/budgets/{id}',             [AdminFinancePlanningController::class, 'showBudget'],     'admin:owner,accountant');
$router->put('/admin/budgets/{id}',             [AdminFinancePlanningController::class, 'updateBudget'],   'admin:owner,accountant');
$router->get('/admin/benchmarks/status',        [AdminFinancePlanningController::class, 'benchmarkStatus'], 'admin:owner,accountant');
$router->get('/admin/benchmarks',               [AdminFinancePlanningController::class, 'benchmarks'],      'admin:owner,accountant');
$router->post('/admin/benchmarks',              [AdminFinancePlanningController::class, 'saveBenchmark'],   'admin:owner,accountant');

// Notifications
$router->get('/admin/notifications',           [AdminNotificationController::class, 'index'],   'admin');

// GST Lookup
$router->get('/admin/gst-lookup',              [AdminGstLookupController::class,   'lookup'],   'admin');


// Admin Reports
$router->get('/admin/reports/analytics',        [AdminFinancePlanningController::class, 'reportsAnalytics'], 'admin:owner,accountant');
$router->get('/admin/reports',                 [AdminReportsController::class, 'index'],        'admin');
$router->get('/admin/reports/customers',       [AdminReportsController::class, 'customers'],    'admin:owner,accountant,sales');
$router->get('/admin/reports/monthly',         [AdminReportsController::class, 'monthly'],      'admin:owner,accountant,sales');
$router->get('/admin/reports/customer-ledger', [AdminReportsController::class, 'customerLedger'],'admin:owner,accountant,sales');

// Admin Quote Requests
$router->post('/admin/quote-requests',      [AdminQuoteController::class,    'store'],        'admin');
$router->get('/admin/quote-requests',       [AdminQuoteController::class,    'index'],        'admin');
$router->get('/admin/quote-requests/{id}',  [AdminQuoteController::class,    'show'],         'admin');
$router->put('/admin/quote-requests/{id}',  [AdminQuoteController::class,    'update'],       'admin');

// Admin Queries
$router->get('/admin/queries',              [AdminQueryController::class,    'index'],        'admin');
$router->get('/admin/queries/{id}',         [AdminQueryController::class,    'show'],         'admin');
$router->put('/admin/queries/{id}/reply',   [AdminQueryController::class,    'reply'],        'admin');

// Admin FAQs (reorder must be before /{id} to avoid route collision)
$router->get('/admin/faqs',                 [AdminFaqController::class, 'index'],   'admin');
$router->post('/admin/faqs',                [AdminFaqController::class, 'store'],   'admin');
$router->put('/admin/faqs/reorder',         [AdminFaqController::class, 'reorder'], 'admin');
$router->put('/admin/faqs/{id}',            [AdminFaqController::class, 'update'],  'admin');
$router->delete('/admin/faqs/{id}',         [AdminFaqController::class, 'destroy'], 'admin');

// Admin Settings
$router->get('/admin/settings',             [AdminSettingsController::class, 'show'],         'admin');
$router->put('/admin/settings',             [AdminSettingsController::class, 'update'],       'admin');

// Admin Attachments
$router->get('/admin/attachments/{id}/download', [AdminAttachmentController::class, 'download'], 'admin');
$router->delete('/admin/attachments/{id}',        [AdminAttachmentController::class, 'destroy'],  'admin');

// Admin Import Engine
$router->get('/admin/import-jobs',              [AdminImportController::class, 'index'],  'admin:owner,accountant,hr');
$router->post('/admin/import-jobs',             [AdminImportController::class, 'store'],  'admin:owner,accountant,hr');
$router->get('/admin/import-jobs/{id}',         [AdminImportController::class, 'show'],   'admin:owner,accountant,hr');
$router->post('/admin/import-jobs/{id}/dry-run',[AdminImportController::class, 'dryRun'], 'admin:owner,accountant,hr');
$router->post('/admin/import-jobs/{id}/commit', [AdminImportController::class, 'commit'], 'admin:owner,accountant,hr');
$router->get('/admin/import-jobs/{id}/errors',  [AdminImportController::class, 'errors'], 'admin:owner,accountant,hr');

// Admin Data Interoperability - Guided imports, exports, backups
$router->get('/admin/import/modules',                 [AdminDataInteropController::class, 'modules'],     'admin:owner,accountant,hr');
$router->get('/admin/import/{module}/template',       [AdminDataInteropController::class, 'template'],    'admin:owner,accountant,hr');
$router->post('/admin/import/{module}/upload',        [AdminDataInteropController::class, 'upload'],      'admin:owner,accountant,hr');
$router->post('/admin/import/{module}/{job}/ai-map',  [AdminDataInteropController::class, 'aiMap'],       'admin:owner,accountant,hr');
$router->post('/admin/import/{module}/{job}/map',     [AdminDataInteropController::class, 'map'],         'admin:owner,accountant,hr');
$router->post('/admin/import/{module}/{job}/dry-run', [AdminDataInteropController::class, 'dryRun'],      'admin:owner,accountant,hr');
$router->post('/admin/import/{module}/{job}/commit',  [AdminDataInteropController::class, 'commit'],      'admin:owner,accountant,hr');
$router->get('/admin/import/{job}/errors',            [AdminDataInteropController::class, 'errors'],      'admin:owner,accountant,hr');
$router->get('/admin/import/{job}',                   [AdminDataInteropController::class, 'showImport'],  'admin:owner,accountant,hr');
$router->get('/admin/export/all',                     [AdminDataInteropController::class, 'exportAll'],   'admin:owner');
$router->get('/admin/export/{module}',                [AdminDataInteropController::class, 'exportModule'],'admin:owner,accountant,hr');
$router->get('/admin/backup/status',                  [AdminDataInteropController::class, 'backupStatus'],'admin:owner');
$router->post('/admin/backup/run',                    [AdminDataInteropController::class, 'runBackup'],  'admin:owner');

// Admin Insights (AI-powered)
$router->post('/admin/insights/generate',   [AdminInsightsController::class, 'generate'],     'admin');

// ─── Admin Tasks ─────────────────────────────────────────────────────────────
// NOTE: static paths (/performance, /statistics, /employee/{id}) MUST be registered
// BEFORE the dynamic /admin/tasks/{id} — router matches in registration order.
$router->get('/admin/tasks',                          [AdminTaskController::class, 'index'],        'admin');
$router->get('/admin/tasks/performance',              [AdminTaskController::class, 'performance'],  'admin');
$router->get('/admin/tasks/statistics',               [AdminTaskController::class, 'statistics'],   'admin');
$router->get('/admin/tasks/employee/{id}',            [AdminTaskController::class, 'byEmployee'],   'admin');
$router->get('/admin/tasks/{id}',                     [AdminTaskController::class, 'show'],         'admin');
$router->post('/admin/tasks',                         [AdminTaskController::class, 'store'],        'admin');
$router->post('/admin/tasks/{id}/comment',            [AdminTaskController::class, 'addComment'],   'admin');
$router->put('/admin/tasks/{id}/status',              [AdminTaskController::class, 'updateStatus'], 'admin');
$router->put('/admin/tasks/{id}/assign',              [AdminTaskController::class, 'assign'],       'admin');
$router->put('/admin/tasks/{id}/priority',            [AdminTaskController::class, 'updatePriority'],'admin');
$router->put('/admin/tasks/{id}',                     [AdminTaskController::class, 'update'],       'admin');
$router->patch('/admin/tasks/{id}',                   [AdminTaskController::class, 'update'],       'admin');
$router->delete('/admin/tasks/{id}',                  [AdminTaskController::class, 'destroy'],      'admin');

// ─── Admin Employees ─────────────────────────────────────────────────────────
$router->get('/admin/employees',                      [AdminEmployeeController::class, 'index'],        'admin');
$router->post('/admin/employees/import',              [AdminHrImportController::class, 'employeeImport'],'admin:owner,hr');
$router->get('/admin/employees/import/{job}/errors',  [AdminHrImportController::class, 'employeeImportErrors'], 'admin:owner,hr');
$router->get('/admin/employees/{key}/compliance',     [AdminComplianceController::class, 'employeeRecords'], 'admin:owner,hr');
$router->post('/admin/employees/{key}/compliance',    [AdminComplianceController::class, 'storeForEmployee'], 'admin:owner,hr');
$router->get('/admin/employees/{id}/qr',              [AdminEmployeeController::class, 'qr'],           'admin');
$router->get('/admin/employees/{id}/profile',         [AdminEmployeeController::class, 'profile'],      'admin');
$router->get('/admin/employees/{id}/photo',           [AdminEmployeeController::class, 'photo'],        'admin');
$router->get('/admin/employees/{id}/insurance',       [AdminEmployeeController::class, 'insurance'],    'admin');
$router->get('/admin/employees/{id}',                 [AdminEmployeeController::class, 'show'],         'admin');
$router->post('/admin/employees',                     [AdminEmployeeController::class, 'store'],        'admin');
$router->post('/admin/employees/{id}',                [AdminEmployeeController::class, 'update'],       'admin');
$router->put('/admin/employees/{id}/status',          [AdminEmployeeController::class, 'updateStatus'], 'admin');
$router->put('/admin/employees/{id}',                 [AdminEmployeeController::class, 'update'],       'admin');
$router->patch('/admin/employees/{id}',               [AdminEmployeeController::class, 'update'],       'admin');
$router->delete('/admin/employees/{id}',              [AdminEmployeeController::class, 'destroy'],      'admin');

// ─── Admin Attendance ────────────────────────────────────────────────────────
$router->get('/admin/attendance/analytics',           [AdminAttendanceAnalyticsController::class, 'analytics'], 'admin:owner,hr');
$router->get('/admin/attendance/anomalies',           [AdminAttendanceAnalyticsController::class, 'anomalies'], 'admin:owner,hr');
$router->post('/admin/attendance/import',             [AdminHrImportController::class, 'attendanceImport'], 'admin:owner,hr');
$router->get('/admin/attendance/import/{job}/errors', [AdminHrImportController::class, 'attendanceImportErrors'], 'admin:owner,hr');
$router->get('/admin/attendance',                     [AdminAttendanceController::class, 'index'],      'admin');
$router->get('/admin/attendance/cutoff', [AdminAttendanceController::class, 'cutoff'], 'admin');
$router->get('/admin/attendance/shifts',              [AdminAttendanceController::class, 'shifts'],     'admin');
$router->post('/admin/attendance/shifts',             [AdminAttendanceController::class, 'storeShift'], 'admin');
$router->put('/admin/attendance/shifts/{id}',         [AdminAttendanceController::class, 'updateShift'], 'admin');
$router->get('/admin/attendance/report',              [AdminAttendanceController::class, 'report'],     'admin');
$router->get('/admin/attendance/summary',             [AdminAttendanceController::class, 'summary'],    'admin');
$router->get('/admin/attendance/employee/{id}',       [AdminAttendanceController::class, 'byEmployee'], 'admin');
$router->post('/admin/attendance/scan',               [AdminAttendanceController::class, 'scan'],       'admin');
$router->post('/admin/attendance/manual',              [AdminAttendanceController::class, 'manual'],    'admin');
$router->post('/admin/attendance/check-in',           [AdminAttendanceController::class, 'checkIn'],    'admin');
$router->post('/admin/attendance/check-out',          [AdminAttendanceController::class, 'checkOut'],   'admin');
$router->post('/admin/attendance/auto-mark-absent',   [AdminAttendanceController::class, 'autoMarkAbsent'], 'admin');
$router->put('/admin/attendance/{id}',                [AdminAttendanceController::class, 'update'],     'admin');
$router->delete('/admin/attendance/{id}',             [AdminAttendanceController::class, 'destroy'],    'admin');

// ─── Admin Payroll ───────────────────────────────────────────────────────────
$router->get('/admin/payroll',                        [AdminPayrollController::class, 'index'],    'admin');
$router->get('/admin/payroll/report',                 [AdminPayrollController::class, 'report'],   'admin');
$router->get('/admin/payroll/{id}/history',           [AdminPayrollController::class, 'history'],  'admin');
$router->get('/admin/payroll/{id}',                   [AdminPayrollController::class, 'show'],     'admin');
$router->post('/admin/payroll/ai-check',              [AdminPayrollController::class, 'aiCheck'],  'admin:owner,accountant,hr');
$router->post('/admin/payroll/run',                   [AdminPayrollController::class, 'run'],      'admin');
$router->post('/admin/payroll/calculate',             [AdminPayrollController::class, 'calculate'],'admin');
$router->post('/admin/payroll/process',               [AdminPayrollController::class, 'process'],  'admin');

// ─── Admin Employee Advances ────────────────────────────────────────────────
$router->get('/admin/employee-advances',              [AdminEmployeeAdvanceController::class, 'index'],   'admin');
$router->post('/admin/employee-advances',             [AdminEmployeeAdvanceController::class, 'store'],   'admin');
$router->put('/admin/employee-advances/{id}',         [AdminEmployeeAdvanceController::class, 'update'],  'admin');
$router->delete('/admin/employee-advances/{id}',      [AdminEmployeeAdvanceController::class, 'destroy'], 'admin');

// ─── Admin Meetings ──────────────────────────────────────────────────────────
$router->get('/admin/meetings',                [AdminMeetingController::class, 'index'],            'admin');
$router->get('/admin/meetings/upcoming',       [AdminMeetingController::class, 'upcoming'],         'admin');
$router->get('/admin/meetings/general',        [AdminMeetingController::class, 'general'],          'admin');
$router->get('/admin/meetings/{id}/media',     [AdminMeetingMediaController::class, 'index'],       'admin:owner,hr');
$router->post('/admin/meetings/{id}/media',    [AdminMeetingMediaController::class, 'store'],       'admin:owner,hr');
$router->delete('/admin/meetings/{id}/media/{attachmentId}', [AdminMeetingMediaController::class, 'destroy'], 'admin:owner,hr');
$router->get('/admin/meetings/{id}',           [AdminMeetingController::class, 'show'],             'admin');
$router->post('/admin/meetings',               [AdminMeetingController::class, 'store'],            'admin');
$router->put('/admin/meetings/{id}',           [AdminMeetingController::class, 'update'],           'admin');
$router->delete('/admin/meetings/{id}',        [AdminMeetingController::class, 'destroy'],          'admin');
$router->put('/admin/meetings/{id}/attendees', [AdminMeetingController::class, 'updateAttendees'],  'admin');

// ─── Admin HR Compliance ─────────────────────────────────────────────────────
$router->get('/admin/compliance/expiring',      [AdminComplianceController::class, 'expiring'],      'admin:owner,hr');
$router->get('/admin/compliance',               [AdminComplianceController::class, 'index'],         'admin:owner,hr');
$router->get('/admin/compliance/{id}/download', [AdminComplianceController::class, 'download'],      'admin:owner,hr');
$router->put('/admin/compliance/{id}',          [AdminComplianceController::class, 'update'],        'admin:owner,hr');
$router->delete('/admin/compliance/{id}',       [AdminComplianceController::class, 'destroy'],       'admin:owner,hr');

// ─── Admin SOPs ───────────────────────────────────────────────────────────────
$router->get('/admin/sops',                    [AdminSopController::class, 'index'],                'admin');
$router->get('/admin/sops/categories',         [AdminSopController::class, 'categories'],           'admin');
$router->get('/admin/sops/{id}',               [AdminSopController::class, 'show'],                 'admin');
$router->post('/admin/sops',                   [AdminSopController::class, 'store'],                'admin');
$router->post('/admin/sops/{id}/versions',     [AdminSopController::class, 'uploadVersion'],        'admin');
$router->put('/admin/sops/{id}/versions/{versionId}/status', [AdminSopController::class, 'updateVersionStatus'], 'admin');
$router->get('/admin/sops/{id}/versions/{versionId}/download', [AdminSopController::class, 'downloadVersion'], 'admin');
$router->put('/admin/sops/{id}',               [AdminSopController::class, 'update'],               'admin');
$router->delete('/admin/sops/{id}',            [AdminSopController::class, 'destroy'],              'admin');
$router->post('/admin/sops/{id}/publish',      [AdminSopController::class, 'publish'],              'admin');

// ─── Admin Workflows ─────────────────────────────────────────────────────────
$router->get('/admin/workflows',                  [AdminWorkflowController::class, 'index'],      'admin');
$router->get('/admin/workflows/{id}',             [AdminWorkflowController::class, 'show'],       'admin');
$router->post('/admin/workflows',                 [AdminWorkflowController::class, 'store'],      'admin');
$router->post('/admin/workflows/{id}/transition', [AdminWorkflowController::class, 'transition'], 'admin');
$router->delete('/admin/workflows/{id}',          [AdminWorkflowController::class, 'destroy'],    'admin');

// ─── Chat (public — auth optional) ───────────────────────────────────────────
$router->post('/chat',              [ChatController::class, 'send']);
$router->get('/chat/history',       [ChatController::class, 'history']);
$router->get('/chat/debug',         [ChatController::class, 'debug']);
$router->get('/admin/chat/sessions',[ChatController::class, 'sessions'], 'admin');

// Dispatch
$router->dispatch();

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { UnsavedChangesProvider } from "@/components/UnsavedChangesGuard";
import { DashboardLayout } from "@/components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Orders from "./pages/Orders";
import Customers from "./pages/Customers";
import PendingApprovals from "./pages/PendingApprovals";
import Dealers from "./pages/Dealers";
import Invoices from "./pages/Invoices";
import Expenses from "./pages/Expenses";
import Finance from "./pages/Finance";
import GstCompliance from "./pages/GstCompliance";
import InventoryOverview from "./pages/inventory/InventoryOverview";
import SparesAssets from "./pages/inventory/SparesAssets";
import Production from "./pages/inventory/Production";
import RawMaterials from "./pages/inventory/RawMaterials";
import StockLevels from "./pages/inventory/StockLevels";
import Movements from "./pages/inventory/Movements";
import Vendors from "./pages/purchase/Vendors";
import VendorForm from "./pages/purchase/VendorForm";
import VendorDetail from "./pages/purchase/VendorDetail";
import PurchaseItemDetail from "./pages/purchase/PurchaseItemDetail";
import PurchaseOrders from "./pages/purchase/PurchaseOrders";
import SalesDocumentsPage from "./pages/sales/SalesDocumentsPage";
import Reports from "./pages/Reports";
import CustomerReport from "./pages/CustomerReport";
import MonthlyReport from "./pages/MonthlyReport";
import CustomerLedger from "./pages/CustomerLedger";
import Employees from "./pages/Employees";
import Attendance from "./pages/Attendance";
import Payroll from "./pages/Payroll";
import AdvanceRegister from "./pages/AdvanceRegister";
import Tasks from "./pages/Tasks";
import Meetings from "./pages/Meetings";
import Sops from "./pages/Sops";
import Workflows from "./pages/Workflows";
import SettingsPage from "./pages/Settings";
import Queries from "./pages/Queries";
import FAQPage from "./pages/FAQ";
import QuoteRequests from "./pages/QuoteRequests";
import Insights from "./pages/Insights";
import SalesBilling from "./pages/SalesBilling";
import FinancePlanning from "./pages/FinancePlanning";
import FinancialStatements from "./pages/FinancialStatements";
import HrCompliance from "./pages/HrCompliance";
import DataInterop from "./pages/DataInterop";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import Contact from "./pages/Contact";
import CustomerForm from "./pages/CustomerForm";
import ProductForm from "./pages/ProductForm";
import OrderForm from "./pages/OrderForm";
import ExpenseForm from "./pages/ExpenseForm";
import TaskForm from "./pages/TaskForm";
import MeetingForm from "./pages/MeetingForm";
import DealerForm from "./pages/DealerForm";
import EmployeeForm from "./pages/EmployeeForm";
import InvoiceForm from "./pages/InvoiceForm";
import SaleBillingForm from "./pages/SaleBillingForm";
import SopForm from "./pages/SopForm";
import WorkflowForm from "./pages/WorkflowForm";
import PayrollForm from "./pages/PayrollForm";
import QueryForm from "./pages/QueryForm";
import QuoteRequestForm from "./pages/QuoteRequestForm";
import AdvanceRegisterForm from "./pages/AdvanceRegisterForm";
import PurchaseOrderForm from "./pages/purchase/PurchaseOrderForm";
import PurchaseOrderDetail from "./pages/purchase/PurchaseOrderDetail";
import PurchaseItems from "./pages/purchase/PurchaseItems";
import PurchaseItemForm from "./pages/purchase/PurchaseItemForm";
import MovementForm from "./pages/inventory/MovementForm";
import ProductionForm from "./pages/inventory/ProductionForm";
import ProductionDetail from "./pages/inventory/ProductionDetail";
import RawMaterialForm from "./pages/inventory/RawMaterialForm";
import SalesDocumentForm from "./pages/sales/SalesDocumentForm";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,          // treat data as fresh for 1 min → no refetch storm on navigation
      gcTime: 10 * 60_000,        // keep cached data for 10 min after a page unmounts
      refetchOnWindowFocus: false,// don't refetch every time the tab regains focus
      retry: 1,
    },
  },
});

function ProtectedRoutes() {
  const { isAuthenticated, loading, role, logout } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Dealers belong on their own site (dealer.ecosudar.com) — not the staff admin app.
  if (role === "dealer") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center">
        <p className="font-semibold text-foreground">This is the staff admin site.</p>
        <p className="text-sm text-muted-foreground">Dealers should sign in at <span className="font-medium">dealer.ecosudar.com</span>.</p>
        <button onClick={logout} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">Sign out</button>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/products" element={<Products />} />
        <Route path="/products/new" element={<ProductForm />} />
        <Route path="/products/:id/edit" element={<ProductForm />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/new" element={<OrderForm />} />
        <Route path="/inventory" element={<InventoryOverview />} />
        <Route path="/inventory/items" element={<SparesAssets />} />
        <Route path="/inventory/production" element={<Production />} />
        <Route path="/inventory/production/new" element={<ProductionForm />} />
        <Route path="/inventory/production/:id/edit" element={<ProductionForm />} />
        <Route path="/inventory/production/:id" element={<ProductionDetail />} />
        <Route path="/inventory/raw-materials" element={<RawMaterials />} />
        <Route path="/inventory/raw-materials/new" element={<RawMaterialForm />} />
        <Route path="/inventory/raw-materials/:id/edit" element={<RawMaterialForm />} />
        <Route path="/inventory/stock" element={<StockLevels />} />
        <Route path="/inventory/movements" element={<Movements />} />
        <Route path="/inventory/movements/new" element={<MovementForm />} />
        <Route path="/purchase/orders" element={<PurchaseOrders />} />
        <Route path="/purchase/orders/new" element={<PurchaseOrderForm />} />
        <Route path="/purchase/orders/:id/edit" element={<PurchaseOrderForm />} />
        <Route path="/purchase/orders/:id" element={<PurchaseOrderDetail />} />
        <Route path="/purchase/vendors" element={<Vendors />} />
        <Route path="/purchase/vendors/new" element={<VendorForm />} />
        <Route path="/purchase/vendors/:id/edit" element={<VendorForm />} />
        <Route path="/purchase/vendors/:id" element={<VendorDetail />} />
        <Route path="/purchase/items" element={<PurchaseItems />} />
        <Route path="/purchase/items/new" element={<PurchaseItemForm />} />
        <Route path="/purchase/items/:id/edit" element={<PurchaseItemForm />} />
        <Route path="/purchase/items/:id" element={<PurchaseItemDetail />} />
        <Route path="/sales/quotations" element={<SalesDocumentsPage docType="quotation" title="Quotations" blurb="Customer quotations — send, then convert to a sales order." />} />
        <Route path="/sales/sales-orders" element={<SalesDocumentsPage docType="sales_order" title="Sales Orders" blurb="Confirmed orders — dispatch a delivery challan and raise the tax invoice." />} />
        <Route path="/sales/delivery-challans" element={<SalesDocumentsPage docType="delivery_challan" title="Delivery Challans" blurb="Goods dispatched against a sales order — finished stock moves out here." />} />
        <Route path="/sales/documents/:docType/new" element={<SalesDocumentForm />} />
        <Route path="/sales/documents/:docType/:id/edit" element={<SalesDocumentForm />} />
        <Route path="/pending-approvals" element={<PendingApprovals />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/new" element={<CustomerForm />} />
        <Route path="/dealers" element={<Dealers />} />
        <Route path="/dealers/new" element={<DealerForm />} />
        <Route path="/dealers/:id/edit" element={<DealerForm />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/employees/new" element={<EmployeeForm />} />
        <Route path="/employees/:id/edit" element={<EmployeeForm />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/new" element={<InvoiceForm />} />
        <Route path="/invoices/:id/edit" element={<InvoiceForm />} />
        <Route path="/sales-billing" element={<SalesBilling />} />
        <Route path="/sales-billing/new" element={<SaleBillingForm />} />
        <Route path="/sales-billing/:id/edit" element={<SaleBillingForm />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/expenses/new" element={<ExpenseForm />} />
        <Route path="/expenses/:id/edit" element={<ExpenseForm />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/financial-statements" element={<FinancialStatements />} />
        <Route path="/finance-planning" element={<FinancePlanning />} />
        <Route path="/gst-compliance" element={<GstCompliance />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/customer-report" element={<CustomerReport />} />
        <Route path="/monthly-report" element={<MonthlyReport />} />
        <Route path="/customer-ledger" element={<CustomerLedger />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/employees/new" element={<EmployeeForm />} />
        <Route path="/employees/:id/edit" element={<EmployeeForm />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/hr-compliance" element={<HrCompliance />} />
        <Route path="/payroll" element={<Payroll />} />
        <Route path="/payroll/run" element={<PayrollForm />} />
        <Route path="/advance-register" element={<AdvanceRegister />} />
        <Route path="/advance-register/new" element={<AdvanceRegisterForm />} />
        <Route path="/advance-register/:id/edit" element={<AdvanceRegisterForm />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/tasks/new" element={<TaskForm />} />
        <Route path="/tasks/:id/edit" element={<TaskForm />} />
        <Route path="/meetings" element={<Meetings />} />
        <Route path="/meetings/new" element={<MeetingForm />} />
        <Route path="/meetings/:id/edit" element={<MeetingForm />} />
        <Route path="/sops" element={<Sops />} />
        <Route path="/sops/new" element={<SopForm />} />
        <Route path="/sops/:id/edit" element={<SopForm />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/new" element={<WorkflowForm />} />
        <Route path="/queries" element={<Queries />} />
        <Route path="/queries/:id/edit" element={<QueryForm />} />
        <Route path="/faq" element={<FAQPage />} />
        <Route path="/quote-requests" element={<QuoteRequests />} />
        <Route path="/quote-requests/:id/edit" element={<QuoteRequestForm />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/data-interop" element={<DataInterop />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </DashboardLayout>
  );
}

function LoginRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null; // wait for session check before deciding
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Login />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <UnsavedChangesProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route path="/*" element={<ProtectedRoutes />} />
            </Routes>
          </AuthProvider>
        </UnsavedChangesProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

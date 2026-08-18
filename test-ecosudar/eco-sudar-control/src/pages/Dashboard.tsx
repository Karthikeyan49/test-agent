import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Package, IndianRupee, ShoppingCart, Users, TrendingDown, RefreshCcw } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { statisticsApi, type ActiveOrder } from "@/lib/api/statistics";

const MONTH_LABELS: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
  "05": "May", "06": "Jun", "07": "Jul", "08": "Aug",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};

const statusColors: Record<string, string> = {
  delivered:       "bg-primary/10 text-primary",
  shipped:         "bg-blue-50 text-status-shipped",
  processing:      "bg-yellow-50 text-status-processing",
  pending:         "bg-muted text-status-pending",
  confirmed:       "bg-indigo-50 text-status-confirmed",
  cancelled:       "bg-destructive/10 text-destructive",
};

function fmtRupees(amount: number): string {
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000)   return `₹${(amount / 1000).toFixed(1)}k`;
  return `₹${amount.toLocaleString("en-IN")}`;
}

export default function Dashboard() {
  const now     = new Date();
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  // 3 calls run in parallel, cached locally in component state
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof statisticsApi.overview>> | null>(null);
  const [ordersStats, setOrdersStats] = useState<Awaited<ReturnType<typeof statisticsApi.orders>> | null>(null);
  const [activeOrders, setActiveOrders] = useState<Awaited<ReturnType<typeof statisticsApi.activeOrders>> | null>(null);

  useEffect(() => {
    statisticsApi.overview().then(setOverview).catch(() => {});
    statisticsApi.orders().then(setOrdersStats).catch(() => {});
    statisticsApi.activeOrders().then(setActiveOrders).catch(() => {});
  }, []);

  const chartData = useMemo(() => {
    if (!ordersStats) return [];
    // Group daily entries by month label for the charts
    const byMonth: Record<string, { sales: number; revenue: number }> = {};
    for (const d of ordersStats.daily) {
      const mm    = d.order_date.slice(5, 7);
      const label = MONTH_LABELS[mm] ?? mm;
      if (!byMonth[label]) byMonth[label] = { sales: 0, revenue: 0 };
      byMonth[label].sales   += d.order_count;
      byMonth[label].revenue += d.revenue;
    }
    return Object.entries(byMonth).map(([month, v]) => ({ month, ...v }));
  }, [ordersStats]);

  const topProducts = useMemo(
    () => (ordersStats?.top_products ?? []).map((p) => ({ name: p.product_name, orders: p.times_ordered })),
    [ordersStats],
  );

  const recentOrders: ActiveOrder[] = useMemo(() => (activeOrders?.orders ?? []).slice(0, 6), [activeOrders]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Executive Dashboard</h1>
          <p className="text-muted-foreground">Welcome back! Here's your business overview.</p>
        </div>
        <div className="text-sm text-muted-foreground border rounded-lg px-4 py-2 bg-card">
          Last updated: <span className="font-semibold text-foreground">Today, {timeStr}</span>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Total Products"
          value={overview ? String(overview.products) : "—"}
          subtitle="Active listings"
          icon={Package}
        />
        <StatCard
          title="Total Orders"
          value={overview ? String(overview.orders.total) : "—"}
          subtitle={overview ? `${overview.orders.pending} pending` : "Loading..."}
          icon={ShoppingCart}
        />
        <StatCard
          title="Revenue"
          value={overview ? fmtRupees(overview.orders.revenue) : "—"}
          subtitle="All time"
          icon={IndianRupee}
        />
        <StatCard
          title="Active Users"
          value={overview ? String(overview.users.active) : "—"}
          subtitle={overview ? `${overview.users.total} total registered` : "Loading..."}
          icon={Users}
        />
        <StatCard
          title="Cancelled Orders"
          value={overview ? String(overview.orders.cancelled) : "—"}
          subtitle="All time"
          icon={TrendingDown}
          subtitleColor="muted"
        />
        <StatCard
          title="Active Employees"
          value={overview ? String(overview.employees) : "—"}
          subtitle={overview ? `${overview.tasks.overdue} overdue tasks` : "Loading..."}
          icon={RefreshCcw}
          subtitleColor="muted"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border p-6 shadow-sm">
          <h3 className="font-semibold text-card-foreground mb-1">Sales Analytics</h3>
          <p className="text-xs text-muted-foreground mb-4">Monthly order count</p>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip />
              <Area type="monotone" dataKey="sales" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-xl border p-6 shadow-sm">
          <h3 className="font-semibold text-card-foreground mb-1">Revenue Overview</h3>
          <p className="text-xs text-muted-foreground mb-4">Monthly revenue in ₹</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `₹${v / 1000}k`} />
              <Tooltip formatter={(v: number) => `₹${v.toLocaleString()}`} />
              <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Products */}
      <div className="bg-card rounded-xl border p-6 shadow-sm">
        <h3 className="font-semibold text-card-foreground mb-1">Top Products by Orders</h3>
        <p className="text-xs text-muted-foreground mb-4">Top 5 products by order count</p>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={topProducts} layout="vertical" margin={{ left: 100 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis type="number" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} width={100} />
            <Tooltip />
            <Bar dataKey="orders" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Orders */}
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="flex items-center justify-between p-6 pb-4">
          <div>
            <h3 className="font-semibold text-card-foreground">Recent Orders</h3>
            <p className="text-xs text-muted-foreground">Latest active orders</p>
          </div>
          <Link to="/orders" className="text-sm text-primary font-medium hover:underline">View All →</Link>
        </div>
        <div className="px-6 pb-6 space-y-3">
          {recentOrders.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading orders…</p>
          )}
          {recentOrders.map((order) => {
            const statusKey = order.order_status.toLowerCase();
            return (
              <div key={order.order_id} className="flex items-center justify-between py-3 border-b last:border-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-secondary rounded-lg">
                    <ShoppingCart className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm text-card-foreground">{order.customer_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.order_number} • {order.total_items} {order.total_items === 1 ? "item" : "items"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-semibold text-sm text-card-foreground">
                    ₹{order.total_amount.toLocaleString("en-IN")}
                  </span>
                  <span className={`text-xs px-3 py-1 rounded-full font-medium capitalize ${statusColors[statusKey] ?? "bg-muted text-muted-foreground"}`}>
                    {order.order_status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

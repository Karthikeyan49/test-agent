import { Bell, ShoppingCart, MessageSquare, ChevronDown, Maximize2, Minimize2, Headset, Settings, LogOut } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { GlobalSearch } from "@/components/GlobalSearch";
import { cn } from "@/lib/utils";
import {
  findSectionByPath,
  getDefaultSection,
  resolveStoredSection,
  sectionIcon,
  ACTIVE_MODULE_STORAGE_KEY,
  type MenuSection,
} from "@/lib/navigation";

interface ApiNotification {
  id: string;
  type: string;
  message: string;
  time: string;
  read: boolean;
}

function timeAgo(dateString: string) {
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function ModuleSwitcher() {
  const location = useLocation();
  const { setModulesDialogOpen } = useDashboardLayout();
  const [activeSection, setActiveSection] = useState<MenuSection | null>(null);

  useEffect(() => {
    if (location.pathname !== "/") {
      const pathSection = findSectionByPath(location.pathname);
      if (pathSection) { setActiveSection(pathSection); return; }
    }
    const stored = localStorage.getItem(ACTIVE_MODULE_STORAGE_KEY);
    if (stored) {
      const found = resolveStoredSection(stored);
      if (found) { setActiveSection(found); return; }
    }
    setActiveSection(getDefaultSection());
  }, [location.pathname]);

  const ModuleIcon = sectionIcon(activeSection?.label ?? "Operations");

  return (
    <button
      onClick={() => setModulesDialogOpen(true)}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-foreground hover:bg-muted transition-colors shrink-0"
      aria-label="Switch module"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <ModuleIcon className="h-3.5 w-3.5 text-primary" />
      </span>
      <span className="max-w-[120px] truncate">{activeSection?.label ?? "Modules"}</span>
      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </button>
  );
}

export function TopNavbar() {
  const { adminEmail, userName, role, logout } = useAuth();
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pathname = useLocation().pathname;
  const isSettings = pathname.startsWith("/settings");
  const isContact = pathname.startsWith("/contact");

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn("Fullscreen request failed:", err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    apiFetch<{ data: ApiNotification[] }>("/admin/notifications")
      .then((res) => {
        setNotifications(res.data ?? []);
        setUnreadCount((res.data ?? []).filter((n) => !n.read).length);
      })
      .catch(() => {});

    const interval = setInterval(() => {
      apiFetch<{ data: ApiNotification[] }>("/admin/notifications")
        .then((res) => {
          setNotifications(res.data ?? []);
          setUnreadCount((res.data ?? []).filter((n) => !n.read).length);
        })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const markAllRead = () => {
    setNotifications(notifications.map((n) => ({ ...n, read: true })));
  };

  return (
    <header className="shrink-0 border-b bg-card shadow-sm">
      <div className="h-14 flex items-center justify-between px-3 md:px-6 gap-2 bg-gradient-to-r from-primary/[0.09] via-primary/[0.03] to-transparent">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <SidebarTrigger className="lg:hidden shrink-0" />
          <ModuleSwitcher />
        </div>

        <div className="hidden sm:flex flex-1 justify-center px-2 md:px-4">
          <div className="w-full max-w-xl"><GlobalSearch /></div>
        </div>

        <div className="flex items-center gap-1 md:gap-2 shrink-0">
          <div className="sm:hidden"><GlobalSearch compact /></div>

          {/* Notifications */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="relative p-2 rounded-lg hover:bg-muted transition-colors">
                <Bell className="h-5 w-5 text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4.5 w-4.5 min-w-[18px] flex items-center justify-center bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full px-1">
                    {unreadCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h4 className="text-sm font-semibold text-card-foreground">Notifications</h4>
                {unreadCount > 0 && (
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>
                    Mark all as read
                  </Button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-8">No notifications</div>
                )}
                {notifications.map((n) => {
                  const Icon = n.type === "order" ? ShoppingCart : MessageSquare;
                  const iconColor = n.type === "order" ? "text-primary" : "text-blue-500";
                  return (
                    <div
                      key={n.id}
                      className={`flex items-start gap-3 px-4 py-3 border-b last:border-0 transition-colors ${!n.read ? "bg-muted/30" : ""}`}
                    >
                      <div className="pt-0.5"><Icon className={`h-4 w-4 ${iconColor}`} /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-card-foreground leading-snug">{n.message}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.time)}</p>
                      </div>
                      {!n.read && <span className="h-2 w-2 bg-primary rounded-full mt-1.5 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          {/* Settings — in the header, not the sidebar footer */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/settings"
                aria-label="Settings"
                className={cn(
                  "rounded-lg p-2 transition-colors hover:bg-muted",
                  isSettings ? "bg-primary/10 text-primary" : "text-muted-foreground",
                )}
              >
                <Settings className="h-5 w-5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom">Settings</TooltipContent>
          </Tooltip>

          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            {isFullscreen
              ? <Minimize2 className="h-5 w-5 text-muted-foreground" />
              : <Maximize2 className="h-5 w-5 text-muted-foreground" />}
          </button>

          {/* Contact & support */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/contact"
                aria-label="Contact and support"
                className={cn(
                  "rounded-lg p-2 transition-colors hover:bg-muted",
                  isContact ? "bg-primary/10 text-primary" : "text-muted-foreground",
                )}
              >
                <Headset className="h-5 w-5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom">Contact &amp; support</TooltipContent>
          </Tooltip>

          <div className="h-6 w-px bg-border shrink-0 hidden md:block" />

          {/* Avatar + account popover */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={adminEmail ? `Account — signed in as ${adminEmail}` : "Account"}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-ink text-brand-ink-foreground text-xs font-semibold uppercase transition-opacity hover:opacity-90"
              >
                {(userName || adminEmail || "?").charAt(0)}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-0">
              <div className="space-y-1 p-4">
                <p className="text-sm font-semibold text-card-foreground">
                  {userName || "Account"}
                </p>
                <p className="break-all text-xs text-muted-foreground">
                  {adminEmail || "No address on this account"}
                </p>
                {role && (
                  <span className="mt-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium capitalize text-primary">
                    {role}
                  </span>
                )}
              </div>
              <div className="border-t p-1">
                <button
                  type="button"
                  onClick={logout}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <WorkspaceTabs />
    </header>
  );
}

import { useEffect, useState } from "react";
import { Home } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { BrandLogo } from "@/components/BrandLogo";
import { BRAND } from "@/brand";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  findSectionByPath,
  getDefaultSection,
  resolveStoredSection,
  ACTIVE_MODULE_STORAGE_KEY,
  MenuSection,
} from "@/lib/navigation";

// Active chip: solid primary fill + white text/icon.
const ACTIVE_ITEM_OVERRIDE = [
  "data-[active=true]:bg-sidebar-primary",
  "data-[active=true]:text-sidebar-primary-foreground",
  "data-[active=true]:hover:bg-sidebar-primary",
  "data-[active=true]:hover:text-sidebar-primary-foreground",
  "data-[active=true]:[&>svg]:text-sidebar-primary-icon",
].join(" ");

const ACTIVE_LINK = [
  "bg-sidebar-primary",
  "text-sidebar-primary-foreground",
  "font-medium",
  "hover:bg-sidebar-primary",
  "[&>svg]:text-sidebar-primary-icon",
].join(" ");

const IDLE_LINK =
  "flex items-center gap-3 px-3 py-2.5 rounded-nav text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors";

// Collapsed: icon + label stacked vertically (not icon-only square).
// Keeps the label visible so the rail is a narrow menu, not a memory test.
const COLLAPSED_ICON_CELL = [
  "group-data-[collapsible=icon]:!w-full",
  "group-data-[collapsible=icon]:!h-auto",
  "group-data-[collapsible=icon]:!min-w-0",
  "group-data-[collapsible=icon]:!max-w-none",
  "group-data-[collapsible=icon]:!flex-col",
  "group-data-[collapsible=icon]:!items-center",
  "group-data-[collapsible=icon]:!justify-center",
  "group-data-[collapsible=icon]:!gap-0.5",
  "group-data-[collapsible=icon]:!px-1",
  "group-data-[collapsible=icon]:!py-1.5",
  "group-data-[collapsible=icon]:rounded-nav",
  "group-data-[collapsible=icon]:[&>svg]:!size-5",
  "group-data-[collapsible=icon]:[&>svg]:shrink-0",
].join(" ");

// One line, ellipsis — long names use line-clamp so cells don't push items off the bottom of the rail.
const COLLAPSED_LABEL =
  "w-full text-center text-[10px] font-medium leading-[1.15] line-clamp-1 !whitespace-normal";

const COLLAPSED_GROUP_PAD = "group-data-[collapsible=icon]:px-1.5";

export function AppSidebar() {
  const { state, toggleSidebar, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const [activeSection, setActiveSection] = useState<MenuSection | null>(null);

  useEffect(() => {
    if (location.pathname !== "/") {
      const pathSection = findSectionByPath(location.pathname);
      if (pathSection) {
        setActiveSection(pathSection);
        localStorage.setItem(ACTIVE_MODULE_STORAGE_KEY, pathSection.label);
        return;
      }
    }

    const stored = localStorage.getItem(ACTIVE_MODULE_STORAGE_KEY);
    if (stored) {
      const foundSection = resolveStoredSection(stored);
      if (foundSection) {
        setActiveSection(foundSection);
        return;
      }
    }

    setActiveSection(getDefaultSection());
  }, [location.pathname]);

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r-sidebar-border group-data-[collapsible=icon]:overflow-hidden">
      {/* Brand row — h-14 matches the header exactly */}
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex h-14 items-center gap-2.5 px-3 w-full text-left hover:bg-sidebar-accent transition-colors group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:overflow-hidden"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <span className="flex h-11 w-11 items-center justify-center shrink-0 rounded-full bg-white ring-1 ring-sidebar-border overflow-hidden group-data-[collapsible=icon]:h-9 group-data-[collapsible=icon]:w-9">
          <BrandLogo
            className="h-full w-full object-contain p-0.5 rounded-full"
            fallbackClassName="text-sm text-emerald-700"
          />
        </span>
        {!collapsed && (
          <h1 className="min-w-0 text-[15px] font-bold leading-none text-sidebar-foreground tracking-wide truncate">
            {BRAND.name}
          </h1>
        )}
      </button>

      {/* eco-noscrollbar hides the gutter on the 84px rail */}
      <SidebarContent className="group-data-[collapsible=icon]:!overflow-y-auto group-data-[collapsible=icon]:overscroll-contain eco-noscrollbar">
        <SidebarGroup className={COLLAPSED_GROUP_PAD}>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Dashboard */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/"}
                  className={`${ACTIVE_ITEM_OVERRIDE} ${COLLAPSED_ICON_CELL}`}
                >
                  <NavLink
                    to="/"
                    end
                    onClick={handleNavClick}
                    className={IDLE_LINK}
                    activeClassName={ACTIVE_LINK}
                  >
                    <Home className="h-5 w-5 shrink-0" />
                    <span className={collapsed ? COLLAPSED_LABEL : "flex-1"} title={collapsed ? "Dashboard" : undefined}>
                      Dashboard
                    </span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mx-3 my-2 h-px bg-sidebar-border" />

        {activeSection && (
          <SidebarGroup className={COLLAPSED_GROUP_PAD}>
            {!collapsed && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-muted font-semibold px-3">
                {activeSection.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {activeSection.items.map((item, idx) => {
                  const active = location.pathname === item.url;
                  const prevGroup = idx > 0 ? activeSection.items[idx - 1].group : undefined;
                  const showSub = item.group && item.group !== prevGroup;
                  return (
                    <div key={item.title} className="contents">
                    {showSub && !collapsed && (
                      <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted/80">
                        {item.group}
                      </div>
                    )}
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        className={`${ACTIVE_ITEM_OVERRIDE} ${COLLAPSED_ICON_CELL}`}
                      >
                        <NavLink
                          to={item.url}
                          end
                          onClick={handleNavClick}
                          className={IDLE_LINK}
                          activeClassName={ACTIVE_LINK}
                        >
                          <item.icon className="h-5 w-5 shrink-0" />
                          <span className={collapsed ? COLLAPSED_LABEL : "flex-1"} title={collapsed ? item.title : undefined}>
                            {item.title}
                          </span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    </div>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Settings has moved to the header (beside notifications) */}
    </Sidebar>
  );
}

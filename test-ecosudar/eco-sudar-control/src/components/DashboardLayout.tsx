import React, { useState, createContext, useEffect } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { TopNavbar } from "@/components/TopNavbar";
import { ChatContextProvider } from "@/contexts/ChatContext";
import { ChatWidget } from "@/components/ChatWidget";
import { ModulesDialog } from "@/components/ModulesDialog";

interface DashboardLayoutContextType {
  modulesDialogOpen: boolean;
  setModulesDialogOpen: (open: boolean) => void;
}

export const DashboardLayoutContext = createContext<DashboardLayoutContextType | undefined>(
  undefined
);

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [modulesDialogOpen, setModulesDialogOpen] = useState(false);

  // Load this tenant's company profile once so generated documents (invoices,
  // quotations) show the tenant's own name/address/GSTIN.
  useEffect(() => {
    import("@/lib/companyProfile").then((m) => m.loadCompanyProfile());
  }, []);

  // The wheel hijack that used to redirect vertical scroll to horizontal on
  // overflow-x-auto tables has been removed. The floating scrollbar handles
  // horizontal scroll deliberately; hijacking the wheel made pages stop
  // scrolling wherever a table happened to be under the cursor.

  return (
    <ChatContextProvider>
      {/* 5.25rem (84px) — sized to the longest single-word nav label so the
          collapsed rail shows whole words rather than clipped tails. */}
      <SidebarProvider style={{ "--sidebar-width-icon": "5.25rem" } as React.CSSProperties}>
        <DashboardLayoutContext.Provider value={{ modulesDialogOpen, setModulesDialogOpen }}>
          {/* h-screen + overflow-hidden makes <main> the scroll container (not
              the window) so sticky/floating elements inside pages actually pin. */}
          <div className="h-screen overflow-hidden flex w-full">
            <AppSidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <TopNavbar />
              <main className="flex-1 overflow-auto px-4 pt-4 pb-28 md:px-6 md:pt-6 md:pb-28">{children}</main>
            </div>
          </div>
          <ModulesDialog open={modulesDialogOpen} onOpenChange={setModulesDialogOpen} />
          <ChatWidget />
        </DashboardLayoutContext.Provider>
      </SidebarProvider>
    </ChatContextProvider>
  );
}

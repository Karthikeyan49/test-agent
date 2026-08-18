import { useContext } from "react";
import { DashboardLayoutContext } from "@/components/DashboardLayout";

export function useDashboardLayout() {
  const context = useContext(DashboardLayoutContext);
  if (!context) {
    throw new Error("useDashboardLayout must be used within DashboardLayout");
  }
  return context;
}

import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENTS, type Accent } from "@/lib/accents";

export type StatAccent = Accent;

interface StatCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  subtitleColor?: "primary" | "muted";
  accent?: Accent;
}

export function StatCard({
  title, value, subtitle, icon: Icon, subtitleColor = "primary", accent = "sky",
}: StatCardProps) {
  const a = ACCENTS[accent];
  return (
    <div className="bg-card rounded-xl border p-5 flex items-start justify-between shadow-sm transition-shadow hover:shadow-md">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground truncate">{title}</p>
        <p className="text-2xl font-bold mt-1 text-card-foreground eco-nums">{value}</p>
        <p className={cn("text-xs mt-1 truncate", subtitleColor === "primary" ? "text-primary" : "text-muted-foreground")}>
          {subtitle}
        </p>
      </div>
      <div className={cn("p-3 rounded-xl shrink-0", a.tile)}>
        <Icon className={cn("h-6 w-6", a.icon)} />
      </div>
    </div>
  );
}

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FormPageProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  onBack: () => void;
  backLabel?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function FormPage({
  title,
  description,
  icon,
  onBack,
  backLabel = "Back",
  actions,
  footer,
  children,
  className,
}: FormPageProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1 shrink-0"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
              {icon}
              {title}
            </h1>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      <div className={cn("bg-card rounded-xl border shadow-sm", className)}>
        <div className="p-4 md:p-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t p-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

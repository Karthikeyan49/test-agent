import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  title?: string;
  subtitle?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyPadding?: string;
}

export function SectionCard({
  title,
  subtitle,
  headerAction,
  children,
  className,
  bodyPadding = 'p-4',
}: SectionCardProps) {
  const hasHeader = title || subtitle || headerAction;
  return (
    <div className={cn('bg-card rounded-xl border shadow-sm', className)}>
      {hasHeader && (
        <div className="p-4 border-b flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-base font-semibold text-card-foreground truncate">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      )}
      <div className={bodyPadding}>{children}</div>
    </div>
  );
}

export default SectionCard;

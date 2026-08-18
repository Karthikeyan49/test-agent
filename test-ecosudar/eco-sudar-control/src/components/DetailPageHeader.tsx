import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { BackButton } from '@/components/BackButton';

interface DetailPageHeaderProps {
  backFallback: string;
  title: string;
  subtitle?: string;
  loading?: boolean;
  badges?: ReactNode;
  actions?: ReactNode;
}

export function DetailPageHeader({
  backFallback,
  title,
  subtitle,
  loading,
  badges,
  actions,
}: DetailPageHeaderProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <BackButton fallback={backFallback} />
      <div className="min-w-0">
        {loading ? (
          <>
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-24 mt-1" />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
          </>
        )}
      </div>
      {badges && <div className="flex items-center gap-2 flex-wrap">{badges}</div>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export default DetailPageHeader;

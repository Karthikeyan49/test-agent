import { Skeleton } from '@/components/ui/skeleton';

interface PageLoadingSkeletonProps {
  rows?: number;
}

export function PageLoadingSkeleton({ rows = 3 }: PageLoadingSkeletonProps) {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="bg-card rounded-xl border shadow-sm p-5">
              <Skeleton className="h-48 w-full" />
            </div>
          ))}
        </div>
        <div className="bg-card rounded-xl border shadow-sm p-5">
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </div>
  );
}

export default PageLoadingSkeleton;

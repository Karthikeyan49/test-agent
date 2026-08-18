import { Skeleton } from '@/components/ui/skeleton';

interface TableSkeletonProps {
  rows?: number;
  cols: number;
  colWidths?: string[];
}

export function TableSkeleton({ rows = 5, cols, colWidths }: TableSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="py-3 px-4">
              <Skeleton className={`h-4 ${colWidths?.[j] ?? 'w-24'}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default TableSkeleton;

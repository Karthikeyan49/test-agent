import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface DetailFieldGridProps {
  children: ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}

const colClass: Record<number, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
};

export function DetailFieldGrid({ children, cols = 2, className }: DetailFieldGridProps) {
  return (
    <dl className={cn('grid gap-4', colClass[cols], className)}>
      {children}
    </dl>
  );
}

export default DetailFieldGrid;

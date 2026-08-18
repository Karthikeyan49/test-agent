import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FilterBarProps {
  children: ReactNode;
  className?: string;
}

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div className={cn('p-4 border-b flex items-center gap-3 flex-wrap', className)}>
      {children}
    </div>
  );
}

export default FilterBar;

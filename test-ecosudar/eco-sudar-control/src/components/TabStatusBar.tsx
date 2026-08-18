import { cn } from '@/lib/utils';

export interface StatusTab<T extends string = string> {
  value: T;
  label: string;
  count?: number;
}

interface TabStatusBarProps<T extends string = string> {
  tabs: StatusTab<T>[];
  active: T;
  onSelect: (value: T) => void;
  className?: string;
}

export function TabStatusBar<T extends string = string>({
  tabs,
  active,
  onSelect,
  className,
}: TabStatusBarProps<T>) {
  return (
    <div className={cn('flex items-center gap-2 flex-wrap', className)}>
      {tabs.map(tab => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onSelect(tab.value)}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
            active === tab.value
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:border-primary hover:text-primary',
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
              active === tab.value ? 'bg-primary-foreground/20' : 'bg-muted',
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export default TabStatusBar;

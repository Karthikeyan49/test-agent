import { cn } from '@/lib/utils';

interface ProgressBarProps {
  label: string;
  actual: number;
  target: number;
  format?: (n: number) => string;
}

export function ProgressBar({ label, actual, target, format }: ProgressBarProps) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  const fmt = format ?? ((n: number) => n.toLocaleString('en-IN'));
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-card-foreground font-medium">
          {fmt(actual)} / {fmt(target)}
          {' '}<span className="text-xs text-muted-foreground">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-primary' : 'bg-amber-400',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;

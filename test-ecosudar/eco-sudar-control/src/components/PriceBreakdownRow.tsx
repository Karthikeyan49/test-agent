import { cn } from '@/lib/utils';

interface PriceBreakdownRowProps {
  label: string;
  value: number;
  format?: (n: number) => string;
  bold?: boolean;
  negative?: boolean;
}

const defaultFmt = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });

export function PriceBreakdownRow({
  label,
  value,
  format = defaultFmt,
  bold = false,
  negative = false,
}: PriceBreakdownRowProps) {
  return (
    <div className={cn('flex justify-between py-1.5 text-sm', bold && 'border-t font-semibold')}>
      <span className={bold ? 'text-card-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className={negative ? 'text-destructive' : 'text-card-foreground'}>{format(value)}</span>
    </div>
  );
}

export default PriceBreakdownRow;

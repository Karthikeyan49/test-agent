import { inr, inrFull } from '@/lib/currency';
import { cn } from '@/lib/utils';

interface CurrencyTextProps {
  amount: number | null | undefined;
  full?: boolean;
  className?: string;
  bold?: boolean;
}

export function CurrencyText({ amount, full = false, className, bold = false }: CurrencyTextProps) {
  const display = full ? inrFull(amount) : inr(amount);
  return (
    <span className={cn(bold && 'font-semibold text-card-foreground', className)}>
      {display}
    </span>
  );
}

export default CurrencyText;

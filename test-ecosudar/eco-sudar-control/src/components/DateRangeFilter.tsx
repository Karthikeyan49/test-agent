import { Input } from '@/components/ui/input';

interface DateRangeFilterProps {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  fromLabel?: string;
  toLabel?: string;
}

export function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  fromLabel = 'From',
  toLabel = 'To',
}: DateRangeFilterProps) {
  return (
    <>
      <Input
        type="date"
        value={from}
        onChange={e => onFromChange(e.target.value)}
        title={fromLabel}
        placeholder={fromLabel}
        className="w-40"
      />
      <Input
        type="date"
        value={to}
        onChange={e => onToChange(e.target.value)}
        title={toLabel}
        placeholder={toLabel}
        className="w-40"
      />
    </>
  );
}

export default DateRangeFilter;

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface MonthPickerProps {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}

export function MonthPicker({ value, onChange, label = 'Month' }: MonthPickerProps) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="month"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

export default MonthPicker;

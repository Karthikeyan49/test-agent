import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

type Period = 'AM' | 'PM';

interface AmPmTimePickerProps {
  value: string;
  onChange: (v: string) => void;
  label: string;
  optional?: boolean;
}

function parseTo12h(val: string) {
  if (!val) return { h12: '', minute: '', period: 'AM' as Period };
  const [hStr, mStr] = val.split(':');
  const h24 = parseInt(hStr, 10);
  const period: Period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { h12: String(h12).padStart(2, '0'), minute: mStr ?? '00', period };
}

function formatTo24h(h12: string, minute: string, period: Period): string {
  if (!h12 || !minute) return '';
  let h = parseInt(h12, 10);
  if (period === 'AM' && h === 12) h = 0;
  if (period === 'PM' && h !== 12) h += 12;
  return `${String(h).padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

const HOURS   = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

export function AmPmTimePicker({ value, onChange, label, optional }: AmPmTimePickerProps) {
  const { h12, minute, period } = parseTo12h(value);
  const set = (h: string, m: string, p: Period) => onChange(formatTo24h(h, m, p));

  return (
    <div>
      <Label className="text-sm">
        {label}
        {optional && <span className="text-muted-foreground text-xs ml-1">(optional)</span>}
      </Label>
      <div className="flex items-center gap-1 mt-1">
        <Select value={h12} onValueChange={v => set(v, minute || '00', period as Period)}>
          <SelectTrigger className="w-[68px] px-2"><SelectValue placeholder="HH" /></SelectTrigger>
          <SelectContent>{HOURS.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-muted-foreground font-bold">:</span>
        <Select value={minute || ''} onValueChange={v => set(h12 || '12', v, period as Period)}>
          <SelectTrigger className="w-[68px] px-2"><SelectValue placeholder="MM" /></SelectTrigger>
          <SelectContent>{MINUTES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={period} onValueChange={v => set(h12 || '12', minute || '00', v as Period)}>
          <SelectTrigger className="w-[68px] px-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="AM">AM</SelectItem>
            <SelectItem value="PM">PM</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export default AmPmTimePicker;

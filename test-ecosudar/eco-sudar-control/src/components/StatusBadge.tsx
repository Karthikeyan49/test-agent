import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  new:               'bg-blue-50 text-blue-600 border-blue-200',
  contacted:         'bg-cyan-50 text-cyan-600 border-cyan-200',
  interested:        'bg-sky-50 text-sky-600 border-sky-200',
  site_visit:        'bg-violet-50 text-violet-600 border-violet-200',
  office_visit:      'bg-cyan-50 text-cyan-600 border-cyan-200',
  family_visit:      'bg-pink-50 text-pink-600 border-pink-200',
  negotiation:       'bg-amber-50 text-amber-600 border-amber-200',
  deal_close:        'bg-emerald-100 text-emerald-800 border-emerald-300',
  token_paid:        'bg-yellow-50 text-yellow-700 border-yellow-200',
  advance:           'bg-violet-50 text-violet-600 border-violet-200',
  booked:            'bg-blue-50 text-blue-700 border-blue-200',
  agreement_signed:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  documentation:     'bg-orange-50 text-orange-600 border-orange-200',
  registration:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  registered:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  completed:         'bg-green-50 text-green-800 border-green-200',
  closed:            'bg-emerald-50 text-emerald-700 border-emerald-200',
  lost:              'bg-red-50 text-red-600 border-red-200',
  low:               'bg-gray-100 text-gray-500 border-gray-200',
  normal:            'bg-blue-50 text-blue-600 border-blue-200',
  high:              'bg-red-50 text-red-600 border-red-200',
  urgent:            'bg-red-50 text-red-600 border-red-200',
  available:         'bg-emerald-50 text-emerald-700 border-emerald-200',
  reserved:          'bg-amber-50 text-amber-600 border-amber-200',
  sold:              'bg-red-50 text-red-600 border-red-200',
  hold:              'bg-gray-100 text-gray-500 border-gray-200',
  paid:              'bg-emerald-50 text-emerald-700 border-emerald-200',
  unpaid:            'bg-red-50 text-red-600 border-red-200',
  partial:           'bg-amber-50 text-amber-600 border-amber-200',
  overdue:           'bg-red-50 text-red-600 border-red-200',
  draft:             'bg-gray-100 text-gray-500 border-gray-200',
  sent:              'bg-blue-50 text-blue-600 border-blue-200',
  pending:           'bg-amber-50 text-amber-600 border-amber-200',
  approved:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected:          'bg-red-50 text-red-600 border-red-200',
  reimbursed:        'bg-blue-50 text-blue-600 border-blue-200',
  delivered:         'bg-emerald-50 text-emerald-700 border-emerald-200',
  processing:        'bg-sky-50 text-sky-600 border-sky-200',
  shipped:           'bg-blue-50 text-blue-600 border-blue-200',
  confirmed:         'bg-emerald-50 text-emerald-700 border-emerald-200',
  'out-for-delivery':'bg-cyan-50 text-cyan-600 border-cyan-200',
  cancelled:         'bg-red-50 text-red-600 border-red-200',
  returned:          'bg-orange-50 text-orange-600 border-orange-200',
  present:           'bg-emerald-50 text-emerald-700 border-emerald-200',
  absent:            'bg-red-50 text-red-600 border-red-200',
  half_day:          'bg-amber-50 text-amber-600 border-amber-200',
  leave:             'bg-purple-50 text-purple-600 border-purple-200',
  active:            'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive:          'bg-gray-100 text-gray-500 border-gray-200',
  converted:         'bg-emerald-50 text-emerald-700 border-emerald-200',
  planned:           'bg-blue-50 text-blue-600 border-blue-200',
  paused:            'bg-amber-50 text-amber-600 border-amber-200',
};

export const SOURCE_STYLES: Record<string, string> = {
  facebook:                 'bg-blue-50 text-blue-600 border-blue-200',
  instagram:                'bg-blue-50 text-blue-600 border-blue-200',
  google_ads:               'bg-red-50 text-red-600 border-red-200',
  youtube:                  'bg-red-50 text-red-600 border-red-200',
  walk_in:                  'bg-green-50 text-green-600 border-green-200',
  referral_customer:        'bg-green-50 text-green-600 border-green-200',
  referral_channel_partner: 'bg-green-50 text-green-600 border-green-200',
  cold_call:                'bg-purple-50 text-purple-600 border-purple-200',
  referral:                 'bg-green-50 text-green-600 border-green-200',
  website:                  'bg-gray-100 text-gray-600 border-gray-200',
  social_media:             'bg-blue-50 text-blue-600 border-blue-200',
  call:                     'bg-purple-50 text-purple-600 border-purple-200',
  other:                    'bg-gray-100 text-gray-600 border-gray-200',
};

interface StatusBadgeProps {
  value: string;
  styleMap?: Record<string, string>;
  className?: string;
}

export function StatusBadge({ value, styleMap = STATUS_STYLES, className }: StatusBadgeProps) {
  return (
    <Badge
      className={cn(
        'border capitalize',
        styleMap[value] ?? 'bg-muted text-muted-foreground border-border',
        className,
      )}
    >
      {value.replace(/_/g, ' ')}
    </Badge>
  );
}

export { STATUS_STYLES };
export default StatusBadge;

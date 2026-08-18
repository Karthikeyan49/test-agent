import { ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

type SortOrder = 'new' | 'old';

interface SortToggleButtonProps {
  order: SortOrder;
  onToggle: () => void;
  newLabel?: string;
  oldLabel?: string;
}

export function SortToggleButton({
  order,
  onToggle,
  newLabel = 'Newest first',
  oldLabel = 'Oldest first',
}: SortToggleButtonProps) {
  return (
    <Button variant="outline" onClick={onToggle}>
      <ArrowUpDown className="h-4 w-4 mr-2" />
      {order === 'new' ? newLabel : oldLabel}
    </Button>
  );
}

export default SortToggleButton;

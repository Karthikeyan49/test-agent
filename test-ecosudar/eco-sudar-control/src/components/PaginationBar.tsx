import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
  itemLabel?: string;
}

export function PaginationBar({
  page,
  totalPages,
  total,
  onPage,
  itemLabel = 'records',
}: PaginationBarProps) {
  return (
    <div className="flex items-center justify-between pt-2">
      <span className="text-xs text-muted-foreground">
        Page {page} of {totalPages} · {total.toLocaleString('en-IN')} {itemLabel}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default PaginationBar;

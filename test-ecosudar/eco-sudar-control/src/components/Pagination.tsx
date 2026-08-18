import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  PAGE_SIZES, pageNumbers, pageSlice, setPageSize, usePageSize, type PageSize,
} from "@/lib/pageSize";

/**
 * Paging for a list, in one hook and one component.
 *
 * Client-side, deliberately. Slicing what the page already holds gives every
 * list the same control today; an endpoint can move to server paging later
 * without the component changing, because it only ever sees an array.
 *
 * Usage:
 *   const paged = usePagedRows(filtered);
 *   {paged.rows.map(...)}
 *   <Pagination {...paged} noun="customers" onPage={paged.setPage} />
 */
export function usePagedRows<T>(rows: T[]) {
  const size = usePageSize();
  const [page, setPage] = useState(1);

  const slice = useMemo(() => pageSlice(rows, page, size), [rows, page, size]);
  useEffect(() => {
    if (slice.page !== page) setPage(slice.page);
  }, [slice.page, page]);

  return { ...slice, size, setPage };
}

export interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  from: number;
  to: number;
  onPage: (page: number) => void;
  /** What the rows are, for the count: "of 214 invoices". */
  noun?: string;
  className?: string;
}

export function Pagination({
  page, totalPages, total, from, to, onPage, noun = "rows", className,
}: PaginationProps) {
  const size = usePageSize();

  if (total === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm",
        className,
      )}
    >
      <p className="text-muted-foreground">
        Showing <span className="font-medium text-foreground eco-nums">{from}–{to}</span>
        {" of "}
        <span className="font-medium text-foreground eco-nums">{total}</span> {noun}
      </p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground whitespace-nowrap">Rows</span>
          <Select
            value={String(size)}
            onValueChange={(v) => {
              setPageSize(Number(v) as PageSize);
              onPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-[4.5rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline" size="icon" className="h-8 w-8"
              onClick={() => onPage(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            {pageNumbers(page, totalPages).map((n, i) =>
              n === "gap" ? (
                <span key={`gap-${i}`} className="px-1 text-muted-foreground">…</span>
              ) : (
                <Button
                  key={n}
                  variant={n === page ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8 eco-nums"
                  onClick={() => onPage(n)}
                  aria-label={`Page ${n}`}
                  aria-current={n === page ? "page" : undefined}
                >
                  {n}
                </Button>
              ),
            )}

            <Button
              variant="outline" size="icon" className="h-8 w-8"
              onClick={() => onPage(page + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

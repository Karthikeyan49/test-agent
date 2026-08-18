import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExportDialog, type ExportColumnDef } from "@/components/ExportDialog";

interface ExportMenuProps<T extends object> {
  /** Entity name shown in the dialog title ("Export <title> to Excel"). */
  title: string;
  /** Column definitions — group:"detail" fields appear under "Additional Fields". */
  columns: ExportColumnDef<T>[];
  /** The (already-filtered) rows to export. */
  rows: T[];
  /** Optional date field to enable the From/To range filter in the dialog. */
  dateField?: keyof T;
  /** Optional download filename base. */
  filename?: string;
  /** Extra dropdown items rendered under "Export to Excel" (e.g. Import). */
  extraItems?: React.ReactNode;
}

/**
 * The site-wide export control: a three-dot (⋮) menu whose "Export to Excel"
 * item opens the customizable <ExportDialog> (column picker + additional fields
 * + date range + password). Use this on every list page instead of a plain
 * Export button, so export is consistent everywhere.
 */
type AnyRow = Record<string, unknown>;

export function ExportMenu<T extends object>({
  title, columns, rows, dateField, filename, extraItems,
}: ExportMenuProps<T>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setOpen(true)}>Export to Excel</DropdownMenuItem>
          {extraItems}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* ExportDialog only reads header/key and indexes rows by those keys, so the
          cast to a generic row shape is safe and lets any page type flow through. */}
      <ExportDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        columns={columns as unknown as ExportColumnDef<AnyRow>[]}
        rows={rows as unknown as AnyRow[]}
        dateField={dateField as unknown as keyof AnyRow | undefined}
        filename={filename}
      />
    </>
  );
}

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SIZE_CLASS = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export interface QuickCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** "big popup for big things" — pick lg/xl for multi-column or line-item forms. */
  size?: keyof typeof SIZE_CLASS;
  children: React.ReactNode;
  onSubmit: () => void;
  saving?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  /** Disable submit (e.g. while a required field is empty). */
  submitDisabled?: boolean;
}

/**
 * A create/edit form shown *inline* — without leaving the page you're on.
 *
 * The site standard is: primary navigation to add/edit opens a full page, but
 * creating a dependency mid-form (a new customer while writing an order) opens
 * this popup so you keep your place. Built on DialogScrollContent, so a tall
 * form scrolls against the window edge, never inside the card, and an outside
 * click never discards what you've typed. Size it up for wider forms.
 */
export function QuickCreateDialog({
  open, onOpenChange, title, description, size = "lg",
  children, onSubmit, saving, submitLabel = "Save", cancelLabel = "Cancel", submitDisabled,
}: QuickCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogScrollContent className={cn("w-full", SIZE_CLASS[size])}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="grid gap-4">{children}</div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {cancelLabel}
          </Button>
          <Button onClick={onSubmit} disabled={saving || submitDisabled}>
            {saving ? "Saving…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogScrollContent>
    </Dialog>
  );
}

import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SavingButton } from '@/components/SavingButton';

interface FormDialogWrapperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
  children: ReactNode;
  submitLabel?: string;
  savingLabel?: string;
  contentClassName?: string;
}

export function FormDialogWrapper({
  open,
  onOpenChange,
  title,
  saving,
  onSubmit,
  children,
  submitLabel = 'Save',
  savingLabel = 'Saving…',
  contentClassName = 'max-w-lg',
}: FormDialogWrapperProps) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!saving) onOpenChange(v); }}>
      <DialogContent
        className={`${contentClassName} max-h-[90vh] overflow-y-auto`}
        onInteractOutside={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 pt-2">
          {children}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <SavingButton saving={saving} label={submitLabel} savingLabel={savingLabel} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default FormDialogWrapper;

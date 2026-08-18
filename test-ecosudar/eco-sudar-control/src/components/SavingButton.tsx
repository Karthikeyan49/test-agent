import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ComponentPropsWithoutRef } from 'react';

interface SavingButtonProps extends Omit<ComponentPropsWithoutRef<typeof Button>, 'children'> {
  saving: boolean;
  label?: string;
  savingLabel?: string;
}

export function SavingButton({
  saving,
  label = 'Save',
  savingLabel = 'Saving…',
  disabled,
  ...props
}: SavingButtonProps) {
  return (
    <Button type="submit" disabled={saving || disabled} {...props}>
      {saving ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin mr-1" />
          {savingLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

export default SavingButton;

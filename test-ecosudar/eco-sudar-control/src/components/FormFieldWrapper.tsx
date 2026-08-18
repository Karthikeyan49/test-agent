import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FormFieldWrapperProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormFieldWrapper({
  label,
  htmlFor,
  hint,
  required,
  children,
  className,
}: FormFieldWrapperProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
        {hint && (
          <span className="ml-1 text-xs text-muted-foreground font-normal">
            ({hint})
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}

export default FormFieldWrapper;

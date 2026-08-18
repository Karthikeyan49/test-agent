import { AlertCircle } from 'lucide-react';

interface InlineCrossAlertProps {
  message: string | null | undefined;
}

export function InlineCrossAlert({ message }: InlineCrossAlertProps) {
  if (!message) return null;
  return (
    <p className="text-xs text-amber-700 flex items-center gap-1 mt-1">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}

export default InlineCrossAlert;

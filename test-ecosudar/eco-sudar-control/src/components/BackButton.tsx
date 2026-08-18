import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSmartBack } from '@/hooks/useSmartBack';

interface BackButtonProps {
  fallback: string;
  label?: string;
}

export function BackButton({ fallback, label }: BackButtonProps) {
  const goBack = useSmartBack(fallback);
  return (
    <Button variant="ghost" size="sm" onClick={goBack} className="-ml-2">
      <ArrowLeft className="h-4 w-4 mr-1" />
      {label ?? 'Back'}
    </Button>
  );
}

export default BackButton;

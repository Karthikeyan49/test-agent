import { FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

interface ExportButtonProps {
  onExport: () => Promise<void> | void;
  label?: string;
}

export function ExportButton({ onExport, label = 'Export' }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handle = async () => {
    setExporting(true);
    try {
      await onExport();
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handle} disabled={exporting}>
      {exporting ? (
        <Loader2 className="h-4 w-4 animate-spin mr-1" />
      ) : (
        <FileDown className="h-4 w-4 mr-1" />
      )}
      {label}
    </Button>
  );
}

export default ExportButton;

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2, FileText } from "lucide-react";
import { documentApi } from "@/lib/api/documents";
import { getAuthToken } from "@/lib/api/client";

interface Props {
  documentId?: number | null;
  dataUrl?: string | null;
  fileName?: string;
  fileType?: string;
  title?: string;
  onClose: () => void;
}

export function FilePreviewDialog({ documentId, dataUrl, fileName, fileType, title, onClose }: Props) {
  const [blobUrl,      setBlobUrl]      = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string | undefined>(fileName);
  const [resolvedType, setResolvedType] = useState<string | undefined>(fileType);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const open = documentId != null || dataUrl != null;

  useEffect(() => {
    if (!open) { setBlobUrl(null); setError(null); return; }

    if (dataUrl) { setBlobUrl(dataUrl); return; }
    if (documentId == null) return;

    let cancelled  = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        if (!fileName || !fileType) {
          const meta = await documentApi.get(documentId);
          if (!cancelled) {
            setResolvedName(meta.data.file_name);
            setResolvedType(meta.data.file_type);
          }
        }
        const token = getAuthToken();
        const res = await fetch(documentApi.downloadUrl(documentId), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("Failed to load file");
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(objectUrl);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, dataUrl, open]);

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = resolvedName ?? fileName ?? "file";
    a.click();
  };

  const mime    = resolvedType ?? fileType ?? (dataUrl?.match(/^data:([^;]+);/)?.[1] ?? "");
  const isImage = mime.startsWith("image/");
  const isPdf   = mime === "application/pdf";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8 truncate">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate">{title ?? resolvedName ?? fileName ?? "File Preview"}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto min-h-[300px] flex items-center justify-center bg-muted/20 rounded-lg">
          {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
          {!loading && error && (
            <p className="text-sm text-destructive text-center px-6">{error}</p>
          )}
          {!loading && !error && blobUrl && isImage && (
            <img
              src={blobUrl}
              alt={resolvedName ?? fileName ?? "preview"}
              className="max-w-full max-h-[70vh] object-contain"
            />
          )}
          {!loading && !error && blobUrl && isPdf && (
            <iframe src={blobUrl} title="PDF preview" className="w-full h-[70vh] border-0" />
          )}
          {!loading && !error && blobUrl && !isImage && !isPdf && (
            <div className="text-center py-10 space-y-2">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                Preview not available for this file type — download it instead.
              </p>
            </div>
          )}
        </div>

        {blobUrl && (
          <div className="pt-3 border-t flex justify-end">
            <Button onClick={handleDownload} variant="outline" className="gap-2">
              <Download className="h-4 w-4" /> Download
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { attachmentObjectUrl } from "@/lib/api/phase2";

/**
 * Renders an image whose bytes are served behind Bearer auth via
 * /admin/attachments/{id}/download. A plain <img> can't send the auth token, so
 * we fetch the blob with auth and use an object URL, revoking it on unmount.
 *
 * Pass the numeric `attachmentId`; the download path is built here. We deliberately
 * do NOT use the API's `download_url` field directly: it is prefixed with "/api"
 * while BASE_URL already ends in "/api", which would double the segment (404).
 */
export function AuthImage({
  attachmentId,
  alt,
  className,
  onClick,
}: {
  attachmentId: number;
  alt: string;
  className?: string;
  onClick?: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setError(false);
    attachmentObjectUrl(`/admin/attachments/${attachmentId}/download`)
      .then((url) => {
        if (cancelled) { URL.revokeObjectURL(url); return; }
        objectUrl = url;
        setSrc(url);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentId]);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-muted text-muted-foreground ${className ?? ""}`}>
        <ImageOff className="h-6 w-6" />
      </div>
    );
  }
  if (!src) {
    return <div className={`animate-pulse bg-muted ${className ?? ""}`} />;
  }
  return <img src={src} alt={alt} className={className} onClick={onClick} loading="lazy" />;
}

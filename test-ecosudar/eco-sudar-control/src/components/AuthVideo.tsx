import { BASE_URL, getAuthToken } from "@/lib/api/client";

/**
 * Streams a video served behind Bearer auth via /admin/attachments/{id}/download.
 *
 * A plain <video src> can't send an Authorization header, so we pass the token as
 * a `?token=` query param (the download route accepts this) and let the browser
 * stream the file with HTTP Range requests — playback starts immediately and
 * supports seeking, instead of downloading the whole file first.
 */
export function AuthVideo({
  attachmentId,
  className,
  autoPlay,
}: {
  attachmentId: number;
  mimeType?: string;
  fileName?: string;
  className?: string;
  autoPlay?: boolean;
}) {
  const token = getAuthToken();
  const src = `${BASE_URL}/admin/attachments/${attachmentId}/download${token ? `?token=${encodeURIComponent(token)}` : ""}`;

  return (
    <video
      key={attachmentId}
      src={src}
      controls
      playsInline
      autoPlay={autoPlay}
      preload="metadata"
      className={className}
    />
  );
}

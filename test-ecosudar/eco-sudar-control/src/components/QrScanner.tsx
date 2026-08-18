import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, FlipHorizontal2, Keyboard, X } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  onScan: (token: string) => void;
  /** Disable scanner from auto-firing while parent processes a result */
  busy?: boolean;
  /** Render scanner as a fixed full-viewport overlay */
  fullscreen?: boolean;
  /** Called when user clicks the X close button (only used when fullscreen) */
  onClose?: () => void;
}

type FacingMode = "environment" | "user";

export function QrScanner({ onScan, busy, fullscreen, onClose }: Props) {
  const containerId   = "qr-scanner-region";
  const scannerRef    = useRef<Html5Qrcode | null>(null);
  const busyRef       = useRef(false);
  const [active, setActive]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [manual, setManual]       = useState("");
  const [facing, setFacing]       = useState<FacingMode>("environment");
  const lastFiredRef = useRef<{ token: string; at: number }>({ token: "", at: 0 });

  useEffect(() => {
    busyRef.current = !!busy;
  }, [busy]);

  // ─── Stop camera ────────────────────────────────────────────────────────────
  const stop = async () => {
    try { await scannerRef.current?.stop(); } catch { /* ignore */ }
    try { await scannerRef.current?.clear(); } catch { /* ignore */ }
    scannerRef.current = null;
    setActive(false);
  };

  // ─── Start camera with given facing mode ────────────────────────────────────
  const start = async (facingMode: FacingMode = facing) => {
    setError(null);
    try {
      const inst = new Html5Qrcode(containerId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      scannerRef.current = inst;
      const minDim = Math.min(window.innerWidth, window.innerHeight);
      const box    = Math.max(240, Math.floor(minDim * 0.75));
      await inst.start(
        { facingMode },
        { fps: 15, qrbox: { width: box, height: box }, aspectRatio: 1.0, disableFlip: false },
        (decoded) => {
          const now = Date.now();
          if (busyRef.current) return;
          // Continuous scanning can see the same badge for several frames.
          // Keep the scanner open, but ignore repeated reads of the same token briefly.
          if (decoded === lastFiredRef.current.token && now - lastFiredRef.current.at < 8000) return;
          lastFiredRef.current = { token: decoded, at: now };
          onScan(decoded);           // ← auto-fires immediately, no submit needed
        },
        () => undefined,
      );
      setActive(true);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Camera unavailable");
      setActive(false);
    }
  };

  // ─── Flip camera ─────────────────────────────────────────────────────────────
  const flip = async () => {
    const next: FacingMode = facing === "environment" ? "user" : "environment";
    setFacing(next);
    if (active) {
      await stop();
      // Small delay so the DOM element re-appears before we re-init
      await new Promise((r) => setTimeout(r, 150));
      await start(next);
    }
  };

  // Auto-start when used as fullscreen overlay
  useEffect(() => {
    if (fullscreen) start();
    return () => { stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  // ─── Fullscreen mode (mobile kiosk) ─────────────────────────────────────────
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 text-white">
          <div>
            <p className="font-semibold">Scan Employee QR</p>
            <p className="text-xs text-white/70">Hold the QR steady — scans automatically</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Flip button */}
            <Button
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/10"
              title={facing === "environment" ? "Switch to front camera" : "Switch to back camera"}
              onClick={flip}
            >
              <FlipHorizontal2 className="h-6 w-6" />
            </Button>
            {/* Close button */}
            <Button
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/10"
              onClick={() => { stop(); onClose?.(); }}
            >
              <X className="h-6 w-6" />
            </Button>
          </div>
        </div>

        {/* Camera viewfinder */}
        <div className="flex-1 relative">
          <div
            id={containerId}
            className="absolute inset-0 [&>video]:!w-full [&>video]:!h-full [&>video]:!object-cover"
          />
          {/* Scanning frame overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-64 relative">
              <span className="absolute top-0    left-0   w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg" />
              <span className="absolute top-0    right-0  w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg" />
              <span className="absolute bottom-0 left-0   w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg" />
              <span className="absolute bottom-0 right-0  w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg" />
            </div>
          </div>
          {/* "Scans automatically" badge */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
            Auto-scan active
          </div>
        </div>

        {error && <p className="text-xs text-destructive text-center bg-black/60 py-2">{error}</p>}

        {/* Manual fallback */}
        <div className="bg-black/80 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-white/80 text-xs">
            <Keyboard className="h-3 w-3" /> Or enter token manually
          </div>
          <div className="flex gap-2">
            <Input
              className="bg-white"
              placeholder="ESD-XX-000-XXXX"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manual.trim() && !busy) {
                  onScan(manual.trim());
                  setManual("");
                }
              }}
            />
            <Button
              size="sm"
              disabled={!manual.trim() || busy}
              onClick={() => { onScan(manual.trim()); setManual(""); }}
            >
              Submit
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Inline (desktop) mode ───────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div
        id={containerId}
        className="rounded-lg overflow-hidden border bg-muted/40 aspect-square max-w-sm mx-auto"
      />
      {error && <p className="text-xs text-destructive text-center">{error}</p>}

      <div className="flex gap-2 justify-center">
        {!active ? (
          <Button onClick={() => start()} size="sm">
            <Camera className="h-4 w-4" /> Start camera
          </Button>
        ) : (
          <>
            <Button onClick={stop} size="sm" variant="outline">
              <CameraOff className="h-4 w-4" /> Stop
            </Button>
            <Button
              onClick={flip}
              size="sm"
              variant="outline"
              title={facing === "environment" ? "Switch to front camera" : "Switch to back camera"}
            >
              <FlipHorizontal2 className="h-4 w-4" />
              {facing === "environment" ? "Front cam" : "Back cam"}
            </Button>
          </>
        )}
      </div>

      {/* Auto-scan notice */}
      {active && (
        <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
          Scans automatically when QR is detected
        </p>
      )}

      <div className="border-t pt-3">
        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
          <Keyboard className="h-3 w-3" /> Or enter token manually
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="ESD-XX-000-XXXX"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manual.trim() && !busy) {
                onScan(manual.trim());
                setManual("");
              }
            }}
          />
          <Button
            size="sm"
            disabled={!manual.trim() || busy}
            onClick={() => { onScan(manual.trim()); setManual(""); }}
          >
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

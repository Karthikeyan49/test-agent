import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, FlipHorizontal2, Loader2, UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BASE_URL, getAuthToken } from "@/lib/api/client";
import type { Employee } from "@/lib/api/hr";

interface Props {
  employees: Employee[];
  busy?: boolean;
  onMatch: (employeeId: string) => Promise<void> | void;
  onClose: () => void;
}

type FacingMode = "user" | "environment";
type FaceBox = { x: number; y: number; width: number; height: number };
type FaceResult = { boundingBox: FaceBox };
type FaceDetectorLike = { detect: (source: CanvasImageSource) => Promise<FaceResult[]> };
type FaceDetectorConstructor = new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;

type FaceDetection = {
  box: FaceBox;
  detected: boolean;
  detectionSupported: boolean;
  faceCount: number;
  faceRatio: number;
};

type FaceDescriptor = {
  texture: Float32Array;
  gradient: Float32Array;
  lbp: Float32Array;
  colorHistogram: Float32Array;
  detected: boolean;
  detectionSupported: boolean;
  faceCount: number;
  faceRatio: number;
};

type FaceReference = {
  employee: Employee;
  descriptor: FaceDescriptor;
};

type FrameMatch = {
  reference: FaceReference;
  score: number;
  secondScore: number;
  gap: number;
  fallbackMode: boolean;
};

type MatchOutcome =
  | { ok: true; match: FrameMatch }
  | { ok: false; reason: string };

const FACE_SIZE = 48;
const COLOR_HISTOGRAM_BINS = 8;
const GRADIENT_GRID = 4;
const GRADIENT_BINS = 8;
const LBP_GRID = 4;
const LBP_BINS = 16;

const MATCH_SAMPLE_COUNT = 3;
const MATCH_SAMPLE_DELAY_MS = 220;
const MATCH_THRESHOLD = 0.84;
const FALLBACK_MATCH_THRESHOLD = 0.9;
const AMBIGUOUS_GAP = 0.08;
const MIN_LIVE_FACE_RATIO = 0.16;
const MAX_LIVE_FACE_RATIO = 0.72;
const SAME_EMPLOYEE_COOLDOWN_MS = 15000;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const employeePhotoUrl = (employeeId: string) => {
  const token = getAuthToken();
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  params.set("t", String(Date.now()));
  return `${BASE_URL}/admin/employees/${encodeURIComponent(employeeId)}/photo?${params.toString()}`;
};

const loadImageFromBlob = (blob: Blob): Promise<{ img: HTMLImageElement; url: string }> => {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load employee photo"));
    };
    img.src = url;
  });
};

const sourceSize = (source: CanvasImageSource) => {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if (source instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas)) {
    return { width: source.width, height: source.height };
  }
  return { width: source.width, height: source.height };
};

const clampBox = (box: FaceBox, width: number, height: number): FaceBox => {
  const pad = Math.max(box.width, box.height) * 0.28;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const right = Math.min(width, box.x + box.width + pad);
  const bottom = Math.min(height, box.y + box.height + pad);
  return { x, y, width: right - x, height: bottom - y };
};

const centerFaceBox = (width: number, height: number): FaceBox => {
  const side = Math.min(width, height) * 0.68;
  return {
    x: (width - side) / 2,
    y: (height - side) / 2,
    width: side,
    height: side,
  };
};

const faceDetectorCtor = () => (
  typeof window !== "undefined"
    ? (window as unknown as { FaceDetector?: FaceDetectorConstructor }).FaceDetector
    : undefined
);

const detectFaceBox = async (source: CanvasImageSource, width: number, height: number): Promise<FaceDetection> => {
  const ctor = faceDetectorCtor();
  if (!ctor) {
    return {
      box: centerFaceBox(width, height),
      detected: false,
      detectionSupported: false,
      faceCount: 0,
      faceRatio: 0,
    };
  }

  try {
    const detector = new ctor({ fastMode: false, maxDetectedFaces: 5 });
    const faces = await detector.detect(source);
    if (faces.length > 0) {
      const sorted = [...faces].sort((a, b) => (
        (b.boundingBox.width * b.boundingBox.height) - (a.boundingBox.width * a.boundingBox.height)
      ));
      const largest = sorted[0].boundingBox;
      return {
        box: clampBox(largest, width, height),
        detected: faces.length === 1,
        detectionSupported: true,
        faceCount: faces.length,
        faceRatio: Math.sqrt((largest.width * largest.height) / (width * height)),
      };
    }
  } catch {
    // Browser support for FaceDetector is optional. Fall back to stricter center-crop matching.
  }

  return {
    box: centerFaceBox(width, height),
    detected: false,
    detectionSupported: true,
    faceCount: 0,
    faceRatio: 0,
  };
};

const normalizeZScore = (values: Float32Array) => {
  let sum = 0;
  for (const value of values) sum += value;
  const mean = sum / values.length;
  let variance = 0;
  for (const value of values) variance += (value - mean) ** 2;
  const std = Math.sqrt(variance / values.length) || 1;
  for (let i = 0; i < values.length; i += 1) {
    values[i] = (values[i] - mean) / std;
  }
  return values;
};

const normalizeL2 = (values: Float32Array) => {
  let magnitude = 0;
  for (const value of values) magnitude += value * value;
  const scale = Math.sqrt(magnitude);
  if (!scale) return values;
  for (let i = 0; i < values.length; i += 1) {
    values[i] = values[i] / scale;
  }
  return values;
};

const buildGradientDescriptor = (gray: Float32Array) => {
  const descriptor = new Float32Array(GRADIENT_GRID * GRADIENT_GRID * GRADIENT_BINS);
  const cellSize = FACE_SIZE / GRADIENT_GRID;

  for (let y = 1; y < FACE_SIZE - 1; y += 1) {
    for (let x = 1; x < FACE_SIZE - 1; x += 1) {
      const dx = gray[(y * FACE_SIZE) + x + 1] - gray[(y * FACE_SIZE) + x - 1];
      const dy = gray[((y + 1) * FACE_SIZE) + x] - gray[((y - 1) * FACE_SIZE) + x];
      const magnitude = Math.sqrt((dx * dx) + (dy * dy));
      if (magnitude === 0) continue;

      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;

      const cellX = Math.min(GRADIENT_GRID - 1, Math.floor(x / cellSize));
      const cellY = Math.min(GRADIENT_GRID - 1, Math.floor(y / cellSize));
      const bin = Math.min(GRADIENT_BINS - 1, Math.floor((angle / Math.PI) * GRADIENT_BINS));
      const index = (((cellY * GRADIENT_GRID) + cellX) * GRADIENT_BINS) + bin;
      descriptor[index] += magnitude;
    }
  }

  return normalizeL2(descriptor);
};

const buildLbpDescriptor = (gray: Float32Array) => {
  const descriptor = new Float32Array(LBP_GRID * LBP_GRID * LBP_BINS);
  const cellSize = FACE_SIZE / LBP_GRID;
  const offsets = [
    [-1, -1], [0, -1], [1, -1],
    [1, 0],
    [1, 1], [0, 1], [-1, 1],
    [-1, 0],
  ];

  for (let y = 1; y < FACE_SIZE - 1; y += 1) {
    for (let x = 1; x < FACE_SIZE - 1; x += 1) {
      const center = gray[(y * FACE_SIZE) + x];
      let code = 0;
      offsets.forEach(([ox, oy], index) => {
        if (gray[((y + oy) * FACE_SIZE) + x + ox] >= center) {
          code |= (1 << index);
        }
      });

      const cellX = Math.min(LBP_GRID - 1, Math.floor(x / cellSize));
      const cellY = Math.min(LBP_GRID - 1, Math.floor(y / cellSize));
      const bin = Math.min(LBP_BINS - 1, Math.floor(code / (256 / LBP_BINS)));
      const descriptorIndex = (((cellY * LBP_GRID) + cellX) * LBP_BINS) + bin;
      descriptor[descriptorIndex] += 1;
    }
  }

  return normalizeL2(descriptor);
};

const descriptorFromSource = async (source: CanvasImageSource): Promise<FaceDescriptor> => {
  const { width, height } = sourceSize(source);
  if (!width || !height) throw new Error("Camera frame is not ready");

  const detection = await detectFaceBox(source, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = FACE_SIZE;
  canvas.height = FACE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.drawImage(source, detection.box.x, detection.box.y, detection.box.width, detection.box.height, 0, 0, FACE_SIZE, FACE_SIZE);
  const data = ctx.getImageData(0, 0, FACE_SIZE, FACE_SIZE).data;
  const gray = new Float32Array(FACE_SIZE * FACE_SIZE);
  const colorHistogram = new Float32Array(COLOR_HISTOGRAM_BINS * 3);

  for (let i = 0; i < FACE_SIZE * FACE_SIZE; i += 1) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    colorHistogram[Math.min(COLOR_HISTOGRAM_BINS - 1, Math.floor((r / 256) * COLOR_HISTOGRAM_BINS))] += 1;
    colorHistogram[COLOR_HISTOGRAM_BINS + Math.min(COLOR_HISTOGRAM_BINS - 1, Math.floor((g / 256) * COLOR_HISTOGRAM_BINS))] += 1;
    colorHistogram[(COLOR_HISTOGRAM_BINS * 2) + Math.min(COLOR_HISTOGRAM_BINS - 1, Math.floor((b / 256) * COLOR_HISTOGRAM_BINS))] += 1;
  }

  return {
    texture: normalizeZScore(new Float32Array(gray)),
    gradient: buildGradientDescriptor(gray),
    lbp: buildLbpDescriptor(gray),
    colorHistogram: normalizeL2(colorHistogram),
    detected: detection.detected,
    detectionSupported: detection.detectionSupported,
    faceCount: detection.faceCount,
    faceRatio: detection.faceRatio,
  };
};

const cosine = (a: Float32Array, b: Float32Array) => {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) return 0;
  return dot / Math.sqrt(magA * magB);
};

const scoreDescriptors = (live: FaceDescriptor, reference: FaceDescriptor) => {
  const textureScore = (cosine(live.texture, reference.texture) + 1) / 2;
  const gradientScore = Math.max(0, cosine(live.gradient, reference.gradient));
  const lbpScore = Math.max(0, cosine(live.lbp, reference.lbp));
  const colorScore = Math.max(0, cosine(live.colorHistogram, reference.colorHistogram));

  return (
    (textureScore * 0.42) +
    (gradientScore * 0.35) +
    (lbpScore * 0.18) +
    (colorScore * 0.05)
  );
};

async function loadReference(employee: Employee): Promise<FaceReference> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(employeePhotoUrl(employee.id), { headers });
  if (!response.ok) throw new Error(`Could not load photo for ${employee.name}`);
  const blob = await response.blob();

  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(blob);
    try {
      return { employee, descriptor: await descriptorFromSource(bitmap) };
    } finally {
      bitmap.close();
    }
  }

  const { img, url } = await loadImageFromBlob(blob);
  try {
    return { employee, descriptor: await descriptorFromSource(img) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const matchFrame = async (source: CanvasImageSource, references: FaceReference[]): Promise<MatchOutcome> => {
  const live = await descriptorFromSource(source);

  if (live.detectionSupported) {
    if (live.faceCount === 0) {
      return { ok: false, reason: "No face detected. Keep one face inside the circle." };
    }
    if (live.faceCount > 1) {
      return { ok: false, reason: "Multiple faces detected. Scan only one person at a time." };
    }
    if (live.faceRatio < MIN_LIVE_FACE_RATIO) {
      return { ok: false, reason: "Face is too far from camera. Move closer and try again." };
    }
    if (live.faceRatio > MAX_LIVE_FACE_RATIO) {
      return { ok: false, reason: "Face is too close to camera. Move back slightly and try again." };
    }
  }

  const matches = references
    .map((reference) => ({
      reference,
      score: scoreDescriptors(live, reference.descriptor),
    }))
    .sort((a, b) => b.score - a.score);

  const best = matches[0];
  const second = matches[1];
  if (!best) {
    return { ok: false, reason: "No employee photos are ready for face matching." };
  }

  const fallbackMode = !live.detected || !best.reference.descriptor.detected;
  const threshold = fallbackMode ? FALLBACK_MATCH_THRESHOLD : MATCH_THRESHOLD;
  const secondScore = second?.score ?? 0;
  const gap = best.score - secondScore;

  if (best.score < threshold) {
    return { ok: false, reason: "No confident face match. Improve light or use QR." };
  }
  if (second && gap < AMBIGUOUS_GAP) {
    return { ok: false, reason: "Face is too similar to another employee photo. Use QR for this scan." };
  }

  return {
    ok: true,
    match: {
      reference: best.reference,
      score: best.score,
      secondScore,
      gap,
      fallbackMode,
    },
  };
};

export function FaceAttendanceScanner({ employees, busy, onMatch, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const referencesRef = useRef<FaceReference[]>([]);
  const lastMarkedRef = useRef<{ employeeId: string; at: number }>({ employeeId: "", at: 0 });
  const [facing, setFacing] = useState<FacingMode>("user");
  const [cameraReady, setCameraReady] = useState(false);
  const [matching, setMatching] = useState(false);
  const [status, setStatus] = useState("Loading employee photos...");
  const [error, setError] = useState<string | null>(null);
  const [referenceCount, setReferenceCount] = useState(0);
  const [skippedReferenceCount, setSkippedReferenceCount] = useState(0);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [lastMatch, setLastMatch] = useState<{ name: string; score: number } | null>(null);

  const eligibleEmployees = useMemo(
    () => employees.filter((employee) => employee.active && employee.photoPath),
    [employees],
  );

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  };

  const startCamera = async (nextFacing: FacingMode = facing) => {
    setError(null);
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: nextFacing,
          width: { ideal: 960 },
          height: { ideal: 960 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (cameraError: unknown) {
      setError(cameraError instanceof Error ? cameraError.message : "Camera unavailable");
      setCameraReady(false);
    }
  };

  const flip = async () => {
    const next: FacingMode = facing === "user" ? "environment" : "user";
    setFacing(next);
    await startCamera(next);
  };

  useEffect(() => {
    void startCamera();
    return stopCamera;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    referencesRef.current = [];
    setReferenceCount(0);
    setSkippedReferenceCount(0);
    setFallbackMode(false);

    const loadReferences = async () => {
      if (!eligibleEmployees.length) {
        setStatus("No active employees have profile photos. Upload employee photos first.");
        return;
      }

      setStatus(`Loading ${eligibleEmployees.length} employee photos...`);
      const results = await Promise.allSettled(eligibleEmployees.map(loadReference));
      if (cancelled) return;

      const loaded = results
        .filter((result): result is PromiseFulfilledResult<FaceReference> => result.status === "fulfilled")
        .map((result) => result.value);
      const references = loaded.filter((reference) => (
        !reference.descriptor.detectionSupported || reference.descriptor.detected
      ));
      const skipped = eligibleEmployees.length - references.length;

      referencesRef.current = references;
      setReferenceCount(references.length);
      setSkippedReferenceCount(skipped);
      setFallbackMode(references.some((reference) => !reference.descriptor.detectionSupported));

      if (references.length === 0) {
        setStatus("Could not read clear single-face employee photos. Re-upload front-facing photos.");
      } else if (skipped > 0) {
        setStatus(`Ready. Loaded ${references.length} photos, skipped ${skipped} unclear photos.`);
      } else if (references.some((reference) => !reference.descriptor.detectionSupported)) {
        setStatus(`Ready in strict fallback mode. Loaded ${references.length} employee photos.`);
      } else {
        setStatus(`Ready. Loaded ${references.length} employee photos.`);
      }
    };

    void loadReferences();
    return () => {
      cancelled = true;
    };
  }, [eligibleEmployees]);

  const captureAndMatch = async () => {
    if (busy || matching) return;
    const video = videoRef.current;
    const references = referencesRef.current;
    if (!video || !cameraReady || !video.videoWidth || !video.videoHeight) {
      setError("Camera is not ready yet");
      return;
    }
    if (!references.length) {
      setError("No clear employee photos are ready for face matching");
      return;
    }

    setMatching(true);
    setError(null);
    setStatus(`Confirming face 1/${MATCH_SAMPLE_COUNT}...`);

    try {
      const frameMatches: FrameMatch[] = [];
      for (let sample = 0; sample < MATCH_SAMPLE_COUNT; sample += 1) {
        if (sample > 0) {
          setStatus(`Confirming face ${sample + 1}/${MATCH_SAMPLE_COUNT}...`);
          await wait(MATCH_SAMPLE_DELAY_MS);
        }

        const outcome = await matchFrame(video, references);
        if (!outcome.ok) {
          setStatus(outcome.reason);
          return;
        }
        frameMatches.push(outcome.match);
      }

      const firstEmployeeId = frameMatches[0].reference.employee.id;
      const sameEmployeeAcrossFrames = frameMatches.every((match) => match.reference.employee.id === firstEmployeeId);
      if (!sameEmployeeAcrossFrames) {
        setStatus("Face match changed between frames. Hold still and try again.");
        return;
      }

      const averageScore = frameMatches.reduce((sum, match) => sum + match.score, 0) / frameMatches.length;
      const smallestGap = Math.min(...frameMatches.map((match) => match.gap));
      if (smallestGap < AMBIGUOUS_GAP) {
        setStatus("Face is too close to another employee match. Use QR for this scan.");
        return;
      }

      const best = frameMatches[0].reference;
      const now = Date.now();
      if (
        best.employee.id === lastMarkedRef.current.employeeId &&
        now - lastMarkedRef.current.at < SAME_EMPLOYEE_COOLDOWN_MS
      ) {
        setStatus(`${best.employee.name} was just marked. Wait a few seconds before scanning again.`);
        return;
      }

      setLastMatch({ name: best.employee.name, score: averageScore });
      await onMatch(best.employee.id);
      lastMarkedRef.current = { employeeId: best.employee.id, at: Date.now() };
      setStatus(frameMatches.some((match) => match.fallbackMode)
        ? "Attendance marked in strict fallback mode. Ready for next face."
        : "Attendance marked. Ready for next face.");
    } catch (matchError: unknown) {
      setError(matchError instanceof Error ? matchError.message : "Face scan failed");
      setStatus("Face scan failed. Try again or use QR.");
    } finally {
      setMatching(false);
    }
  };

  const close = () => {
    stopCamera();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div>
          <p className="font-semibold">Face Attendance</p>
          <p className="text-xs text-white/70">Strict multi-frame match with employee profile photo</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10"
            title={facing === "user" ? "Switch to back camera" : "Switch to front camera"}
            onClick={flip}
          >
            <FlipHorizontal2 className="h-6 w-6" />
          </Button>
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={close}>
            <X className="h-6 w-6" />
          </Button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-72 w-72 rounded-full border-4 border-primary/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        <div className="absolute bottom-4 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg bg-black/70 px-4 py-3 text-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{status}</p>
              <p className="text-xs text-white/65">
                {referenceCount} photo{referenceCount === 1 ? "" : "s"} ready
                {skippedReferenceCount > 0 ? `, ${skippedReferenceCount} skipped` : ""}. QR remains fallback.
              </p>
              {fallbackMode && (
                <p className="mt-1 text-xs text-amber-200">
                  Browser face detection is unavailable, so matching is stricter.
                </p>
              )}
              {lastMatch && (
                <p className="mt-1 text-xs text-primary">
                  Last match: {lastMatch.name} ({Math.round(lastMatch.score * 100)}%)
                </p>
              )}
            </div>
            <UserCheck className="h-5 w-5 shrink-0 text-primary" />
          </div>
        </div>
      </div>

      {error && <p className="bg-destructive/20 px-4 py-2 text-center text-xs text-white">{error}</p>}

      <div className="bg-black/85 px-4 py-3">
        <Button
          className="w-full"
          onClick={captureAndMatch}
          disabled={!cameraReady || matching || busy || referenceCount === 0}
        >
          {matching || busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {matching || busy ? "Verifying face..." : "Capture Face & Mark Attendance"}
        </Button>
        <p className="mt-2 text-center text-xs text-white/55">
          This uses strict photo matching. If confidence is low or ambiguous, use QR.
        </p>
      </div>
    </div>
  );
}

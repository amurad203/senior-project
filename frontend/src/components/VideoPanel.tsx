import {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
  type ChangeEvent,
} from 'react';
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radar,
  Upload,
  Video,
  VideoOff,
} from 'lucide-react';
import type { BoundingBox } from '../types';
import { canvasSourceToJpegBlob } from '../api/detect';
import type { PerfStats } from '../api/perf';

/** Imperative API for grabbing JPEG frames (uploaded image/video, webcam, or URL stream). */
export type VideoFeedCapture = {
  captureFrame: (maxSide?: number, quality?: number) => Promise<Blob>;
  /** True when there is a frame source (not the empty placeholder). */
  hasActiveFeed: () => boolean;
};

interface VideoPanelProps {
  boundingBoxes?: BoundingBox[];
  isLive?: boolean;
  isPaused?: boolean;
  onPause?: () => void;
  streamUrl?: string | null;
  liveDetectActive?: boolean;
  perfStats?: PerfStats | null;
}

type LocalFile = { kind: 'image' | 'video'; url: string };

export const VideoPanel = forwardRef<VideoFeedCapture, VideoPanelProps>(
  function VideoPanel(
    {
      boundingBoxes = [],
      isLive = true,
      isPaused = false,
      onPause,
      streamUrl = null,
      liveDetectActive = false,
      perfStats = null,
    },
    ref
  ) {
    const imgRef = useRef<HTMLImageElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [useWebcam, setUseWebcam] = useState(false);
    const [localFile, setLocalFile] = useState<LocalFile | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const localFileUrlRef = useRef<string | null>(null);

    const revokeLocalFile = useCallback(() => {
      setLocalFile((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return null;
      });
    }, []);

    const hasActiveFeed = useCallback(() => {
      if (useWebcam || !!streamUrl) return true;
      if (localFile?.kind === 'video') return true;
      if (localFile?.kind === 'image') return true;
      return false;
    }, [useWebcam, streamUrl, localFile]);

    useImperativeHandle(
      ref,
      () => ({
        hasActiveFeed,
        captureFrame: async (maxSide = 960, quality = 0.82) => {
          const v = videoRef.current;
          const videoActive =
            (useWebcam || !!streamUrl || localFile?.kind === 'video') &&
            v &&
            (v.srcObject || v.src) &&
            v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            v.videoWidth > 0;
          if (videoActive && v) {
            return canvasSourceToJpegBlob(v, maxSide, quality);
          }
          const img = imgRef.current;
          if (img?.complete && img.naturalWidth > 0) {
            return canvasSourceToJpegBlob(img, maxSide, quality);
          }
          return Promise.reject(
            new Error('Add a photo or video, or open the camera, before running detection.')
          );
        },
      }),
      [useWebcam, streamUrl, localFile, hasActiveFeed]
    );

    useEffect(() => {
      localFileUrlRef.current = localFile?.url ?? null;
    }, [localFile]);

    const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;

      setUseWebcam(false);
      setLocalFile((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        const nextUrl = URL.createObjectURL(file);
        if (file.type.startsWith('video/')) return { kind: 'video', url: nextUrl };
        if (file.type.startsWith('image/')) return { kind: 'image', url: nextUrl };
        URL.revokeObjectURL(nextUrl);
        return null;
      });
    };

    const openCamera = () => {
      revokeLocalFile();
      setUseWebcam(true);
    };

    useEffect(() => {
      return () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        if (localFileUrlRef.current) URL.revokeObjectURL(localFileUrlRef.current);
      };
    }, []);

    useEffect(() => {
      if (!useWebcam) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
        return;
      }
      let cancelled = false;
      (async () => {
        try {
          const videoOpts = { width: { ideal: 1280 }, height: { ideal: 720 } };
          let stream: MediaStream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { ...videoOpts, facingMode: { ideal: 'user' } },
              audio: false,
            });
          } catch {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: { ...videoOpts, facingMode: { ideal: 'environment' } },
                audio: false,
              });
            } catch {
              stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            }
          }
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
          }
        } catch (err) {
          console.warn('Webcam unavailable:', err);
          setUseWebcam(false);
        }
      })();
      return () => {
        cancelled = true;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
    }, [useWebcam]);

    const videoSrcRemote = !useWebcam && localFile?.kind !== 'video' && streamUrl ? streamUrl : undefined;
    const isMjpegRemote =
      !!videoSrcRemote &&
      (videoSrcRemote.includes('/api/stream/mjpeg') ||
        videoSrcRemote.endsWith('.mjpeg') ||
        videoSrcRemote.endsWith('.mjpg'));
    const videoSrcFile = !useWebcam && localFile?.kind === 'video' ? localFile.url : undefined;

    useEffect(() => {
      const el = videoRef.current;
      if (!el) return;
      if (useWebcam) {
        el.removeAttribute('src');
        return;
      }
      if (videoSrcFile || (videoSrcRemote && !isMjpegRemote)) {
        el.srcObject = null;
        el.src = videoSrcFile || videoSrcRemote || '';
        el.loop = !!videoSrcFile;
        void el.play().catch(() => {});
      } else {
        el.removeAttribute('src');
        el.load();
      }
    }, [videoSrcFile, videoSrcRemote, isMjpegRemote, useWebcam]);

    const showVideo = useWebcam || !!videoSrcFile || (!!videoSrcRemote && !isMjpegRemote);
    const showImage = (!showVideo && localFile?.kind === 'image') || (!!videoSrcRemote && isMjpegRemote);
    const isEmpty = !showVideo && !showImage;
    const feedActive = !isEmpty;

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const getRenderedMediaRect = () => {
        const containerWidth = canvas.width;
        const containerHeight = canvas.height;
        if (containerWidth <= 0 || containerHeight <= 0) {
          return { x: 0, y: 0, width: 0, height: 0 };
        }

        const video = videoRef.current;
        const image = imgRef.current;
        const mediaWidth =
          (video && video.videoWidth > 0 ? video.videoWidth : 0) ||
          (image && image.naturalWidth > 0 ? image.naturalWidth : 0);
        const mediaHeight =
          (video && video.videoHeight > 0 ? video.videoHeight : 0) ||
          (image && image.naturalHeight > 0 ? image.naturalHeight : 0);

        if (!mediaWidth || !mediaHeight) {
          return { x: 0, y: 0, width: containerWidth, height: containerHeight };
        }

        // Match CSS object-contain so overlay aligns with visible content area.
        const scale = Math.min(containerWidth / mediaWidth, containerHeight / mediaHeight);
        const width = mediaWidth * scale;
        const height = mediaHeight * scale;
        const x = (containerWidth - width) / 2;
        const y = (containerHeight - height) / 2;
        return { x, y, width, height };
      };

      const resize = () => {
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const mediaRect = getRenderedMediaRect();

        boundingBoxes.forEach((box) => {
          const x = mediaRect.x + (box.x / 100) * mediaRect.width;
          const y = mediaRect.y + (box.y / 100) * mediaRect.height;
          const w = (box.width / 100) * mediaRect.width;
          const h = (box.height / 100) * mediaRect.height;

          ctx.strokeStyle = box.color;
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, w, h);

          const labelText =
            typeof box.confidence === 'number' && Number.isFinite(box.confidence)
              ? `${box.label} ${(box.confidence * 100).toFixed(0)}%`
              : box.label;

          ctx.font = '12px system-ui, sans-serif';
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeText(labelText, x, y - 4);
          ctx.fillStyle = box.color;
          ctx.lineWidth = 1;
          ctx.fillText(labelText, x, y - 4);
        });
      };

      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      const raf = window.setInterval(resize, 250);

      return () => {
        observer.disconnect();
        window.clearInterval(raf);
      };
    }, [boundingBoxes]);

    const toggleFullscreen = () => {
      if (!containerRef.current) return;
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen?.();
        setIsFullscreen(true);
      } else {
        document.exitFullscreen?.();
        setIsFullscreen(false);
      }
    };

    useEffect(() => {
      const handler = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener('fullscreenchange', handler);
      return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    return (
      <div className="flex flex-col flex-1 min-w-0">
        <div
          ref={containerRef}
          className="relative aspect-video bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800"
        >
          {isLive && feedActive && (
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-2 py-1 bg-red-500/90 rounded text-white text-xs font-medium">
              <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
              LIVE
              {liveDetectActive && (
                <span className="ml-1 pl-2 border-l border-white/40 font-normal opacity-95">
                  DETECT
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={toggleFullscreen}
            className="absolute top-3 right-3 z-10 p-2 bg-zinc-800/80 hover:bg-zinc-700/80 rounded-lg text-white transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>

          {perfStats && (
            <div className="absolute top-3 right-14 z-10 bg-black/65 rounded-lg px-3 py-2 text-[11px] text-zinc-200 font-mono leading-tight">
              <div>
                cpu: <span className="text-zinc-100">{perfStats.cpu_percent?.toFixed(1) ?? '--'}</span>% | gpu:{' '}
                <span className="text-zinc-100">{perfStats.gpu_percent?.toFixed(1) ?? '--'}</span>%
              </div>
              <div>
                cuda_mem: <span className="text-zinc-100">{perfStats.gpu_cuda_memory_percent?.toFixed(1) ?? '--'}</span>% (
                <span className="text-zinc-100">{perfStats.gpu_cuda_memory_used_mb?.toFixed(0) ?? '--'}</span>/
                <span className="text-zinc-100">{perfStats.gpu_cuda_memory_total_mb?.toFixed(0) ?? '--'}</span> MB)
              </div>
              <div>
                stream: <span className="text-zinc-100">{perfStats.stream_fps.toFixed(1)}</span> fps
              </div>
              <div>
                vlm: <span className="text-zinc-100">{perfStats.vlm.avg_ms.toFixed(0)}</span> ms
              </div>
              <div>
                detect: <span className="text-zinc-100">{perfStats.detect.est_fps.toFixed(1)}</span> fps
              </div>
            </div>
          )}

          <div className="absolute inset-0">
            {isEmpty && (
              <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-6 px-6 text-center bg-zinc-900/95">
                <div>
                  <p className="text-zinc-100 text-base font-medium">
                    Add a photo or video to scan
                  </p>
                  <p className="text-zinc-500 text-sm mt-2 max-w-sm mx-auto">
                    Or open your camera to use a live feed. Detection uses whatever is showing here.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    className="sr-only"
                    onChange={onPickFile}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-zinc-100 text-zinc-900 text-sm font-medium hover:bg-white transition-colors"
                  >
                    <Upload size={18} />
                    Choose file
                  </button>
                  <button
                    type="button"
                    onClick={openCamera}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-500 transition-colors"
                  >
                    <Video size={18} />
                    Open camera
                  </button>
                </div>
              </div>
            )}

            <img
              ref={imgRef}
              src={
                showImage
                  ? localFile?.kind === 'image'
                    ? localFile.url
                    : videoSrcRemote
                  : undefined
              }
              alt={showImage ? (localFile?.kind === 'image' ? 'Uploaded image' : 'Live stream') : ''}
              className={`w-full h-full object-contain bg-black ${showImage && !isPaused ? '' : 'hidden'} ${isPaused ? 'opacity-80' : ''}`}
            />
            <video
              ref={videoRef}
              className={`w-full h-full object-contain bg-black ${showVideo && !isPaused ? '' : 'hidden'} ${isPaused ? 'opacity-80' : ''}`}
              playsInline
              muted
              autoPlay
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ mixBlendMode: 'normal' }}
            />
          </div>

          <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
            {feedActive && (
              <span className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white">
                <Radar size={18} />
                Live detect on
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                if (useWebcam) {
                  setUseWebcam(false);
                } else {
                  openCamera();
                }
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                useWebcam
                  ? 'bg-sky-600 hover:bg-sky-500 text-white'
                  : 'bg-zinc-800/90 hover:bg-zinc-700 text-white'
              }`}
              aria-pressed={useWebcam}
              title={useWebcam ? 'Turn camera off' : 'Use device camera'}
            >
              {useWebcam ? <Video size={18} /> : <VideoOff size={18} />}
              {useWebcam ? 'Camera on' : 'Camera'}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-2 bg-white/90 hover:bg-white text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
              onClick={() => fileInputRef.current?.click()}
              title="Upload another image or video"
            >
              <Upload size={18} />
              Upload
            </button>
            <button
              type="button"
              className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
              onClick={onPause}
              disabled={!feedActive}
            >
              {isPaused ? <Play size={18} /> : <Pause size={18} />}
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
          <span
            className={`w-2 h-2 rounded-full ${feedActive && !isPaused ? 'bg-green-500' : 'bg-zinc-500'}`}
          />
          {isEmpty
            ? 'No source — upload or open camera'
            : isPaused
              ? 'Paused'
              : useWebcam
                ? 'Webcam'
                : localFile?.kind === 'video'
                  ? 'Video file'
                  : localFile?.kind === 'image'
                    ? 'Image'
                    : 'Stream'}
        </div>
      </div>
    );
  }
);

import { useRef, useEffect, useState } from 'react';
import { Maximize2, Minimize2, Pause, Play } from 'lucide-react';
import type { Telemetry, BoundingBox } from '../types';
import { MOCK_TELEMETRY } from '../data/mock';
import droneImage from '../assets/drone-image.jpg';

interface VideoPanelProps {
  telemetry?: Telemetry;
  boundingBoxes?: BoundingBox[];
  isLive?: boolean;
  isPaused?: boolean;
  onPause?: () => void;
}

export function VideoPanel({
  telemetry = MOCK_TELEMETRY,
  boundingBoxes = [], // Pass MOCK_BOUNDING_BOXES to show detection boxes
  isLive = true,
  isPaused = false,
  onPause,
}: VideoPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const getBatteryColor = (battery: number) => {
    if (battery <= 20) return 'text-red-400';
    if (battery <= 50) return 'text-yellow-400';
    return 'text-green-400';
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      boundingBoxes.forEach((box) => {
        const x = (box.x / 100) * canvas.width;
        const y = (box.y / 100) * canvas.height;
        const w = (box.width / 100) * canvas.width;
        const h = (box.height / 100) * canvas.height;

        ctx.strokeStyle = box.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        ctx.fillStyle = box.color;
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(box.label, x, y - 4);
      });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => observer.disconnect();
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
        className="relative aspect-video bg-zinc-950 rounded-lg overflow-hidden"
      >
        {isLive && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-2 py-1 bg-red-500/90 rounded text-white text-xs font-medium">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            LIVE
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

        <div className="absolute inset-0">
          <img
            src={droneImage}
            alt="Drone live feed"
            className={`w-full h-full object-cover ${isPaused ? 'opacity-80' : ''}`}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ mixBlendMode: 'normal' }}
          />
        </div>

        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-4 px-3 py-2 bg-black/60 rounded-lg text-white text-sm">
          <span>Alt: {telemetry.altitude}m</span>
          <span>Speed: {telemetry.speed} m/s</span>
          <span>
            Battery: <span className={getBatteryColor(telemetry.battery)}>{telemetry.battery}%</span>
          </span>
        </div>

        <button
          type="button"
          className="absolute bottom-3 right-3 z-10 flex items-center gap-2 px-4 py-2 bg-white hover:bg-zinc-100 text-zinc-900 rounded-lg text-sm font-medium transition-colors"
          onClick={onPause}
        >
          {isPaused ? <Play size={18} /> : <Pause size={18} />}
          {isPaused ? 'Resume' : 'Pause'}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
        <span
          className={`w-2 h-2 rounded-full ${isLive && !isPaused ? 'bg-green-500' : 'bg-zinc-500'}`}
        />
        Live Stream Active
      </div>
    </div>
  );
}

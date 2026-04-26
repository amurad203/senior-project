import { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './components/Header';
import { VideoPanel, type VideoFeedCapture } from './components/VideoPanel';
import { CommandConsole } from './components/CommandConsole';
import type { BoundingBox } from './types';
import { postVlm } from './api/vlm';
import { getStreamStatus, startStream, stopStream } from './api/stream';
import { getPerfStats, type PerfStats } from './api/perf';
import { getHealth } from './api/health';

/** Throttle: vision models are heavy; tune vs latency (ms between frames). */
const DEFAULT_LIVE_DETECT_INTERVAL_MS = 60;
/** Smaller JPEG for faster upload on live path */
const LIVE_CAPTURE_MAX_SIDE = 640;
const DEFAULT_MODELS = [
  'yolov8n-worldv2.pt',
  'yolov8s-worldv2.pt',
  'yolov8m-worldv2.pt',
  'yolov8l-worldv2.pt',
  'yolov8x-worldv2.pt',
];

type ScenarioPreset = {
  id: string;
  label: string;
  prompt: string;
  source:
    | { type: 'built_in'; scenarioId: string }
    | { type: 'media'; mediaKind: 'image' | 'video'; mediaUrl: string };
};

const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'traffic',
    label: 'Traffic (Demo)',
    prompt: 'car, bus, truck, motorcycle, person',
    source: { type: 'built_in', scenarioId: 'traffic' },
  },
  {
    id: 'warehouse',
    label: 'Warehouse (Demo)',
    prompt: 'person, forklift, pallet, box',
    source: { type: 'built_in', scenarioId: 'warehouse' },
  },
  {
    id: 'runway',
    label: 'Airport Runway (Demo)',
    prompt: 'airplane, vehicle, person',
    source: { type: 'built_in', scenarioId: 'runway' },
  },
  {
    id: 'marine',
    label: 'Marine Port (Demo)',
    prompt: 'boat, ship, container, person',
    source: { type: 'built_in', scenarioId: 'marine' },
  },
];
type UiNotification = {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  unread: boolean;
};

function App() {
  const [isPaused, setIsPaused] = useState(false);
  const [boundingBoxes, setBoundingBoxes] = useState<BoundingBox[]>([]);
  const feedRef = useRef<VideoFeedCapture | null>(null);
  /** Detection targets; chat commands refresh this for the live loop */
  const [detectionPrompt, setDetectionPrompt] = useState('');
  /** Sent as `box_threshold` to the API (YOLO confidence). Lower → more boxes. */
  const [boxThreshold, setBoxThreshold] = useState(0.15);
  const [selectedModel, setSelectedModel] = useState('yolov8m-worldv2.pt');
  const [modelOptions, setModelOptions] = useState<string[]>(DEFAULT_MODELS);
  const [liveDetectIntervalMs, setLiveDetectIntervalMs] = useState(DEFAULT_LIVE_DETECT_INTERVAL_MS);
  const [tileGrid, setTileGrid] = useState(1);
  const [streamUrlInput, setStreamUrlInput] = useState('');
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamConnecting, setStreamConnecting] = useState(false);
  const [streamFps, setStreamFps] = useState(0);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<UiNotification[]>([]);
  const [perfStats, setPerfStats] = useState<PerfStats | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(
    typeof import.meta.env.VITE_STREAM_URL === 'string' && import.meta.env.VITE_STREAM_URL.trim()
      ? import.meta.env.VITE_STREAM_URL.trim()
      : null
  );
  const activeModel = 'yolo_world' as const;
  const busyRef = useRef(false);
  const prevStreamConnectedRef = useRef(false);

  const pushNotification = useCallback((title: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setNotifications((prev) => [{ id, title, message, timestamp, unread: true }, ...prev].slice(0, 30));
  }, []);

  const handleSendCommand = useCallback(async (command: string) => {
    const cap = feedRef.current;
    if (!cap || !cap.hasActiveFeed()) {
      throw new Error('Add a photo or video, or open the camera, before sending a command.');
    }
    const trimmed = command.trim();
    if (!trimmed) {
      throw new Error('Enter a detection prompt first (for example: person, car).');
    }
    setDetectionPrompt(trimmed);
    const blob = await cap.captureFrame(1280, 0.88);
    const data = await postVlm(
      blob,
      trimmed,
      boxThreshold,
      selectedModel,
      tileGrid
    );
    setBoundingBoxes(data.boxes);
    return data.response;
  }, [boxThreshold, selectedModel, tileGrid]);

  useEffect(() => {
    if (isPaused) {
      return;
    }
    const tick = async () => {
      if (busyRef.current) return;
      const cap = feedRef.current;
      if (!cap?.hasActiveFeed()) return;
      const prompt = detectionPrompt.trim();
      if (!prompt) return;
      busyRef.current = true;
      try {
        const blob = await cap.captureFrame(LIVE_CAPTURE_MAX_SIDE, 0.72);
        const data = await postVlm(
          blob,
          prompt,
          boxThreshold,
          selectedModel,
          tileGrid
        );
        setBoundingBoxes(data.boxes);
      } catch (e) {
        console.warn('Live detection frame skipped:', e);
      } finally {
        busyRef.current = false;
      }
    };
    const id = window.setInterval(tick, liveDetectIntervalMs);
    void tick();
    return () => clearInterval(id);
  }, [isPaused, detectionPrompt, boxThreshold, selectedModel, tileGrid, liveDetectIntervalMs]);

  useEffect(() => {
    let cancelled = false;
    const loadHealth = async () => {
      try {
        const health = await getHealth();
        const supported = health.yolo_world?.supported_models ?? [];
        if (!cancelled && supported.length > 0) {
          setModelOptions(supported);
          setSelectedModel((prev) => (supported.includes(prev) ? prev : supported[0]));
        }
      } catch (e) {
        console.warn('Unable to load supported models from backend health:', e);
      }
    };
    void loadHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshStreamStatus = useCallback(async () => {
    try {
      const s = await getStreamStatus();
      setStreamConnected(s.running && s.has_frame);
      setStreamFps(s.fps || 0);
      setStreamError(s.last_error ?? null);
      if (s.running && s.preview_url) {
        setStreamUrl('/api/stream/mjpeg');
      } else if (!s.running) {
        setStreamUrl(
          typeof import.meta.env.VITE_STREAM_URL === 'string' && import.meta.env.VITE_STREAM_URL.trim()
            ? import.meta.env.VITE_STREAM_URL.trim()
            : null
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStreamConnected(false);
      setStreamError(msg);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshStreamStatus();
    }, 1500);
    void refreshStreamStatus();
    return () => clearInterval(id);
  }, [refreshStreamStatus]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getPerfStats();
        if (!cancelled) setPerfStats(next);
      } catch {
        if (!cancelled) setPerfStats(null);
      }
    };
    const id = window.setInterval(() => {
      void poll();
    }, 1500);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (prevStreamConnectedRef.current !== streamConnected) {
      if (streamConnected) {
        pushNotification('Stream connected', `Live stream active at ${streamFps.toFixed(1)} fps.`);
      } else if (!streamConnecting) {
        pushNotification('Stream disconnected', 'Live stream is no longer active.');
      }
      prevStreamConnectedRef.current = streamConnected;
    }
  }, [streamConnected, streamConnecting, streamFps, pushNotification]);

  const handleConnectStream = useCallback(async () => {
    const url = streamUrlInput.trim();
    if (!url) throw new Error('Enter a stream URL first.');
    setStreamConnecting(true);
    try {
      await startStream(url);
      setStreamError(null);
      await refreshStreamStatus();
      pushNotification('Connecting stream', `Attempting to connect: ${url}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushNotification('Stream connection failed', msg);
      throw e;
    } finally {
      setStreamConnecting(false);
    }
  }, [streamUrlInput, refreshStreamStatus, pushNotification]);

  const handleDisconnectStream = useCallback(async () => {
    await stopStream();
    setStreamConnected(false);
    setStreamFps(0);
    setStreamError(null);
    await refreshStreamStatus();
    pushNotification('Stream stopped', 'Stream was disconnected from settings.');
  }, [refreshStreamStatus, pushNotification]);

  const handleThresholdChange = useCallback((value: number) => {
    setBoxThreshold(value);
    pushNotification('Threshold updated', `Detection threshold set to ${value.toFixed(2)}.`);
  }, [pushNotification]);

  const handleModelChange = useCallback((value: string) => {
    setSelectedModel(value);
    pushNotification('Model updated', `YOLO model changed to ${value}.`);
  }, [pushNotification]);

  const handleTileGridChange = useCallback((value: number) => {
    setTileGrid(value);
    pushNotification('Tiling updated', `Detection tiling set to ${value}x${value}.`);
  }, [pushNotification]);

  const handleLiveDetectIntervalChange = useCallback((value: number) => {
    setLiveDetectIntervalMs(value);
    pushNotification('Live interval updated', `Live detect interval set to ${value} ms.`);
  }, [pushNotification]);

  const markNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
  }, []);

  const handleSelectScenario = useCallback((scenario: ScenarioPreset) => {
    const cap = feedRef.current;
    if (!cap) return;
    if (scenario.source.type === 'built_in') {
      cap.loadScenario(scenario.source.scenarioId);
    } else {
      cap.loadScenarioMedia(scenario.source.mediaKind, scenario.source.mediaUrl);
    }
    setDetectionPrompt(scenario.prompt);
    setIsPaused(false);
    pushNotification('Scenario selected', `${scenario.label} loaded with prompt: ${scenario.prompt}`);
  }, [pushNotification]);

  return (
    <div className="h-dvh flex flex-col bg-zinc-950 text-white overflow-hidden">
      <div className="shrink-0">
        <Header
          boxThreshold={boxThreshold}
          onBoxThresholdChange={handleThresholdChange}
          selectedModel={selectedModel}
          modelOptions={modelOptions}
          onSelectedModelChange={handleModelChange}
          liveDetectIntervalMs={liveDetectIntervalMs}
          onLiveDetectIntervalChange={handleLiveDetectIntervalChange}
          tileGrid={tileGrid}
          onTileGridChange={handleTileGridChange}
          streamUrlInput={streamUrlInput}
          onStreamUrlInputChange={setStreamUrlInput}
          onConnectStream={handleConnectStream}
          onDisconnectStream={handleDisconnectStream}
          streamConnected={streamConnected}
          streamConnecting={streamConnecting}
          streamFps={streamFps}
          streamError={streamError}
          notifications={notifications}
          onMarkNotificationsRead={markNotificationsRead}
          perfStats={perfStats}
        />
      </div>

      <main className="flex-1 flex min-h-0 flex-col lg:flex-row p-4 gap-4 overflow-hidden lg:items-stretch">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col min-h-[260px]">
          <VideoPanel
            ref={feedRef}
            boundingBoxes={boundingBoxes}
            isPaused={isPaused}
            onPause={() => setIsPaused((p) => !p)}
            streamUrl={streamUrl}
            liveDetectActive
            perfStats={perfStats}
          />
        </div>
        <div className="w-full lg:min-w-[380px] lg:max-w-md shrink-0 min-h-[320px] flex flex-col h-[min(420px,52dvh)] lg:h-full">
          <CommandConsole
            onSendCommand={handleSendCommand}
            activeModel={activeModel}
          />
        </div>
      </main>

      <section className="shrink-0 border-t border-zinc-800 px-4 py-3 bg-zinc-950/90">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-100">Scenario Presets</h3>
            <span className="text-xs text-zinc-400">Pick a built-in scene or your predefined videos</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {SCENARIO_PRESETS.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                onClick={() => handleSelectScenario(scenario)}
                className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-100 text-sm transition-colors"
                title={scenario.prompt}
              >
                {scenario.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/*
        True multi-viewer broadcast is out of band here: publish the drone feed with WebRTC (e.g. WHIP/WHEP),
        RTMP→HLS, or an MJPEG proxy, then point VITE_STREAM_URL at that URL or use the webcam path for bench demos.
      */}
    </div>
  );
}

export default App;

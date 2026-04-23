import { useState, useRef, useEffect } from 'react';
import { Bell, Settings } from 'lucide-react';
import type { PerfStats } from '../api/perf';

type DropdownType = 'notifications' | 'settings' | null;
type HeaderNotification = {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  unread: boolean;
};
interface HeaderProps {
  boxThreshold: number;
  onBoxThresholdChange: (value: number) => void;
  selectedModel: string;
  modelOptions: string[];
  onSelectedModelChange: (value: string) => void;
  liveDetectIntervalMs: number;
  onLiveDetectIntervalChange: (value: number) => void;
  tileGrid: number;
  onTileGridChange: (value: number) => void;
  streamUrlInput: string;
  onStreamUrlInputChange: (value: string) => void;
  onConnectStream: () => Promise<void>;
  onDisconnectStream: () => Promise<void>;
  streamConnected: boolean;
  streamConnecting: boolean;
  streamFps: number;
  streamError: string | null;
  notifications: HeaderNotification[];
  onMarkNotificationsRead: () => void;
  perfStats: PerfStats | null;
}

export function Header({
  boxThreshold,
  onBoxThresholdChange,
  selectedModel,
  modelOptions,
  onSelectedModelChange,
  liveDetectIntervalMs,
  onLiveDetectIntervalChange,
  tileGrid,
  onTileGridChange,
  streamUrlInput,
  onStreamUrlInputChange,
  onConnectStream,
  onDisconnectStream,
  streamConnected,
  streamConnecting,
  streamFps,
  streamError,
  notifications,
  onMarkNotificationsRead,
  perfStats,
}: HeaderProps) {
  const [openDropdown, setOpenDropdown] = useState<DropdownType>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenDropdown(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const toggleDropdown = (type: DropdownType) => {
    setOpenDropdown((prev) => {
      const next = prev === type ? null : type;
      if (next === 'notifications') {
        onMarkNotificationsRead();
      }
      return next;
    });
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-zinc-900 border-b border-zinc-800">
      <h1 className="text-lg font-medium text-white">
        Small VLMs for Zero-Shot Object Recognition
      </h1>
      <div ref={dropdownRef} className="flex items-center gap-1 relative">
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown('notifications')}
            className={`p-2 rounded-lg transition-colors ${
              openDropdown === 'notifications'
                ? 'text-white bg-zinc-700'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
            aria-label="Notifications"
            aria-expanded={openDropdown === 'notifications'}
          >
            <Bell size={20} />
            {notifications.some((n) => n.unread) ? (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full" />
            ) : null}
          </button>
          {openDropdown === 'notifications' && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-700">
                <h3 className="font-medium text-white">Notifications</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Stream and setting changes</p>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-zinc-500">No notifications yet.</p>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`px-4 py-3 border-b border-zinc-700/50 last:border-0 ${
                        n.unread ? 'bg-zinc-700/20' : ''
                      }`}
                    >
                      <p className="text-sm font-medium text-white">{n.title}</p>
                      <p className="text-xs text-zinc-300 mt-1">{n.message}</p>
                      <p className="text-[11px] text-zinc-500 mt-1">{n.timestamp}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        {/* Settings */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleDropdown('settings')}
            className={`p-2 rounded-lg transition-colors ${
              openDropdown === 'settings'
                ? 'text-white bg-zinc-700'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
            aria-label="Settings"
            aria-expanded={openDropdown === 'settings'}
          >
            <Settings size={20} />
          </button>
          {openDropdown === 'settings' && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-700">
                <h3 className="font-medium text-white">Settings</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Detection + stream controls</p>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-zinc-400 mb-1.5">
                    <label htmlFor="header-box-threshold">Detection threshold</label>
                    <span className="tabular-nums text-zinc-300">{boxThreshold.toFixed(2)}</span>
                  </div>
                  <input
                    id="header-box-threshold"
                    type="range"
                    min={0.05}
                    max={0.9}
                    step={0.01}
                    value={boxThreshold}
                    onChange={(e) => onBoxThresholdChange(Number(e.target.value))}
                    className="w-full h-2 accent-blue-500 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                <div>
                  <label htmlFor="header-model-select" className="block text-xs text-zinc-400 mb-1.5">
                    YOLO-World model
                  </label>
                  <select
                    id="header-model-select"
                    value={selectedModel}
                    onChange={(e) => onSelectedModelChange(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-zinc-400 mb-1.5">
                    <label htmlFor="header-live-interval">Live detect interval</label>
                    <span className="tabular-nums text-zinc-300">{liveDetectIntervalMs} ms</span>
                  </div>
                  <input
                    id="header-live-interval"
                    type="range"
                    min={30}
                    max={500}
                    step={10}
                    value={liveDetectIntervalMs}
                    onChange={(e) => onLiveDetectIntervalChange(Number(e.target.value))}
                    className="w-full h-2 accent-blue-500 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                <div>
                  <label htmlFor="header-tile-grid" className="block text-xs text-zinc-400 mb-1.5">
                    Tiling grid
                  </label>
                  <select
                    id="header-tile-grid"
                    value={tileGrid}
                    onChange={(e) => onTileGridChange(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={1}>1x1 (off)</option>
                    <option value={2}>2x2</option>
                    <option value={3}>3x3</option>
                    <option value={4}>4x4</option>
                  </select>
                </div>
                <div className="border border-zinc-700 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="header-stream-url" className="text-xs text-zinc-400">
                      Stream URL
                    </label>
                    <span
                      className={`text-[11px] ${
                        streamConnected
                          ? 'text-emerald-400'
                          : streamConnecting
                            ? 'text-amber-300'
                            : 'text-zinc-500'
                      }`}
                    >
                      {streamConnected
                        ? `Connected (${streamFps.toFixed(1)} fps)`
                        : streamConnecting
                          ? 'Connecting...'
                          : 'Disconnected'}
                    </span>
                  </div>
                  <input
                    id="header-stream-url"
                    type="text"
                    value={streamUrlInput}
                    onChange={(e) => onStreamUrlInputChange(e.target.value)}
                    placeholder="rtsp://... or rtmp://..."
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void onConnectStream()}
                      disabled={streamConnecting}
                      className="px-3 py-2 rounded-lg text-sm bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {streamConnecting ? 'Connecting...' : 'Connect'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDisconnectStream()}
                      disabled={streamConnecting}
                      className="px-3 py-2 rounded-lg text-sm bg-zinc-700 hover:bg-zinc-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Disconnect
                    </button>
                  </div>
                  {streamError ? <p className="text-[11px] text-amber-400">{streamError}</p> : null}
                </div>
                <div className="border border-zinc-700 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-zinc-400">Performance metrics</p>
                  {perfStats ? (
                    <div className="space-y-1 text-[11px] text-zinc-300 font-mono">
                      <p>
                        cpu: <span className="text-zinc-100">{perfStats.cpu_percent?.toFixed(1) ?? '--'}</span>% | gpu:{' '}
                        <span className="text-zinc-100">{perfStats.gpu_percent?.toFixed(1) ?? '--'}</span>%
                      </p>
                      <p>
                        cuda_mem: <span className="text-zinc-100">{perfStats.gpu_cuda_memory_percent?.toFixed(1) ?? '--'}</span>% (
                        <span className="text-zinc-100">{perfStats.gpu_cuda_memory_used_mb?.toFixed(0) ?? '--'}</span>/
                        <span className="text-zinc-100">{perfStats.gpu_cuda_memory_total_mb?.toFixed(0) ?? '--'}</span> MB)
                      </p>
                      <p>
                        stream_fps: <span className="text-zinc-100">{perfStats.stream_fps.toFixed(1)}</span>
                      </p>
                      <p>
                        vlm_ms(avg): <span className="text-zinc-100">{perfStats.vlm.avg_ms.toFixed(1)}</span>{' '}
                        | vlm_fps(est): <span className="text-zinc-100">{perfStats.vlm.est_fps.toFixed(1)}</span>
                      </p>
                      <p>
                        detect_ms(avg): <span className="text-zinc-100">{perfStats.detect.avg_ms.toFixed(1)}</span>{' '}
                        | detect_fps(est): <span className="text-zinc-100">{perfStats.detect.est_fps.toFixed(1)}</span>
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500">Metrics unavailable</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

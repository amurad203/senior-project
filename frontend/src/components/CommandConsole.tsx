import { useState, useRef, useEffect } from 'react';
import { Send, MessageCircle } from 'lucide-react';
import type { Message } from '../types';

interface CommandConsoleProps {
  messages?: Message[];
  /** If set, awaited for each send; return text shown as system reply. */
  onSendCommand?: (command: string) => Promise<string>;
  /** 0–1 detection score cutoff; lower returns more boxes (more false positives). */
  boxThreshold?: number;
  onBoxThresholdChange?: (value: number) => void;
  activeModel?: 'yolo_world' | null;
  selectedModel?: string;
  onSelectedModelChange?: (value: string) => void;
  tileGrid?: number;
  onTileGridChange?: (value: number) => void;
  streamUrlInput?: string;
  onStreamUrlInputChange?: (value: string) => void;
  onConnectStream?: () => Promise<void>;
  onDisconnectStream?: () => Promise<void>;
  streamConnected?: boolean;
  streamFps?: number;
  streamError?: string | null;
}

export function CommandConsole({
  messages = [],
  onSendCommand,
  boxThreshold,
  onBoxThresholdChange,
  activeModel = null,
  selectedModel = 'yolov8m-worldv2.pt',
  onSelectedModelChange,
  tileGrid = 1,
  onTileGridChange,
  streamUrlInput = '',
  onStreamUrlInputChange,
  onConnectStream,
  onDisconnectStream,
  streamConnected = false,
  streamFps = 0,
  streamError = null,
}: CommandConsoleProps) {
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[]>(messages);
  const [isLoading, setIsLoading] = useState(false);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const scrollToBottom = () => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [localMessages, isLoading]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    setLocalMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const ts = () =>
      new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

    try {
      let content: string;
      if (onSendCommand) {
        content = await onSendCommand(trimmed);
      } else {
        await new Promise((r) => setTimeout(r, 600));
        content =
          'No API handler wired. Start the server (see project README) and refresh.';
      }
      setLocalMessages((prev) => [
        ...prev,
        {
          id: `system-${Date.now()}`,
          role: 'system',
          content,
          timestamp: ts(),
        },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalMessages((prev) => [
        ...prev,
        {
          id: `system-${Date.now()}`,
          role: 'system',
          content: `Error: ${msg}`,
          timestamp: ts(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const isEmpty = localMessages.length === 0 && !isLoading;
  const modelLabel = activeModel === 'yolo_world' ? 'YOLO-World' : 'Unknown';

  return (
    <div className="flex flex-col w-full h-full min-h-0 max-w-md bg-zinc-900 border-t lg:border-t-0 lg:border-l border-zinc-800 rounded-lg lg:rounded-l-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium text-white">Command Console</h2>
          <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
            Model: {modelLabel}
          </span>
        </div>
        <p className="text-sm text-zinc-400 mt-0.5">
          Sends the current frame with your prompt.{' '}
          <kbd className="text-xs px-1.5 py-0.5 bg-zinc-700 rounded text-zinc-300">⌘K</kbd>{' '}
          to focus
        </p>
      </div>

      <div
        ref={messagesScrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-4 space-y-4 [scrollbar-gutter:stable]"
      >
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center min-h-[200px] h-full text-center text-zinc-500">
            <MessageCircle size={48} className="mb-3 opacity-50" />
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1">Type a command below to get started</p>
          </div>
        ) : (
          <>
        {localMessages.map((msg) =>
          msg.role === 'user' ? (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg px-4 py-2 bg-blue-600 text-white">
                <p className="text-sm break-words whitespace-pre-wrap">{msg.content}</p>
                <span className="text-xs text-blue-200 mt-1 block">
                  {msg.timestamp}
                </span>
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex justify-start gap-2">
              <span className="text-zinc-500 text-sm mt-1">&#62;_</span>
              <div className="max-w-[85%] rounded-lg px-4 py-2 bg-zinc-800 text-zinc-200">
                <p className="text-sm break-words whitespace-pre-wrap">{msg.content}</p>
                <span className="text-xs text-zinc-500 mt-1 block">
                  {msg.timestamp}
                </span>
              </div>
            </div>
          )
        )}
        {isLoading && (
          <div className="flex justify-start gap-2">
            <span className="text-zinc-500 text-sm mt-1">&#62;_</span>
            <div className="px-4 py-2 bg-zinc-800 rounded-lg flex items-center gap-2">
              <span className="flex gap-1">
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
              <span className="text-sm text-zinc-400">Running detection…</span>
            </div>
          </div>
        )}
          </>
        )}
      </div>

      <div className="p-4 border-t border-zinc-800 flex-shrink-0 space-y-3">
        {boxThreshold != null && onBoxThresholdChange && (
          <div>
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-400 mb-1.5">
              <label htmlFor="box-threshold">Detection threshold</label>
              <span className="tabular-nums text-zinc-300">{boxThreshold.toFixed(2)}</span>
            </div>
            <input
              id="box-threshold"
              type="range"
              min={0.05}
              max={0.9}
              step={0.01}
              value={boxThreshold}
              onChange={(e) => onBoxThresholdChange(Number(e.target.value))}
              className="w-full h-2 accent-blue-500 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Lower → more detections; higher → stricter. Matches server{' '}
              <code className="text-zinc-400">box_threshold</code>.
            </p>
          </div>
        )}
        {onSelectedModelChange && (
          <div>
            <label htmlFor="model-select" className="block text-xs text-zinc-400 mb-1.5">
              YOLO-World model
            </label>
            <select
              id="model-select"
              value={selectedModel}
              onChange={(e) => onSelectedModelChange(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="yolov8s-worldv2.pt">yolov8s-worldv2.pt (fastest)</option>
              <option value="yolov8m-worldv2.pt">yolov8m-worldv2.pt (balanced)</option>
              <option value="yolov8l-worldv2.pt">yolov8l-worldv2.pt (stronger)</option>
              <option value="yolov8x-worldv2.pt">yolov8x-worldv2.pt (strongest)</option>
            </select>
          </div>
        )}
        {onTileGridChange && (
          <div>
            <label htmlFor="tile-grid" className="block text-xs text-zinc-400 mb-1.5">
              Tiling grid
            </label>
            <select
              id="tile-grid"
              value={tileGrid}
              onChange={(e) => onTileGridChange(Number(e.target.value))}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={1}>1x1 (off)</option>
              <option value={2}>2x2</option>
              <option value={3}>3x3</option>
              <option value={4}>4x4</option>
            </select>
            <p className="text-[11px] text-zinc-500 mt-1">
              More tiles increase recall for tiny objects but are slower.
            </p>
          </div>
        )}
        {(onStreamUrlInputChange || onConnectStream || onDisconnectStream) && (
          <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="stream-url" className="block text-xs text-zinc-400">
                Drone stream URL (RTSP/RTMP/HTTP)
              </label>
              <span
                className={`text-[11px] ${
                  streamConnected ? 'text-emerald-400' : 'text-zinc-500'
                }`}
              >
                {streamConnected ? `Connected (${streamFps.toFixed(1)} fps)` : 'Disconnected'}
              </span>
            </div>
            <input
              id="stream-url"
              type="text"
              value={streamUrlInput}
              onChange={(e) => onStreamUrlInputChange?.(e.target.value)}
              placeholder="rtsp://... or rtmp://..."
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void onConnectStream?.()}
                className="px-3 py-2 rounded-lg text-sm bg-sky-600 hover:bg-sky-500 text-white"
              >
                Connect stream
              </button>
              <button
                type="button"
                onClick={() => void onDisconnectStream?.()}
                className="px-3 py-2 rounded-lg text-sm bg-zinc-700 hover:bg-zinc-600 text-white"
              >
                Disconnect
              </button>
            </div>
            {streamError ? <p className="text-[11px] text-amber-400">{streamError}</p> : null}
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleSend()}
            placeholder="e.g. car, truck, person"
            disabled={isLoading}
            className="flex-1 px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={isLoading}
            className="p-3 bg-blue-600 hover:bg-blue-500 rounded-full text-white transition-colors disabled:opacity-50"
            aria-label="Send"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

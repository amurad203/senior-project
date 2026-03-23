import { useState, useRef, useEffect } from 'react';
import { Send, MessageCircle } from 'lucide-react';
import type { Message } from '../types';
import { MOCK_MESSAGES } from '../data/mock';

interface CommandConsoleProps {
  messages?: Message[];
  onSendCommand?: (command: string) => void;
}

export function CommandConsole({
  messages = MOCK_MESSAGES,
  onSendCommand,
}: CommandConsoleProps) {
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[]>(messages);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [localMessages, isLoading]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

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
    onSendCommand?.(trimmed);
    setInput('');
    setIsLoading(true);

    // Mock system response
    setTimeout(() => {
      const systemMessage: Message = {
        id: `system-${Date.now()}`,
        role: 'system',
        content: 'Command received. Processing with VLM... (Backend not connected)',
        timestamp: new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      setLocalMessages((prev) => [...prev, systemMessage]);
      setIsLoading(false);
    }, 800);
  };

  const isEmpty = localMessages.length === 0 && !isLoading;

  return (
    <div className="flex flex-col w-full max-w-md bg-zinc-900 border-t lg:border-t-0 lg:border-l border-zinc-800 h-full min-h-0 rounded-lg lg:rounded-l-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <h2 className="text-base font-medium text-white">Command Console</h2>
        <p className="text-sm text-zinc-400 mt-0.5">
          Send commands to your drone. <kbd className="text-xs px-1.5 py-0.5 bg-zinc-700 rounded text-zinc-300">⌘K</kbd> to focus
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center text-zinc-500">
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
                <p className="text-sm">{msg.content}</p>
                <span className="text-xs text-blue-200 mt-1 block">
                  {msg.timestamp}
                </span>
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex justify-start gap-2">
              <span className="text-zinc-500 text-sm mt-1">&#62;_</span>
              <div className="max-w-[85%] rounded-lg px-4 py-2 bg-zinc-800 text-zinc-200">
                <p className="text-sm">{msg.content}</p>
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
              <span className="text-sm text-zinc-400">VLM processing...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div className="p-4 border-t border-zinc-800 flex-shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Enter drone command..."
            className="flex-1 px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={handleSend}
            className="p-3 bg-blue-600 hover:bg-blue-500 rounded-full text-white transition-colors"
            aria-label="Send"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

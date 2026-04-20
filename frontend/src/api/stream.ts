export interface StreamStatus {
  running: boolean;
  source_url: string | null;
  last_error: string | null;
  fps: number;
  has_frame: boolean;
  preview_url: string | null;
}

function err(statusText: string, body: unknown): Error {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === 'string') return new Error(d);
  }
  return new Error(statusText || 'Request failed');
}

export async function startStream(sourceUrl: string): Promise<void> {
  const res = await fetch('/api/stream/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_url: sourceUrl }),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw err(res.statusText, body);
}

export async function stopStream(): Promise<void> {
  const res = await fetch('/api/stream/stop', { method: 'POST' });
  if (!res.ok) throw new Error(res.statusText || 'Stop stream failed');
}

export async function getStreamStatus(): Promise<StreamStatus> {
  const res = await fetch('/api/stream/status');
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw err(res.statusText, body);
  return body as StreamStatus;
}

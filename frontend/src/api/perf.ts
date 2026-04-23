export interface PerfLane {
  last_ms: number;
  avg_ms: number;
  count: number;
  est_fps: number;
}

export interface PerfStats {
  cpu_percent: number | null;
  gpu_percent: number | null;
  gpu_metric?: string;
  gpu_cuda_memory_used_mb: number | null;
  gpu_cuda_memory_free_mb: number | null;
  gpu_cuda_memory_total_mb: number | null;
  gpu_cuda_memory_percent: number | null;
  stream_fps: number;
  stream_has_frame: boolean;
  stream_running: boolean;
  vlm: PerfLane;
  detect: PerfLane;
  last_updated_ms: number;
}

function err(statusText: string, body: unknown): Error {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === 'string') return new Error(d);
  }
  return new Error(statusText || 'Request failed');
}

export async function getPerfStats(): Promise<PerfStats> {
  const res = await fetch('/api/perf');
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw err(res.statusText, body);
  return body as PerfStats;
}

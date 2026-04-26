import type { BoundingBox } from '../types';

export interface VlmResponse {
  mode: 'yolo_world';
  response: string;
  boxes: BoundingBox[];
  count?: number;
  prompt_normalized?: string;
}

function errorMessageFromResponse(statusText: string, body: unknown): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
      return d
        .map((x) =>
          typeof x === 'object' && x && 'msg' in x ? String((x as { msg: string }).msg) : String(x)
        )
        .join(' ');
    }
  }
  return statusText || 'Request failed';
}

/**
 * @param boxThreshold Optional 0–1. Sent as `box_threshold` (YOLO-World confidence). Omit to use server default from env.
 */
export async function postVlm(
  image: Blob,
  prompt: string,
  boxThreshold?: number | null,
  detectorBackend?: 'yolo_world',
  modelId?: string | null,
  tileGrid?: number | null
): Promise<VlmResponse> {
  const fd = new FormData();
  fd.append('image', image, 'frame.jpg');
  fd.append('prompt', prompt);
  if (boxThreshold != null && Number.isFinite(boxThreshold)) {
    fd.append('box_threshold', String(boxThreshold));
  }
  if (detectorBackend) {
    fd.append('detector_backend', detectorBackend);
  }
  if (modelId) {
    fd.append('model_id', modelId);
  }
  if (tileGrid != null && Number.isFinite(tileGrid)) {
    fd.append('tile_grid', String(tileGrid));
  }

  const res = await fetch('/api/vlm', { method: 'POST', body: fd });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new Error(errorMessageFromResponse(res.statusText, body));
  }

  const data = body as VlmResponse;
  if (!data || typeof data.response !== 'string' || !Array.isArray(data.boxes)) {
    throw new Error('Invalid response from server');
  }
  return data;
}

import type { BoundingBox } from '../types';

export interface DetectResponse {
  prompt_normalized: string;
  count: number;
  boxes: BoundingBox[];
}

function sourceDimensions(source: CanvasImageSource): { w: number; h: number } {
  if (source instanceof HTMLVideoElement) {
    return { w: source.videoWidth, h: source.videoHeight };
  }
  if (source instanceof HTMLImageElement) {
    return { w: source.naturalWidth, h: source.naturalHeight };
  }
  if (source instanceof HTMLCanvasElement) {
    return { w: source.width, h: source.height };
  }
  return { w: (source as ImageBitmap).width, h: (source as ImageBitmap).height };
}

/** Resize long edge for faster uploads; works for `<img>`, `<video>`, canvas, ImageBitmap. */
export function canvasSourceToJpegBlob(
  source: CanvasImageSource,
  maxSide = 1280,
  quality = 0.88
): Promise<Blob> {
  const { w, h } = sourceDimensions(source);
  if (w === 0 || h === 0) {
    return Promise.reject(new Error('Source has no dimensions yet'));
  }
  let tw = w;
  let th = h;
  if (w > maxSide || h > maxSide) {
    if (w >= h) {
      tw = maxSide;
      th = Math.round(h * (maxSide / w));
    } else {
      th = maxSide;
      tw = Math.round(w * (maxSide / h));
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas not supported'));
  ctx.drawImage(source, 0, 0, tw, th);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode JPEG'))),
      'image/jpeg',
      quality
    );
  });
}

export function imageElementToJpegBlob(
  img: HTMLImageElement,
  maxSide = 1280,
  quality = 0.88
): Promise<Blob> {
  return canvasSourceToJpegBlob(img, maxSide, quality);
}

function errorMessageFromResponse(statusText: string, body: unknown): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
      const parts = d.map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: string }).msg) : String(x)));
      return parts.join(' ') || statusText;
    }
    if (d && typeof d === 'object') {
      const o = d as { message?: string; error?: string };
      if (o.error && o.message) return `${o.message}: ${o.error}`;
      if (o.error) return String(o.error);
      if (o.message) return String(o.message);
    }
  }
  return statusText || 'Request failed';
}

export async function postDetect(
  image: Blob,
  prompt: string
): Promise<DetectResponse> {
  const fd = new FormData();
  fd.append('image', image, 'frame.jpg');
  fd.append('prompt', prompt);

  const res = await fetch('/api/detect', { method: 'POST', body: fd });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new Error(errorMessageFromResponse(res.statusText, body));
  }

  const data = body as DetectResponse;
  if (!data || !Array.isArray(data.boxes)) {
    throw new Error('Invalid response from server');
  }
  return data;
}

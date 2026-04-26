export interface HealthResponse {
  ok: boolean;
  supported_backends?: Array<'yolo_world' | 'yolo_e'>;
  yolo_world?: {
    loaded: boolean;
    model_id: string;
    error: string | null;
    supported_models?: string[];
  };
  yolo_e?: {
    loaded: boolean;
    model_id: string;
    error: string | null;
    supported_models?: string[];
  };
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch('/health');
  if (!res.ok) {
    throw new Error(res.statusText || 'Health check failed');
  }
  const body = (await res.json()) as HealthResponse;
  return body;
}

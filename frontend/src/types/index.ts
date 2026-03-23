export interface Telemetry {
  altitude: number;
  speed: number;
  battery: number;
}

export interface BoundingBox {
  id: string;
  label: string;
  confidence?: number;
  x: number; // percentage 0-100
  y: number;
  width: number;
  height: number;
  color: string;
}

export type MessageRole = 'user' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
}

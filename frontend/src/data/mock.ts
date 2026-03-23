import type { Telemetry, BoundingBox, Message } from '../types';

export const MOCK_TELEMETRY: Telemetry = {
  altitude: 245,
  speed: 12,
  battery: 87,
};

export const MOCK_BOUNDING_BOXES: BoundingBox[] = [
  { id: '1', label: 'Car (24)', confidence: 24, x: 15, y: 45, width: 12, height: 8, color: '#7dd3fc' },
  { id: '2', label: 'Car (26)', confidence: 26, x: 28, y: 50, width: 11, height: 7, color: '#7dd3fc' },
  { id: '3', label: 'Car (31)', confidence: 31, x: 42, y: 48, width: 10, height: 6, color: '#7dd3fc' },
  { id: '4', label: 'Truck', confidence: 89, x: 55, y: 35, width: 20, height: 12, color: '#e879f9' },
  { id: '5', label: 'Car', confidence: 45, x: 78, y: 52, width: 9, height: 6, color: '#7dd3fc' },
];

export const MOCK_MESSAGES: Message[] = [
  {
    id: '1',
    role: 'user',
    content: 'scan for people near the waterfront',
    timestamp: '02:40 PM',
  },
  {
    id: '2',
    role: 'system',
    content: 'Roger that. Proceeding to waterfront location and enabling person detection. I will map all detected individuals while maintaining safe distance and altitude.',
    timestamp: '02:40 PM',
  },
  {
    id: '3',
    role: 'user',
    content: 'detect all vehicles here',
    timestamp: '02:41 PM',
  },
  {
    id: '4',
    role: 'system',
    content: 'Analyzing current field of view. I will map all detected vehicles while maintaining safe distance and altitude. All vehicles have been marked with bounding boxes in the live feed.',
    timestamp: '02:41 PM',
  },
];

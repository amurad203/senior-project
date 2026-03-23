# Small VLMs for Zero-Shot Object Recognition — Frontend

Frontend for the senior project: live DJI drone feed with VLM (Vision Language Model) command console.

## Stack

- **React 19** + **TypeScript** + **Vite**
- **Tailwind CSS** for styling
- **Lucide React** for icons

## Run

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
```

## Structure

```
src/
├── components/
│   ├── Header.tsx        # Top bar with icons
│   ├── VideoPanel.tsx    # Live feed + bounding boxes + telemetry
│   └── CommandConsole.tsx# VLM chat interface
├── data/
│   └── mock.ts           # Mock data (replace with API)
├── types/
│   └── index.ts          # TypeScript types
├── App.tsx
└── main.tsx
```

## Backend Integration

The UI is built to work with a Python backend. Replace mocks with:

1. **Video stream** — WebRTC or MJPEG URL in `VideoPanel`
2. **Telemetry** — WebSocket for altitude, speed, battery
3. **Bounding boxes** — WebSocket sending detection coordinates
4. **Chat** — REST or WebSocket for VLM commands/responses

See `src/data/mock.ts` and component props for expected data shapes.

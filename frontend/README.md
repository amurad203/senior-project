# Small VLMs for Zero-Shot Object Recognition — Frontend

Frontend for the senior project: live drone-style feed with open-vocabulary detection command console.

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

With the Python API on **8765** (`backend/run.sh`), Vite proxies `/api/*` to the backend. The console sends **`POST /api/vlm`** with the current frame and your prompt.

**Live detection** — Use **Live detect** on the video panel to run detection on a timer (~2.5 FPS by default); the prompt is the last thing you sent in chat (default targets: `car, truck, person`). **Camera** uses your device webcam; for a drone or broadcast feed, set **`VITE_STREAM_URL`** to an HTTP(S) video or MJPEG URL (`.env`: `VITE_STREAM_URL=https://...`). HLS streams need something like **hls.js** wired to the `<video>` element separately. Detection behavior is configured when you start the Python server (see **`backend/README.md`**).

**Broadcasting** to many viewers is separate from this UI: publish the camera/drone feed with **WebRTC**, **RTMP→HLS**, or an **MJPEG proxy**, then point **`VITE_STREAM_URL`** at that URL (or embed a player).

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
│   └── CommandConsole.tsx# Command / detection chat
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
4. **Chat** — REST for prompts and detection summaries (`POST /api/vlm`)

See `src/data/mock.ts` and component props for expected data shapes.

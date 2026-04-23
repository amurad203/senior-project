from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass
class StreamState:
    running: bool
    source_url: str | None
    last_error: str | None
    fps: float
    has_frame: bool


class StreamManager:
    """Background OpenCV reader for RTSP/RTMP/file streams."""

    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._source_url: str | None = None
        self._last_error: str | None = None
        self._latest_jpeg: bytes | None = None
        self._fps: float = 0.0

    def start(self, source_url: str) -> None:
        source = source_url.strip()
        if not source:
            raise ValueError("source_url is required")
        self.stop()
        self._stop.clear()
        with self._lock:
            self._source_url = source
            self._last_error = None
            self._latest_jpeg = None
            self._fps = 0.0
        self._thread = threading.Thread(target=self._run, args=(source,), daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        t = self._thread
        if t and t.is_alive():
            t.join(timeout=2.0)
        self._thread = None
        with self._lock:
            self._source_url = None
            self._fps = 0.0

    def get_state(self) -> StreamState:
        with self._lock:
            return StreamState(
                running=self._thread is not None and self._thread.is_alive(),
                source_url=self._source_url,
                last_error=self._last_error,
                fps=self._fps,
                has_frame=self._latest_jpeg is not None,
            )

    def get_latest_jpeg(self) -> bytes | None:
        with self._lock:
            return self._latest_jpeg

    def _run(self, source_url: str) -> None:
        try:
            import cv2
        except Exception as e:
            with self._lock:
                self._last_error = f"opencv unavailable: {e}"
            return

        frames = 0
        window_start = time.time()
        cap = None
        consecutive_read_failures = 0
        reconnect_backoff_s = 1.0

        def open_stream():
            local_cap = cv2.VideoCapture(source_url, cv2.CAP_FFMPEG)
            # Keep decode latency low by minimizing internal buffering.
            local_cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            return local_cap

        try:
            while not self._stop.is_set():
                if cap is None or not cap.isOpened():
                    if cap is not None:
                        cap.release()
                    cap = open_stream()
                    if not cap.isOpened():
                        with self._lock:
                            self._last_error = f"failed to open stream: {source_url}; retrying"
                            self._latest_jpeg = None
                        time.sleep(reconnect_backoff_s)
                        reconnect_backoff_s = min(5.0, reconnect_backoff_s + 0.5)
                        continue
                    consecutive_read_failures = 0
                    reconnect_backoff_s = 1.0

                ok, frame = cap.read()
                if not ok or frame is None:
                    consecutive_read_failures += 1
                    with self._lock:
                        self._last_error = (
                            f"stream read failed ({consecutive_read_failures}); reconnecting"
                        )
                    # Force capture recreation to recover stale/broken decoder state.
                    cap.release()
                    cap = None
                    time.sleep(min(2.0, 0.1 * consecutive_read_failures))
                    continue
                consecutive_read_failures = 0
                ok_enc, enc = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                if ok_enc:
                    with self._lock:
                        self._latest_jpeg = enc.tobytes()
                        self._last_error = None
                frames += 1
                now = time.time()
                elapsed = now - window_start
                if elapsed >= 1.0:
                    with self._lock:
                        self._fps = frames / elapsed
                    frames = 0
                    window_start = now
        finally:
            if cap is not None:
                cap.release()


stream_manager = StreamManager()

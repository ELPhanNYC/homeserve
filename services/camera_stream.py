import os
import shutil
import subprocess
import threading
import time

# Same env var the audio converter uses: ffmpeg.exe or its bin folder.
# NSSM services don't inherit the user PATH, so set it there.
FFMPEG_LOCATION = os.environ.get("FFMPEG_LOCATION")

# LAN cameras serve rtsps with self-signed certs, which ffmpeg rejects by
# default. Set RTSP_TLS_VERIFY=1 if your cameras have a trusted certificate.
TLS_VERIFY = os.environ.get("RTSP_TLS_VERIFY", "0")

FPS = 10              # frames per second sent to browsers
MAX_WIDTH = 1280      # downscale wide streams to keep CPU and bandwidth sane
JPEG_QUALITY = 5      # ffmpeg -q:v, 2 (best) .. 31 (worst)
IDLE_TIMEOUT = 15     # seconds with no viewers before ffmpeg is stopped
FRAME_TIMEOUT = 15    # seconds without a frame before ffmpeg is restarted

BOUNDARY = b"frame"
_SOI = b"\xff\xd8"    # JPEG start-of-image
_EOI = b"\xff\xd9"    # JPEG end-of-image


def _ffmpeg_exe():
    if FFMPEG_LOCATION:
        if os.path.isdir(FFMPEG_LOCATION):
            return os.path.join(FFMPEG_LOCATION, "ffmpeg.exe" if os.name == "nt" else "ffmpeg")
        return FFMPEG_LOCATION
    return shutil.which("ffmpeg") or "ffmpeg"


class CameraStream:
    """One ffmpeg process per camera, shared by every browser watching it."""

    def __init__(self, name, url, logger):
        self.name = name
        self._url = url
        self._logger = logger
        self._cond = threading.Condition()
        self._proc = None
        self._frame = None
        self._frame_id = 0
        self._viewers = 0
        self._idle_since = None

    def frames(self):
        """Generator of multipart/x-mixed-replace chunks for a Flask Response."""
        with self._cond:
            self._viewers += 1
            self._idle_since = None
            self._ensure_running()
        last_id = None
        try:
            while True:
                with self._cond:
                    self._cond.wait_for(lambda: self._frame_id != last_id, timeout=FRAME_TIMEOUT)
                    if self._frame_id == last_id:
                        # stalled or ffmpeg died -- (re)start it and keep waiting
                        self._ensure_running()
                        continue
                    frame, last_id = self._frame, self._frame_id
                if frame is None:
                    continue
                yield (b"--" + BOUNDARY + b"\r\n"
                       b"Content-Type: image/jpeg\r\n"
                       b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
                       + frame + b"\r\n")
        finally:
            # runs when the browser disconnects and werkzeug closes the generator
            with self._cond:
                self._viewers -= 1
                if self._viewers == 0:
                    self._idle_since = time.monotonic()

    def _ensure_running(self):
        # caller holds self._cond
        if self._proc is not None and self._proc.poll() is None:
            return
        cmd = [
            _ffmpeg_exe(), "-hide_banner", "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-tls_verify", TLS_VERIFY,
            "-timeout", str(FRAME_TIMEOUT * 1_000_000),  # socket timeout, microseconds
            "-i", self._url,
            "-an",
            "-vf", f"fps={FPS},scale='min({MAX_WIDTH},iw)':-2",
            "-q:v", str(JPEG_QUALITY),
            "-f", "mjpeg", "pipe:1",
        ]
        self._logger.info("camera %s: starting ffmpeg", self.name)
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                # no console window flashing up when running under NSSM
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError as e:
            self._logger.error("camera %s: could not start ffmpeg (%s): %s", self.name, cmd[0], e)
            return
        self._proc = proc
        threading.Thread(target=self._read_frames, args=(proc,), daemon=True).start()
        threading.Thread(target=self._log_errors, args=(proc,), daemon=True).start()

    def _read_frames(self, proc):
        buf = b""
        while True:
            chunk = proc.stdout.read1(65536)
            if not chunk:
                break
            buf += chunk
            # the mjpeg muxer writes back-to-back complete JPEGs
            while True:
                start = buf.find(_SOI)
                if start < 0:
                    buf = b""
                    break
                end = buf.find(_EOI, start + 2)
                if end < 0:
                    buf = buf[start:]
                    break
                frame = buf[start:end + 2]
                buf = buf[end + 2:]
                with self._cond:
                    self._frame = frame
                    self._frame_id += 1
                    self._cond.notify_all()
                    idle = (self._viewers == 0 and self._idle_since is not None
                            and time.monotonic() - self._idle_since > IDLE_TIMEOUT)
                if idle:
                    self._logger.info("camera %s: no viewers, stopping ffmpeg", self.name)
                    proc.kill()
                    break

        proc.wait()
        with self._cond:
            if self._proc is proc:
                self._proc = None
                self._frame = None  # don't show a stale image on the next start
            self._cond.notify_all()

    def _log_errors(self, proc):
        for line in proc.stderr:
            # never log the URL -- it contains the password
            msg = line.decode("utf-8", "replace").strip().replace(self._url, "<camera url>")
            if msg:
                self._logger.warning("camera %s: ffmpeg: %s", self.name, msg)

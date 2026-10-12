# HomeServe

---

A collection of tools to be hosted on a local Raspberry Pi.

## Features

- **Audio Converter** — Convert a single YouTube URL, or bulk-convert a list of URLs from a `.txt` file, to MP3.
- **Image Formatter** — Upload one or more images and batch-convert them to a chosen format (PNG, JPG, WEBP, BMP, HEIC).
- **Cameras** — Live view of RTSP/RTSPS cameras (e.g. UniFi Protect) in the browser, no plugins or app needed.

## Requirements

- Python 3.11+
- ffmpeg
- Deno (JS runtime required by yt-dlp)

**NOTE**: Be sure to install ffmpeg on project init.

```Shell
brew install ffmpeg
```

```Shell
sudo apt install ffmpeg
```

```PowerShell
winget install ffmpeg
```

**NOTE**: Ensure that Deno JS runtime is installed on project init.

```Shell
curl -fsSL https://deno.land/install.sh | sh
```

```PowerShell
irm https://deno.land/install.ps1 | iex
```

```PowerShell
winget install --id=DenoLand.Deno
```

## Project Layout

```
HomeServe/
├── main.py                     # Flask app entry point / route definitions
├── requirements.txt            # Python dependencies
├── .env.example                # Template for camera settings (copy to .env)
├── services/
│   ├── audio_converter.py      # YouTube -> MP3 conversion logic (yt-dlp)
│   ├── image_formatter.py      # Image format conversion logic
│   ├── rtsp_config.py          # Builds camera URLs from RTSP_* env vars
│   └── camera_stream.py        # RTSP -> MJPEG relay (one ffmpeg per camera)
├── templates/
│   ├── index.html              # Home page / tool directory
│   ├── audio-converter.html    # Audio converter page
│   ├── format-image.html       # Image formatter page
│   └── cameras.html            # Camera grid page
├── static/
│   ├── css/
│   │   └── style.css           # Shared stylesheet
│   └── js/
│       ├── index.js
│       ├── audio-converter.js
│       ├── format-image.js
│       └── cameras.js          # Stream reconnect / fullscreen / tab-hidden handling
└── README.md
```

## Setup

1. Clone the repo:
   ```Shell
   git clone <repo-url>
   cd HomeServe
   ```

2. Create and activate a virtual environment:
   ```Shell
   python -m venv venv
   source venv/bin/activate       # macOS/Linux
   venv\Scripts\activate          # Windows
   ```

3. Install dependencies:
   ```Shell
   pip install -r requirements.txt
   ```

4. Install ffmpeg and Deno (see **Requirements** above).

5. (Optional, for cameras) Copy `.env.example` to `.env` and fill in your camera details — see **Cameras** below.

## Running the App

```Shell
python main.py
```

By default this binds to `0.0.0.0:5001`, so it's reachable from other devices on your local network at `http://<your-ip>:5001`.

## Usage

| Route | Description |
|---|---|
| `/` | Home page listing available tools |
| `/audio-converter` | Convert a single YouTube URL or bulk-upload a `.txt` file of URLs to MP3 |
| `/format-image` | Upload and batch-convert images to a chosen format |
| `/cameras` | Live grid of configured cameras |
| `/cameras/<name>/stream` | Raw MJPEG stream for a single camera |

## Cameras

Browsers can't play RTSP directly, so the server relays each camera as an MJPEG stream that a plain `<img>` tag can display.

### How it works

```
camera --rtsps--> ffmpeg --JPEG frames--> CameraStream --multipart/x-mixed-replace--> <img> in browser
```

1. **Config** — `services/rtsp_config.py` reads every `RTSP_CAMERA_<NAME>` variable from `.env` at startup and builds a full URL, adding `RTSP_USERNAME` / `RTSP_PASSWORD` (URL-encoded) unless the entry already has credentials. `<NAME>` is lowercased and becomes the camera's id in the URL (`RTSP_CAMERA_FRONT_DOOR` → `/cameras/front_door/stream`).
2. **Relay** — `services/camera_stream.py` keeps one `CameraStream` per camera. When the first viewer connects it starts a single ffmpeg process that pulls the stream over TCP, drops audio, downsamples to 10 fps, scales to at most 1280px wide, and writes JPEGs to stdout. A reader thread splits them into frames and hands the latest one to every connected viewer, so ten open tabs still cost one camera connection.
3. **Browser** — `/cameras/<name>/stream` returns the frames as `multipart/x-mixed-replace`, which browsers render as a continuously updating image. `static/js/cameras.js` shows a status overlay, retries every 5s if a stream drops, and toggles fullscreen on click.

### Lifecycle

- **Lazy start:** ffmpeg only runs while someone is watching.
- **Idle stop:** after the last viewer leaves, ffmpeg is killed once it's been idle for 15s. Hiding the tab also disconnects the streams so this kicks in.
- **Stall recovery:** if no frame arrives for 15s (camera rebooted, network blip), ffmpeg is restarted.
- Tunables (`FPS`, `MAX_WIDTH`, `JPEG_QUALITY`, `IDLE_TIMEOUT`, `FRAME_TIMEOUT`) are constants at the top of `camera_stream.py`.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `RTSP_CAMERA_<NAME>` | — | One per camera: `host:port/path` or a full `rtsps://…` URL |
| `RTSP_USERNAME` / `RTSP_PASSWORD` | empty | Credentials added to camera URLs that don't include their own |
| `RTSP_SCHEME` | `rtsps` | Scheme used when an entry has no `://` |
| `RTSP_TLS_VERIFY` | `0` | Set to `1` only if your cameras have trusted certs (most are self-signed) |
| `FFMPEG_LOCATION` | `ffmpeg` on PATH | Path to ffmpeg or its `bin` folder — needed under NSSM, which doesn't inherit the user PATH |

Cameras are loaded once at startup, so **restart the app after editing `.env`**.

### Security

- Camera URLs (which contain the password) never leave the server: the page only receives camera names, and ffmpeg error output is scrubbed of the URL before logging.
- `.env` is gitignored — keep real credentials there, not in `.env.example`.
- The camera routes have no authentication, so anyone who can reach the app on your network can watch the feeds. Don't expose port 5001 to the internet.

## Notes

- yt-dlp is kept up to date manually (`pip install -U yt-dlp`) since YouTube frequently changes extraction requirements.
- Each camera stream holds a server thread open for as long as it's being watched; the Flask dev server is threaded, so this is fine for a handful of viewers.
- Deno is required for reliable YouTube format extraction — without it, some downloads may fail or be missing formats.
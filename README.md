# HomeServe

---

A collection of tools to be hosted on a local Raspberry Pi.

## Features

- **Audio Converter** — Convert a single YouTube URL, or bulk-convert a list of URLs from a `.txt` file, to MP3.
- **Image Formatter** — Upload one or more images and batch-convert them to a chosen format (PNG, JPG, WEBP, BMP, HEIC).

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
├── app.py                      # Flask app entry point / route definitions
├── requirements.txt            # Python dependencies
├── services/
│   ├── audio_converter.py      # YouTube -> MP3 conversion logic (yt-dlp)
│   └── image_formatter.py      # Image format conversion logic
├── templates/
│   ├── index.html              # Home page / tool directory
│   ├── audio-converter.html    # Audio converter page
│   └── format-image.html       # Image formatter page
├── static/
│   ├── css/
│   │   └── style.css           # Shared stylesheet
│   └── js/
│       ├── index.js
│       ├── audio-converter.js
│       └── format-image.js
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

## Running the App

```Shell
python app.py
```

By default this binds to `0.0.0.0:5001`, so it's reachable from other devices on your local network at `http://<your-ip>:5001`.

## Usage

| Route | Description |
|---|---|
| `/` | Home page listing available tools |
| `/audio-converter` | Convert a single YouTube URL or bulk-upload a `.txt` file of URLs to MP3 |
| `/format-image` | Upload and batch-convert images to a chosen format |

## Notes

- yt-dlp is kept up to date manually (`pip install -U yt-dlp`) since YouTube frequently changes extraction requirements.
- Deno is required for reliable YouTube format extraction — without it, some downloads may fail or be missing formats.
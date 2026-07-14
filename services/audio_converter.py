import yt_dlp
import os

def convertToMp3(url, dir, bitrate):
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(dir, "%(title)s.%(ext)s"),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": bitrate,
            }
        ],
        "noplaylist": True,
        "quiet": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        filename = ydl.prepare_filename(info)
        return filename.rsplit(".", 1)[0] + ".mp3"
    
# convertToMp3("https://www.youtube.com/watch?v=wBHbQtuLlj0", "~/Downloads", 192)

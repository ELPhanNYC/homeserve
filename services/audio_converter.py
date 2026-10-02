import yt_dlp
from yt_dlp.postprocessor.metadataparser import MetadataParserPP
import os

# Services (e.g. NSSM running as LocalSystem) don't inherit the user PATH,
# so ffmpeg/deno installed per-user via winget aren't found. Set these env vars
# to point at them explicitly; otherwise yt-dlp falls back to searching PATH.
FFMPEG_LOCATION = os.environ.get("FFMPEG_LOCATION")  # ffmpeg.exe or its bin folder
DENO_PATH = os.environ.get("DENO_PATH")  # path to deno.exe

def convertToMp3(url, dir, bitrate):
    # processing url gathered from the share button
    if '?is=' in url:
        vid_hash = url.split('?is=')[0].split('https://youtu.be/')[1]
        url = 'https://youtu.be/watch?v=' + vid_hash
    elif '?si=' in url:
            vid_hash = url.split('?si=')[0].split('https://youtu.be/')[1]
            url = 'https://youtu.be/watch?v=' + vid_hash    
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(dir, "%(title)s.%(ext)s"),
        "writethumbnail": True,
        "postprocessors": [
            # blank the description/synopsis tags -- otherwise the whole video
            # description (links, lyrics, promo text) gets stuffed into the MP3
            {
                "key": "MetadataParser",
                "when": "pre_process",
                "actions": [
                    (MetadataParserPP.Actions.INTERPRET, "", "(?P<meta_description>)"),
                    (MetadataParserPP.Actions.INTERPRET, "", "(?P<meta_synopsis>)"),
                ],
            },
            # YouTube thumbnails are usually webp; MP3 cover art needs jpg
            {
                "key": "FFmpegThumbnailsConvertor",
                "format": "jpg",
                "when": "before_dl",
            },
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": bitrate,
            },
            # writes title / artist / album / date tags (ID3)
            {
                "key": "FFmpegMetadata",
                "add_metadata": True,
            },
            # embeds the thumbnail as cover art, then deletes the image file
            {
                "key": "EmbedThumbnail",
            },
        ],
        "noplaylist": True,
        "quiet": True,
        "js_runtimes": {"deno": {"path": DENO_PATH} if DENO_PATH else {}},
    }
    if FFMPEG_LOCATION:
        ydl_opts["ffmpeg_location"] = FFMPEG_LOCATION

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        filename = ydl.prepare_filename(info)
        return filename.rsplit(".", 1)[0] + ".mp3"


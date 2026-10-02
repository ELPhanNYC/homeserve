import os
from urllib.parse import quote

CAMERA_PREFIX = "RTSP_CAMERA_"


def getCameras():
    """Return {camera_name: stream_url} built from RTSP_* environment variables.

    A camera value can be a full URL (rtsps://host:7441/path) or just
    host:port/path, in which case RTSP_SCHEME (default rtsps) is prepended.
    """
    scheme = os.getenv("RTSP_SCHEME", "rtsps")
    username = os.getenv("RTSP_USERNAME", "")
    password = os.getenv("RTSP_PASSWORD", "")

    # URL-encode so characters like @ : / in a password don't break the URL
    auth = ""
    if username:
        auth = quote(username, safe="")
        if password:
            auth += ":" + quote(password, safe="")
        auth += "@"

    cameras = {}
    for key, value in sorted(os.environ.items()):
        if key.startswith(CAMERA_PREFIX) and value:
            name = key[len(CAMERA_PREFIX):].lower()
            if "://" in value:
                value_scheme, rest = value.split("://", 1)
            else:
                value_scheme, rest = scheme, value
            # don't add credentials if the URL already carries its own
            prefix = "" if "@" in rest.split("/", 1)[0] else auth
            cameras[name] = f"{value_scheme}://{prefix}{rest}"
    return cameras

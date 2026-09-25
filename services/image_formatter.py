import io
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()  # enables HEIC read + write

PIL_FORMATS = {
    "jpg": "JPEG", "jpeg": "JPEG", "png": "PNG",
    "webp": "WEBP", "bmp": "BMP", "heic": "HEIF",
}

ALLOWED_MODES = {
    "JPEG": {"RGB", "L"},
    "PNG":  {"1", "L", "LA", "P", "RGB", "RGBA"},
    "WEBP": {"RGB", "RGBA"},
    "BMP":  {"1", "L", "P", "RGB", "RGBA"},
    "HEIF": {"RGB", "RGBA"},
}

def _has_alpha(im):
    return im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)

def _normalize_mode(im, pil_fmt):
    if im.mode in ALLOWED_MODES[pil_fmt]:
        return im
    if pil_fmt == "JPEG":
        if _has_alpha(im):
            # flatten transparency onto white instead of black
            rgba = im.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.getchannel("A"))
            return bg
        return im.convert("RGB")
    return im.convert("RGBA" if _has_alpha(im) else "RGB")

def formatImage(f, ext):
    pil_fmt = PIL_FORMATS[ext]
    with Image.open(f) as im:
        im = ImageOps.exif_transpose(im)
        im = _normalize_mode(im, pil_fmt)
        buf = io.BytesIO()
        im.save(buf, pil_fmt)
    return buf.getvalue()
from PIL import Image
import os

def formatImage(f, dir, format):
    im = Image.open(f)
    if format in {"jpg", "jpeg"}:
        im = im.convert("RGB")
    output = os.path.join(dir, os.path.splitext(f.filename)[0] + "." + format)
    im.save(output, format.upper())
    return output
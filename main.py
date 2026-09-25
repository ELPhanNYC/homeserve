from flask import Flask, request, send_file, abort, render_template
from flask_cors import CORS
import tempfile
import os
import io
import zipfile
import uuid
import logging
from PIL import UnidentifiedImageError
from werkzeug.utils import secure_filename
import services.audio_converter as convert
import services.image_formatter as format

app = Flask(__name__)
CORS(app)

# NSSM discards stdout/stderr, so write errors (with tracebacks) to a file
LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(LOG_DIR, exist_ok=True)
_log_handler = logging.FileHandler(os.path.join(LOG_DIR, "app.log"), encoding="utf-8")
_log_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
app.logger.addHandler(_log_handler)
app.logger.setLevel(logging.INFO)
logging.getLogger("werkzeug").addHandler(_log_handler)

import sys, getpass, PIL
app.logger.info(
    "startup exe=%s cwd=%s user=%s file=%s pillow=%s temp=%s",
    sys.executable, os.getcwd(), getpass.getuser(), os.path.abspath(__file__),
    PIL.__version__, tempfile.gettempdir(),
)

@app.errorhandler(500)
def _log_500(e):
    original = getattr(e, "original_exception", None)
    if original is not None:
        app.logger.error("500 on %s %s", request.method, request.path,
                         exc_info=(type(original), original, original.__traceback__))
    else:
        import traceback
        app.logger.error("500 on %s %s (no original exception)\n%s",
                         request.method, request.path, "".join(traceback.format_stack()))
    return e

@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")

@app.route("/audio-converter", methods=["GET"])
def audio_converter():
    return render_template("audio-converter.html")

@app.route("/audio-download", methods=["POST"])
def audio_download():

    data = request.get_json()
    url = data.get("url") if data else None

    if not url:
        abort(400, "Missing URL")

    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            mp3_path = convert.convertToMp3(url, tmpdir, 192)
        except Exception as e:
            abort(500, f"Failed to process URL: {e}")

        return send_file(
            mp3_path,
            as_attachment=True,
            download_name=os.path.basename(mp3_path),
            mimetype="audio/mpeg"
        )
    
@app.route("/audio-download-bulk", methods=["POST"])
def audio_download_bulk():
    if "file" not in request.files:
        abort(400, "Missing .txt file")

    uploaded = request.files["file"]
    if not uploaded.filename.endswith(".txt"):
        abort(400, "File must be .txt")

    urls = [
        line.strip()
        for line in uploaded.read().decode("utf-8").splitlines()
        if line.strip()
    ]

    if not urls:
        abort(400, "No URLs found")

    with tempfile.TemporaryDirectory() as tmpdir:
        mp3_dir = os.path.join(tmpdir, "mp3")
        os.makedirs(mp3_dir, exist_ok=True)

        mp3_files = []

        for url in urls:
            try:
                mp3_path = convert.convertToMp3(url, mp3_dir, 192)
                mp3_files.append(mp3_path)
            except Exception as e:
                print(f"Failed: {url} -> {e}")

        if not mp3_files:
            abort(500, "No files could be processed")

        zip_name = f"mp3_batch_{uuid.uuid4().hex}.zip"
        zip_path = os.path.join(tmpdir, zip_name)

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for mp3 in mp3_files:
                zipf.write(mp3, arcname=os.path.basename(mp3))

        return send_file(
            zip_path,
            as_attachment=True,
            download_name="audios.zip",
            mimetype="application/zip"
        )
    
ACCEPTED_FORMATS = set(format.PIL_FORMATS)

@app.route("/format-image", methods=["GET", "POST"])
def format_image():
    if request.method == "GET":
        return render_template("format-image.html")

    uploads = [f for f in request.files.getlist("image") if f and f.filename]
    if not uploads:
        abort(400, "Missing image.")

    req_format = (request.form.get("format") or "").strip().lower()
    if not req_format:
        abort(400, "Missing conversion format.")
    if req_format not in ACCEPTED_FORMATS:
        abort(400, "Requested conversion format is not accepted.")

    zip_buf = io.BytesIO()
    used_names = set()

    with zipfile.ZipFile(zip_buf, "w") as z:
        for upload in uploads:
            try:
                data = format.formatImage(upload, req_format)
            except (UnidentifiedImageError, OSError):
                abort(400, f"Could not read {upload.filename} as an image.")

            stem = os.path.splitext(secure_filename(upload.filename))[0] or "image"
            name = f"{stem}.{req_format}"
            n = 1
            while name in used_names:
                name = f"{stem}_{n}.{req_format}"
                n += 1
            used_names.add(name)
            z.writestr(name, data)

    zip_buf.seek(0)
    return send_file(
        zip_buf,
        as_attachment=True,
        download_name="images.zip",
        mimetype="application/zip",
    )

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)

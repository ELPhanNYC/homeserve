from flask import Flask, request, send_file, abort, render_template
from flask_cors import CORS
import tempfile
import os
import zipfile
import uuid
import services.audio_converter as convert
import services.image_formatter as format

app = Flask(__name__)
CORS(app)

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
    
@app.route("/format-image", methods=["GET", "POST"])
def format_image():
    if request.method == "GET":
        return render_template("format-image.html")

    if request.method == "POST":
        if "image" not in request.files:
            abort(400, "Missing image.")

        uploaded = request.files.getlist("image")
        req_format = request.form.get("format").lower()

        if not req_format:
            abort(400, "Missing conversion format.")

        accepted_formats = {"jpg", "jpeg", "png", "webp", "bmp", "heic"}
        if req_format not in accepted_formats:
            abort(400, "Requested conversion format is not accepted.")

        with tempfile.TemporaryDirectory() as tmpdir:
            img_dir = os.path.join(tmpdir, "img")
            os.makedirs(img_dir, exist_ok=True)

            converted = []

            for upload in uploaded:
                converted.append(
                    format.formatImage(upload, img_dir, req_format)
                )

            zip_path = os.path.join(tmpdir, "converted_images.zip")

            with zipfile.ZipFile(zip_path, "w") as z:
                for path in converted:
                    z.write(path, os.path.basename(path))

            return send_file(
                zip_path,
                as_attachment=True,
                download_name="converted_images.zip",
                mimetype="application/zip",
            )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port="5001")

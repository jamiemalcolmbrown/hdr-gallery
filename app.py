# v0.4 Flask server (canonical name: app.py)
from pathlib import Path
from flask import Flask, render_template, jsonify, send_from_directory
import json

BASE = Path(__file__).parent.resolve()
IMAGES = (BASE / "images").resolve()
THUMBS = (IMAGES / "thumbs").resolve()
IMAGES.mkdir(parents=True, exist_ok=True)
THUMBS.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder="static", template_folder="templates")

HDR_SUFFIX = "_hdr.avif"
SDR_SUFFIX = "_sdr.jpg"

def _is_pair(p: Path) -> bool:
    n = p.name.lower()
    return n.endswith(HDR_SUFFIX) or n.endswith(SDR_SUFFIX)

def _key(name: str) -> str:
    n = name.lower()
    if n.endswith(HDR_SUFFIX):
        return name[:-len(HDR_SUFFIX)]
    if n.endswith(SDR_SUFFIX):
        return name[:-len(SDR_SUFFIX)]
    return name.rsplit(".", 1)[0]

def _load_meta() -> dict:
    mpath = IMAGES / "metadata.json"
    if not mpath.exists():
        return {}
    try:
        data = json.loads(mpath.read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

@app.route("/manifest.json")
def manifest():
    # Build pairs
    items = {}
    for p in sorted(IMAGES.iterdir()):
        if not p.is_file() or not _is_pair(p):
            continue
        k = _key(p.name)
        e = items.setdefault(k, {"key": k, "hdr": None, "sdr": None})
        if p.name.lower().endswith(HDR_SUFFIX):
            e["hdr"] = p.name
        elif p.name.lower().endswith(SDR_SUFFIX):
            e["sdr"] = p.name

    manifest = [v for v in items.values() if v["hdr"] and v["sdr"]]

    meta = _load_meta()
    for it in manifest:
        m = meta.get(it["key"], {})
        it["title"] = m.get("title") or ""         # no filename fallback
        it["description"] = m.get("description") or ""
        it["city"] = m.get("city") or ""
        it["state_fullname"] = m.get("state_fullname") or ""
        it["state_abbr"] = m.get("state_abbr") or ""
        it["season"] = m.get("season") or ""
        it["color"] = m.get("color") or ""
        it["tags"] = m.get("tags") or []
        # thumbnail path
        tname = f"{it['key']}.jpg"
        it["thumb"] = f"/thumbs/{tname}" if (THUMBS / tname).exists() else f"/images/{it['sdr']}"

    manifest.sort(key=lambda x: ((x.get("title") or "").lower(), x["key"].lower()))
    return jsonify({"ok": True, "version": "v0.4.0", "hdr": True, "items": manifest})

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/images/<path:filename>")
def image_file(filename):
    return send_from_directory(IMAGES, filename)

@app.route("/thumbs/<path:filename>")
def thumb_file(filename):
    return send_from_directory(THUMBS, filename)

@app.route("/health")
def health():
    return jsonify({"ok": True, "version": "v0.4.0"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

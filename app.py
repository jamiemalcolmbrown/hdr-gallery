import json
from pathlib import Path
from flask import Flask, render_template, send_from_directory, jsonify

BASE_DIR = Path(__file__).parent.resolve()
IMAGES_DIR = (BASE_DIR / "images").resolve()
THUMBS_DIR = (IMAGES_DIR / "thumbs").resolve()
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
THUMBS_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_url_path="/static", static_folder="static", template_folder="templates")

HDR_SUFFIX = "_hdr.avif"
SDR_SUFFIX = "_sdr.jpg"

def is_pair_candidate(p: Path) -> bool:
    n = p.name.lower()
    return n.endswith(HDR_SUFFIX) or n.endswith(SDR_SUFFIX)

def pair_key(name: str) -> str:
    lname = name.lower()
    if lname.endswith(HDR_SUFFIX): return name[:-len(HDR_SUFFIX)]
    if lname.endswith(SDR_SUFFIX): return name[:-len(SDR_SUFFIX)]
    return name.rsplit(".", 1)[0]

def load_sidecar_metadata():
    meta_path = IMAGES_DIR / "metadata.json"
    if not meta_path.exists(): return {}
    try:
        data = json.loads(meta_path.read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def build_manifest():
    items = {}
    for p in sorted(IMAGES_DIR.iterdir()):
        if not p.is_file() or not is_pair_candidate(p):
            continue
        key = pair_key(p.name)
        e = items.setdefault(key, {"key": key, "hdr": None, "sdr": None})
        if p.name.lower().endswith(HDR_SUFFIX): e["hdr"] = p.name
        elif p.name.lower().endswith(SDR_SUFFIX): e["sdr"] = p.name

    manifest = [v for v in items.values() if v["hdr"] and v["sdr"]]

    meta = load_sidecar_metadata()
    for it in manifest:
        m = meta.get(it["key"], {})
        # NO filename fallback for title
        it["title"] = m.get("title") or ""
        it["description"] = m.get("description") or ""
        it["state_fullname"] = m.get("state_fullname") or ""
        it["season"] = m.get("season") or ""
        it["color"] = m.get("color") or ""
        it["tags"] = m.get("tags") or []
        thumb_name = f"{it['key']}.jpg"
        it["thumb"] = f"/thumbs/{thumb_name}" if (THUMBS_DIR / thumb_name).exists() else f"/images/{it['sdr']}"

    return {"ok": True, "version": "v0.3.0", "hdr": True, "items": manifest}

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/manifest.json")
def manifest():
    return jsonify(build_manifest())

@app.route("/images/<path:filename>")
def image_file(filename):
    return send_from_directory(IMAGES_DIR, filename)

@app.route("/thumbs/<path:filename>")
def thumb_file(filename):
    return send_from_directory(THUMBS_DIR, filename)

@app.route("/health")
def health():
    return jsonify({"ok": True, "version": "v0.3.0"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

#!/usr/bin/env python3
"""
Gallery v0.2 server (safe/full)
- Uses ExifTool with -api jsonUnicode=1 to escape control characters
- Skips corrupt metadata instead of crashing
- Defaults to current directory if --images not given
- Serves a minimal UI at "/"
"""
import argparse, json, mimetypes, os, re, subprocess, sys, threading, time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional
from flask import Flask, jsonify, request, send_file, abort, send_from_directory

DEFAULT_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp"}
CACHE_TTL_DEFAULT = int(os.environ.get("GALLERY_CACHE_TTL", "300"))

app = Flask(__name__)

def safe_float(x, default=None):
    try:
        return float(x)
    except Exception:
        return default

def get_exif_metadata(file_path: str) -> dict:
    cmd = ["exiftool","-j","-api","jsonUnicode=1","-m","-fast2","-n",file_path]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if proc.returncode != 0:
            app.logger.warning("[exiftool] rc=%s file=%s stderr=%s", proc.returncode, file_path, proc.stderr.strip())
            return {}
        data = json.loads(proc.stdout)
        if isinstance(data, list) and data:
            return data[0]
        return {}
    except (json.JSONDecodeError, subprocess.TimeoutExpired, OSError) as e:
        app.logger.warning("[exiftool] parse error for %s: %s", file_path, e)
        return {}

@dataclass
class MetaCacheItem:
    mtime: float
    data: dict
    ts: float

class MetaCache:
    def __init__(self, ttl: int = CACHE_TTL_DEFAULT):
        self.ttl = max(0, int(ttl))
        self._lock = threading.Lock()
        self._data: Dict[str, MetaCacheItem] = {}
    def get(self, path: str) -> Optional[dict]:
        p = str(Path(path).resolve())
        with self._lock:
            item = self._data.get(p)
            if not item: return None
            try:
                mtime = os.path.getmtime(p)
            except FileNotFoundError:
                self._data.pop(p, None); return None
            if mtime != item.mtime: self._data.pop(p, None); return None
            if self.ttl and (time.time() - item.ts > self.ttl):
                self._data.pop(p, None); return None
            return item.data
    def set(self, path: str, data: dict):
        p = str(Path(path).resolve())
        try:
            mtime = os.path.getmtime(p)
        except FileNotFoundError:
            return
        with self._lock:
            self._data[p] = MetaCacheItem(mtime=mtime, data=data, ts=time.time())

meta_cache = MetaCache()

def is_image(path: Path) -> bool:
    return path.suffix.lower() in DEFAULT_EXTS

def scan_images(root: Path) -> List[Path]:
    files: List[Path] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            p = Path(dirpath) / fn
            if is_image(p): files.append(p)
    files.sort(key=lambda p: str(p).lower())
    return files

KEYS_STRING = ["FileName","Directory","MIMEType","Model","Make","LensModel","Artist","Creator","Title","Headline","Description","Subject","Keywords","Location","City","State","Province-State","Country"]
KEYS_NUM = ["ImageWidth","ImageHeight","Orientation","FocalLength","FNumber","ShutterSpeedValue","ExposureTime","ISO","GPSLatitude","GPSLongitude"]
KEYS_TIME = ["CreateDate","DateTimeOriginal"]

def summarize_meta(meta: dict) -> dict:
    if not meta: return {}
    out = {}
    for k in KEYS_STRING:
        v = meta.get(k)
        if v is None: continue
        if isinstance(v, str):
            v = re.sub(r"[\r\x00-\x08\x0b\x0c\x0e-\x1f]", " ", v).strip()
        out[k] = v
    for k in KEYS_NUM:
        v = meta.get(k)
        if v is None: continue
        out[k] = safe_float(v, v)
    for k in KEYS_TIME:
        v = meta.get(k)
        if v: out[k] = v
    w = out.get("ImageWidth"); h = out.get("ImageHeight")
    if isinstance(w,(int,float)) and isinstance(h,(int,float)) and w and h:
        out["_orientation"] = "portrait" if h > w else ("landscape" if w > h else "square")
    return out

IMAGES_DIR = Path(os.environ.get("GALLERY_IMAGES_DIR", ".")).resolve()
def set_images_dir(p: Path):
    global IMAGES_DIR
    IMAGES_DIR = p.resolve()
    app.logger.info("Using IMAGES_DIR=%s", IMAGES_DIR)

# ---------- Static & index ----------
@app.get("/")
def index():
    return send_from_directory(str(Path(__file__).parent), "index.html")

@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(str(Path(__file__).parent / "static"), filename)

# ---------- APIs ----------
@app.get("/api/ping")
def ping():
    return jsonify({"ok": True, "images_dir": str(IMAGES_DIR)})

@app.get("/api/images")
def api_images():
    q = (request.args.get("q") or "").strip().lower()
    orient = (request.args.get("orient") or "").strip().lower()
    limit = int(request.args.get("limit", 1000))
    offset = int(request.args.get("offset", 0))

    files = scan_images(IMAGES_DIR)
    results = []
    for p in files:
        p_str = str(p)
        meta = meta_cache.get(p_str)
        if meta is None:
            meta = get_exif_metadata(p_str)
            meta_cache.set(p_str, meta)
        summary = summarize_meta(meta)
        summary["_path"] = str(p.relative_to(IMAGES_DIR))
        summary["_name"] = p.name

        if q:
            hay = " ".join(str(summary.get(k, "")) for k in ("_name","Title","Description","Keywords","City","State","Country","Location")).lower()
            if q not in hay: continue
        if orient and summary.get("_orientation") != orient: continue
        results.append(summary)

    total = len(results)
    results = results[offset:offset + limit]
    return jsonify({"total": total, "items": results})

@app.get("/api/metadata")
def api_metadata_for_path():
    rel = request.args.get("path")
    if not rel: abort(400, "Missing 'path'")
    candidate = (IMAGES_DIR / rel).resolve()
    try: candidate.relative_to(IMAGES_DIR)
    except Exception: abort(400, "Invalid path")
    if not candidate.exists(): abort(404)
    meta = meta_cache.get(str(candidate))
    if meta is None:
        meta = get_exif_metadata(str(candidate))
        meta_cache.set(str(candidate), meta)
    return jsonify(meta or {})

@app.get("/image")
def serve_image():
    rel = request.args.get("path")
    if not rel: abort(400, "Missing 'path'")
    p = (IMAGES_DIR / rel).resolve()
    try: p.relative_to(IMAGES_DIR)
    except Exception: abort(400, "Invalid path")
    if not p.exists(): abort(404)
    mime, _ = mimetypes.guess_type(str(p))
    return send_file(str(p), mimetype=mime or "application/octet-stream")

def parse_args(argv: List[str]) -> argparse.Namespace:
    import argparse
    parser = argparse.ArgumentParser(description="Gallery v0.2 server (safe/full)")
    parser.add_argument("--images", type=str, default=os.environ.get("GALLERY_IMAGES_DIR", "."), help="Path to images root")
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--debug", action="store_true")
    return parser.parse_args(argv)

def main(argv: List[str]) -> int:
    args = parse_args(argv)
    root = Path(args.images)
    if not root.exists():
        print(f"ERROR: images dir not found: {root}", file=sys.stderr)
        return 2
    set_images_dir(root)
    app.logger.setLevel("INFO")
    app.run(host=args.host, port=args.port, debug=args.debug, threaded=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

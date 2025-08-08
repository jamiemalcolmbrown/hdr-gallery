#!/usr/bin/env python3
"""
Gallery v0.2.4 — Masonry + Full State Names
- Masonry (no-crop) thumbnails; UI shows Title + full State only
- State normalization outputs FULL names (e.g., MA -> Massachusetts)
- Season & State chip filters
- Prebuild (--prebuild, optional --prebuild-avif)
- Dedup scan, ignore rules, MIN_LONG=1000, 4K fullscreen, WebP/AVIF, regex fix
"""
import argparse, json, mimetypes, os, re, subprocess, sys, threading, time, hashlib, fnmatch
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Set
from flask import Flask, jsonify, request, send_file, abort, send_from_directory

# --- Pillow / AVIF ---
AVIF_ENABLED = False
try:
    from PIL import Image, ImageOps
    try:
        import pillow_avif  # noqa: F401
        AVIF_ENABLED = True
    except Exception:
        pass
except Exception as e:
    raise SystemExit("Pillow is required. pip install Pillow") from e

DEFAULT_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp", ".avif"}
CACHE_TTL_DEFAULT = int(os.environ.get("GALLERY_CACHE_TTL", "300"))
THUMB_SIZES = [256, 512, 1024]
DISPLAY_MAX = int(os.environ.get("GALLERY_DISPLAY_MAX", "3840"))
CACHE_DIR_THUMBS = Path(".cache/thumbs")
CACHE_DIR_DISPLAY = Path(".cache/display")

# --- Ignore & size rules ---
IGNORE_DIRS = {"__MACOSX", ".cache", "thumbnails", "previews", "icons", "ui", ".git", ".svn"}
IGNORE_GLOBS_DEFAULT = [
    "thumb.*", "*thumbnail*", "*_thumb.*", "*_preview*", "*preview*",
    "plus.*", "minus.*", "more.*", "less.*", "console.*", "*icon*", "*sprite*",
    ".DS_Store", "._*", "*.xmp", "*.pp3"
]
USER_IGNORE_GLOBS = os.environ.get("GALLERY_IGNORE_GLOBS", "").strip()
if USER_IGNORE_GLOBS:
    IGNORE_GLOBS = IGNORE_GLOBS_DEFAULT + [g.strip() for g in USER_IGNORE_GLOBS.split(",") if g.strip()]
else:
    IGNORE_GLOBS = IGNORE_GLOBS_DEFAULT

MIN_LONG = int(os.environ.get("GALLERY_MIN_LONG", "1000"))

# --- US State normalization (full names) ---
US_ABBR_TO_FULL = {
    "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado","CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia",
    "HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts",
    "MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico",
    "NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina",
    "SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming"
}
US_FULL_TO_ABBR = {v.lower(): k for k, v in US_ABBR_TO_FULL.items()}

app = Flask(__name__)

def safe_float(x, default=None):
    try:
        return float(x)
    except Exception:
        return default

# ---------------------- ExifTool wrapper --------------------
def get_exif_metadata(file_path: str) -> dict:
    cmd = ["exiftool","-j","-api","jsonUnicode=1","-m","-fast2","-n",file_path]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
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

# ---------------------- Metadata cache ----------------------
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

# ---------------------- Ignore helpers ----------------------
def should_ignore(path: Path) -> bool:
    for part in path.parts:
        if part.lower() in {d.lower() for d in IGNORE_DIRS}:
            return True
    name = path.name.lower()
    for pat in IGNORE_GLOBS:
        if fnmatch.fnmatch(name, pat.lower()):
            return True
    return False

# ---------------------- Image scanning with de-dupe ---------
def is_image(path: Path) -> bool:
    return path.suffix.lower() in DEFAULT_EXTS

def scan_images(root: Path) -> List[Path]:
    files: List[Path] = []
    seen: Set[str] = set()
    seen_inode: Set[Tuple[int,int]] = set()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if (Path(dirpath)/d).name.lower() not in {x.lower() for x in IGNORE_DIRS}]
        for fn in filenames:
            p = Path(dirpath) / fn
            if should_ignore(p) or not is_image(p):
                continue
            try:
                rp = str(p.resolve())
            except Exception:
                rp = str(p.absolute())
            key = rp.lower()
            if key in seen:
                continue
            try:
                st = os.stat(rp)
                tup = (getattr(st, "st_ino", 0), getattr(st, "st_dev", 0))
                if tup in seen_inode:
                    continue
                seen_inode.add(tup)
            except Exception:
                pass
            seen.add(key)
            files.append(Path(rp))
    files.sort(key=lambda p: str(p).lower())
    return files

# ---------------------- Summarization + state/season --------
KEYS_STRING = ["FileName","Directory","MIMEType","Model","Make","LensModel","Artist","Creator","Title","Headline","Description","Subject","Keywords","Location","City","State","Province-State","Country"]
KEYS_NUM = ["ImageWidth","ImageHeight","Orientation","FocalLength","FNumber","ShutterSpeedValue","ExposureTime","ISO","GPSLatitude","GPSLongitude"]
KEYS_TIME = ["CreateDate","DateTimeOriginal"]

def normalize_state_full(meta: dict) -> Optional[str]:
    # Prefer explicit State or Province-State
    for k in ("State","Province-State"):
        raw = meta.get(k)
        if not raw:
            continue
        s = str(raw).strip()
        if len(s) == 2 and s.isalpha():
            abbr = s.upper()
            return US_ABBR_TO_FULL.get(abbr, abbr)  # fallback to abbr if unknown
        low = s.lower()
        # Already full name?
        if low in US_FULL_TO_ABBR:
            # standardize capitalization
            return US_FULL_TO_ABBR[low] and s.title() if s else s
        # Not a US state; title-case region like "Quebec"
        return s.title()
    return None

def parse_season(meta: dict) -> Optional[str]:
    kw = meta.get("Keywords") or ""
    if isinstance(kw, list):
        kw_list = kw
    else:
        kw_list = [x.strip() for x in str(kw).split(",")]
    for k in kw_list:
        k_low = k.lower()
        if k_low.startswith("season:"):
            v = k_low.split(":",1)[1]
            if v == "fall": v = "autumn"
            return v
    return None

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
    # add state + season
    st = normalize_state_full(out)
    if st: out["_state"] = st
    ss = parse_season(out)
    if ss: out["_season"] = ss
    return out

# ---------------------- Cache keys + writers ----------------
def sha_for(src: Path, extra: str) -> str:
    st = src.stat()
    h = hashlib.sha1()
    h.update(str(src.resolve()).encode("utf-8"))
    h.update(str(st.st_mtime_ns).encode("utf-8"))
    h.update(str(st.st_size).encode("utf-8"))
    h.update(extra.encode("utf-8"))
    return h.hexdigest()

def thumb_cache_path(src: Path, w: int, fmt: str) -> Path:
    digest = sha_for(src, f"thumb:{w}:{fmt}")
    sub = digest[:2] + "/" + digest[2:]
    return CACHE_DIR_THUMBS / sub / f"thumb.{fmt}"

def display_cache_path(src: Path, max_long: int, fmt: str) -> Path:
    digest = sha_for(src, f"display:{max_long}:{fmt}")
    sub = digest[:2] + "/" + digest[2:]
    return CACHE_DIR_DISPLAY / sub / f"display.{fmt}"

def make_thumbnail(src_path: Path, w: int, fmt: str):
    dst = thumb_cache_path(src_path, w, fmt)
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        mime = "image/avif" if fmt == "avif" else "image/webp"
        return dst, mime
    with Image.open(src_path) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB","RGBA"): im = im.convert("RGB")
        ratio = w / max(im.width, im.height)
        new_size = (max(1, int(im.width * ratio)), max(1, int(im.height * ratio)))
        im = im.resize(new_size, Image.LANCZOS)
        if fmt == "avif" and AVIF_ENABLED:
            im.save(dst, "AVIF", quality=int(os.environ.get("GALLERY_AVIF_QUALITY", "55")))
            mime = "image/avif"
        else:
            im.save(dst, "WEBP", method=6, quality=int(os.environ.get("GALLERY_WEBP_QUALITY", "82")))
            mime = "image/webp"
    return dst, mime

def make_display(src_path: Path, max_long: int, fmt: str):
    dst = display_cache_path(src_path, max_long, fmt)
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        mime = "image/avif" if fmt == "avif" else "image/webp"
        return dst, mime
    with Image.open(src_path) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB","RGBA"): im = im.convert("RGB")
        long_side = max(im.width, im.height)
        ratio = max_long / long_side if long_side else 1.0
        new_size = (max(1, int(im.width * ratio)), max(1, int(im.height * ratio)))
        im = im.resize(new_size, Image.LANCZOS)
        if fmt == "avif" and AVIF_ENABLED:
            im.save(dst, "AVIF", quality=int(os.environ.get("GALLERY_AVIF_QUALITY", "55")))
            mime = "image/avif"
        else:
            im.save(dst, "WEBP", method=6, quality=int(os.environ.get("GALLERY_WEBP_QUALITY", "90")))
            mime = "image/webp"
    return dst, mime

# ---------------------- Prebuild ----------------------------
def prebuild_all(images: List[Path], sizes: List[int], max_long: int, build_avif: bool):
    app.logger.info("Prebuild start: %d images, sizes=%s, display=%d, avif=%s", len(images), sizes, max_long, build_avif)
    def work(p: Path):
        # skip tiny
        try:
            from PIL import Image
            with Image.open(p) as im:
                if max(im.width, im.height) < MIN_LONG:
                    return 0
        except Exception:
            return 0
        made = 0
        for fmt in (["avif","webp"] if (build_avif and AVIF_ENABLED) else ["webp"]):
            for w in sizes:
                make_thumbnail(p, w, fmt); made += 1
            make_display(p, max_long, fmt); made += 1
        return made
    total = 0
    with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 4)) as ex:
        for n in ex.map(work, images):
            total += n
    app.logger.info("Prebuild done. Items generated: %d", total)

# ---------------------- Routes ------------------------------
IMAGES_DIR = Path(os.environ.get("GALLERY_IMAGES_DIR", ".")).resolve()
def set_images_dir(p: Path):
    global IMAGES_DIR
    IMAGES_DIR = p.resolve()
    app.logger.info("Using IMAGES_DIR=%s", IMAGES_DIR)

@app.get("/")
def index():
    return send_from_directory(str(Path(__file__).parent), "index.html")

@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(str(Path(__file__).parent / "static"), filename)

@app.get("/api/ping")
def ping():
    return jsonify({"ok": True, "images_dir": str(IMAGES_DIR), "avif": AVIF_ENABLED, "min_long": MIN_LONG, "version": "v0.2.4"})

@app.get("/api/images")
def api_images():
    # Filters: season, state (full name)
    season = (request.args.get("season") or "").strip().lower()
    state = (request.args.get("state") or "").strip()

    files = scan_images(IMAGES_DIR)
    results = []
    for p in files:
        p_str = str(p)
        meta = meta_cache.get(p_str)
        if meta is None:
            meta = get_exif_metadata(p_str)
            meta_cache.set(p_str, meta)
        summary = summarize_meta(meta)
        summary["_path"] = str(Path(p).relative_to(IMAGES_DIR))
        summary["_name"] = Path(p).name

        w = int(summary.get("ImageWidth") or 0); h = int(summary.get("ImageHeight") or 0)
        if max(w,h) and max(w,h) < MIN_LONG:
            continue

        if season and season != (summary.get("_season","") or "").lower():
            continue
        if state and state != (summary.get("_state","") or ""):
            continue

        results.append(summary)

    return jsonify({"total": len(results), "items": results})

@app.get("/api/facets")
def api_facets():
    files = scan_images(IMAGES_DIR)
    states = set(); seasons = set()
    for p in files:
        meta = meta_cache.get(str(p))
        if meta is None:
            meta = get_exif_metadata(str(p))
            meta_cache.set(str(p), meta)
        summary = summarize_meta(meta)
        w = int(summary.get("ImageWidth") or 0); h = int(summary.get("ImageHeight") or 0)
        if max(w,h) and max(w,h) < MIN_LONG:
            continue
        st = summary.get("_state")
        if st: states.add(st)
        ss = summary.get("_season")
        if ss: seasons.add(ss)
    return jsonify({"states": sorted(states), "seasons": sorted(seasons)})

@app.get("/thumb")
def thumb():
    rel = request.args.get("path")
    w = int(request.args.get("w", "512"))
    fmt = (request.args.get("fmt") or "webp").lower()
    if w not in THUMB_SIZES:
        abort(400, f"Unsupported w. Choose one of {THUMB_SIZES}")
    if not rel: abort(400, "Missing 'path'")
    src = (IMAGES_DIR / rel).resolve()
    try: src.relative_to(IMAGES_DIR)
    except Exception: abort(400, "Invalid path")
    if not src.exists(): abort(404)
    if fmt == "avif" and not AVIF_ENABLED: fmt = "webp"
    dst, mime = make_thumbnail(src, w, fmt)
    return send_file(str(dst), mimetype=mime, conditional=True)

@app.get("/display")
def display():
    rel = request.args.get("path")
    max_long = int(request.args.get("max", str(DISPLAY_MAX)))
    fmt = (request.args.get("fmt") or "webp").lower()
    if not rel: abort(400, "Missing 'path'")
    src = (IMAGES_DIR / rel).resolve()
    try: src.relative_to(IMAGES_DIR)
    except Exception: abort(400, "Invalid path")
    if not src.exists(): abort(404)
    if fmt == "avif" and not AVIF_ENABLED: fmt = "webp"
    dst, mime = make_display(src, max_long, fmt)
    return send_file(str(dst), mimetype=mime, conditional=True)

def parse_args(argv: List[str]) -> argparse.Namespace:
    import argparse
    parser = argparse.ArgumentParser(description="Gallery v0.2.4")
    parser.add_argument("--images", type=str, default=os.environ.get("GALLERY_IMAGES_DIR", "."), help="Path to images root")
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--clean-cache", action="store_true", help="Clean cached items for ignored/tiny sources before starting")
    parser.add_argument("--prebuild", action="store_true", help="Prebuild thumbs and display, then exit")
    parser.add_argument("--prebuild-avif", action="store_true", help="If AVIF available, also prebuild AVIF")
    return parser.parse_args(argv)

def main(argv: List[str]) -> int:
    args = parse_args(argv)
    root = Path(args.images)
    if not root.exists():
        print(f"ERROR: images dir not found: {root}", file=sys.stderr)
        return 2
    CACHE_DIR_THUMBS.mkdir(parents=True, exist_ok=True)
    CACHE_DIR_DISPLAY.mkdir(parents=True, exist_ok=True)
    set_images_dir(root)
    app.logger.setLevel("INFO")

    if args.prebuild:
        imgs = scan_images(IMAGES_DIR)
        prebuild_all(imgs, THUMB_SIZES, DISPLAY_MAX, build_avif=args.prebuild_avif)
        return 0

    app.run(host=args.host, port=args.port, debug=args.debug, threaded=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

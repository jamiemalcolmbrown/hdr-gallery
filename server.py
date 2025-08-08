from __future__ import annotations
from flask import Flask, send_from_directory, jsonify, abort
from pathlib import Path
import json, subprocess
from typing import Dict, Any

ROOT = Path(__file__).resolve().parent
IMAGES_DIR = ROOT / "images"
VIEWER_DIR = ROOT / "viewer"
CACHE_DIR = ROOT / "cache"
CACHE_DIR.mkdir(exist_ok=True)

SUPPORTED = {".avif", ".webp", ".jxl", ".jpg", ".jpeg", ".png"}
MAX_W, MAX_H = 3840, 2160

MEM_CACHE: Dict[str, Dict[str, Any]] = {}

try:
    from PIL import Image, ImageOps
    try:
        import pillow_avif  # noqa: F401
        AVIF_WRITABLE = True
    except Exception:
        AVIF_WRITABLE = False
except Exception:
    Image = None
    ImageOps = None
    AVIF_WRITABLE = False

UNTOUCHED_EXTS = {".jxl"}

EXIFTOOL_FIELDS = [
    "Title", "Description",
    "Province-State", "Location", "Sublocation", "City",
    "Subject", "HierarchicalSubject", "XPKeywords",
    "XMP:Label",
    "Make", "Model",
    "LensModel", "Lens",
    "FNumber", "ApertureValue",
    "ExposureTime", "ShutterSpeed", "ShutterSpeedValue",
    "ISO", "ISOSetting",
    "FocalLength",
    "CreateDate", "DateTimeOriginal"
]

def run_exiftool_batch(files: list[Path]) -> Dict[str, Dict[str, Any]]:
    if not files:
        return {}
    cmd = ["exiftool", "-json"] + [f"-{f}" for f in EXIFTOOL_FIELDS] + [str(p) for p in files]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
        data = json.loads(out.decode("utf-8", errors="replace"))
    except Exception as e:
        print("Exiftool error:", e)
        return {}

    result: Dict[str, Dict[str, Any]] = {}
    for item in data:
        src = item.get("SourceFile")
        if not src:
            continue
        fn = Path(src).name

        title = item.get("Title") or ""
        desc = item.get("Description") or ""
        state = item.get("Province-State") or ""
        loc = item.get("Sublocation") or item.get("Location") or item.get("City") or ""

        tags = []
        for key in ("Subject", "HierarchicalSubject", "XPKeywords"):
            val = item.get(key)
            if isinstance(val, list):
                tags += [str(v) for v in val if v]
            elif isinstance(val, str) and val.strip():
                tags += [t.strip() for t in val.replace(";", ",").split(",") if t.strip()]
        seen, uniq = set(), []
        for t in tags:
            tt = t.strip()
            if tt and tt.lower() not in seen:
                seen.add(tt.lower()); uniq.append(tt)

        lr_label = (item.get("XMP:Label") or "").strip()

        make  = (item.get("Make") or "").strip()
        model = (item.get("Model") or "").strip()
        camera = " ".join([p for p in [make, model] if p]).strip()

        lens = (item.get("LensModel") or item.get("Lens") or "").strip()

        ap = item.get("FNumber") or item.get("ApertureValue")
        try:
            ap_str = f"f/{float(ap):.1f}" if ap else ""
        except Exception:
            ap_str = f"f/{ap}" if ap else ""

        sh = item.get("ExposureTime") or item.get("ShutterSpeed") or item.get("ShutterSpeedValue") or ""
        sh_str = str(sh)

        iso = item.get("ISO") or item.get("ISOSetting") or ""
        iso_str = f"ISO {iso}" if iso else ""

        fl = (item.get("FocalLength") or "").replace(" ", "")
        fl_str = fl if fl else ""

        date = item.get("DateTimeOriginal") or item.get("CreateDate") or ""

        result[fn] = {
            "caption": title,
            "description": desc,
            "state": state,
            "location": loc,
            "tags": uniq,
            "color": "",
            "lr_color_label": lr_label,
            "camera": camera,
            "lens": lens,
            "aperture": ap_str,
            "shutter": sh_str,
            "iso": iso_str,
            "focal_length": fl_str,
            "date": date
        }
    return result

def compute_dominant_color_label(img_path: Path) -> str:
    if Image is None:
        return ""
    try:
        with Image.open(img_path) as im0:
            im = ImageOps.exif_transpose(im0.convert("RGB"))
            im.thumbnail((256, 256))
            px = im.load()
            w, h = im.size
            hue_bins = [0]*360
            gray = black = white = 0
            for y in range(h):
                for x in range(w):
                    r, g, b = px[x, y]
                    rn, gn, bn = r/255.0, g/255.0, b/255.0
                    mx, mn = max(rn, gn, bn), min(rn, gn, bn)
                    v = mx
                    d = mx - mn
                    s = 0 if mx == 0 else d/mx
                    if v < 0.12:
                        black += 1; continue
                    if s < 0.08 and v > 0.9:
                        white += 1; continue
                    if s < 0.08:
                        gray += 1; continue
                    if d == 0:
                        continue
                    if mx == rn:   h = ((gn - bn) / d) % 6
                    elif mx == gn: h = ((bn - rn) / d) + 2
                    else:          h = ((rn - gn) / d) + 4
                    hue = int(60*h) % 360
                    hue_bins[hue] += 1

            total = sum(hue_bins) + gray + black + white
            if total == 0: return ""

            if black/total > 0.35: return "black"
            if white/total > 0.35: return "white"
            if gray/total  > 0.35: return "gray"

            h = max(range(360), key=lambda i: hue_bins[i])
            if h >= 345 or h < 15: return "red"
            if h < 25: return "red-orange"
            if h < 45: return "orange" if (h < 35) else "yellow-orange"
            if h < 65: return "yellow"
            if h < 170: return "green"
            if h < 200: return "cyan"
            if h < 255: return "blue"
            if h < 290: return "purple"
            if h < 320: return "magenta"
            if h < 345: return "pink"
            return "red"
    except Exception as e:
        print("Color compute error:", img_path.name, e)
        return ""

def _scaled_name(src: Path) -> Path:
    ext = src.suffix.lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp"}:
        return CACHE_DIR / src.name
    if ext == ".avif":
        try:
            import pillow_avif  # noqa: F401
            return CACHE_DIR / src.name
        except Exception:
            return CACHE_DIR / (src.stem + ".webp")
    return src

def _needs_scale(w: int, h: int) -> bool:
    return (w > MAX_W) or (h > MAX_H)

def _scale_image(src: Path, dst: Path) -> None:
    if Image is None:
        return
    with Image.open(src) as im0:
        im = ImageOps.exif_transpose(im0.convert("RGB"))
        w, h = im.size
        sf = min(MAX_W / w, MAX_H / h, 1.0)
        if sf < 1.0:
            im = im.resize((int(w*sf), int(h*sf)), Image.LANCZOS)

        ext = dst.suffix.lower()
        if ext in {".jpg", ".jpeg"}:
            im.save(dst, quality=90, optimize=True, subsampling=1)
        elif ext == ".png":
            im.save(dst, optimize=True)
        elif ext == ".webp":
            im.save(dst, quality=90, method=6)
        elif ext == ".avif":
            im.save(dst, quality=90)
        else:
            im.save(dst.with_suffix(".jpg"), quality=90, optimize=True, subsampling=1)

def get_serving_path(src: Path) -> Path:
    ext = src.suffix.lower()
    if ext in {".jxl"} or Image is None:
        return src
    try:
        with Image.open(src) as im:
            w, h = im.size
    except Exception:
        return src
    if not _needs_scale(w, h):
        return src
    dst = _scaled_name(src)
    if dst == src:
        return src
    try:
        if (not dst.exists()) or (dst.stat().st_mtime < src.stat().st_mtime):
            dst.parent.mkdir(parents=True, exist_ok=True)
            _scale_image(src, dst)
    except Exception as e:
        print("Scale error:", src.name, e)
        return src
    return dst

def scan_images() -> list[Path]:
    if not IMAGES_DIR.exists():
        return []
    return sorted([p for p in IMAGES_DIR.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED],
                  key=lambda p: p.name.lower())

def hydrate_cache(files: list[Path]) -> None:
    needs: list[Path] = []
    for p in files:
        mtime = p.stat().st_mtime
        rec = MEM_CACHE.get(p.name)
        if not rec or rec.get("mtime") != mtime:
            needs.append(p)

    if needs:
        meta_map = run_exiftool_batch(needs)
        for p in needs:
            base = meta_map.get(p.name, {
                "caption": "", "description": "", "state": "", "location": "",
                "tags": [], "color": "", "lr_color_label": "",
                "camera": "", "lens": "", "aperture": "", "shutter": "",
                "iso": "", "focal_length": "", "date": ""
            })
            if not base.get("color"):
                base["color"] = compute_dominant_color_label(p) or ""
            MEM_CACHE[p.name] = {"mtime": p.stat().st_mtime, "meta": base}

app = Flask(__name__, static_folder=None)

@app.get("/")
def root():
    return send_from_directory(VIEWER_DIR, "index.html")

@app.get("/viewer/")
def viewer_root():
    return send_from_directory(VIEWER_DIR, "index.html")

@app.get("/viewer/<path:path>")
def viewer_static(path):
    full = (VIEWER_DIR / path).resolve()
    if not str(full).startswith(str(VIEWER_DIR.resolve())):
        return abort(404)
    return send_from_directory(VIEWER_DIR, path)

@app.get("/images/<path:path>")
def images_static(path):
    src = (IMAGES_DIR / path).resolve()
    if not str(src).startswith(str(IMAGES_DIR.resolve())):
        return abort(404)
    if not src.exists() or not src.is_file():
        return abort(404)
    serve_path = get_serving_path(src)
    def is_rel_to(p: Path, base: Path) -> bool:
        try: return p.is_relative_to(base)
        except AttributeError: return str(p.resolve()).startswith(str(base.resolve()))
    if is_rel_to(serve_path, IMAGES_DIR):
        return send_from_directory(IMAGES_DIR, path)
    if is_rel_to(serve_path, CACHE_DIR):
        rel = serve_path.relative_to(CACHE_DIR)
        return send_from_directory(CACHE_DIR, str(rel))
    return send_from_directory(IMAGES_DIR, path)

@app.get("/api/metadata")
def api_metadata():
    files = scan_images()
    hydrate_cache(files)

    images_meta = {p.name: MEM_CACHE.get(p.name, {}).get("meta", {}) for p in files}

    states    = sorted({ (images_meta[f].get("state") or "").strip() for f in images_meta if images_meta[f].get("state") })
    locations = sorted({ (images_meta[f].get("location") or "").strip() for f in images_meta if images_meta[f].get("location") })
    colors    = sorted({ (images_meta[f].get("color") or "").strip() for f in images_meta if images_meta[f].get("color") })
    tagset = set()
    for f in images_meta:
        for t in (images_meta[f].get("tags") or []):
            if isinstance(t, str) and t.strip():
                tagset.add(t.strip())
    tags_sorted = sorted(tagset)

    return jsonify({
        "version": 1,
        "files": [p.name for p in files],
        "images": images_meta,
        "filters": {
            "states": states,
            "locations": locations,
            "colors": colors,
            "tags": tags_sorted
        }
    })

if __name__ == "__main__":
    IMAGES_DIR.mkdir(exist_ok=True)
    VIEWER_DIR.mkdir(exist_ok=True)
    app.run(host="0.0.0.0", port=8000, debug=False)

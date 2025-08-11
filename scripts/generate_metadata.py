#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, subprocess, shutil, re
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List
from PIL import Image, ImageOps
import numpy as np

HDR_SUFFIX = "_hdr.avif"
SDR_SUFFIX = "_sdr.jpg"
THUMBS_DIRNAME = "thumbs"

SEASON_WORDS = {"winter":"Winter","spring":"Spring","summer":"Summer","autumn":"Autumn","fall":"Autumn"}

def pair_key(name: str) -> str:
    lname = name.lower()
    if lname.endswith(HDR_SUFFIX): return name[:-len(HDR_SUFFIX)]
    if lname.endswith(SDR_SUFFIX): return name[:-len(SDR_SUFFIX)]
    return name.rsplit(".",1)[0]

def find_pairs(images_dir: Path):
    items = {}
    for p in images_dir.iterdir():
        if not p.is_file(): continue
        n = p.name.lower()
        if not (n.endswith(HDR_SUFFIX) or n.endswith(SDR_SUFFIX)): continue
        key = pair_key(p.name)
        e = items.setdefault(key, {"key": key, "hdr": None, "sdr": None})
        if n.endswith(HDR_SUFFIX): e["hdr"] = p
        else: e["sdr"] = p
    return [v for v in items.values() if v["hdr"] and v["sdr"]]

def run_exiftool_json(path: Path) -> Optional[Dict[str, Any]]:
    if not shutil.which("exiftool"):
        return None
    try:
        out = subprocess.check_output([
            "exiftool","-j","-n",
            "-GPSLatitude","-GPSLongitude",
            "-DateTimeOriginal",
            "-Subject","-HierarchicalSubject",
            "-XMP-photoshop:State","-State",
            "-XMP:City","-IPTC:City","-XMP:Location","-XMP:Sub-location",
            "-XMP:Title","-IPTC:ObjectName","-XMP:Headline",
            "-XMP:Description","-ImageDescription",
            str(path)
        ])
        arr = json.loads(out.decode("utf-8", errors="ignore"))
        return arr[0] if arr else None
    except Exception:
        return None

def gps_keywords_title_desc_city_state(path: Path):
    """Return (lat, lon, keywords, city, state_text, dto, title, description). ExifTool-only."""
    j = run_exiftool_json(path)
    if not j:
        return None, None, [], None, None, "", "", ""
    lat = j.get("GPSLatitude")
    lon = j.get("GPSLongitude")
    # keywords
    subs = j.get("Subject", [])
    if isinstance(subs, str): subs = [subs]
    hs = j.get("HierarchicalSubject", [])
    if isinstance(hs, str): hs = [hs]
    keywords = list(dict.fromkeys([*(subs or []), *(hs or [])]))
    # location text fields
    city = j.get("City") or j.get("XMP:City") or j.get("IPTC:City") or j.get("Location") or j.get("Sub-location") or None
    state_text = j.get("State") or j.get("XMP:State") or j.get("XMP-photoshop:State") or None
    # datetime
    dto = j.get("DateTimeOriginal", "") or ""
    # title priority
    title = j.get("Title") or j.get("XMP:Title") or j.get("ObjectName") or j.get("IPTC:ObjectName") or j.get("Headline") or j.get("XMP:Headline") or ""
    # description priority
    description = j.get("Description") or j.get("XMP:Description") or j.get("ImageDescription") or ""
    # coerce numeric
    try: lat = float(lat) if lat is not None else None
    except Exception: lat = None
    try: lon = float(lon) if lon is not None else None
    except Exception: lon = None
    return lat, lon, keywords, city, state_text, dto, title, description

def season_from(dto: str, keywords: List[str], allow_month: bool) -> str:
    for k in keywords:
        w = k.strip().lower()
        if w in SEASON_WORDS: return SEASON_WORDS[w]
        if w.startswith("season:"):
            w2 = w.split(":",1)[1].strip()
            if w2 in SEASON_WORDS: return SEASON_WORDS[w2]
    if not allow_month or not dto:
        return ""
    try:
        month = int(str(dto).split(":")[1])
        if month in (12,1,2): return "Winter"
        if month in (3,4,5): return "Spring"
        if month in (6,7,8): return "Summer"
        return "Autumn"
    except Exception:
        return ""

def dominant_color_bucket(jpeg_path: Path) -> str:
    try:
        with Image.open(jpeg_path) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            w,h = im.size
            im = im.resize((256, max(1,int(256*h/max(1,w)))), Image.LANCZOS)
            arr = np.asarray(im).astype(np.float32)/255.0
        r,g,b = arr[...,0], arr[...,1], arr[...,2]
        mx = np.max(arr, axis=-1); mn = np.min(arr, axis=-1); chroma = mx-mn
        mask = chroma > 0.12
        if not np.any(mask): return "Neutral"
        hue = np.zeros_like(mx)
        rmax, gmax = (mx==r), (mx==g)
        bmax = (mx==b)
        hue[rmax] = ((g-b)[rmax]/(chroma[rmax]+1e-6))%6
        hue[gmax] = ((b-r)[gmax]/(chroma[gmax]+1e-6))+2
        hue[bmax] = ((r-g)[bmax]/(chroma[bmax]+1e-6))+4
        hue = (hue*60.0)[mask]
        bins = [0,20,45,70,160,200,255,290,320,360]
        labels = ["Red","Orange","Yellow","Green","Cyan","Blue","Purple","Magenta"]
        hist,_ = np.histogram(hue, bins=bins)
        return labels[int(hist.argmax())] if hist.sum()>0 else "Neutral"
    except Exception:
        return "Neutral"

def ensure_thumb(images_dir: Path, key: str, sdr_path: Path, long_land: int=480, long_port: int=360) -> None:
    thumbs_dir = images_dir / THUMBS_DIRNAME
    thumbs_dir.mkdir(exist_ok=True)
    out = thumbs_dir / f"{key}.jpg"
    if out.exists() and out.stat().st_mtime >= sdr_path.stat().st_mtime: return
    with Image.open(sdr_path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        w,h = im.size
        long_edge = long_land if w>=h else long_port
        scale = long_edge / float(max(w,h))
        if scale < 1.0:
            im = im.resize((int(w*scale), int(h*scale)), Image.LANCZOS)
        im.save(out, "JPEG", quality=85, optimize=True, progressive=True)

def bbox_state(lat: float, lon: float, bbox_map: Dict[str, list]) -> Optional[str]:
    try:
        lat = float(lat); lon = float(lon)
    except Exception:
        return None
    for state, (lat_min, lat_max, lon_min, lon_max) in bbox_map.items():
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            return state
    return None

def us_state_abbrev_map() -> Dict[str,str]:
    return {
        "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO",
        "Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID",
        "Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA",
        "Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS",
        "Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ",
        "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK",
        "Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",
        "Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA",
        "West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC"
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--merge", action="store_true")
    ap.add_argument("--allow-filename-state", action="store_true")
    ap.add_argument("--allow-month-fallback", action="store_true", help="If set, use EXIF month when season keyword missing")
    ap.add_argument("--thumb-long-landscape", type=int, default=480)
    ap.add_argument("--thumb-long-portrait", type=int, default=360)
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    images_dir = Path(args.images).resolve()
    bbox_map = json.loads((Path(__file__).parent / "us_states_bbox.json").read_text("utf-8"))
    abbr_map = us_state_abbrev_map()

    meta_path = images_dir / "metadata.json"
    meta: Dict[str, Dict[str, Any]] = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text("utf-8"))
            if not isinstance(meta, dict): meta = {}
        except Exception:
            meta = {}

    pairs = find_pairs(images_dir)

    for it in pairs:
        key, sdr = it["key"], it["sdr"]
        entry = meta.get(key, {}) if args.merge else {}

        title = entry.get("title") if args.merge else None
        description = entry.get("description") if args.merge else None
        city = entry.get("city") if args.merge else None
        state_fullname = entry.get("state_fullname") if args.merge else None
        season = entry.get("season") if args.merge else None
        color = entry.get("color") if args.merge else None
        tags = entry.get("tags", []) if args.merge else []

        lat, lon, keywords, j_city, j_state_text, dto, j_title, j_desc = gps_keywords_title_desc_city_state(sdr)

        # Fill title/description only if empty (merge-safe), never from filename
        title = title or j_title or ""
        description = description or j_desc or ""

        # City (merge-safe)
        city = city or j_city or ""

        # State from GPS bbox or XMP text; allow filename state as very last resort if requested
        if not state_fullname:
            guessed = None
            if lat is not None and lon is not None:
                guessed = bbox_state(lat, lon, bbox_map)
            if not guessed and j_state_text:
                guessed = j_state_text
            if not guessed and args.allow_filename_state and "__" in key:
                guessed = key.split("__",1)[0]
            state_fullname = guessed or ""

        # Season
        if not season:
            season = season_from(dto, keywords, allow_month=args.allow_month_fallback)

        # Color + tags
        color = color or dominant_color_bucket(sdr)
        base_tags = [t for t in [state_fullname, season, color] if t]
        tags = list(dict.fromkeys((tags or []) + base_tags))

        meta[key] = {
            "title": title,
            "description": description,
            "city": city,
            "state_fullname": state_fullname or "",
            "state_abbr": (abbr_map.get(state_fullname) if state_fullname else "") or "",
            "season": season or "",
            "color": color or "",
            "tags": tags
        }

        ensure_thumb(images_dir, key, sdr, args.thumb_long_landscape, args.thumb_long_portrait)

        if args.debug:
            gps_flag = "yes" if (lat is not None and lon is not None) else "no"
            loc = ", ".join([p for p in [city, (abbr_map.get(state_fullname) if state_fullname else "")] if p])
            tlog = (title[:40] + "…" if title and len(title) > 40 else (title or ""))
            print(f"{key}: GPS={gps_flag} -> state='{state_fullname}', city='{city}', season='{season}', color='{color}' | title='{tlog}'")

    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Wrote {meta_path}")
    print(f"Thumbnails in {images_dir / THUMBS_DIRNAME}/")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, subprocess, shutil
from pathlib import Path
from typing import Dict, Any, Optional, List
from PIL import Image, ImageOps
import numpy as np

HDR_SUFFIX = "_hdr.avif"
SDR_SUFFIX = "_sdr.jpg"
THUMBS_DIRNAME = "thumbs"

SEASON_WORDS = {'winter':'Winter','spring':'Spring','summer':'Summer','autumn':'Autumn','fall':'Autumn'}

STATE_ABBR = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA",
  "Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM",
  "New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
  "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY",
  "District of Columbia":"DC"
}

def pair_key(name: str) -> str:
  n = name.lower()
  if n.endswith(HDR_SUFFIX): return name[:-len(HDR_SUFFIX)]
  if n.endswith(SDR_SUFFIX): return name[:-len(SDR_SUFFIX)]
  return name.rsplit('.',1)[0]

def find_pairs(images_dir: Path):
  items = {}
  for p in images_dir.iterdir():
    if not p.is_file(): continue
    n = p.name.lower()
    if not (n.endswith(HDR_SUFFIX) or n.endswith(SDR_SUFFIX)): continue
    k = pair_key(p.name)
    e = items.setdefault(k, {"key": k, "hdr": None, "sdr": None})
    if n.endswith(HDR_SUFFIX): e["hdr"] = p
    else: e["sdr"] = p
  return [v for v in items.values() if v.get("sdr")]

def run_exiftool_json(path: Path) -> Optional[Dict[str, Any]]:
  if not shutil.which("exiftool"):
    return None
  try:
    out = subprocess.check_output([
      "exiftool","-j","-n",
      "-GPSLatitude","-GPSLongitude",
      "-Subject","-HierarchicalSubject",
      "-XMP-photoshop:State",
      "-City","-XMP:City","-IPTC:City","-XMP:Location","-XMP:Sub-location",
      "-XMP:Title","-IPTC:ObjectName","-XMP:Headline",
      "-XMP:Description","-ImageDescription",
      "-DateTimeOriginal",
      str(path)
    ])
    arr = json.loads(out.decode("utf-8","ignore"))
    return arr[0] if arr else None
  except Exception:
    return None

def title_desc_city_state(jpeg: Path):
  j = run_exiftool_json(jpeg) or {}
  # Title
  title = j.get("Title") or j.get("ObjectName") or j.get("Headline") or ""
  # Description
  desc = j.get("Description") or j.get("ImageDescription") or ""
  # City
  city = j.get("City") or j.get("XMP:City") or j.get("IPTC:City") or j.get("Location") or j.get("Sub-location") or ""
  # State
  xstate = j.get("State") or j.get("XMP:State") or ""
  return (title or ""), (desc or ""), (city or ""), (xstate or "")

def season_from(dto: str, keywords: List[str], allow_month: bool) -> str:
  for k in keywords or []:
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
    import numpy as np2
    hist,_ = np2.histogram(hue, bins=bins)
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

def main():
  ap = argparse.ArgumentParser()
  ap.add_argument("--images", required=True)
  ap.add_argument("--merge", action="store_true")
  ap.add_argument("--allow-month-fallback", action="store_true")
  ap.add_argument("--thumb-long-landscape", type=int, default=480)
  ap.add_argument("--thumb-long-portrait", type=int, default=360)
  ap.add_argument("--debug", action="store_true", default=False)
  args = ap.parse_args()

  images_dir = Path(args.images).resolve()
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
    key = it["key"]
    sdr = it["sdr"]
    entry = meta.get(key, {}) if args.merge else {}

    # title/desc/city/state from ExifTool (no filename fallback)
    title, desc, city, xstate = title_desc_city_state(sdr)

    # merge-safe
    if not entry.get("title"): entry["title"] = title or ""
    if not entry.get("description"): entry["description"] = desc or ""
    if not entry.get("city"): entry["city"] = city or ""
    if not entry.get("state_fullname"): entry["state_fullname"] = xstate or ""
    if not entry.get("state_abbr") and entry.get("state_fullname"):
      entry["state_abbr"] = STATE_ABBR.get(entry["state_fullname"], "")
    elif not entry.get("state_abbr") and xstate:
      entry["state_abbr"] = STATE_ABBR.get(xstate, "")

    # season via keywords/month (kept simple: we read again with exiftool for Subject + DateTimeOriginal)
    j = run_exiftool_json(sdr) or {}
    subs = j.get("Subject", [])
    if isinstance(subs, str): subs = [subs]
    hs = j.get("HierarchicalSubject", [])
    if isinstance(hs, str): hs = [hs]
    keywords = list(dict.fromkeys([*(subs or []), *(hs or [])]))
    dto = j.get("DateTimeOriginal", "") or ""
    if not entry.get("season"):
      entry["season"] = season_from(dto, keywords, allow_month=args.allow_month_fallback)

    # color
    if not entry.get("color"):
      entry["color"] = dominant_color_bucket(sdr)

    # tags (dedupe)
    tags = entry.get("tags", [])
    for t in [entry.get("state_fullname",""), entry.get("season",""), entry.get("color","")]:
      if t and t not in tags:
        tags.append(t)
    entry["tags"] = tags

    meta[key] = entry

    ensure_thumb(images_dir, key, sdr, args.thumb_long_landscape, args.thumb_long_portrait)

    if args.debug:
      print(f"{key}: state='{entry.get('state_fullname','')}', city='{entry.get('city','')}', season='{entry.get('season','')}', color='{entry.get('color','')}'")

  meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
  print(f"Wrote {meta_path}")
  print(f"Thumbnails in {images_dir / THUMBS_DIRNAME}/")

if __name__ == "__main__":
  main()

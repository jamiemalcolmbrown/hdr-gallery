# Gallery v0.2.4

**New in v0.2.4:**
- **Masonry layout (no cropping):** variable-height thumbs; clean scaffold.
- **Captions:** Only **Title** and **State (full)**, if present — otherwise no caption.
- **States fully spelled out** (e.g., “MA” → “Massachusetts”). Facets and filters use full names.
- **Prebuild:** `--prebuild` to warm 256/512/1024 thumbs and 4K display; add `--prebuild-avif` to include AVIF.

## Install
```
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Optional AVIF:
pip install pillow-avif-plugin
```

## Prebuild (recommended)
```
python server.py --images /path/to/images --prebuild
# Or:
python server.py --images /path/to/images --prebuild --prebuild-avif
```

## Run
```
python server.py --images /path/to/images --host 0.0.0.0 --port 8080
```

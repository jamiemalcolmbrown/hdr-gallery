# Development Guidelines (v0.4)
- Flask entry point stays **app.py** (do not rename).
- Frontend JS is **static/js/gallery.js** (no other names).
- Styles in **static/css/styles.css**.
- HTML template stays **templates/index.html**.
- Prebuild script is **scripts/generate_metadata.py**.
- Repo is **code only** (images, thumbs, metadata, venv, cache are ignored via .gitignore).

Keyboard & Touch
- Esc = close fullscreen and return Home (clears filters).
- T = toggle fullscreen toolbar.
- C = toggle HDR compare slider.
- ← / → (or swipe left/right on touch) navigate within **filtered set** only.

Layout
- Thumbnails show **Title** (if present) and **City, ST** on a second line.
- Fullscreen overlay is always visible, bottom-left ~1/3 up, opaque, showing Title, Description, City, State (full), Season.
- Navigation uses crossfade + subtle slide.

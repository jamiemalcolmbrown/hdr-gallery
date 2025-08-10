# Gallery v0.2.8

- HDR/SDR badge and Title/Location/Description overlay in fullscreen
- Left sidebar with Season (low-saturation colors) and State buttons
- Masonry (no-crop) grid, Title + State captions
- Fullscreen cross-fade transitions
- Prefer AVIF toggle; Prefer HDR (experimental) toggle (fullscreen only)
- Prebuild options:
  ```
  python server.py --images /path/to/images --prebuild
  python server.py --images /path/to/images --prebuild --prebuild-avif
  python server.py --images /path/to/images --prebuild --prebuild-avif --prebuild-hdr
  ```
- Requires Pillow; AVIF/HDR needs `pillow-avif-plugin`.

## Run
```
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# for AVIF/HDR:
pip install pillow-avif-plugin
python server.py --images /path/to/images --host 0.0.0.0 --port 8080
```

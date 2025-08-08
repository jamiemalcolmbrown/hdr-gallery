# HDR Image Gallery – Clean Build

Includes:
- server.py (live Lightroom IPTC/XMP via exiftool, dominant color, auto-scale+cache 3840×2160)
- viewer/ (big metadata overlay, tags as chips, filter chips UI scaffold)
- images/ (drop your exports here)
- cache/ (auto-created scaled images)

Run:
  sudo apt update && sudo apt install -y libimage-exiftool-perl python3-pil
  python3 server.py
  # open http://localhost:8000/viewer/

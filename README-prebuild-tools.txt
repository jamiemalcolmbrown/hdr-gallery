Prebuild Tools for Image Gallery (metadata.json generator)

This add-on generates /images/metadata.json based on your JPEG/AVIF pairs.

What it does
- Scans /images for files named <Key>_sdr.jpg and <Key>_hdr.avif
- Derives:
  • title: from the key (after optional "Category__" or "State__" prefix)
  • state_fullname: from "State__" prefix IF present, else blank
  • season: from capture date (EXIF) if available; else blank
  • color: dominant color bucket derived from the SDR JPEG
- Writes /images/metadata.json with an entry per Key

Usage
  cd ~/image-gallery
  python3 -m venv .venv && source .venv/bin/activate
  pip install -r scripts/requirements-prebuild.txt
  python scripts/generate_metadata.py --images ./images

Optional
  • If you already maintain a metadata.json, re-run this tool with --merge to
    fill in missing fields without overwriting existing ones.

Notes
  • State is read from a filename prefix like: Massachusetts__Sugarloaf Dawn-Edit_sdr.jpg
  • Season is mapped from EXIF capture month:
      Winter=Dec–Feb, Spring=Mar–May, Summer=Jun–Aug, Autumn=Sep–Nov
  • Color buckets: Neutral, Red, Orange, Yellow, Green, Cyan, Blue, Purple, Magenta.

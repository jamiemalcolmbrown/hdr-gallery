# Gallery v0.2 — Safe/Full

## Quick start
1) Create venv & install deps
```
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```
2) Ensure ExifTool is installed & on PATH.
3) Run
```
python server.py --host 0.0.0.0 --port 8080           # shares on your LAN
# or just:
python server.py                                      # localhost only (127.0.0.1:8080)
```
4) Visit http://localhost:8080/

# v0.6.1 Flask server (Pi-5 friendly GPIO + SSE broadcast)
from pathlib import Path
from flask import Flask, render_template, jsonify, send_from_directory, request, Response, stream_with_context
import json
import time
import threading
import queue

# ---------- Paths / constants ----------
BASE = Path(__file__).parent.resolve()
IMAGES = (BASE / "images").resolve()
THUMBS = (IMAGES / "thumbs").resolve()
IMAGES.mkdir(parents=True, exist_ok=True)
THUMBS.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder="static", template_folder="templates")

HDR_SUFFIX = "_hdr.avif"
SDR_SUFFIX = "_sdr.jpg"

# ---------- Simple in-memory filter state ----------
current_filters = {"state": None, "season": None, "color": None}

def apply_filter(facet: str, value):
    if facet not in current_filters:
        return False
    current_filters[facet] = value
    print(f"[filters] {facet} = {value}")
    return True

# ---------- SSE fanout ----------
_clients = set()
_clients_lock = threading.Lock()

def _broadcast(msg: dict):
    with _clients_lock:
        targets = list(_clients)
    for q in targets:
        try:
            q.put_nowait(msg)
        except queue.Full:
            pass

@app.route('/events')
def sse_events():
    q = queue.Queue(maxsize=16)
    with _clients_lock:
        _clients.add(q)

    def gen():
        try:
            # initial comment/handshake
            yield ':ok\n\n'
            while True:
                try:
                    msg = q.get(timeout=15)
                    payload = json.dumps(msg, separators=(',', ':'))
                    yield f'data: {payload}\n\n'
                except queue.Empty:
                    # heartbeat to keep connection alive through proxies
                    yield ':keepalive\n\n'
        finally:
            with _clients_lock:
                _clients.discard(q)

    headers = {
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',  # disable nginx buffering if present
        'Connection': 'keep-alive',
    }
    return Response(stream_with_context(gen()), mimetype='text/event-stream', headers=headers)

# ---------- Manifest helpers ----------

def _is_pair(p: Path) -> bool:
    n = p.name.lower()
    return n.endswith(HDR_SUFFIX) or n.endswith(SDR_SUFFIX)


def _key(name: str) -> str:
    n = name.lower()
    if n.endswith(HDR_SUFFIX):
        return name[:-len(HDR_SUFFIX)]
    if n.endswith(SDR_SUFFIX):
        return name[:-len(SDR_SUFFIX)]
    return name.rsplit('.', 1)[0]


def _load_meta() -> dict:
    mpath = IMAGES / "metadata.json"
    if not mpath.exists():
        return {}
    try:
        data = json.loads(mpath.read_text('utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

# ---------- Routes ----------

@app.after_request
def _no_cache(resp):
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/manifest.json')
def manifest():
    # Build pairs
    items = {}
    for p in sorted(IMAGES.iterdir()):
        if not p.is_file() or not _is_pair(p):
            continue
        k = _key(p.name)
        e = items.setdefault(k, {"key": k, "hdr": None, "sdr": None})
        if p.name.lower().endswith(HDR_SUFFIX):
            e["hdr"] = p.name
        elif p.name.lower().endswith(SDR_SUFFIX):
            e["sdr"] = p.name

    manifest = [v for v in items.values() if v["hdr"] and v["sdr"]]

    meta = _load_meta()
    for it in manifest:
        m = meta.get(it["key"], {})
        it["title"] = m.get("title") or ""
        it["description"] = m.get("description") or ""
        it["city"] = m.get("city") or ""
        it["state_fullname"] = m.get("state_fullname") or ""
        it["state_abbr"] = m.get("state_abbr") or ""
        it["season"] = m.get("season") or ""
        it["color"] = m.get("color") or ""
        it["tags"] = m.get("tags") or []
        tname = f"{it['key']}.jpg"
        it["thumb"] = f"/thumbs/{tname}" if (THUMBS / tname).exists() else f"/images/{it['sdr']}"

    manifest.sort(key=lambda x: ((x.get("title") or "").lower(), x["key"].lower()))
    return jsonify({"ok": True, "version": "v0.6.1", "hdr": True, "items": manifest})


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/images/<path:filename>')
def image_file(filename):
    return send_from_directory(IMAGES, filename)


@app.route('/thumbs/<path:filename>')
def thumb_file(filename):
    return send_from_directory(THUMBS, filename)


@app.route('/health')
def health():
    return jsonify({"ok": True, "version": "v0.6.1", "filters": current_filters})


# --- Filter APIs ---
@app.post('/api/filters/set')
def api_filters_set():
    data = request.get_json(force=True, silent=True) or {}
    facet = data.get('facet')
    value = data.get('value')
    ok = apply_filter(facet, value)
    if ok:
        _broadcast({'type': 'apply_filter', 'facet': facet, 'value': value})
    return jsonify({'ok': ok, 'filters': current_filters})


@app.get('/api/filters/current')
def api_filters_current():
    return jsonify({'ok': True, 'filters': current_filters})


# ---------- GPIO button watcher (GPIO27→Green, GPIO17→Blue) ----------
# Pi‑5 friendly via gpiozero + lgpio. Auto‑disables if not available.
try:
    from gpiozero import Button
    _GPIOZERO = True
except Exception:
    _GPIOZERO = False
    Button = None


class ButtonWatcher:
    # Map color name → BCM pin
    MAP = {
        'Green': {'pin': 27},  # board pin 13
        'Blue':  {'pin': 13},  # board pin 11
    }
    DEBOUNCE_S = 0.08   # 80 ms

    def __init__(self):
        self.btns = {}

    def start(self):
        if not _GPIOZERO:
            print("[gpio] gpiozero not available; button watcher disabled.")
            return
        for name, cfg in self.MAP.items():
            pin = int(cfg['pin'])
            btn = Button(pin, pull_up=True, bounce_time=self.DEBOUNCE_S)
            btn.when_pressed = (lambda n=name: self._pressed(n))
            self.btns[name] = btn
            print(f"[gpio] gpiozero watching GPIO{pin} for {name}")

    def _pressed(self, color_name: str):
        try:
            apply_filter('color', color_name)
            _broadcast({'type': 'apply_filter', 'facet': 'color', 'value': color_name})
        except Exception as e:
            print('[gpio] handler error:', e)

    def stop(self):
        for name, btn in list(self.btns.items()):
            try:
                btn.close()
            except Exception:
                pass
        self.btns.clear()
        print('[gpio] Button watcher stopped')


_watcher = ButtonWatcher()
_watcher.start()


# ---------- Dev entrypoint ----------
if __name__ == '__main__':
    # For development only; in production, use gunicorn (service below)
    app.run(host='0.0.0.0', port=5000, threaded=True)

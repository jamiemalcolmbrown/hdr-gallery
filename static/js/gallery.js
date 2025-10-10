// gallery.js  v0.5.9 (hardware filter sync + joystick select + unified nav + blue-exit)
console.log('[gallery] v0.5.9');

let __inDelayFrac = 0.85; // v0.5.6: fraction of OUT duration before IN starts
let __lastDir = 'right';  // v0.5.5 direction memory

(async function() {
  const r = await fetch('/manifest.json', {cache:'no-store'});
  const manifest = await r.json();
  const allItems = manifest.items || [];

  // v0.5.6 helper: get animation duration from CSS var (ms)
  function __animDurMs() {
    const v = String(getComputedStyle(document.documentElement).getPropertyValue('--anim-dur') || '').trim();
    if (v.endsWith('ms')) return parseFloat(v) || 0;
    if (v.endsWith('s'))  return (parseFloat(v) || 0) * 1000;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 1000; // default 1s
  }

  // v0.4.11: encode filenames for src/srcset (spaces in srcset break parsing)
  function encFile(f){ if(!f) return ''; return f.split('/').map(encodeURIComponent).join('/'); }

  function ensureViewerScaffold() {
    if (!document.getElementById('viewer')) {
      const v = document.createElement('div');
      v.id = 'viewer';
      v.className = 'viewer hidden';
      v.setAttribute('role', 'dialog');
      v.setAttribute('aria-modal', 'true');
      v.innerHTML = `
        <div id="viewerTopBar" class="viewer-toolbar">
          <button id="closeViewer" aria-label="Close">&times;</button>
        </div>
        <div class="stage-container">
          <div class="stage">
            <picture id="pic"><img id="img" alt="" /></picture>
            <div id="compareOverlay" class="compare-overlay">
              <img id="compareSDR" alt="" />
              <img id="compareHDR" alt="" />
              <input id="compareSlider" type="range" min="0" max="100" value="50" />
              <button id="compareToggle" aria-pressed="false" aria-label="Toggle compare"></button>
            </div>
            <div id="metaOverlay" class="meta-overlay"></div>
          </div>
          <button id="prevBtn" class="nav prev" aria-label="Previous">&#10094;</button>
          <button id="nextBtn" class="nav next" aria-label="Next">&#10095;</button>
        </div>`;
      document.body.appendChild(v);
    } else {
      const v = document.getElementById('viewer');
      if (!document.getElementById('viewerTopBar')) {
        const tb = document.createElement('div'); tb.id='viewerTopBar'; tb.className='viewer-toolbar'; v.prepend(tb);
        const close = document.createElement('button'); close.id='closeViewer'; close.textContent='×'; tb.appendChild(close);
      }
      if (!document.querySelector('.stage-container')) {
        const sc = document.createElement('div'); sc.className='stage-container';
        const stage = document.createElement('div'); stage.className='stage'; sc.appendChild(stage);
        if (!document.getElementById('pic')) {
          const pic = document.createElement('picture'); pic.id='pic';
          const img = document.createElement('img'); img.id='img'; img.alt='';
          pic.appendChild(img); stage.appendChild(pic);
        }
        const comp = document.createElement('div'); comp.id='compareOverlay'; comp.className='compare-overlay';
        const sdr = document.createElement('img'); sdr.id='compareSDR'; comp.appendChild(sdr);
        const hdr = document.createElement('img'); hdr.id='compareHDR'; comp.appendChild(hdr);
        const slider = document.createElement('input'); slider.id='compareSlider'; slider.type='range'; slider.min='0'; slider.max='100'; slider.value='50'; comp.appendChild(slider);
        const toggle = document.createElement('button'); toggle.id='compareToggle'; toggle.setAttribute('aria-pressed','false'); comp.appendChild(toggle);
        stage.appendChild(comp);
        if (!document.getElementById('metaOverlay')) {
          const mo = document.createElement('div'); mo.id='metaOverlay'; mo.className='meta-overlay'; stage.appendChild(mo);
        }
        const prev = document.createElement('button'); prev.id='prevBtn'; prev.className='nav prev'; prev.innerHTML='&#10094;';
        const next = document.createElement('button'); next.id='nextBtn'; next.className='nav next'; next.innerHTML='&#10095;';
        sc.appendChild(prev); sc.appendChild(next);
        v.appendChild(sc);
      }
    }
    const scExisting = document.querySelector('.stage-container');
    if (scExisting && !document.getElementById('pic')) {
      const stage = scExisting.querySelector('.stage') || scExisting;
      const pic = document.createElement('picture'); pic.id='pic';
      const img = document.createElement('img'); img.id='img'; img.alt=''; pic.appendChild(img);
      const compareOverlay = document.getElementById('compareOverlay');
      if (compareOverlay && compareOverlay.parentElement === scExisting) {
        scExisting.insertBefore(pic, compareOverlay);
      } else {
        stage.insertBefore(pic, stage.firstChild);
      }
    }
  }
  ensureViewerScaffold();

  const stateFilters = document.getElementById('stateFilters');
  const seasonFilters = document.getElementById('seasonFilters');
  const colorFilters = document.getElementById('colorFilters');
  const thumbGrid = document.getElementById('thumbGrid');
  const emptyState = document.getElementById('emptyState');
  const homeBtn = document.getElementById('homeBtn');

  const viewer = document.getElementById('viewer');
  if (!document.getElementById('viewer')) { console.warn('[viewer] Scaffold missing post-inject'); return; }
  const topbar = document.getElementById('viewerTopBar');
  const closeViewer = document.getElementById('closeViewer');
  const pic = document.getElementById('pic');
  const overlay = document.getElementById('compareOverlay');
  const compareSDR = document.getElementById('compareSDR');
  const compareHDR = document.getElementById('compareHDR');
  const compareToggle = document.getElementById('compareToggle');
  const compareControl = document.getElementById('compareControl');
  const compareSlider = document.getElementById('compareSlider');
  const metaOverlay = document.getElementById('metaOverlay');
  const stageContainer = document.querySelector('.stage-container') || ((typeof layerHost !== 'undefined' && layerHost) ? layerHost.parentElement : null) || document.getElementById('viewer');
  if (metaOverlay && stageContainer && metaOverlay.parentElement !== stageContainer) {
    try { stageContainer.appendChild(metaOverlay); } catch(e){}
  }
  function showMeta() {
    const metaOverlay = document.getElementById('metaOverlay');
    if (!metaOverlay) return;
    metaOverlay.classList.remove('hidden');
    metaOverlay.style.display = 'block';
    metaOverlay.style.opacity = '1';
  }

  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');

  let currentList = [];
  let index = 0;

  // --- active filters ---
  const active = { state: null, season: null, color: null };

  // Expose a simple filter applier so SSE can call it
  window.applyFilter = function (facet, value) {
    if (!facet) return false;
    if (active[facet] === value) return true;
    active[facet] = value ?? null;
    renderChips();
    renderThumbs();
    try { showMeta(); } catch(e){}
    return true;
  };

  // ===== availability helper =====
  function computeAvailability() {
    const avail = { states: new Set(), seasons: new Set(), colors: new Set() };
    for (const it of allItems) {
      if ((active.season ? it.season === active.season : true) &&
          (active.color  ? it.color  === active.color  : true)) {
        if (it.state_fullname) avail.states.add(it.state_fullname);
      }
      if ((active.state  ? it.state_fullname === active.state : true) &&
          (active.color  ? it.color          === active.color : true)) {
        if (it.season) avail.seasons.add(it.season);
      }
      if ((active.state  ? it.state_fullname === active.state : true) &&
          (active.season ? it.season         === active.season: true)) {
        if (it.color) avail.colors.add(it.color);
      }
    }
    return avail;
  }

  // chip factory
  function chip(label, type, disabled) {
    const el = document.createElement('button');
    el.className = 'chip';
    el.textContent = label || 'Unknown';
    if (disabled) {
      el.classList.add('disabled');
      el.setAttribute('aria-disabled', 'true');
    }
    el.addEventListener('click', function(e) {
      if (el.classList.contains('disabled')) {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('chip-wiggle');
        setTimeout(function(){ el.classList.remove('chip-wiggle'); }, 250);
        return;
      }
      active[type] = (active[type] === label) ? null : label;
      renderChips();
      renderThumbs();
      try { showMeta(); } catch(e){}
    });
    return el;
  }

  const uniq = arr => Array.from(new Set(arr.filter(Boolean))).sort((a,b)=>a.localeCompare(b));
  const states = uniq(allItems.map(i => i.state_fullname));
  const seasons = uniq(allItems.map(i => i.season));
  const colors  = uniq(allItems.map(i => i.color));

  // renderChips
  function renderChips() {
    stateFilters.innerHTML = '';
    seasonFilters.innerHTML = '';
    colorFilters.innerHTML  = '';

    const avail = computeAvailability();

    states.forEach(function(s) {
      const disabled = !avail.states.has(s);
      const el = chip(s, 'state', disabled);
      if (active.state === s) el.classList.add('active');
      stateFilters.appendChild(el);
    });
    seasons.forEach(function(s) {
      const disabled = !avail.seasons.has(s);
      const el = chip(s, 'season', disabled);
      if (active.season === s) el.classList.add('active');
      seasonFilters.appendChild(el);
    });
    colors.forEach(function(c) {
      const disabled = !avail.colors.has(c);
      const el = chip(c, 'color', disabled);
      if (active.color === c) el.classList.add('active');
      colorFilters.appendChild(el);
    });
  }

  function matches(i) {
    const sOk  = active.state  ? active.state  === i.state_fullname : true;
    const seOk = active.season ? active.season === i.season         : true;
    const cOk  = active.color  ? active.color  === i.color          : true;
    return sOk && seOk && cOk;
  }

  function titleLine(it) { return it.title || ''; }
  function locLine(it) {
    const city = it.city || '';
    const st = it.state_abbr || '';
    if (city && st) return `${city}, ${st}`;
    if (city) return city;
    if (st) return st;
    return '';
  }

  function thumbHtml(it, idxInCurrent) {
    const t = titleLine(it);
    const l = locLine(it);
    const label = (t || l)
      ? `<div class="label">${t ? `<div class='title'>${t}</div>` : ''}${l ? `<div class='loc'>${l}</div>` : ''}</div>`
      : '';
    return `<div class="thumb" data-idx="${idxInCurrent}">
      <div class="ph" aria-hidden="true"></div>
      <img src="${it.thumb}" alt="${t || ''}" loading="lazy" decoding="async" />
      ${label}
    </div>`;
  }

  function renderThumbs() {
    currentList = allItems.filter(matches);
    if (!currentList.length) {
      emptyState?.classList.remove('hidden');
      if (thumbGrid) thumbGrid.innerHTML = '';
      return;
    }
    emptyState?.classList.add('hidden');

    if (thumbGrid) {
      thumbGrid.innerHTML = currentList.map((it, idx) => thumbHtml(it, idx)).join('');

      // Reveal labels only when images are fully loaded
      thumbGrid.querySelectorAll('.thumb').forEach(th => {
        const img = th.querySelector('img');
        const ph  = th.querySelector('.ph');
        const done = () => {
          th.classList.add('is-loaded');
          ph?.remove();
        };
        if (img.complete && img.naturalWidth) done();
        else {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true }); // don't hang on broken images
        }
        // click-to-open
        th.addEventListener('click', () => openViewer(parseInt(th.getAttribute('data-idx'), 10)));
      });

      // After re-render, ensure a selection exists (cooperate with nav block)
      document.dispatchEvent(new CustomEvent('gallery:rendered'));
    }
  }

  function prefetchNeighbors(list, idx) {
    if (!Array.isArray(list) || !list.length) return;
    const next = list[(idx + 1) % list.length];
    const prev = list[(idx - 1 + list.length) % list.length];
    [next, prev].forEach(it => {
      if (!it) return;
      const url = it.sdr
        ? `/images/${encodeURIComponent(it.sdr)}`
        : (it.key ? `/images/${encodeURIComponent(it.key + '_sdr.jpg')}` : '');
      if (!url) return;
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.src = url;
    });
  }

  function sdrUrl(entry) { const k = entry && (entry.sdr || entry.key); if (!k) return ''; const f = entry.sdr ? entry.sdr : `${entry.key}_sdr.jpg`; return `/images/${encFile(f)}`; }
  function hdrUrl(entry) { const k = entry && (entry.hdr || entry.key); if (!k) return ''; const f = entry.hdr ? entry.hdr : `${entry.key}_hdr.avif`; return `/images/${encFile(f)}`; }

  function setOverlay(entry) {
    const title = entry.title || '';
       const desc = entry.description || '';
    const city = entry.city || '';
    const state = entry.state_fullname || '';
    const season = entry.season || '';
    const parts = [];
    if (title) parts.push(`<div class="meta-title">${title}</div>`);
    if (desc) parts.push(`<div class="meta-desc">${desc}</div>`);
    const loc = [city, state].filter(Boolean).join(', ');
    if (loc) parts.push(`<div class="meta-sub">${loc}</div>`);
    if (season) parts.push(`<div class="meta-sub">${season}</div>`);
    metaOverlay.innerHTML = parts.join('');
  }

  async function setImage(entry) {
    const container = document.querySelector('.stage-container') || document.getElementById('viewer') || document.body;

    // Build a fresh <picture> with SDR/HDR sources (no animation classes)
    const picNew = document.createElement('picture');

    // (HDR source is optional; during slideshow you may skip it)
    const srcHdr = document.createElement('source');
    srcHdr.setAttribute('type', 'image/avif');
    const _hdr = hdrUrl(entry);
    if (_hdr && /\.[a-z0-9]+$/i.test(_hdr)) { srcHdr.setAttribute('sizes', '100vw'); srcHdr.srcset = `${_hdr} 1x`; }

    const srcSdr = document.createElement('source');
    srcSdr.setAttribute('type', 'image/jpeg');
    const _sdr = sdrUrl(entry);
    if (_sdr && /\.[a-z0-9]+$/i.test(_sdr)) { srcSdr.setAttribute('sizes', '100vw'); srcSdr.srcset = `${_sdr} 1x`; }

    if (srcHdr.srcset) picNew.appendChild(srcHdr);
    if (srcSdr.srcset) picNew.appendChild(srcSdr);

    const img = document.createElement('img');
    img.alt = titleLine(entry) || '';
    img.loading = 'eager';
    img.decoding = 'async';
    img.setAttribute('fetchpriority', 'high');
    img.src = (_sdr || _hdr || '');
    picNew.appendChild(img);

    // Replace existing #pic immediately (no classes, no timeouts)
    const oldPic = document.getElementById('pic');
    if (oldPic && oldPic.parentElement) {
      oldPic.parentElement.replaceChild(picNew, oldPic);
    } else {
      container.appendChild(picNew);
    }
    picNew.id = 'pic';

    // Update compare overlay sources (instant)
    const compareSDREl = document.getElementById('compareSDR');
    const compareHDREl = document.getElementById('compareHDR');
    if (compareSDREl) { const u = _sdr || _hdr || ''; if (u) compareSDREl.src = u; }
    if (compareHDREl) { const u = _hdr || _sdr || ''; if (u) compareHDREl.src = u; }

    // Refill metadata overlay
    setOverlay(entry);
    showMeta();

    // Prefetch neighbors
    try { prefetchNeighbors(currentList, index); } catch(e) {}
  }

  function openViewer(i) {
    index = i;
    let viewerEl = document.getElementById('viewer');
    let topbarEl = document.getElementById('viewerTopBar');
    if (!viewerEl || !topbarEl) {
      if (typeof ensureViewerScaffold === 'function') ensureViewerScaffold();
      viewerEl = document.getElementById('viewer'); topbarEl = document.getElementById('viewerTopBar');
    }
    if (!viewerEl || !topbarEl) { console.warn('[viewer] Missing viewer/topbar nodes.'); return; }
    viewerEl.classList.remove('hidden'); topbarEl.classList.add('hidden');
    showMeta(); setImage(currentList[index]);
  }
  setTimeout(() => prefetchNeighbors(currentList, index), 0);

  function closeV() { viewer.classList.add('hidden'); }

  // make a safe global so SSE can close the viewer before applying filters
  window.closeViewerIfOpen = function () {
    const v = document.getElementById('viewer');
    if (v && !v.classList.contains('hidden')) v.classList.add('hidden');
  };

  function next() { __lastDir = 'right'; index = (index + 1) % currentList.length; setImage(currentList[index], 'right'); }
  function prev() { __lastDir = 'left'; index = (index - 1 + currentList.length) % currentList.length; setImage(currentList[index], 'left'); }
  nextBtn.addEventListener('click', next);
  prevBtn.addEventListener('click', prev);
  document.getElementById('closeViewer').addEventListener('click', closeV);

  function goHomeFromFullscreen() {
    closeV();
    active.state = active.season = active.color = null;
    renderChips();
    renderThumbs();
    try { showMeta(); } catch(e){}
    topbar.classList.add('hidden');
    showMeta();
  }

  window.addEventListener('keydown', (e) => {
    if (!viewer.classList.contains('hidden')) {
      if (e.key === 'Escape') { goHomeFromFullscreen(); return; }
      if (e.key.toLowerCase() === 't') { topbar.classList.toggle('hidden'); showMeta(); return; }
      if (e.key.toLowerCase() === 'c') {
        compareToggle.checked = !compareToggle.checked;
        compareToggle.dispatchEvent(new Event('change')); return;
      }
      if (e.key === 'ArrowRight' || e.key === ' ') { next(); return; }
      if (e.key === 'ArrowLeft') { __lastDir = 'left'; prev(); return; }
    }
  });

  compareToggle.addEventListener('change', () => {
    const on = compareToggle.checked;
    document.getElementById('compareOverlay').classList.toggle('hidden', !on);
    document.getElementById('compareControl')?.classList.toggle('hidden', !on);
  });
  compareSlider.addEventListener('input', () => {
    const v = Number(compareSlider.value);
    compareHDR.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
  });

  homeBtn.addEventListener('click', () => {
    active.state = active.season = active.color = null;
    renderChips();
    renderThumbs();
    try { showMeta(); } catch(e){}
  });

  renderChips();
  renderThumbs();
  try { showMeta(); } catch(e){}

  // v0.4.9 runtime animation controls
  function __setAnimVars(opts={}){
    const r = document.documentElement.style;
    if (opts.dur)   r.setProperty('--anim-dur', String(opts.dur));
    if (opts.shift) r.setProperty('--anim-shift', String(opts.shift));
    if (opts.ease)  r.setProperty('--anim-ease', String(opts.ease));
  }
  window.galleryAnim = Object.assign(window.galleryAnim || {}, {
    set: __setAnimVars,
    setOverlap: (f)=>{ try{ f=Number(f); if(isFinite(f)) __inDelayFrac = Math.max(0, Math.min(1, f)); }catch(e){} }
  });

  // =========================
  // Hardware filter sync (poller with SSE backoff)
  // =========================
  const HW_POLL_MS = 300;
  let lastHw = { color: null, season: null, state: null };

  async function pollHardwareFilters() {
    // Back off if SSE is connected (readyState 1 = OPEN)
    if (window.__galleryES && window.__galleryES.readyState === 1) {
      setTimeout(pollHardwareFilters, 2000);
      return;
    }
    try {
      const res = await fetch('/api/filters/current', { cache: 'no-store' });
      if (!res.ok) throw new Error('filters/current failed');
      const { ok, filters } = await res.json();
      if (!ok || !filters) return;
      const changed =
        filters.color !== lastHw.color ||
        filters.season !== lastHw.season ||
        filters.state !== lastHw.state;

      if (changed) {
        lastHw = { ...filters };
        applyFiltersFromHardware(filters);
      }
    } catch (e) {
      // silent retry
    } finally {
      setTimeout(pollHardwareFilters, HW_POLL_MS);
    }
  }

  function applyFiltersFromHardware(filters) {
    if (typeof onUserInput === 'function') onUserInput('hardware-filter'); // stop slideshow if defined

    let didChange = false;
    if (Object.prototype.hasOwnProperty.call(filters, 'color')) {
      if (active.color !== filters.color) {
        active.color = filters.color;   // e.g., "Blue" / "Green"
        didChange = true;
      }
    }
    // Extend later for state/season if you wire more buttons.

    if (didChange) {
      renderChips();    // updates active chip highlight + disables based on availability
      renderThumbs();   // re-filters grid
      try { showMeta(); } catch(e){}
    }
  }

  // start polling on page load
  pollHardwareFilters();

  // ---------- Selection/Enter helper ----------
  // Open the currently highlighted thumbnail (or the first one)
  window.openSelected = function () {
    const v = document.getElementById('viewer');
    if (v && !v.classList.contains('hidden')) return; // ignore when already open
    let el = document.querySelector('.thumb.is-selected') || document.querySelector('.thumb');
    if (!el) return;
    el.click(); // thumbs map click -> openViewer(data-idx)
  };

  // Optional: Enter key to test Select without hardware (only when viewer is closed)
  window.addEventListener('keydown', (e) => {
    const v = document.getElementById('viewer');
    if (v && !v.classList.contains('hidden')) return;
    if (e.key === 'Enter') { e.preventDefault(); window.openSelected(); }
  });

})();

/* ===== SSE hookup (singleton) ===== */
(function attachSSE() {
  if (window.__galleryES) return;

  const es = new EventSource('/events');
  window.__galleryES = es;

  es.onmessage = (evt) => {
    if (!evt.data) return;
    let msg; try { msg = JSON.parse(evt.data); } catch { return; }

    // ---- Filters (includes Blue -> exit viewer) ----
    if (msg.type === 'apply_filter' && msg.facet && typeof msg.value !== 'undefined') {
      // If Blue is pressed while slideshow is open, exit to grid first
      if (msg.facet === 'color' &&
          String(msg.value).toLowerCase() === 'blue' &&
          typeof closeViewerIfOpen === 'function') {
        closeViewerIfOpen();
      }

      const applied =
        (typeof applyFilter === 'function' && applyFilter(msg.facet, msg.value)) ||
        (window.app && typeof window.app.applyFilter === 'function' && window.app.applyFilter(msg.facet, msg.value));

      // Ensure a selected thumb after the re-render
      document.dispatchEvent(new CustomEvent('gallery:apply_filter', { detail: msg }));
      return;
    }

    // ---- Joystick nav ----
    if (msg.type === 'nav' && msg.dir) {
      const navigated =
        (typeof navigateByJoystick === 'function' && navigateByJoystick(msg.dir)) ||
        (window.app && typeof window.app.navigateByJoystick === 'function' && window.app.navigateByJoystick(msg.dir));

      if (!navigated) {
        document.dispatchEvent(new CustomEvent('gallery:navigate', { detail: msg }));
      }
      return;
    }

    // ---- Select / Enter ----
    if (msg.type === 'select') {
      if (typeof openSelected === 'function') openSelected();
      else {
        const el = document.querySelector('.thumb.is-selected') || document.querySelector('.thumb');
        el && el.click();
      }
      return;
    }
  };

  es.onerror = () => {
    // Browser auto-reconnects; optional: log here
  };
})();

/* ===== Unified joystick/keyboard navigation (nearest-by-direction) ===== */
(function () {
  const THUMB_SELECTOR = '.thumb';                                   // adjust if your class differs
  const THUMB_CONTAINER = '#thumbGrid, .gallery, .grid, .thumbs';    // best-guess containers
  const DIR_EPS = 2;
  const DY_PENALTY = 1.0;  // row stickiness for left/right
  const DX_PENALTY = 1.0;  // column stickiness for up/down
  let observerStarted = false;

  // Expose one public API used by SSE and hardware
  window.navigateByJoystick = function (dir) {
    // Do not navigate when viewer is open
    const v = document.getElementById('viewer');
    if (v && !v.classList.contains('hidden')) return false;
    return _moveSelection(dir);
  };

  // Ensure a selection after filters apply (from SSE or UI)
  document.addEventListener('gallery:apply_filter', () => {
    requestAnimationFrame(() => _ensureInitialSelection(true));
  });

  // After renders (we dispatch 'gallery:rendered' in renderThumbs)
  document.addEventListener('gallery:rendered', () => {
    _ensureInitialSelection(true);
  });

  // Keyboard fallback (only when viewer is closed)
  window.addEventListener('keydown', (e) => {
    const v = document.getElementById('viewer');
    if (v && !v.classList.contains('hidden')) return;
    const k = e.key;
    if (k === 'ArrowLeft')  { e.preventDefault(); navigateByJoystick('left'); }
    if (k === 'ArrowRight') { e.preventDefault(); navigateByJoystick('right'); }
    if (k === 'ArrowUp')    { e.preventDefault(); navigateByJoystick('up'); }
    if (k === 'ArrowDown')  { e.preventDefault(); navigateByJoystick('down'); }
  });

  // Initial attach + DOM watcher
  window.addEventListener('load', () => {
    let tries = 0;
    const tick = () => {
      tries++;
      _startObserverOnce();
      const made = _ensureInitialSelection(false);
      if (!made && tries < 20) setTimeout(tick, 150);
    };
    tick();
  });

  function _startObserverOnce() {
    if (observerStarted) return;
    const container = document.querySelector(THUMB_CONTAINER);
    if (!container) return;
    observerStarted = true;
    const mo = new MutationObserver(() => {
      requestAnimationFrame(() => _ensureInitialSelection(false));
    });
    mo.observe(container, { childList: true, subtree: true });
  }

  /* ---------- selection helpers ---------- */
  function _visibleThumbs() {
    const nodes = Array.from(document.querySelectorAll(THUMB_SELECTOR));
    return nodes.filter(n => n.offsetParent !== null);
  }

  function _ensureInitialSelection(forceReset) {
    const thumbs = _visibleThumbs();
    if (!thumbs.length) return false;
    const current = thumbs.findIndex(t => t.classList.contains('is-selected'));
    const want = (forceReset || current === -1) ? 0 : current;
    _selectIndex(thumbs, want, false);
    return true;
  }

  function _currentIndex(thumbs) {
    return thumbs.findIndex(t => t.classList.contains('is-selected'));
  }

  function _selectIndex(thumbs, idx, smooth) {
    if (!thumbs.length) return;
    idx = Math.max(0, Math.min(idx, thumbs.length - 1));
    thumbs.forEach(t => t.classList.remove('is-selected'));
    const el = thumbs[idx];
    el.classList.add('is-selected');
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth ? 'smooth' : 'instant' });
  }

  function _rects(thumbs) {
    return thumbs.map((el, i) => {
      const r = el.getBoundingClientRect();
      return { el, i, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
  }

  function _moveSelection(dir) {
    const thumbs = _visibleThumbs();
    if (!thumbs.length) return false;

    let idx = _currentIndex(thumbs);
    if (idx === -1) { _selectIndex(thumbs, 0, false); return true; }

    const rects = _rects(thumbs);
    const me = rects[idx];

    // candidates strictly in intended direction
    let candidates;
    if (dir === 'left')  candidates = rects.filter(t => t.cx <  me.cx - DIR_EPS);
    if (dir === 'right') candidates = rects.filter(t => t.cx >  me.cx + DIR_EPS);
    if (dir === 'up')    candidates = rects.filter(t => t.cy <  me.cy - DIR_EPS);
    if (dir === 'down')  candidates = rects.filter(t => t.cy >  me.cy + DIR_EPS);

    if (!candidates || !candidates.length) return false;

    // cost: prefer movement along main axis, penalize drift on minor axis
    const scored = candidates.map(t => {
      const dx = Math.abs(t.cx - me.cx);
      const dy = Math.abs(t.cy - me.cy);
      const score = (dir === 'left' || dir === 'right') ? (dx + DY_PENALTY * dy) : (dy + DX_PENALTY * dx);
      return { t, score, dx, dy };
    });

    scored.sort((a, b) => a.score - b.score || (dir === 'left' || dir === 'right' ? a.dy - b.dy : a.dx - b.dx));

    _selectIndex(thumbs, scored[0].t.i, true);
    return true;
  }
})();

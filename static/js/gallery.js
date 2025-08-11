console.log('[gallery] v0.4.14 fade-only non-async build loaded');
console.log('[gallery] v0.4.13 fade-in-only build loaded');
console.log('[gallery] v0.4.9 anim vars build loaded');
console.log('[gallery] v0.4.6 directional animation build loaded');
console.log('[gallery] v0.4.5 pic-injection build loaded');
console.log('[gallery] v0.4.4 (path-aware build) loaded');
(async function() {
  const r = await fetch('/manifest.json', {cache:'no-store'});
  const manifest = await r.json();
  const allItems = manifest.items || [];

  // v0.4.11: encode filenames for src/srcset (spaces in srcset break parsing)
  function encFile(f){ if(!f) return ''; return f.split('/').map(encodeURIComponent).join('/'); }



  function ensureViewerScaffold() {
    // Only create if core nodes are missing (viewer and pic).
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
      // Ensure sub-nodes exist even if viewer exists
      const v = document.getElementById('viewer');
      if (!document.getElementById('viewerTopBar')) {
        const tb = document.createElement('div'); tb.id='viewerTopBar'; tb.className='viewer-toolbar'; v.prepend(tb);
        const close = document.createElement('button'); close.id='closeViewer'; close.textContent='×'; tb.appendChild(close);
      }
      if (!document.querySelector('.stage-container')) {
        const sc = document.createElement('div'); sc.className='stage-container';
        const stage = document.createElement('div'); stage.className='stage'; sc.appendChild(stage);
        // pic
        if (!document.getElementById('pic')) {
          const pic = document.createElement('picture'); pic.id='pic';
          const img = document.createElement('img'); img.id='img'; img.alt='';
          pic.appendChild(img); stage.appendChild(pic);
        }
        // compare overlay
        const comp = document.createElement('div'); comp.id='compareOverlay'; comp.className='compare-overlay';
        const sdr = document.createElement('img'); sdr.id='compareSDR'; comp.appendChild(sdr);
        const hdr = document.createElement('img'); hdr.id='compareHDR'; comp.appendChild(hdr);
        const slider = document.createElement('input'); slider.id='compareSlider'; slider.type='range'; slider.min='0'; slider.max='100'; slider.value='50'; comp.appendChild(slider);
        const toggle = document.createElement('button'); toggle.id='compareToggle'; toggle.setAttribute('aria-pressed','false'); comp.appendChild(toggle);
        stage.appendChild(comp);
        // meta overlay
        if (!document.getElementById('metaOverlay')) {
          const mo = document.createElement('div'); mo.id='metaOverlay'; mo.className='meta-overlay'; stage.appendChild(mo);
        }
        // nav
        const prev = document.createElement('button'); prev.id='prevBtn'; prev.className='nav prev'; prev.innerHTML='&#10094;';
        const next = document.createElement('button'); next.id='nextBtn'; next.className='nav next'; next.innerHTML='&#10095;';
        sc.appendChild(prev); sc.appendChild(next);
        v.appendChild(sc);
      }
    }
      // If stage-container exists but #pic is missing, create it and insert before compareOverlay
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
    // Ensure the metadata overlay lives inside the stage container,
    // not the toolbar — otherwise hiding the toolbar hides the overlay too.
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

  const active = { state: null, season: null, color: null };

  function chip(label, type) {
    const el = document.createElement('button');
    el.className = 'chip';
    el.textContent = label || 'Unknown';
    el.addEventListener('click', () => {
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
  const colors = uniq(allItems.map(i => i.color));

  function renderChips() {
    stateFilters.innerHTML = '';
    seasonFilters.innerHTML = '';
    colorFilters.innerHTML = '';
    states.forEach(s => {
      const el = chip(s, 'state');
      if (active.state === s) el.classList.add('active');
      stateFilters.appendChild(el);
    });
    seasons.forEach(s => {
      const el = chip(s, 'season');
      if (active.season === s) el.classList.add('active');
      seasonFilters.appendChild(el);
    });
    colors.forEach(c => {
      const el = chip(c, 'color');
      if (active.color === c) el.classList.add('active');
      colorFilters.appendChild(el);
    });
  }

  function matches(i) {
    const sOk = active.state ? active.state === i.state_fullname : true;
    const seOk = active.season ? active.season === i.season : true;
    const cOk = active.color ? active.color === i.color : true;
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
    const label = (t || l) ? `<div class="label">${t ? `<div class='title'>${t}</div>` : ''}${l ? `<div class='loc'>${l}</div>` : ''}</div>` : '';
    return `<div class="thumb" data-idx="${idxInCurrent}">
      <img src="${it.thumb}" alt="${t || ''}">
      ${label}
    </div>`;
  }

  function renderThumbs() {
    currentList = allItems.filter(matches);
    if (!currentList.length) {
      emptyState.classList.remove('hidden');
      thumbGrid.innerHTML = '';
      return;
    }
    emptyState.classList.add('hidden');
    thumbGrid.innerHTML = currentList.map((it, idx) => thumbHtml(it, idx)).join('');
    for (const el of thumbGrid.querySelectorAll('.thumb')) {
      el.addEventListener('click', () => openViewer(parseInt(el.getAttribute('data-idx'), 10)));
    }
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

  
  
async function setImage(entry, dir) {
    const stageContainer = document.querySelector('.stage-container') || document.getElementById('viewer') || document.body;
    const oldPic = document.getElementById('pic');

    // Build new picture offscreen state
    const newPic = document.createElement('picture');
    newPic.className = 'swap-pic anim-in';
    // (fade-only) no incoming offset for left
    // (fade-only) no incoming offset for right

    // Sources
    const srcHdr = document.createElement('source');
    srcHdr.setAttribute('type', 'image/avif');
    const _hdr = hdrUrl(entry);
    if (_hdr && /\.[a-z0-9]+$/i.test(_hdr)) { srcHdr.setAttribute('sizes', '100vw'); srcHdr.srcset = `${_hdr} 1x`; }

    const srcSdr = document.createElement('source');
    srcSdr.setAttribute('type', 'image/jpeg');
    const _sdr = sdrUrl(entry);
    if (_sdr && /\.[a-z0-9]+$/i.test(_sdr)) { srcSdr.setAttribute('sizes', '100vw'); srcSdr.srcset = `${_sdr} 1x`; }

    if (srcHdr.srcset) newPic.appendChild(srcHdr);
    if (srcSdr.srcset) newPic.appendChild(srcSdr);

    // Img
    const image = document.createElement('img');
    image.alt = entry.title || '';
    image.loading = 'eager';
    image.decoding = 'async';
    image.src = (_sdr || _hdr || '');
    newPic.appendChild(image);

    // Insert before compare overlay so overlays stay above
    const compareOverlayEl = document.getElementById('compareOverlay');
    if (stageContainer && compareOverlayEl && compareOverlayEl.parentElement === stageContainer) {
      stageContainer.insertBefore(newPic, compareOverlayEl);
    } else if (stageContainer) {
      stageContainer.appendChild(newPic);
    }

    // Wait for the browser to decode to avoid a pop-in
    try { if (image.decode) await image.decode(); } catch(e) {}

    // Start both animations in the same frame
    requestAnimationFrame(() => {
      // (fade-only) ensure no incoming offset classes
      newPic.classList.remove('from-left','from-right');
      newPic.classList.add('anim-go');
      if (oldPic) {
        if (dir === 'left')  oldPic.classList.add('anim-out-left');
        if (dir === 'right') oldPic.classList.add('anim-out-right');
        oldPic.classList.add('anim-go');
      }
    });

    const finish = () => {
      if (oldPic && oldPic.parentElement) oldPic.parentElement.removeChild(oldPic);
      newPic.id = 'pic';
      newPic.classList.remove('swap-pic','anim-in','from-left','from-right','anim-go','anim-out-left','anim-out-right');
      newPic.removeEventListener('transitionend', finish);
    };
    newPic.addEventListener('transitionend', finish);

    // Update compare images if they exist
    const compareSDREl = document.getElementById('compareSDR');
    const compareHDREl = document.getElementById('compareHDR');
    if (compareSDREl) { const u = _sdr || _hdr || ''; if (u) compareSDREl.src = u; }
    if (compareHDREl) { const u = _hdr || _sdr || ''; if (u) compareHDREl.src = u; }

    // Overlay
    let mo = document.getElementById('metaOverlay');
    if (!mo) {
      mo = document.createElement('div'); mo.id = 'metaOverlay'; mo.className='meta-overlay';
      const stage = document.querySelector('.stage-container .stage') || document.querySelector('.stage') || stageContainer || document.body;
      stage.appendChild(mo);
    }
    setOverlay(entry);
    showMeta();
  }



  function openViewer(i) { index = i; let viewerEl = document.getElementById('viewer'); let topbarEl = document.getElementById('viewerTopBar'); if (!viewerEl || !topbarEl) { if (typeof ensureViewerScaffold === 'function') ensureViewerScaffold(); viewerEl = document.getElementById('viewer'); topbarEl = document.getElementById('viewerTopBar'); } if (!viewerEl || !topbarEl) { console.warn('[viewer] Missing viewer/topbar nodes.'); return; } viewerEl.classList.remove('hidden'); topbarEl.classList.add('hidden');
      showMeta(); setImage(currentList[index]); }
  function closeV() { viewer.classList.add('hidden'); }
  function next() { index = (index + 1) % currentList.length; setImage(currentList[index], 'right'); }
  function prev() { index = (index - 1 + currentList.length) % currentList.length; setImage(currentList[index], 'left'); }
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
      if (e.key === 'ArrowLeft') { prev(); return; }
    }
  });

  compareToggle.addEventListener('change', () => {
    const on = compareToggle.checked;
    document.getElementById('compareOverlay').classList.toggle('hidden', !on);
    document.getElementById('compareControl').classList.toggle('hidden', !on);
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
  window.galleryAnim = { set: __setAnimVars };

})();
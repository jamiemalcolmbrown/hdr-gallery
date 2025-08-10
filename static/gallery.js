(async function() {
  const r = await fetch('/manifest.json', {cache:'no-store'});
  const manifest = await r.json();
  const items = manifest.items || [];
  const hdrEnabled = !!manifest.hdr;

  const stateFilters = document.getElementById('stateFilters');
  const seasonFilters = document.getElementById('seasonFilters');
  const colorFilters = document.getElementById('colorFilters');
  const thumbGrid = document.getElementById('thumbGrid');

  const modeLabel = document.getElementById('modeLabel');
  const forceSDR = document.getElementById('forceSDR');

  const viewer = document.getElementById('viewer');
  const closeViewer = document.getElementById('closeViewer');
  const pic = document.getElementById('pic');
  const overlay = document.getElementById('compareOverlay');
  const compareSDR = document.getElementById('compareSDR');
  const compareHDR = document.getElementById('compareHDR');
  const compareToggle = document.getElementById('compareToggle');
  const compareControl = document.getElementById('compareControl');
  const compareSlider = document.getElementById('compareSlider');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const metaOverlay = document.getElementById('metaOverlay');

  let index = 0;
  const hdrCapable = hdrEnabled && (window.__HDR_SUPPORT__?.dynamicRange || window.__HDR_SUPPORT__?.gamutRec2020);

  function setModeLabel() {
    if (!hdrEnabled) { modeLabel.textContent = 'SDR (HDR disabled)'; return; }
    if (forceSDR.checked) { modeLabel.textContent = 'SDR (forced)'; return; }
    modeLabel.textContent = hdrCapable ? 'HDR' : 'SDR (no HDR support)';
  }

  const uniq = (arr) => Array.from(new Set(arr.filter(Boolean))).sort((a,b)=>a.localeCompare(b));
  const states = uniq(items.map(i => i.state_fullname));
  const seasons = uniq(items.map(i => i.season));
  const colors = uniq(items.map(i => i.color));
  const active = { states: new Set(), seasons: new Set(), colors: new Set() };

  function chip(label, set) {
    const el = document.createElement('button');
    el.className = 'chip';
    el.textContent = label || 'Unknown';
    el.addEventListener('click', () => {
      if (set.has(label)) set.delete(label); else set.add(label);
      el.classList.toggle('active');
      renderThumbs();
    });
    return el;
  }
  states.forEach(s => stateFilters.appendChild(chip(s, active.states)));
  seasons.forEach(s => seasonFilters.appendChild(chip(s, active.seasons)));
  colors.forEach(c => colorFilters.appendChild(chip(c, active.colors)));

  function matches(i) {
    const sOk = active.states.size ? active.states.has(i.state_fullname) : true;
    const seOk = active.seasons.size ? active.seasons.has(i.season) : true;
    const cOk = active.colors.size ? active.colors.has(i.color) : true;
    return sOk && seOk && cOk;
  }

  function thumbHtml(it, idx) {
    const state = it.state_fullname || '';
    // No filename fallback; title may be blank
    const title = it.title || '';
    const titleLine = title ? `<div class="label">${title}</div>` : '';
    const stateLine = state ? `<div class="sub">${state}</div>` : '';
    return `<div class="thumb" data-index="${idx}">
      <img src="${it.thumb}" alt="${title || state || ''}">
      ${titleLine}${stateLine}
    </div>`;
  }

  function renderThumbs() {
    const list = items.filter(matches);
    thumbGrid.innerHTML = list.map(it => thumbHtml(it, items.indexOf(it))).join('');
    for (const el of thumbGrid.querySelectorAll('.thumb')) {
      el.addEventListener('click', () => openViewer(parseInt(el.getAttribute('data-index'), 10)));
    }
  }

  function sdrUrl(entry) { return `/images/${entry.sdr}`; }
  function hdrUrl(entry) { return `/images/${entry.hdr}`; }
  function chooseMainSrc(entry) { return sdrUrl(entry); }

  function setMetaOverlay(entry) {
    const title = entry.title || '';
    const desc = entry.description || '';
    const state = entry.state_fullname || '';
    const tagChips = [];
    const tagSet = new Set([entry.season, entry.color, ...(entry.tags||[])]);
    for (const t of tagSet) if (t) tagChips.push(`<span class="meta-chip">${t}</span>`);
    const titleHtml = title ? `<div class="meta-title">${title}</div>` : '';
    const descHtml = desc ? `<div class="meta-desc">${desc}</div>` : '';
    const locHtml = state ? `<span class="meta-chip">${state}</span>` : '';
    const tagsLine = (locHtml || tagChips.length) ? `<div class="meta-line">${locHtml}${tagChips.join('')}</div>` : '';
    metaOverlay.innerHTML = titleHtml + descHtml + tagsLine;
  }

  function setImage(entry) {
    while (pic.firstChild) pic.removeChild(pic.firstChild);
    const useHDR = hdrCapable && !forceSDR.checked;
    if (useHDR) {
      const srcHdr = document.createElement('source');
      srcHdr.setAttribute('type', 'image/avif');
      srcHdr.srcset = hdrUrl(entry);
      pic.appendChild(srcHdr);
    }
    const image = document.createElement('img');
    image.id = 'img';
    image.alt = entry.title || entry.state_fullname || '';
    image.src = chooseMainSrc(entry);
    image.loading = 'eager';
    image.decoding = 'async';
    pic.appendChild(image);

    compareSDR.src = sdrUrl(entry);
    compareHDR.src = hdrUrl(entry);

    setMetaOverlay(entry);
  }

  function openViewer(i) { index = i; viewer.classList.remove('hidden'); setImage(items[index]); }
  function closeV() { viewer.classList.add('hidden'); }
  function next() { index = (index + 1) % items.length; setImage(items[index]); }
  function prev() { index = (index - 1 + items.length) % items.length; setImage(items[index]); }
  nextBtn.addEventListener('click', next);
  prevBtn.addEventListener('click', prev);
  document.getElementById('closeViewer').addEventListener('click', closeV);
  forceSDR.addEventListener('change', () => { setModeLabel(); setImage(items[index]); });

  compareToggle.addEventListener('change', () => {
    const on = compareToggle.checked;
    document.getElementById('compareOverlay').classList.toggle('hidden', !on);
    document.getElementById('compareControl').classList.toggle('hidden', !on);
    if (on) setClipFromSlider();
  });
  function setClipFromSlider() {
    const v = Number(compareSlider.value);
    compareHDR.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
  }
  compareSlider.addEventListener('input', setClipFromSlider);

  window.addEventListener('keydown', (e) => {
    if (viewer.classList.contains('hidden')) return;
    if (e.key === 'ArrowRight' || e.key === ' ') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key.toLowerCase() === 'h') { forceSDR.checked = !forceSDR.checked; setModeLabel(); setImage(items[index]); }
    else if (e.key.toLowerCase() === 'c') { compareToggle.checked = !compareToggle.checked; compareToggle.dispatchEvent(new Event('change')); }
    else if (e.key.toLowerCase() === 'Escape') closeV();
  });

  setModeLabel();
  renderThumbs();
})();
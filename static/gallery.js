(async function() {
  const r = await fetch('/manifest.json', {cache:'no-store'});
  const manifest = await r.json();
  const allItems = manifest.items || [];

  const stateFilters = document.getElementById('stateFilters');
  const seasonFilters = document.getElementById('seasonFilters');
  const colorFilters = document.getElementById('colorFilters');
  const thumbGrid = document.getElementById('thumbGrid');
  const emptyState = document.getElementById('emptyState');
  const homeBtn = document.getElementById('homeBtn');

  const viewer = document.getElementById('viewer');
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

  function sdrUrl(entry) { return `/images/${entry.sdr}`; }
  function hdrUrl(entry) { return `/images/${entry.hdr}`; }

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

  function setImage(entry) {
    while (pic.firstChild) pic.removeChild(pic.firstChild);
    const srcHdr = document.createElement('source');
    srcHdr.setAttribute('type', 'image/avif');
    srcHdr.srcset = hdrUrl(entry);
    pic.appendChild(srcHdr);

    const image = document.createElement('img');
    image.id = 'img';
    image.alt = entry.title || '';
    image.src = sdrUrl(entry);
    image.loading = 'eager';
    image.decoding = 'async';
    pic.appendChild(image);

    compareSDR.src = sdrUrl(entry);
    compareHDR.src = hdrUrl(entry);

    setOverlay(entry);
  }

  function openViewer(i) { index = i; viewer.classList.remove('hidden'); topbar.classList.add('hidden'); setImage(currentList[index]); }
  function closeV() { viewer.classList.add('hidden'); }
  function next() { index = (index + 1) % currentList.length; setImage(currentList[index]); }
  function prev() { index = (index - 1 + currentList.length) % currentList.length; setImage(currentList[index]); }
  nextBtn.addEventListener('click', next);
  prevBtn.addEventListener('click', prev);
  document.getElementById('closeViewer').addEventListener('click', closeV);

  function goHomeFromFullscreen() {
    closeV();
    active.state = active.season = active.color = null;
    renderChips();
    renderThumbs();
    topbar.classList.add('hidden');
  }
  window.addEventListener('keydown', (e) => {
    if (!viewer.classList.contains('hidden')) {
      if (e.key === 'Escape') { goHomeFromFullscreen(); return; }
      if (e.key.toLowerCase() === 't') { topbar.classList.toggle('hidden'); return; }
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
  });

  renderChips();
  renderThumbs();
})();
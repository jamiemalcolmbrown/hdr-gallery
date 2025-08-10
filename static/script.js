// v0.2.8 client with HDR badge + FS metadata overlay
let preferAvif = false;
let preferHdr = false; // fullscreen only
let items = [];
let idx = -1;
let activeSeason = '';
let activeState = '';

async function detectAvifSupport() {
  const avif = new Image();
  return new Promise((resolve) => {
    avif.onload = () => resolve(true);
    avif.onerror = () => resolve(false);
    avif.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAG1pZjFoZWlmAAABAG1ldGEAAAAAAAAA';
  });
}

function detectHdrCapable() {
  return window.matchMedia && window.matchMedia('(dynamic-range: high)').matches;
}

function qs(id) { return document.getElementById(id); }
function makeChip(text, { onClick, active=false, classes=[] } = {}) {
  const btn = document.createElement('button');
  btn.className = 'chip' + (active ? ' active' : '') + (classes.length ? ' ' + classes.join(' ') : '');
  btn.textContent = text;
  btn.onclick = () => onClick && onClick(text, btn);
  return btn;
}

async function fetchFacets() {
  const res = await fetch('/api/facets');
  const data = await res.json();
  const scol = qs('seasonCol');
  const stcol = qs('stateCol');
  scol.innerHTML = ''; stcol.innerHTML = '';

  // Seasons
  const seasonMap = [['spring','season-spring'], ['summer','season-summer'], ['autumn','season-autumn'], ['winter','season-winter']];
  const allS = makeChip('All seasons', { onClick: (t, el) => { activeSeason=''; refreshCol(scol, el); fetchImages(); }, active: activeSeason==='' });
  scol.appendChild(allS);
  for (const [s, cls] of seasonMap) {
    if (!data.seasons.includes(s)) continue;
    const label = s[0].toUpperCase()+s.slice(1);
    const chip = makeChip(label, { onClick: (t, el) => { activeSeason=s; refreshCol(scol, el); fetchImages(); }, active: activeSeason===s, classes:[cls] });
    scol.appendChild(chip);
  }

  // States
  const allSt = makeChip('All states', { onClick: (t, el) => { activeState=''; refreshCol(stcol, el); fetchImages(); }, active: activeState==='' });
  stcol.appendChild(allSt);
  for (const st of data.states) {
    const chip = makeChip(st, { onClick: (t, el) => { activeState=st; refreshCol(stcol, el); fetchImages(); }, active: activeState===st });
    stcol.appendChild(chip);
  }
}

function refreshCol(col, activeEl) {
  for (const el of col.querySelectorAll('.chip')) el.classList.remove('active');
  activeEl.classList.add('active');
}

async function fetchImages() {
  const url = new URL('/api/images', window.location.origin);
  if (activeSeason) url.searchParams.set('season', activeSeason);
  if (activeState) url.searchParams.set('state', activeState);
  const res = await fetch(url);
  const data = await res.json();
  items = data.items || [];
  const masonry = qs('masonry');
  masonry.innerHTML = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    img.loading = 'lazy';
    const fmt = (preferAvif ? 'avif' : 'webp');
    img.src = `/thumb?path=${encodeURIComponent(item._path)}&w=512&fmt=${fmt}`;
    img.srcset = [
      `/thumb?path=${encodeURIComponent(item._path)}&w=256&fmt=${fmt} 256w`,
      `/thumb?path=${encodeURIComponent(item._path)}&w=512&fmt=${fmt} 512w`,
      `/thumb?path=${encodeURIComponent(item._path)}&w=1024&fmt=${fmt} 1024w`
    ].join(', ');
    img.sizes = '(max-width: 1600px) 50vw, 33vw';
    img.alt = item.Title || '';
    img.onclick = () => openFs(i);
    card.appendChild(img);

    const haveTitle = !!item.Title;
    const haveState = !!item._state;
    if (haveTitle || haveState) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      const title = (item.Title || '').toString();
      const state = (item._state || '').toString();
      meta.innerHTML = `<span class="title">${title}</span><span class="state">${state}</span>`;
      card.appendChild(meta);
    }

    masonry.appendChild(card);
  }
}

// ----- Fullscreen with fade and HDR + overlay -----
function fadeTo(src) {
  const fsImg = document.getElementById('fsImg');
  fsImg.classList.remove('loaded');
  void fsImg.offsetWidth; // restart transition
  fsImg.onload = () => fsImg.classList.add('loaded');
  fsImg.src = src;
}

function buildFsUrl(item) {
  const fmt = (preferAvif || preferHdr) ? 'avif' : 'webp'; // HDR needs avif
  const hdr = (preferHdr ? '&hdr=1' : '');
  return `/display?path=${encodeURIComponent(item._path)}&max=3840&fmt=${fmt}${hdr}`;
}

function updateFsMeta(item) {
  const titleEl = document.getElementById('fsTitle');
  const locEl   = document.getElementById('fsLoc');
  const descEl  = document.getElementById('fsDesc');
  const badgeEl = document.getElementById('fsBadge');

  const hdrCapable = detectHdrCapable();
  const isHdr = !!(preferHdr && hdrCapable);
  badgeEl.textContent = isHdr ? 'HDR' : 'SDR';
  badgeEl.title = isHdr ? 'High Dynamic Range' : 'Standard Dynamic Range';

  const whereParts = [];
  if (item._state) whereParts.push(item._state);
  else if (item.City) whereParts.push(item.City);
  else if (item.Location) whereParts.push(item.Location);

  titleEl.textContent = item.Title || '';
  locEl.textContent = whereParts.join(', ');
  descEl.textContent = item.Description || '';
}

function openFs(i) {
  idx = i;
  const fs = document.getElementById('fs');
  updateFsMeta(items[idx]);
  fadeTo(buildFsUrl(items[idx]));
  fs.classList.remove('hidden');
  fs.setAttribute('aria-hidden', 'false');
}

function closeFs() {
  const fs = document.getElementById('fs');
  const fsImg = document.getElementById('fsImg');
  fs.classList.add('hidden');
  fs.setAttribute('aria-hidden', 'true');
  fsImg.src = '';
  fsImg.classList.remove('loaded');
}

function nextFs(step) {
  if (idx < 0) return;
  idx = (idx + step + items.length) % items.length;
  updateFsMeta(items[idx]);
  fadeTo(buildFsUrl(items[idx]));
}

// --- Boot ---
(async () => {
  const avifOK = await detectAvifSupport();
  preferAvif = avifOK; // default to AVIF thumbs if supported
  const hdrOK = detectHdrCapable();

  const avifBox = document.getElementById('wantAvif');
  if (avifBox) {
    avifBox.checked = avifOK;
    avifBox.onchange = (e) => { preferAvif = e.target.checked; fetchImages(); };
  }
  const hdrBox = document.getElementById('wantHdr');
  if (hdrBox) {
    hdrBox.style.display = hdrOK ? '' : 'none';
    hdrBox.checked = false;
    hdrBox.onchange = (e) => { preferHdr = !!e.target.checked; };
  }

  await fetchFacets();
  await fetchImages();

  document.getElementById('fsClose')?.addEventListener('click', closeFs);
  document.getElementById('fsPrev')?.addEventListener('click', () => nextFs(-1));
  document.getElementById('fsNext')?.addEventListener('click', () => nextFs(1));
  window.addEventListener('keydown', (e) => {
    const fs = document.getElementById('fs');
    const open = !fs.classList.contains('hidden');
    if (!open) return;
    if (e.key === 'Escape') closeFs();
    if (e.key === 'ArrowLeft') nextFs(-1);
    if (e.key === 'ArrowRight') nextFs(1);
  });

  document.getElementById('refresh')?.addEventListener('click', () => { fetchFacets(); fetchImages(); });
})();

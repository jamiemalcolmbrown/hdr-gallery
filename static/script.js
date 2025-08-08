
let preferAvif = false;
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

function makeChip(text, onClick, isActive = false) {
  const btn = document.createElement('button');
  btn.className = 'chip' + (isActive ? ' active' : '');
  btn.textContent = text;
  btn.onclick = () => onClick(text, btn);
  return btn;
}

async function fetchFacets() {
  const res = await fetch('/api/facets');
  const data = await res.json();
  const srow = document.getElementById('seasonRow');
  const strow = document.getElementById('stateRow');
  srow.innerHTML = ''; strow.innerHTML = '';

  // Seasons chips
  const allS = makeChip('All seasons', (t, el) => { activeSeason = ''; refreshChips(srow, el); fetchImages(); }, activeSeason === '');
  srow.appendChild(allS);
  for (const s of data.seasons) {
    const label = s[0].toUpperCase() + s.slice(1);
    const chip = makeChip(label, (t, el) => { activeSeason = s; refreshChips(srow, el); fetchImages(); }, activeSeason === s);
    srow.appendChild(chip);
  }

  // States chips (full names)
  const allSt = makeChip('All states', (t, el) => { activeState = ''; refreshChips(strow, el); fetchImages(); }, activeState === '');
  strow.appendChild(allSt);
  for (const st of data.states) {
    const chip = makeChip(st, (t, el) => { activeState = st; refreshChips(strow, el); fetchImages(); }, activeState === st);
    strow.appendChild(chip);
  }
}

function refreshChips(row, activeEl) {
  for (const el of row.querySelectorAll('.chip')) el.classList.remove('active');
  activeEl.classList.add('active');
}

async function fetchImages() {
  const url = new URL('/api/images', window.location.origin);
  if (activeSeason) url.searchParams.set('season', activeSeason);
  if (activeState) url.searchParams.set('state', activeState);
  const res = await fetch(url);
  const data = await res.json();
  items = data.items;
  const masonry = document.getElementById('masonry');
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
    img.sizes = '(max-width: 1400px) 50vw, 25vw';
    img.alt = item.Title || '';
    img.onclick = () => openFs(i);
    card.appendChild(img);

    // Caption: Title + full State only; no filename fallback
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

function openFs(i) {
  idx = i;
  const fs = document.getElementById('fs');
  const fsImg = document.getElementById('fsImg');
  const it = items[idx];
  const fmt = (preferAvif ? 'avif' : 'webp');
  fsImg.src = `/display?path=${encodeURIComponent(it._path)}&max=3840&fmt=${fmt}`;
  fs.classList.remove('hidden');
  fs.setAttribute('aria-hidden', 'false');
}

function closeFs() {
  const fs = document.getElementById('fs');
  const fsImg = document.getElementById('fsImg');
  fs.classList.add('hidden');
  fs.setAttribute('aria-hidden', 'true');
  fsImg.src = '';
}

function nextFs(step) {
  if (idx < 0) return;
  idx = (idx + step + items.length) % items.length;
  const it = items[idx];
  const fsImg = document.getElementById('fsImg');
  const fmt = (preferAvif ? 'avif' : 'webp');
  fsImg.src = `/display?path=${encodeURIComponent(it._path)}&max=3840&fmt=${fmt}`;
}

document.getElementById('fsClose').onclick = closeFs;
document.getElementById('fsPrev').onclick = () => nextFs(-1);
document.getElementById('fsNext').onclick = () => nextFs(1);
window.addEventListener('keydown', (e) => {
  const fs = document.getElementById('fs');
  const open = !fs.classList.contains('hidden');
  if (!open) return;
  if (e.key === 'Escape') closeFs();
  if (e.key === 'ArrowLeft') nextFs(-1);
  if (e.key === 'ArrowRight') nextFs(1);
});

document.getElementById('refresh').onclick = () => { fetchFacets(); fetchImages(); };
document.getElementById('wantAvif').onchange = (e) => { preferAvif = e.target.checked; fetchImages(); };

(async () => {
  const ok = await detectAvifSupport();
  if (ok) {
    document.getElementById('wantAvif').checked = true;
    preferAvif = true;
  }
  await fetchFacets();
  await fetchImages();
  document.getElementById('fs').classList.add('hidden');
  document.getElementById('fs').setAttribute('aria-hidden', 'true');
})();

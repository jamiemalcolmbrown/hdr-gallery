(async function() {
  const r = await fetch('/manifest.json', {cache:'no-store'});
  const manifest = await r.json();
  const items = manifest.items || [];

  const stateFilters = document.getElementById('stateFilters');
  const seasonFilters = document.getElementById('seasonFilters');
  const colorFilters = document.getElementById('colorFilters');
  const thumbGrid = document.getElementById('thumbGrid');
  const emptyState = document.getElementById('emptyState');
  const homeBtn = document.getElementById('homeBtn');

  const viewer = document.getElementById('viewer');
  const topbar = document.getElementById('viewerTopBar');
  const pic = document.getElementById('pic');
  const overlayEl = document.getElementById('compareOverlay');
  const compareSDR = document.getElementById('compareSDR');
  const compareHDR = document.getElementById('compareHDR');
  const compareToggle = document.getElementById('compareToggle');
  const compareControl = document.getElementById('compareControl');
  const compareSlider = document.getElementById('compareSlider');
  const metaOverlay = document.getElementById('metaOverlay');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const closeViewer = document.getElementById('closeViewer');

  let index = 0;
  const hdrCapable = true;

  const uniq = arr => Array.from(new Set(arr.filter(Boolean))).sort((a,b)=>a.localeCompare(b));

  // Single-select filters
  const active = { state: null, season: null, color: null };
  const states = uniq(items.map(i => i.state_fullname));
  const seasons = uniq(items.map(i => i.season));
  const colors = uniq(items.map(i => i.color));

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
  function renderChips() {
    stateFilters.innerHTML = '';
    seasonFilters.innerHTML = '';
    colorFilters.innerHTML = '';
    states.forEach(s => { const el=chip(s,'state'); if(active.state===s) el.classList.add('active'); stateFilters.appendChild(el); });
    seasons.forEach(s => { const el=chip(s,'season'); if(active.season===s) el.classList.add('active'); seasonFilters.appendChild(el); });
    colors.forEach(c => { const el=chip(c,'color'); if(active.color===c) el.classList.add('active'); colorFilters.appendChild(el); });
  }

  function matches(i) {
    const sOk = active.state ? active.state === i.state_fullname : true;
    const seOk = active.season ? active.season === i.season : true;
    const cOk = active.color ? active.color === i.color : true;
    return sOk && seOk && cOk;
  }

  function thumbHtml(it, idx) {
    const title = it.title || ''; // no filename fallback
    const label = title ? `<div class="label">${title}</div>` : '';
    return `<div class="thumb" data-index="${idx}">
      <img src="${it.thumb}" alt="${title}">
      ${label}
    </div>`;
  }

  function renderThumbs() {
    const list = items.filter(matches);
    if (!list.length) {
      emptyState.classList.remove('hidden');
      thumbGrid.innerHTML = '';
      return;
    }
    emptyState.classList.add('hidden');
    thumbGrid.innerHTML = list.map(it => thumbHtml(it, items.indexOf(it))).join('');
    for (const el of thumbGrid.querySelectorAll('.thumb')) {
      el.addEventListener('click', () => openViewer(parseInt(el.getAttribute('data-index'), 10)));
    }
  }

  function sdrUrl(entry) { return `/images/${entry.sdr}`; }
  function hdrUrl(entry) { return `/images/${entry.hdr}`; }

  function setOverlay(entry) {
    const title = entry.title || '';
    const desc = entry.description || '';
    const state = entry.state_fullname || '';
    const base = entry.tags || [];
    const remove = new Set([state, entry.season || '', entry.color || '', '']);
    const extraTags = [...new Set(base.filter(t => t && !remove.has(t)))];
    const lines = [];
    if (title) lines.push(`<div class="meta-title">${title}</div>`);
    if (desc) lines.push(`<div class="meta-desc">${desc}</div>`);
    if (state) lines.push(`<div class="meta-sub">Location: ${state}</div>`);
    const extras = [entry.season || '', entry.color || '', ...extraTags].filter(Boolean).join(' · ');
    if (extras) lines.push(`<div class="meta-tags">${extras}</div>`);
    metaOverlay.innerHTML = lines.join('');
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

  function openViewer(i) {
    index = i;
    viewer.classList.remove('hidden');
    topbar.classList.add('hidden'); // keep hidden on open
    setImage(items[index]);
  }
  function closeV() { viewer.classList.add('hidden'); }
  function next() { index = (index + 1) % items.length; setImage(items[index]); }
  function prev() { index = (index - 1 + items.length) % items.length; setImage(items[index]); }
  nextBtn.addEventListener('click', next);
  prevBtn.addEventListener('click', prev);
  closeViewer.addEventListener('click', closeV);

  // Keyboard: toggle topbar with T, compare with C
  window.addEventListener('keydown', (e) => {
    if (!viewer.classList.contains('hidden')) {
      const k = e.key.toLowerCase();
      if (k === 't') {
        topbar.classList.toggle('hidden');
      } else if (k === 'c') {
        compareToggle.checked = !compareToggle.checked;
        compareToggle.dispatchEvent(new Event('change'));
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        next();
      } else if (e.key === 'ArrowLeft') {
        prev();
      } else if (e.key === 'Escape') {
        closeV();
      }
    }
  });

  compareToggle.addEventListener('change', () => {
    const on = compareToggle.checked;
    overlayEl.classList.toggle('hidden', !on);
    compareControl.classList.toggle('hidden', !on);
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
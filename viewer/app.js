(() => {
  const state = {
    data: null, files: [], idx: 0,
    filter: { state: '', location: '', color: '', tags: [] },
    catIndex: 0, valueIndex: 0
  };

  const el = (s) => document.querySelector(s);
  const $thumbs = el('#thumbs'), $holder = el('#image-holder');
  const $title = el('#cap-title'), $desc = el('#cap-desc');
  const $capTags = el('#cap-tags'), $capTech = el('#cap-tech');
  const $catChips = Array.from(document.querySelectorAll('.chip.cat'));
  const $catValues = el('#cat-values');

  async function fetchMetadata() {
    const res = await fetch('/api/metadata');
    if (!res.ok) throw new Error('Failed to load metadata');
    const json = await res.json();
    state.data = json;
    applyFilters();
    if (state.files.length) show(0); else showEmpty();
    buildCategoryValues();
  }

  function applyFilters() {
    const imgs = state.data.images || {};
    const pass = (f) => {
      const m = imgs[f] || {};
      if (state.filter.state && (m.state || '') !== state.filter.state) return false;
      if (state.filter.location && (m.location || '') !== state.filter.location) return false;
      if (state.filter.color && (m.color || '') !== state.filter.color) return false;
      if (state.filter.tags.length) {
        const mt = (m.tags || []).map(t => (t||'').trim().toLowerCase());
        for (const t of state.filter.tags) if (!mt.includes(t.toLowerCase())) return false;
      }
      return true;
    };
    state.files = (state.data.files || []).filter(pass);
    state.idx = 0;
    renderThumbs();
  }

  function renderThumbs() {
    $thumbs.innerHTML = '';
    if (!state.files.length) { showEmpty(); return; }
    state.files.forEach((f, i) => {
      const div = document.createElement('div');
      div.className = 'thumb' + (i === state.idx ? ' active' : '');
      const img = document.createElement('img');
      img.loading = 'lazy'; img.src = `/images/${encodeURIComponent(f)}`; img.alt = f;
      div.appendChild(img);
      div.addEventListener('click', () => show(i));
      $thumbs.appendChild(div);
    });
  }

  function showEmpty() {
    $holder.innerHTML = '<div class="empty">No images match the current filters.</div>';
    $title.textContent = ''; $desc.textContent = '';
    $capTags.innerHTML = ''; $capTech.textContent = '';
  }

  function show(i) {
    if (!state.files.length) { showEmpty(); return; }
    state.idx = (i + state.files.length) % state.files.length;
    const f = state.files[state.idx];
    const m = (state.data.images || {})[f] || {};

    const pic = document.createElement('picture');
    const img = document.createElement('img');
    img.src = `/images/${encodeURIComponent(f)}`;
    img.alt = m.caption || f;
    img.style.maxWidth = '100%'; img.style.maxHeight = '100%';
    pic.appendChild(img);

    $holder.innerHTML = ''; $holder.appendChild(pic);

    const title = m.caption || f;
    const desc = m.description || [m.state, m.location, m.color].filter(Boolean).join(' • ');
    $title.textContent = title; $desc.textContent = desc;

    $capTags.innerHTML = '';
    (m.tags || []).forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'chip'; chip.textContent = t;
      $capTags.appendChild(chip);
    });

    const bits = [m.camera, m.lens, m.focal_length, m.aperture, m.shutter, m.iso, m.date].filter(Boolean);
    $capTech.innerHTML = bits.join(' &nbsp;•&nbsp; ');

    Array.from($thumbs.children).forEach((e, idx) => e.classList.toggle('active', idx === state.idx));
  }

  function setCat(index) {
    state.catIndex = Math.max(0, Math.min(index, $catChips.length - 1));
    $catChips.forEach((c, i) => c.classList.toggle('active', i === state.catIndex));
    state.valueIndex = 0;
    buildCategoryValues();
  }

  function getCurrentCat() { return $catChips[state.catIndex]?.dataset.cat || 'state'; }

  function buildCategoryValues() {
    const cat = getCurrentCat();
    const filters = state.data.filters || {};
    let items = [];
    const counts = new Map();

    if (cat === 'state') items = filters.states || [];
    else if (cat === 'location') items = filters.locations || [];
    else if (cat === 'color') items = filters.colors || [];
    else if (cat === 'tags') items = filters.tags || [];
    else if (cat === 'clear') items = [];

    const imgs = state.data.images || {}; const files = state.data.files || [];
    function wouldMatch(f, cat, val) {
      const m = imgs[f] || {};
      if (cat === 'state') return (m.state||'') === val;
      if (cat === 'location') return (m.location||'') === val;
      if (cat === 'color') return (m.color||'') === val;
      if (cat === 'tags') return (m.tags||[]).map(t=>(t||'').toLowerCase()).includes(val.toLowerCase());
      return true;
    }
    items.forEach(v => { let c = 0; for (const f of files) if (wouldMatch(f, cat, v)): c += 1; counts.set(v, c); });

    $catValues.innerHTML = '';
    if (cat === 'clear') {
      const btn = document.createElement('div'); btn.className = 'value'; btn.textContent = 'Clear all filters';
      btn.addEventListener('click', clearFilters); $catValues.appendChild(btn); return;
    }

    const selectedSet = new Set(
      cat === 'tags' ? state.filter.tags.map(t => t.toLowerCase()) : [state.filter[cat]].filter(Boolean).map(v => v.toLowerCase())
    );
    items.forEach((v, i) => {
      const row = document.createElement('div');
      row.className = 'value' + (selectedSet.has(v.toLowerCase()) ? ' selected' : '');
      const name = document.createElement('div'); name.textContent = v;
      const cnt = document.createElement('div'); cnt.className = 'count'; cnt.textContent = counts.get(v) ?? '';
      row.appendChild(name); row.appendChild(cnt);
      row.addEventListener('click', () => toggleSelection(getCurrentCat(), v));
      $catValues.appendChild(row);
    });
  }

  function toggleSelection(cat, value) {
    if (cat === 'clear') return clearFilters();
    if (cat === 'tags') {
      const set = new Set(state.filter.tags.map(t => t.toLowerCase()));
      const v = value.toLowerCase();
      if (set.has(v)) state.filter.tags = state.filter.tags.filter(t => t.toLowerCase() !== v);
      else state.filter.tags = [...state.filter.tags, value];
    } else {
      state.filter[cat] = (state.filter[cat] === value) ? '' : value;
    }
    applyFilters(); buildCategoryValues();
  }

  function clearFilters() { state.filter = { state:'', location:'', color:'', tags:[] }; applyFilters(); buildCategoryValues(); }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') setCat(state.catIndex - 1);
    else if (e.key === 'ArrowRight') setCat(state.catIndex + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const items = Array.from($catValues.querySelectorAll('.value')); if (!items.length) return;
      state.valueIndex = (state.valueIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('selected', i === state.valueIndex || it.classList.contains('selected') && getCurrentCat()!=='tags'));
      items[state.valueIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const items = Array.from($catValues.querySelectorAll('.value')); if (!items.length) return;
      const cat = getCurrentCat(); const name = items[state.valueIndex].firstChild.textContent;
      toggleSelection(cat, name);
    } else if (e.key.toLowerCase() === 'f' || e.key === 'F11') {
      e.preventDefault(); const d=document, de=d.documentElement;
      if (!d.fullscreenElement) { de.requestFullscreen && de.requestFullscreen(); }
      else { d.exitFullscreen && d.exitFullscreen(); }
    } else if (e.key === 'ArrowLeft' && e.altKey) { show(state.idx - 1); }
    else if (e.key === 'ArrowRight' && e.altKey) { show(state.idx + 1); }
  });

  el('#btn-prev').addEventListener('click', () => show(state.idx - 1));
  el('#btn-next').addEventListener('click', () => show(state.idx + 1));
  el('#btn-full').addEventListener('click', () => {
    const d = document, de = d.documentElement;
    if (!d.fullscreenElement) { de.requestFullscreen && de.requestFullscreen(); }
    else { d.exitFullscreen && d.exitFullscreen(); }
  });

  fetchMetadata().catch(err => {
    console.error(err);
    $holder.innerHTML = '<div class="empty">Failed to load metadata. Is exiftool installed?</div>';
  });
})();

async function fetchImages() {
  const q = document.getElementById('q').value.trim();
  const orient = document.getElementById('orient').value;
  const url = new URL('/api/images', window.location.origin);
  if (q) url.searchParams.set('q', q);
  if (orient) url.searchParams.set('orient', orient);
  const res = await fetch(url);
  const data = await res.json();
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (const item of data.items) {
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = '/image?path=' + encodeURIComponent(item._path);
    img.alt = item.Title || item._name;
    img.onclick = () => showMeta(item._path, item._name);
    card.appendChild(img);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = (item.Title || item._name || '').toString();
    const w = item.ImageWidth || '?';
    const h = item.ImageHeight || '?';
    meta.innerHTML = `<span>${title}</span><span>${w}×${h}</span>`;
    card.appendChild(meta);
    grid.appendChild(card);
  }
}

async function showMeta(relPath, name) {
  const side = document.getElementById('side');
  side.classList.remove('hidden');
  document.getElementById('meta-name').textContent = name;
  const url = new URL('/api/metadata', window.location.origin);
  url.searchParams.set('path', relPath);
  const res = await fetch(url);
  const data = await res.json();
  document.getElementById('meta').textContent = JSON.stringify(data, null, 2);
}

document.getElementById('refresh').onclick = fetchImages;
document.getElementById('q').onkeydown = (e) => { if (e.key === 'Enter') fetchImages(); };
document.getElementById('orient').onchange = fetchImages;
document.getElementById('close').onclick = () => document.getElementById('side').classList.add('hidden');

fetchImages();

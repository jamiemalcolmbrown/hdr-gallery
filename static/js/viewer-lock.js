
// v0.4: body scroll lock when viewer is open (prevents background from moving/peeking)
(function(){
  const viewer = document.getElementById('viewer');
  if (!viewer) return;
  const origOverflow = document.body.style.overflow || '';
  const lock = () => { document.body.style.overflow = 'hidden'; };
  const unlock = () => { document.body.style.overflow = origOverflow; };

  const o = new MutationObserver(() => {
    const open = !viewer.classList.contains('hidden');
    if (open) lock(); else unlock();
  });
  o.observe(viewer, { attributes: true, attributeFilter: ['class'] });
})();

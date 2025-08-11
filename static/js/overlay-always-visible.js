
// Patch: ensure overlay is rendered and visible on every image change/open.
(function(){
  const overlay = document.getElementById('metaOverlay');
  if (!overlay) return;
  // If gallery.js exposes last entry, re-apply on next frame
  function forceShow(){
    overlay.style.display = 'block';
    overlay.style.opacity = '1';
  }
  // Listen for our custom events if present
  window.addEventListener('gallery-set-image', () => forceShow());
  window.addEventListener('gallery-last-entry', () => forceShow());
  // Also kick once on load in case viewer is already open
  requestAnimationFrame(forceShow);
})();

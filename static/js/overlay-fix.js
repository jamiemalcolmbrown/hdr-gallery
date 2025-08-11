// --- v0.4 overlay injector (safe to include after gallery.js) ---
(function(){
  function esc(s){return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function html(entry){
    if(!entry) return '';
    const t=entry.title||'', d=entry.description||'', c=entry.city||'', st=entry.state_fullname||'', se=entry.season||'';
    const parts=[];
    if(t) parts.push('<div class="meta-title">'+esc(t)+'</div>');
    if(d) parts.push('<div class="meta-desc">'+esc(d)+'</div>');
    const loc=[c,st].filter(Boolean).join(', ');
    if(loc) parts.push('<div class="meta-sub">'+esc(loc)+'</div>');
    if(se) parts.push('<div class="meta-tags">'+esc(se)+'</div>');
    return parts.join('');
  }

  const host=document.getElementById('layerHost');
  const overlay=document.getElementById('metaOverlay');
  if(!host||!overlay) return;

  if(!window.__forceOverlayRender){
    window.__forceOverlayRender=function(entry){
      const out=html(entry);
      overlay.innerHTML=out;
      overlay.style.display = out ? 'block' : 'none';
      window.__lastOverlayEntry = entry || null;
    };
  }

  window.addEventListener('gallery-set-image', function(e){
    try{ window.__forceOverlayRender(e.detail); }catch(_){}
  });

  const mo=new MutationObserver(()=>{
    if(window.__lastOverlayEntry) window.__forceOverlayRender(window.__lastOverlayEntry);
  });
  mo.observe(host,{childList:true});
})();

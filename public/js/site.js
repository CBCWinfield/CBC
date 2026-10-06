/* Church website: phone menu, sermon players. */
(function () {
  'use strict';
  var btn = document.querySelector('.nav .menu-btn'), menu = document.getElementById('menu');
  if (btn && menu) {
    var close = menu.querySelector('.menu-close');
    var set = function (open) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.hidden = !open;
      document.body.classList.toggle('menu-open', open);
      if (open && close) close.focus(); else btn.focus();
    };
    btn.addEventListener('click', function () { set(true); });
    if (close) close.addEventListener('click', function () { set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) set(false); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) { menu.hidden = true; document.body.classList.remove('menu-open'); } });
    window.addEventListener('resize', function () { if (window.innerWidth > 960 && !menu.hidden) set(false); });
  }
  // "Watch now" plays the sermon right there.
  var watch = document.querySelector('[data-play-latest]');
  if (watch) watch.addEventListener('click', function (e) { var b = document.querySelector('#sermon-player .player-btn'); if (b && b.tagName === 'BUTTON') { e.preventDefault(); b.click(); } });
  // Close the desktop "More" menu when clicking elsewhere.
  document.addEventListener('click', function (e) {
    document.querySelectorAll('.nav-more[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });
  // Sermon pictures: use YouTube's big image when it exists.
  document.querySelectorAll('img[data-fallback]').forEach(function (img) {
    var fix = function () { if (img.src !== img.dataset.fallback) img.src = img.dataset.fallback; };
    img.addEventListener('error', fix);
    img.addEventListener('load', function () { if (img.naturalWidth && img.naturalWidth < 200) fix(); });
  });
  // Play a sermon right where it is; only one plays at a time.
  var playing = null;
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.player-btn');
    if (!b) return;
    if (b.tagName !== 'BUTTON') return; // a plain YouTube link
    var fig = b.closest('figure.player');
    if (playing && playing.fig !== fig) { playing.fig.replaceChild(playing.btn, playing.fig.querySelector('iframe')); }
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + b.getAttribute('data-video') + '?autoplay=1&rel=0&modestbranding=1';
    f.title = b.getAttribute('aria-label') || 'Sermon';
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    f.allowFullscreen = true;
    fig.replaceChild(f, b);
    playing = { fig: fig, btn: b };
  });
})();

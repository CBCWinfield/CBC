/* Church website: phone menu, sermon players. */
(function () {
  'use strict';
  var btn = document.querySelector('.menu-btn'), menu = document.getElementById('menu');
  if (btn && menu) {
    var set = function (open) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.hidden = !open;
      document.body.classList.toggle('menu-open', open);
    };
    btn.addEventListener('click', function () { set(menu.hidden); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    window.addEventListener('resize', function () { if (window.innerWidth > 1060 && !menu.hidden) set(false); });
  }
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
    var fig = b.closest('.player');
    if (playing && playing.fig !== fig) { playing.fig.replaceChild(playing.btn, playing.fig.querySelector('iframe')); }
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + b.getAttribute('data-video') + '?autoplay=1&rel=0&modestbranding=1';
    f.title = (fig.querySelector('figcaption strong') || {}).textContent || 'Sermon';
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    f.allowFullscreen = true;
    fig.replaceChild(f, b);
    playing = { fig: fig, btn: b };
  });
})();

/* Sermon carousel: play a sermon in its own box, arrows to scroll. */
(function () {
  'use strict';
  // Use YouTube's big picture when it exists, otherwise the standard one.
  document.querySelectorAll('img[data-fallback]').forEach(function (img) {
    img.addEventListener('error', function () { if (img.src !== img.dataset.fallback) img.src = img.dataset.fallback; });
    if (img.complete && img.naturalWidth && img.naturalWidth < 200) img.src = img.dataset.fallback; // YouTube's 120px "no image" placeholder
    img.addEventListener('load', function () { if (img.naturalWidth < 200 && img.src !== img.dataset.fallback) img.src = img.dataset.fallback; });
  });
  var track = document.querySelector('.sx-track') || document.querySelector('.sx-feature');
  if (!track) return;
  var playing = null;
  function thumbFor(id, title) {
    var b = document.createElement('button');
    b.className = 'sx-thumb'; b.type = 'button'; b.setAttribute('data-video', id); b.setAttribute('aria-label', 'Play ' + title);
    b.innerHTML = '<img src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="" width="480" height="360">' + (document.body.classList.contains('sx-featured') ? '<span class="sx-badge">Latest sermon</span>' : '') + '<span class="sx-play" aria-hidden="true"><svg viewBox="0 0 68 48" width="56" height="40"><path d="M66.5 7.7c-.8-2.9-3-5.2-5.9-6C55.3.3 34 .3 34 .3s-21.3 0-26.6 1.4c-2.9.8-5.1 3.1-5.9 6C.1 13 .1 24 .1 24s0 11 1.4 16.3c.8 2.9 3 5.2 5.9 6 5.3 1.4 26.6 1.4 26.6 1.4s21.3 0 26.6-1.4c2.9-.8 5.1-3.1 5.9-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z" fill="#2E7D32"/><path d="M45 24 27 14v20z" fill="#fff"/></svg></span>';
    return b;
  }
  track.addEventListener('click', function (e) {
    var btn = e.target.closest('.sx-thumb');
    if (!btn) return;
    var id = btn.getAttribute('data-video');
    var title = (btn.closest('.sx-card').querySelector('.sx-title') || {}).textContent || 'sermon';
    if (playing) { var f = playing.frame; f.innerHTML = ''; f.appendChild(thumbFor(playing.id, playing.title)); } // only one plays at a time
    var frame = btn.parentNode;
    var ifr = document.createElement('iframe');
    ifr.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&modestbranding=1';
    ifr.title = title;
    ifr.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    ifr.allowFullscreen = true;
    frame.innerHTML = ''; frame.appendChild(ifr);
    playing = { frame: frame, id: id, title: title };
  });
  var prev = document.querySelector('.sx-prev'), next = document.querySelector('.sx-next'), dots = document.querySelector('.sx-dots');
  if (!prev || document.body.classList.contains('sx-grid')) return;
  var cards = track.querySelectorAll('.sx-card');
  // One dot per card on phones (swipe), so people can see there's more.
  cards.forEach(function (c, i) {
    var li = document.createElement('li'); var b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-label', 'Go to sermon ' + (i + 1));
    b.addEventListener('click', function () { track.scrollTo({ left: c.offsetLeft - track.offsetLeft, behavior: 'smooth' }); });
    li.appendChild(b); dots.appendChild(li);
  });
  var dotBtns = dots.querySelectorAll('button');
  function update() {
    prev.hidden = track.scrollLeft < 8;
    next.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
    var w = cards.length ? cards[0].getBoundingClientRect().width + 12 : 1;
    var at = Math.round(track.scrollLeft / w);
    if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 8) at = cards.length - 1;
    dotBtns.forEach(function (d, i) { d.setAttribute('aria-current', i === at ? 'true' : 'false'); });
  }
  prev.addEventListener('click', function () { track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' }); });
  next.addEventListener('click', function () { track.scrollBy({ left: track.clientWidth, behavior: 'smooth' }); });
  track.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();

'use strict';
// Sermon videos from the church's YouTube channel, as a carousel the Wix site (or any page)
// can embed. /sermons/embed?skip=1 skips the newest video, which the page above already shows.
const { html } = require('../lib/html');
const t = require('../lib/time');
const yt = require('../lib/youtube');

const when = (iso) => { const d = new Date(iso); return iso && !Number.isNaN(d.getTime()) ? t.fmtDateYear(d) : ''; };
const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function page({ videos, theme, layout, channelUrl }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sermons | Central Baptist Church</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Montserrat:wght@600;700&display=swap">
<link rel="stylesheet" href="/css/sermons.css?v=1">
<script src="/js/sermons.js?v=1" defer></script>
</head>
<body class="sx sx-${theme} sx-${layout}">
${videos.length ? html`<div class="sx-wrap">
  <button class="sx-nav sx-prev" type="button" aria-label="Earlier sermons" hidden>‹</button>
  <ul class="sx-track" aria-label="More sermons">
    ${videos.map((v) => html`<li class="sx-card">
      <div class="sx-frame">
        <button class="sx-thumb" type="button" data-video="${v.id}" aria-label="Play ${v.title}">
          <img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360">
          <span class="sx-play" aria-hidden="true"><svg viewBox="0 0 68 48" width="56" height="40"><path d="M66.5 7.7c-.8-2.9-3-5.2-5.9-6C55.3.3 34 .3 34 .3s-21.3 0-26.6 1.4c-2.9.8-5.1 3.1-5.9 6C.1 13 .1 24 .1 24s0 11 1.4 16.3c.8 2.9 3 5.2 5.9 6 5.3 1.4 26.6 1.4 26.6 1.4s21.3 0 26.6-1.4c2.9-.8 5.1-3.1 5.9-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z" fill="#2E7D32"/><path d="M45 24 27 14v20z" fill="#fff"/></svg></span>
        </button>
      </div>
      <p class="sx-title" title="${v.title}">${v.title}</p>
      <p class="sx-date">${when(v.published)}</p>
    </li>`)}
  </ul>
  <button class="sx-nav sx-next" type="button" aria-label="More sermons" hidden>›</button>
  <ol class="sx-dots" aria-label="Sermon pages"></ol>
</div>` : html`<p class="sx-empty">Sermons are loading. <a href="${channelUrl}" target="_blank" rel="noopener">Watch them on YouTube</a>.</p>`}
<p class="sx-more"><a href="${channelUrl}" target="_blank" rel="noopener">See all sermons on YouTube ›</a></p>
</body>
</html>`;
}

module.exports = (app) => {
  app.get('/sermons/embed', async (req, res) => {
    const skip = int(req.query.skip, 0, 14, 1);
    const count = int(req.query.count, 1, 15, 12);
    const match = String(req.query.match || '').trim().toLowerCase().slice(0, 40);
    let videos = await yt.recent();
    if (match) videos = videos.filter((v) => v.title.toLowerCase().includes(match));
    videos = videos.slice(skip, skip + count);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(page({
      videos,
      theme: req.query.theme === 'dark' ? 'dark' : 'light',
      layout: req.query.layout === 'grid' ? 'grid' : 'carousel',
      channelUrl: `https://www.youtube.com/channel/${yt.CHANNEL}`,
    }).toString());
  });

  // Plain list for other pages (e.g. a future sermons page on the church site).
  app.get('/sermons.json', async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ channel: yt.CHANNEL, videos: await yt.recent() });
  });
};

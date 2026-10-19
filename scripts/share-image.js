'use strict';
// Draws the picture a link shows when it's shared or previewed (Facebook, Messages, email): 1200 x 630.
//   node scripts/share-image.js            → public/img/share/sermons.png
// Needs Playwright (with Chromium) installed where Node can find it, e.g. NODE_PATH=$(npm root -g).
// The picture uses the website's own fonts, colors, wheat field and cross, so it matches the site.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const font = (f) => `url('file://${path.join(ROOT, 'public/fonts', f)}')`;
const wheat = fs.readFileSync(path.join(ROOT, 'src/site/wheat.html'), 'utf8');
const logo = `file://${path.join(ROOT, 'public/img/logo-central-white.png')}`;

const CROSS = `<svg viewBox="0 0 400 560" class="cross" aria-hidden="true"><defs>
  <radialGradient id="g" cx="200" cy="190" r="200" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F6DE9C" stop-opacity=".6"/><stop offset=".35" stop-color="#E2BE66" stop-opacity=".22"/><stop offset="1" stop-color="#E2BE66" stop-opacity="0"/></radialGradient>
  <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6DA"/><stop offset=".55" stop-color="#EBCB7C"/><stop offset="1" stop-color="#B98F3A"/></linearGradient>
  <linearGradient id="r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F6DE9C" stop-opacity=".5"/><stop offset="1" stop-color="#F6DE9C" stop-opacity="0"/></linearGradient></defs>
  <circle cx="200" cy="190" r="200" fill="url(#g)"/>
  <g transform="translate(200 190)" opacity=".75">${Array.from({ length: 16 }, (_, i) => `<rect x="30" y="-1" width="${i % 2 ? 150 : 210}" height="2" rx="1" fill="url(#r)" transform="rotate(${i * 22.5})"/>`).join('')}</g>
  <path d="M182 34h36v122h90v36h-90v342h-36V192H92v-36h90z" fill="url(#b)" stroke="#FFF6DA" stroke-opacity=".55" style="filter:drop-shadow(0 0 16px rgba(246,222,156,.5))"/></svg>`;

const PAGES = {
  sermons: {
    eyebrow: 'Sermons',
    title: 'Sunday’s message,',
    accent: 'any day of the week.',
    lead: 'Watch past sermons from Central Baptist Church in Winfield, Kansas.',
    cta: 'Watch the sermons',
    url: 'cbcwinfield.org/sermons',
  },
};

function page(p) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Bricolage Grotesque'; src: ${font('bricolage.woff2')} format('woff2'); font-weight: 200 800; }
@font-face { font-family: 'Instrument Sans'; src: ${font('instrument-sans.woff2')} format('woff2'); font-weight: 400 700; }
@font-face { font-family: 'Instrument Serif'; src: ${font('instrument-serif-italic.woff2')} format('woff2'); font-style: italic; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body { position: relative; color: #F5F1E6; font-family: 'Instrument Sans', sans-serif; -webkit-font-smoothing: antialiased;
  background: radial-gradient(900px 420px at 74% 96%, rgba(226,190,102,.30), transparent 62%), radial-gradient(760px 520px at 12% 0%, #24502F 0%, transparent 62%), linear-gradient(#132F1F 0%, #0F2719 62%, #163420 100%); }
/* the wheat, smaller than on the site so it stays a band along the bottom */
.field { position: absolute; left: -45%; right: -45%; bottom: 0; height: 190px; z-index: 1; transform: scale(.52); transform-origin: 50% 100%; }
.field .stalk { position: absolute; bottom: -8px; transform-origin: 50% 100%; transform: rotate(var(--r)); }
.field::after { content: ''; position: absolute; inset: auto 0 0; height: 120px; background: linear-gradient(transparent, rgba(10,30,18,.5)); z-index: 3; }
.logo { position: absolute; left: 64px; top: 46px; width: 168px; z-index: 4; }
.text { position: absolute; left: 64px; top: 140px; width: 640px; z-index: 4; }
.eyebrow { display: flex; align-items: center; gap: 14px; color: #E2BE66; font-weight: 700; font-size: 20px; letter-spacing: .2em; text-transform: uppercase; }
.eyebrow::before { content: ''; width: 40px; height: 2px; background: #E2BE66; }
h1 { margin-top: 18px; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 74px; line-height: .98; letter-spacing: -0.025em; }
h1 .serif { display: block; margin-top: 4px; font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 400; color: #E2BE66; font-size: 82px; letter-spacing: -0.01em; }
.lead { margin-top: 22px; font-size: 25px; line-height: 1.4; color: rgba(245,241,230,.86); max-width: 560px; }
.cta { margin-top: 28px; display: flex; align-items: center; gap: 18px; }
.btn { display: inline-flex; align-items: center; gap: 12px; height: 58px; padding: 0 28px 0 22px; border-radius: 999px; background: #E2BE66; color: #10261A;
  font-weight: 700; font-size: 22px; box-shadow: 0 14px 34px -14px rgba(226,190,102,.8); }
.btn i { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: #10261A; }
.btn i::before { content: ''; margin-left: 3px; border-left: 11px solid #E2BE66; border-top: 7px solid transparent; border-bottom: 7px solid transparent; }
.url { font-size: 20px; color: rgba(245,241,230,.7); letter-spacing: .01em; }
/* a stack of sermon videos */
.stack { position: absolute; right: 64px; top: 124px; width: 430px; height: 300px; z-index: 2; }
.card { position: absolute; width: 410px; aspect-ratio: 16 / 9; border-radius: 22px; overflow: hidden;
  background: radial-gradient(420px 240px at 50% 30%, #2D5C38, #12301E 70%); border: 1.5px solid rgba(245,241,230,.16); box-shadow: 0 30px 60px -28px rgba(0,0,0,.75); }
.card.c3 { right: -6px; top: -26px; transform: rotate(5deg); opacity: .45; }
.card.c2 { right: 0; top: -12px; transform: rotate(2.5deg); opacity: .7; }
.card.c1 { left: 0; top: 18px; transform: rotate(-1.5deg); border-color: rgba(226,190,102,.5); }
.card .cross { position: absolute; left: 50%; top: 50%; width: 190px; transform: translate(-50%, -46%); opacity: .95; }
.play { position: absolute; left: 50%; top: 50%; width: 92px; height: 92px; margin: -46px 0 0 -46px; border-radius: 50%; background: rgba(16,38,26,.72);
  border: 2px solid rgba(255,246,218,.85); box-shadow: 0 0 0 10px rgba(226,190,102,.14), 0 16px 34px -12px rgba(0,0,0,.6); display: grid; place-items: center; }
.play::before { content: ''; margin-left: 8px; border-left: 30px solid #F6DE9C; border-top: 19px solid transparent; border-bottom: 19px solid transparent; }
.bar { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 18px; background: linear-gradient(transparent, rgba(8,22,14,.85)); font-size: 17px; font-weight: 600; color: rgba(245,241,230,.92); }
.bar b { color: #E2BE66; font-weight: 700; }
</style></head><body>
<img class="logo" src="${logo}" alt="">
<div class="text">
  <p class="eyebrow">${p.eyebrow}</p>
  <h1>${p.title}<span class="serif">${p.accent}</span></h1>
  <p class="lead">${p.lead}</p>
  <div class="cta"><span class="btn"><i></i>${p.cta}</span><span class="url">${p.url}</span></div>
</div>
<div class="stack">
  <div class="card c3"></div><div class="card c2"></div>
  <div class="card c1">${CROSS}<span class="play"></span><span class="bar"><b>Sunday worship</b> · Pastor Blake Orr</span></div>
</div>
<div class="field">${wheat}</div>
</body></html>`;
}

(async () => {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PAGES);
  const b = await chromium.launch();
  const tab = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const key of which) {
    const tmp = path.join(require('os').tmpdir(), `share-${key}.html`);
    fs.writeFileSync(tmp, page(PAGES[key]));
    await tab.goto('file://' + tmp);
    await tab.evaluate(() => document.fonts.ready);
    const out = path.join(ROOT, 'public/img/share', `${key}.png`);
    await tab.screenshot({ path: out, type: 'png' });
    console.log('wrote', path.relative(ROOT, out), fs.statSync(out).size, 'bytes');
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

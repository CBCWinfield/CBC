'use strict';
// The church website, built from the "Central Baptist Redesign" homepage design.
const fs = require('fs');
const path = require('path');
const { html, raw } = require('../lib/html');
const t = require('../lib/time');
const C = require('./content');
const wheat = require('./wheat');

const { CHURCH } = C;
const appUrl = (p) => `${CHURCH.app}${p}`;
const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const when = (iso) => { const d = new Date(iso); return iso && !Number.isNaN(d.getTime()) ? t.fmtDateYear(d) : ''; };
const longDate = (key) => t.fmtLong(t.zoned(...key.split('-').map(Number), 12));
const upcoming = () => C.EVENTS.filter((e) => e.date >= t.dateKey(new Date()));
const years = () => new Date().getFullYear() - CHURCH.founded;
const ARROW = raw('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>');
const OUT = raw('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>');
const PLAY = raw('<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>');
const PIN = raw('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E2BE66" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>');

// Homepage hero: the cross with light behind it, and the church's slogan.
const CROSS = raw(`<figure class="hero-cross">
  <svg class="hc-art" viewBox="0 0 400 560" aria-hidden="true">
    <defs>
      <radialGradient id="hcGlow" cx="200" cy="190" r="200" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#F6DE9C" stop-opacity=".55"/><stop offset=".35" stop-color="#E2BE66" stop-opacity=".22"/><stop offset="1" stop-color="#E2BE66" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="hcBeam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6DA"/><stop offset=".55" stop-color="#EBCB7C"/><stop offset="1" stop-color="#B98F3A"/></linearGradient>
      <linearGradient id="hcRay" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F6DE9C" stop-opacity=".5"/><stop offset="1" stop-color="#F6DE9C" stop-opacity="0"/></linearGradient>
    </defs>
    <circle class="hc-glow" cx="200" cy="190" r="200" fill="url(#hcGlow)"/>
    <g class="hc-rays" transform="translate(200 190)">${Array.from({ length: 16 }, (_, i) => `<rect x="30" y="-1" width="${i % 2 ? 150 : 210}" height="2" rx="1" fill="url(#hcRay)" transform="rotate(${i * 22.5})"/>`).join('')}</g>
    <g class="hc-cross">
      <path d="M182 34h36v122h90v36h-90v342h-36V192H92v-36h90z" fill="url(#hcBeam)" stroke="#FFF6DA" stroke-opacity=".55" stroke-linejoin="round"/>
    </g>
  </svg>
  <figcaption>The Cross is <span class="serif">Central.</span></figcaption>
</figure>`);

// Staff photo on disk? Returns a cache-busting stamp or 0. Photos go in public/img/staff/<key>.jpg.
function staffPhoto(key) {
  try { return Math.floor(fs.statSync(path.join(__dirname, '..', '..', 'public', 'img', 'staff', `${key}.jpg`)).mtimeMs / 1000); } catch { return 0; }
}

const NAV = [['/about', 'About'], ['/ministries', 'Ministries'], ['/sermons', 'Sermons'], ['/events', 'Events'], ['/staff', 'Staff'], ['/connect', 'Connect']];

// The main menu, with the same dropdowns the old site had. Links starting with "app:" go to the church app;
// "ext" opens in a new tab.
const MENU = [
  { label: 'About', href: '/about' },
  { label: 'Ministries', href: '/ministries', groups: [
    { title: 'Ministries', links: [['/ministries#kids', 'Central Kids'], ['/ministries#students', 'Central Teens'], ['/ministries#adults', 'Adults'], ['/ministries#bus', 'Bus Ministry']] },
    { title: 'Missions & outreach', links: [
      ['https://kfl.org/baby-bottle-project/', 'Kansans For Life Baby Bottle Project', 'ext'],
      ['https://casasporcristo.org/', 'Mexico Mission Trip (Casas Por Cristo)', 'ext'],
      ['https://www.samaritanspurse.org/', 'Operation Christmas Child', 'ext'],
      ['https://www.namb.net/', 'North American Mission Board', 'ext'],
      ['https://www.imb.org/', 'International Mission Board', 'ext'],
    ] },
  ] },
  { label: 'Sermons', href: '/sermons' },
  { label: 'Resources', href: '/events', groups: [
    { title: 'At Central', links: [['app:/', 'Church library'], ['/events', 'Events'], ['shop', 'Church shop', 'ext'], ['app:/checkin/family', 'Family check-in']] },
    { title: 'Southern Baptist partners', links: [
      ['https://www.kncsb.org/', 'Church Forward', 'ext'],
      ['https://www.sbc.net/', 'Southern Baptist Convention', 'ext'],
      ['https://scasbks.com/', 'South Central Association of Southern Baptists', 'ext'],
      ['https://www.baptistpress.com/', 'Baptist Press', 'ext'],
    ] },
  ] },
  { label: 'Staff', href: '/staff' },
  { label: 'Connect', href: '/connect', groups: [
    { title: 'Connect', links: [['/connect', 'Contact us'], ['/visit', 'Plan a visit'], ['app:/checkin/prayer', 'Prayer Wall'], ['/serve', 'Serve'], ['/ride', 'Request a bus ride']] },
  ] },
];

// Page wrapper: the green banner (nav, heading, swaying wheat), the page, and the footer.
function layout({ title, desc, page, body, base = '', head }) {
  const href = (p) => (p.startsWith('http') ? p : `${base}${p}`);
  const link = (u) => (u === 'shop' ? CHURCH.shop : u.startsWith('app:') ? appUrl(u.slice(4)) : href(u));
  const cur = (p) => (page === p.replace(/^\//, '') || (p === '/' && page === 'home') ? raw(' aria-current="page"') : '');
  const isHome = page === 'home';
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title ? `${title} | Central Baptist Church` : 'Central Baptist Church | Winfield, Kansas'}</title>
<meta name="description" content="${desc || `Central Baptist Church is a Southern Baptist church family on Wheat Road in Winfield, Kansas, for ${years()} years. Sundays at 9:30 and 10:45 AM, Wednesdays at 6:00 PM.`}">
<meta name="theme-color" content="#132F1F">
<meta property="og:title" content="${title || 'Central Baptist Church'}">
<meta property="og:description" content="${desc || `A church family on Wheat Road in Winfield, Kansas, for ${years()} years.`}">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/img/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="preload" href="/fonts/bricolage.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/instrument-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/site.css?v=23">
<script src="/js/site.js?v=6" defer></script>
<script type="application/ld+json">${raw(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Church', name: CHURCH.name, telephone: CHURCH.phone, email: CHURCH.email, address: { '@type': 'PostalAddress', streetAddress: '904 Wheat Rd', addressLocality: 'Winfield', addressRegion: 'KS', postalCode: '67156', addressCountry: 'US' }, sameAs: [CHURCH.youtube, CHURCH.facebook] }).replace(/</g, '\\u003c'))}</script>
</head>
<body class="page-${page}">
<a class="skip" href="#main">Skip to content</a>
<header class="hero${isHome ? '' : ' hero-page'}">
  <nav class="nav" aria-label="Main">
    <a class="brand" href="${href('/')}" aria-label="Central Baptist Church home"><img src="/img/logo-central-white.png" alt="Central Baptist Church" width="640" height="224"></a>
    <div class="navlinks">
      ${MENU.map((m) => (m.groups ? html`<details class="navdrop">
        <summary class="navlink"${page === m.href.slice(1) ? raw(' aria-current="page"') : ''}>${m.label}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>
        <div class="navdrop-pop${m.groups.length > 1 ? ' wide' : ''}">${m.groups.map((g) => html`<div class="navdrop-col"><p class="navdrop-title">${g.title}</p>${g.links.map(([u, l, ext]) => html`<a href="${link(u)}"${ext ? raw(' target="_blank" rel="noopener"') : ''}>${l}${ext ? html`<span class="ext" aria-hidden="true">↗</span>` : ''}</a>`)}</div>`)}</div>
      </details>` : html`<a class="navlink" href="${link(m.href)}"${m.ext ? raw(' target="_blank" rel="noopener"') : cur(m.href)}>${m.label}</a>`))}
    </div>
    <div class="nav-cta">
      <a class="btn btn-ghost btn-sm" href="${href('/give')}">Give</a>
      <a class="btn btn-gold btn-sm" href="${href('/visit')}">Plan a visit</a>
    </div>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="menu"><span class="menu-lines" aria-hidden="true"></span><span class="visually-hidden">Menu</span></button>
  </nav>
  <div class="hero-in" id="top">
    ${head.kicker !== false ? html`<p class="hero-kicker">${head.kicker || 'Central Baptist Church'}</p>` : ''}
    <h1>${head.title}</h1>
    ${head.lead ? html`<p class="hero-lead">${head.lead}</p>` : ''}
    ${head.actions ? html`<div class="hero-actions">${head.actions}</div>` : ''}
    ${isHome ? CROSS : ''}
  </div>
  <div class="field" aria-hidden="true"><div class="field-inner">${wheat()}</div></div>
</header>
<div class="menu" id="menu" hidden>
  <div class="menu-top"><img src="/img/logo-central-white.png" alt="" width="640" height="224"><button class="menu-btn menu-close" type="button" aria-expanded="true" aria-controls="menu"><span class="menu-lines" aria-hidden="true"></span><span class="visually-hidden">Close menu</span></button></div>
  <nav aria-label="Menu">
    <a class="menu-big" href="${href('/')}"${cur('/')}>Home</a>
    ${MENU.map((m) => (m.groups ? html`<details class="menu-group"><summary class="menu-big">${m.label}</summary>
      <div class="menu-sub"><a href="${href(m.href)}">${m.label === 'Resources' ? 'Events' : `All ${m.label.toLowerCase()}`}</a>${m.groups.map((g) => html`<p class="menu-sub-title">${g.title}</p>${g.links.map(([u, l, ext]) => html`<a href="${link(u)}"${ext ? raw(' target="_blank" rel="noopener"') : ''}>${l}</a>`)}`)}</div>
    </details>` : html`<a class="menu-big" href="${link(m.href)}"${m.ext ? raw(' target="_blank" rel="noopener"') : cur(m.href)}>${m.label}</a>`))}
    <a class="menu-big" href="${href('/give')}"${cur('/give')}>Give</a>
    <div class="menu-cta"><a class="btn btn-gold" href="${href('/visit')}">Plan a visit</a><a class="btn btn-ghost" href="${href('/give')}">Give</a></div>
  </nav>
</div>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="foot-in">
    <div class="foot-brand">
      <img src="/img/logo-central-white.png" alt="Central Baptist Church" width="640" height="224">
      <p>A Southern Baptist church family on Wheat Road in Winfield, Kansas, since ${CHURCH.founded}.</p>
    </div>
    <div>
      <h2>Visit</h2>
      <a href="${CHURCH.maps}" target="_blank" rel="noopener">${CHURCH.street}<br>${CHURCH.cityLine}</a>
      <a href="${CHURCH.phoneHref}">${CHURCH.phone}</a>
      <a class="mail" href="mailto:${CHURCH.email}">${CHURCH.email}</a>
    </div>
    <div>
      <h2>Gather</h2>
      <span>Sun 9:30 · Sunday School</span><span>Sun 10:45 · Worship</span><span>Mon 1:00 · Adult Bible Study</span><span>Wed 6:00 · Meal &amp; Bible Study</span><span>Nursery &amp; childcare provided</span>
    </div>
    <div>
      <h2>Explore</h2>
      <a href="${href('/sermons')}">Sermons</a><a href="${href('/give')}">Give</a><a href="${appUrl('/checkin/prayer')}">Prayer Wall</a>
      <a href="${CHURCH.shop}" target="_blank" rel="noopener">Church Shop</a><a href="${appUrl('/')}">Library</a>
      <a href="${CHURCH.youtube}" target="_blank" rel="noopener">YouTube</a><a href="${CHURCH.facebook}" target="_blank" rel="noopener">Facebook</a>
    </div>
  </div>
  <div class="foot-bar"><span>© ${new Date().getFullYear()} Central Baptist Church <a href="/privacy">Privacy</a><a href="/terms">Terms</a></span><span>Celebrating ${years()} years · ${CHURCH.founded}–${new Date().getFullYear()}</span></div>
</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------- shared pieces
function player(v, { small = false, caption = true } = {}) {
  if (!v) return html`<figure class="player${small ? ' player-sm' : ''}"><a class="player-btn" href="${CHURCH.youtube}" target="_blank" rel="noopener"><span class="player-play"><span>${raw('<svg width="34" height="34" viewBox="0 0 24 24" fill="#10261A" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>')}</span></span><span class="player-cap">Watch on YouTube</span></a></figure>`;
  return html`<figure class="player${small ? ' player-sm' : ''}">
    <button class="player-btn" type="button" data-video="${v.id}" aria-label="Play ${v.title}">
      <img src="https://i.ytimg.com/vi/${v.id}/${small ? 'hqdefault' : 'maxresdefault'}.jpg" data-fallback="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="" loading="${small ? 'lazy' : 'eager'}" width="1280" height="720">
      <span class="player-play"><span>${raw('<svg width="34" height="34" viewBox="0 0 24 24" fill="#10261A" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>')}</span></span>
      ${!small && caption ? html`<span class="player-cap">${when(v.published)}</span>` : ''}
    </button>
    ${small ? html`<figcaption><strong>${v.title}</strong><span>${when(v.published)}</span></figcaption>` : ''}
  </figure>`;
}

function timesBand() {
  return html`<section class="times" aria-label="Service times"><div class="times-in">
    <div class="time"><span class="time-day">Sunday</span><span class="time-at">9:30 AM</span><span class="time-what">Sunday School &amp; Adult Study</span></div>
    <div class="time"><span class="time-day">Sunday</span><span class="time-at">10:45 AM</span><span class="time-what">Worship · Children’s Church</span></div>
    <div class="time"><span class="time-day">Wednesday</span><span class="time-at">6:00 PM</span><span class="time-what">Meal, Fellowship &amp; Bible Study · Teens &amp; Kids</span></div>
    <a class="where" href="${CHURCH.maps}" target="_blank" rel="noopener"><span class="where-pin">${PIN}</span><span class="where-text"><strong>904 Wheat Rd.</strong><span>Winfield, KS 67156 · Directions</span></span></a>
    <p class="times-note">${NURSERY_ICON} Nursery and childcare provided</p>
  </div></section>`;
}

function eventCard(e, base, { detail = false } = {}) {
  const [y, m, d] = e.date.split('-').map(Number);
  const dt = t.zoned(y, m, d, 12);
  const mon = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: t.TZ }).format(dt);
  const wd = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: t.TZ }).format(dt);
  return html`<div class="event-card">
    <div class="event-75" aria-hidden="true">${years()}</div>
    <div class="event-main">
      <div class="event-date" aria-hidden="true"><span class="m">${mon}</span><span class="d">${d}</span><span class="w">${wd}</span></div>
      <div class="event-text">
        <p class="event-kicker">${e.kicker || longDate(e.date)}</p>
        <h2>${e.titleA ? html`${e.titleA} <span class="serif">${e.titleB}</span>` : e.title}</h2>
        <p class="body">${detail ? html`${longDate(e.date)}, ${e.start} to ${e.end} at ${e.where}. ${e.body}` : e.short || `${e.start} to ${e.end}. ${e.body}`}</p>
      </div>
    </div>
    <div class="event-actions">
      ${detail ? html`<a class="btn btn-dark" href="${base}/connect?topic=${encodeURIComponent(e.title)}">Ask a question</a>` : html`<a class="btn btn-dark" href="${base}/events">See the details</a>`}
      <a class="btn btn-line" href="${base}/events/${e.key}.ics">Add to calendar</a>
    </div>
  </div>`;
}

const pageHead = (title, lead, kicker) => ({ kicker, title, lead });

// ---------------------------------------------------------------- home (the design, section by section)
function home({ latest, base }) {
  const ev = upcoming();
  const orr = staffPhoto('orr');
  const body = html`
  ${timesBand()}
  ${ev.length ? html`<section id="events" class="wrap sec-tight">${eventCard(ev[0], base)}</section>` : ''}

  <section id="sermons" class="wrap sec"><div class="sermon">
    <div class="sermon-text">
      <p class="eyebrow">This week’s message</p>
      <h2>${latest ? latest.title : 'Sunday’s message'}</h2>
      <p class="lead">Pastor Blake Orr${latest ? ` · ${when(latest.published)}` : ''}. Missed Sunday, or want to hear it again? Catch up from anywhere.</p>
      <div class="btn-row"><a class="btn btn-dark" href="#sermon-player" data-play-latest>Watch now</a><a class="btn btn-line" href="${base}/sermons">All sermons</a></div>
    </div>
    <div class="player" id="sermon-player">${player(latest)}</div>
  </div></section>

  <section id="visit" class="wrap sec">
    <div class="sec-head">
      <div><p class="eyebrow">Your first Sunday</p><h2 class="h-sec" style="max-width:14ch">We saved you a seat.</h2></div>
      <a class="btn btn-dark" href="${base}/visit">Let us know you’re coming</a>
    </div>
    <div class="grid3">
      <div class="card step"><span class="step-n">01</span><h3>Someone will meet you</h3><p>Pull in at 904 Wheat Rd. A greeter at the door will help you find your way, grab coffee, and get settled.</p></div>
      <div class="card step"><span class="step-n">02</span><h3>Your kids are in good hands</h3><p>Each child gets a printed name tag and matching pickup code. Only you, or people you list, can pick them up.</p></div>
      <div class="card step"><span class="step-n">03</span><h3>No pressure, ever</h3><p>Sit wherever you like, take it all in, and we won’t add you to any lists.</p></div>
    </div>
  </section>

  <section id="ministries" class="wrap sec">
    <p class="eyebrow">Ministries</p>
    <h2 class="h-sec" style="max-width:18ch">Every age, growing in Christ together.</h2>
    <div class="grid3">
      <a class="card min-card" href="${base}/ministries#kids"><div class="min-art min-kids"><span>Kids</span></div><div class="min-body"><p class="tag">Nursery – 5th grade</p><p>A safe, fun place to learn about Jesus. Sundays at 9:30 and 10:45, and Wednesday nights.</p></div></a>
      <a class="card min-card" href="${base}/ministries#students"><div class="min-art min-teens"><span>Teens</span></div><div class="min-body"><p class="tag">Middle &amp; high school</p><p>Central Teens meets Wednesdays at 6:00 to dig into Scripture and build real friendships.</p></div></a>
      <a class="card min-card" href="${base}/ministries#adults"><div class="min-art min-adults"><span>Adults</span></div><div class="min-body"><p class="tag">Study &amp; fellowship</p><p>Sunday School at 9:30, Monday Bible Study at 1:00, and a Wednesday meal and Bible study at 6:00.</p></div></a>
    </div>
    <a class="card bus-band" href="${base}/ride">
      <img src="/img/bus.webp" alt="The Central Baptist Church bus" width="1200" height="900" loading="lazy">
      <div class="bus-text"><p class="tag">Bus ministry</p><h3>Need a ride to church? Just ask.</h3><p>For decades our bus and van ministry has brought kids and students to church, and to Jesus. On Wednesday nights the bus picks up around 5:30 PM and drops off around 7:45 PM. Live in Cowley County? Let us know.</p><span class="u">Request a ride</span></div>
    </a>
  </section>

  <section id="about" class="wrap sec"><div class="pastor">
    <div class="pastor-photo">${orr ? html`<img src="/img/staff/orr.jpg?v=${orr}" alt="Pastor Blake and Ruth Orr" width="1000" height="750" loading="lazy">` : html`<span class="pastor-mono" aria-hidden="true">B &amp; R</span>`}</div>
    <div class="pastor-text">
      <p class="eyebrow eyebrow-gold">A word from our pastor</p>
      <p class="pastor-quote">“For seventy-five years, this church has been a place where people are known by name. We’d love for you to be one of them.”</p>
      <div class="pastor-by"><span class="av" aria-hidden="true">BR</span><span><strong>Blake &amp; Ruth Orr</strong><em>Senior Pastor · 17th year at Central</em></span></div>
      <a class="u" href="${base}/staff">Meet our staff &amp; leaders</a>
    </div>
  </div></section>

  <section id="give" class="wrap sec sec-last grid2">
    <div class="card pad-card"><p class="eyebrow">Give</p><h2>Generosity that reaches Winfield and the world.</h2><p class="body">Give once or set up recurring giving through Vanco, our secure online giving partner. You can also give during worship or by mail.</p><a class="btn btn-dark" href="${base}/give">Give online</a></div>
    <div id="connect" class="card pad-card"><p class="eyebrow">Prayer</p><h2>How can we pray for you?</h2><p class="body">Share a request on our prayer wall, or call the church office. Someone here will pray for you this week, by name.</p><a class="btn btn-line" href="${appUrl('/checkin/prayer')}">Share a prayer request</a></div>
  </section>`;
  return {
    head: {
      kicker: `Winfield, Kansas · Since ${CHURCH.founded}`,
      title: html`A church family on Wheat Road for <span class="serif">${years()} years.</span>`,
      lead: 'A place to know Jesus, grow in His Word, and belong to a family that will pray for you by name. We’d love to see you this Sunday.',
      actions: html`<a class="btn btn-gold" href="${base}/visit">Plan your visit ${ARROW}</a><a class="btn btn-ghost" href="#sermons">${PLAY} Watch the latest sermon</a>`,
    },
    body,
  };
}

// ---------------------------------------------------------------- inner pages
const NURSERY_ICON = raw('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M10.5 8h.01M13.5 8h.01M10.8 9.8c.7.5 1.7.5 2.4 0M6 21c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>');
function schedule() {
  return html`<ul class="sched">${C.TIMES.map((x) => html`<li><div><span class="sched-day">${x.day}</span><span class="sched-at">${x.time}</span></div><div><strong>${x.what}</strong><p>${x.note}</p></div></li>`)}</ul>
  <p class="nursery-note">${NURSERY_ICON} Nursery and childcare provided.</p>`;
}

function contactForm({ csrf, base, topic = '', button = 'Send message', compact = false, values = {}, error }) {
  return html`<form method="post" action="${base}/connect" class="form" novalidate>
    ${csrfField(csrf)}<input type="hidden" name="topic" value="${values.topic || topic}">
    ${error ? html`<p class="err" role="alert">${error}</p>` : ''}
    <div class="row2"><label>Name<input name="name" required autocomplete="name" value="${values.name || ''}"></label>
    <label>Phone <span class="opt">(optional)</span><input name="phone" type="tel" autocomplete="tel" value="${values.phone || ''}"></label></div>
    <label>Email<input name="email" type="email" required autocomplete="email" value="${values.email || ''}"></label>
    ${(values.topic || topic) === 'Planning a visit' ? html`<label class="check-row"><input type="checkbox" name="kids" value="1"> I’m bringing kids <span class="opt">(we’ll email a quick form so we can care for them well)</span></label>` : ''}
    <label>${compact ? html`Anything we should know? <span class="opt">(optional)</span>` : 'How can we help?'}<textarea name="message" rows="${compact ? 3 : 5}" ${compact ? '' : raw('required')}>${values.message || ''}</textarea></label>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn btn-dark btn-block" type="submit">${button}</button>
  </form>`;
}

function visit({ csrf, base, sent }) {
  return {
    head: { kicker: 'Your first Sunday', title: html`We saved you a <span class="serif">seat.</span>`, lead: 'Here’s what to expect when you visit Central Baptist Church. We can’t wait to meet you.' },
    body: html`${timesBand()}
    <section class="wrap sec sec-last"><div class="two">
      <div class="prose">
        <h2>When we gather</h2>
        ${schedule()}
        <h2>When you arrive</h2>
        <p>Pull in at <a href="${CHURCH.maps}" target="_blank" rel="noopener">904 Wheat Rd.</a> A greeter at the door will help you find your way, grab coffee, and get settled. Wear what’s comfortable.</p>
        <h2>Bringing kids?</h2>
        <p>Children are welcome in worship, and Children’s Church meets during the 10:45 service. At the welcome desk we’ll check your kids in and print their name tags with a matching pickup code for you. Only you, or the people you list, can pick them up.</p>
        <p>Want to skip the line? <a href="${appUrl('/checkin/family')}">Set up your family online</a> before you come.</p>
      </div>
      <aside class="card form-card">
        <h2>Let us know you’re coming</h2>
        <p>We’ll watch for you and help you get settled. No pressure, and we won’t add you to any lists.</p>
        ${sent ? html`<p class="ok" role="status">Thank you! We’ve got your note and look forward to seeing you Sunday.</p>` : contactForm({ csrf, base, topic: 'Planning a visit', button: 'Send', compact: true })}
      </aside>
    </div></section>`,
  };
}

// About page: how we're connected, and a plain-language summary of The Baptist Faith and Message 2000.
const ASSOC = [
  ['Locally', 'South Central Association of Southern Baptists', 'Churches in our corner of Kansas who pray together, share resources, and serve our area side by side.', 'https://scasbks.com/'],
  ['Regionally', 'Church Forward', 'The Kansas-Nebraska Convention of Southern Baptists, helping churches across both states start, grow, and reach their communities.', 'https://www.kncsb.org/'],
  ['Nationally', 'Southern Baptist Convention', 'A fellowship of tens of thousands of churches whose giving supports missionaries across North America and around the world.', 'https://www.sbc.net/'],
];
const BELIEFS = [
  ['The Bible', 'The Bible was written by people inspired by God. It is true and trustworthy, without any mixture of error, and it is our final authority for faith and life.'],
  ['God', 'There is one true God, eternally existing as Father, Son, and Holy Spirit: three persons, one God.'],
  ['Jesus Christ', 'Jesus is the eternal Son of God, born of the virgin Mary. He lived a sinless life, died on the cross for our sins, rose bodily from the grave, and will return in glory.'],
  ['The Holy Spirit', 'The Spirit draws people to Christ, gives new life, lives in every believer, and gives gifts so we can serve the church.'],
  ['People', 'Every person is created in God’s image and has dignity and worth. All of us have sinned and are separated from God, and we cannot save ourselves.'],
  ['Salvation', 'Salvation is a free gift of God’s grace, received by repentance and faith in Jesus Christ alone. Everyone who is truly born again is kept secure by God forever.'],
  ['The Church', 'A local church is a self-governing congregation of baptized believers who worship together, follow Christ’s teaching, and take the gospel to the world. Scripture limits the office of pastor to qualified men, and men and women alike are gifted to serve.'],
  ['Baptism & the Lord’s Supper', 'Baptism is the immersion of a believer in water, a picture of new life in Christ. The Lord’s Supper is a meal of remembrance of His death until He comes.'],
  ['The Last Things', 'Jesus will return personally and visibly. The dead will be raised, God will judge the world in righteousness, and those who belong to Christ will live with Him forever.'],
  ['Mission', 'Every follower of Jesus and every church is called to make disciples of all nations, sharing the good news by word and by a Christ-like life.'],
  ['Family & life', 'God designed marriage as the union of one man and one woman for a lifetime. Children are a blessing from the Lord, and every human life is sacred from conception to natural death.'],
  ['Religious liberty', 'God alone is Lord of the conscience. Church and state should be separate, and every person should be free to worship according to conscience.'],
];

function about({ base }) {
  return {
    head: { kicker: 'About Central', title: html`Rooted in faith, hope, and <span class="serif">love.</span>`, lead: `For ${years()} years, Central Baptist Church has been a cornerstone of the Winfield community, sharing the message of Christ’s love through worship, fellowship, and service.` },
    body: html`<section class="wrap sec"><div class="two">
      <div class="prose">
        <p class="eyebrow">Who we are</p>
        <h2 style="margin-top:14px">A Southern Baptist church family in Winfield, Kansas.</h2>
        <p>We are a Southern Baptist congregation committed to sound doctrine and to a warm, welcoming place where people of every age can know Jesus and grow in Him.</p>
        <p>Our mission is simple: to make disciples of Jesus Christ here in Winfield and beyond, as a body of believers unified to worship God, to show Christ-like love for each other, and to serve our community and our world through the power of the Holy Spirit.</p>
        <div class="values">
          <div class="card value"><h3>God’s Word</h3><p>The Bible is our authority, and we open it together every week.</p></div>
          <div class="card value"><h3>Worship</h3><p>We gather to praise the God who has been faithful to us for ${years()} years.</p></div>
          <div class="card value"><h3>Family</h3><p>Kids, teens, and adults growing together and caring for each other.</p></div>
          <div class="card value"><h3>Mission</h3><p>From Winfield to Juárez and around the world, we go and give.</p></div>
        </div>
      </div>
      <aside class="aside-gold"><p class="eyebrow" style="color:#10261A">1951 — ${new Date().getFullYear()}</p><p class="big">${years()}</p><p>years of God’s faithfulness on Wheat Road.</p><a class="btn btn-dark" href="${base}/visit">Come see for yourself</a></aside>
    </div></section>
    <section class="wrap sec-tight" id="family">
      <div class="prose" style="max-width:760px">
        <p class="eyebrow">Our Baptist family</p>
        <h2 style="margin-top:14px">An independent church that <span class="serif">cooperates.</span></h2>
        <p>Like every Southern Baptist church, Central is self-governing. Our members, under the lordship of Christ, call our pastor, set our budget, and make our own decisions. No denomination owns our building or directs our church.</p>
        <p>We also believe churches can do more together than apart. So we gladly cooperate with other Southern Baptist churches, close to home and around the world, to train leaders, plant churches, help in disasters, and send missionaries.</p>
      </div>
      <div class="assoc">
        ${ASSOC.map(([level, name, body, url]) => html`<a class="card assoc-card" href="${url}" target="_blank" rel="noopener"><p class="tag">${level}</p><h3>${name}</h3><p>${body}</p><span class="u">Visit their site ${OUT}</span></a>`)}
      </div>
    </section>
    <section class="wrap sec sec-last" id="beliefs">
      <div class="prose" style="max-width:760px">
        <p class="eyebrow">What we believe</p>
        <h2 style="margin-top:14px">The Cross is <span class="serif">Central.</span></h2>
        <p>We believe in Jesus Christ, the eternal Son of God, who died on the cross of Calvary for our sins and rose again. Our church affirms <a href="https://bfm.sbc.net/bfm2000/" target="_blank" rel="noopener">The Baptist Faith and Message 2000</a>, the statement of faith shared by Southern Baptist churches. Here it is in brief.</p>
      </div>
      <div class="beliefs">
        ${BELIEFS.map(([title, body]) => html`<div class="card belief"><h3>${title}</h3><p>${body}</p></div>`)}
      </div>
      <p class="small muted beliefs-note">These are short summaries. The full Baptist Faith and Message, with Scripture references for every article, is at <a href="https://bfm.sbc.net/bfm2000/" target="_blank" rel="noopener">bfm.sbc.net</a>. Have a question about what we believe? <a href="${base}/connect?topic=${encodeURIComponent('A question about faith')}">Ask us</a>; we’d love to talk.</p>
    </section>`,
  };
}

function ministries({ base }) {
  const art = { kids: html`<div class="card"><img src="/img/central-kids.webp" alt="Central Kids" width="640" height="320"></div>`, students: html`<div class="card"><img src="/img/central-teens.webp" alt="Central Teens" width="640" height="320"></div>`, adults: html`<div class="min-art min-adults"><span>Adults</span></div>`, bus: html`<div class="card min-photo"><img src="/img/bus.webp" alt="The Central Baptist Church bus, ready for Sunday pickups" width="1200" height="900" loading="lazy"></div>` };
  return {
    head: { kicker: 'Ministries', title: html`Every age, growing in Christ <span class="serif">together.</span>`, lead: 'Kids, teens, and adults growing in faith side by side, a bus ministry that brings kids to church, and a church that serves Winfield and the world.' },
    body: html`${C.MINISTRIES.map((m, i) => html`<section class="wrap sec" id="${m.key}"><div class="min-row${i % 2 ? ' flip' : ''}">
      <div class="min-logo">${art[m.key]}</div>
      <div class="prose">
        <p class="eyebrow">${m.ages}</p>
        <h2 style="margin-top:14px">${m.name}</h2>
        <p>${m.body}</p>
        <ul class="ticks">${m.times.map((x) => html`<li>${x}</li>`)}</ul>
        ${m.safe ? html`<p class="note">${m.safe}</p>` : ''}
        ${m.key === 'kids' ? html`<a class="btn btn-dark" href="${appUrl('/checkin/family')}">Set up your family for check-in</a>` : ''}
        ${m.key === 'bus' ? html`<div class="btn-row"><a class="btn btn-dark" href="${base}/ride">Request a ride</a><a class="btn btn-ghost-dark" href="${base}/serve">Serve on the bus team</a></div>` : ''}
      </div>
    </div></section>`)}
    <section class="wrap sec sec-last">
      <div class="sec-head"><div><p class="eyebrow">Missions &amp; outreach</p><h2 class="h-sec" style="max-width:16ch">Serving beyond our walls.</h2></div><a class="btn btn-dark" href="${base}/serve">Find a place to serve</a></div>
      <div class="grid3">${C.OUTREACH.map((o) => html`<div class="card out-card"><h3>${o.name}</h3><p>${o.body}</p><span><a href="${o.url}" target="_blank" rel="noopener" class="u">Learn more</a>${o.url2 ? html` · <a href="${o.url2}" target="_blank" rel="noopener" class="u">IMB</a>` : ''}</span></div>`)}</div>
    </section>`,
  };
}

function sermons({ videos }) {
  const [latest, ...rest] = videos;
  return {
    head: { kicker: 'Sermons', title: html`This week’s <span class="serif">message.</span>`, lead: 'Messages from Sunday worship at Central. Watch here, or join us live on YouTube.' },
    body: html`<section class="wrap sec-tight"><div class="sermon">
      <div class="sermon-text">
        <p class="eyebrow">Latest</p>
        <h2>${latest ? latest.title : 'Sunday’s message'}</h2>
        <p class="lead">Pastor Blake Orr${latest ? ` · ${when(latest.published)}` : ''}.</p>
        <div class="btn-row"><a class="btn btn-dark" href="${CHURCH.youtubeLive}" target="_blank" rel="noopener">Watch live on YouTube</a><a class="btn btn-line" href="${CHURCH.youtube}" target="_blank" rel="noopener">Subscribe</a></div>
      </div>
      <div class="player">${player(latest)}</div>
    </div></section>
    ${rest.length ? html`<section class="wrap sec sec-last"><p class="eyebrow">Recent messages</p><h2 class="h-sec">Catch up from anywhere.</h2>
      <div class="grid3" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:36px 24px">${rest.map((v) => player(v, { small: true }))}</div></section>` : html`<div class="sec-last"></div>`}`,
  };
}

function events({ base, reel, slides = [], longDate, keyOf }) {
  const ev = upcoming();
  const stamp = (a) => new Date(a.updated_at).getTime();
  return {
    head: { kicker: 'Events & announcements', title: html`What’s happening at <span class="serif">Central.</span>`, lead: 'This week’s announcements, special days coming up, and the rhythm of every week.' },
    body: html`${reel || slides.length ? html`<section class="wrap sec-tight" id="announcements">
      <div class="ann-head"><div><p class="eyebrow">Announcements</p><h2 class="h-sec">${reel ? html`This week at <span class="serif">Central.</span>` : html`Don’t miss <span class="serif">this.</span>`}</h2></div>
        ${reel ? html`<p class="ann-date">${longDate(keyOf(reel.service_date))}</p>` : ''}</div>
      ${reel ? html`<div class="ann-video card"><video controls playsinline preload="metadata" src="/announcements/reels/${reel.id}/video" poster="/announcements/title.svg?date=${keyOf(reel.service_date)}"></video></div>` : ''}
      ${slides.length ? html`<div class="ann-carousel" data-carousel>
        <div class="ann-track" tabindex="0" aria-label="Announcement slides">${slides.map((a, i) => html`<figure class="ann-slide" aria-label="${i + 1} of ${slides.length}">
          <img src="/announcements/${a.id}/slide.svg?v=${stamp(a)}" alt="${[a.headline || a.title, a.blurb].filter(Boolean).join('. ')}" width="1920" height="1080" loading="${i < 2 ? 'eager' : 'lazy'}">
        </figure>`)}</div>
        ${slides.length > 1 ? html`<div class="ann-ctrl"><button type="button" class="ann-btn" data-prev aria-label="Previous announcement">‹</button><span class="ann-count" aria-live="polite">1 / ${slides.length}</span><button type="button" class="ann-btn" data-next aria-label="Next announcement">›</button></div>` : ''}
      </div>` : ''}
    </section>` : ''}
    ${ev.length ? html`<section class="wrap sec-tight">${eventCard(ev[0], base, { detail: true })}</section>` : ''}
    ${ev.length > 1 ? html`<section class="wrap sec-tight event-list">${ev.slice(1).map((e) => eventCard(e, base, { detail: true }))}</section>` : ''}
    <section class="wrap sec sec-last"><div class="two">
      <div><p class="eyebrow">Every week</p><h2 class="h-sec" style="margin-bottom:24px">Join us any week.</h2>${schedule()}</div>
      <aside class="card form-card"><h2>Questions about an event?</h2><p>Call <a href="${CHURCH.phoneHref}">${CHURCH.phone}</a> or send us a note and we’ll get back to you.</p><p style="margin-top:22px"><a class="btn btn-dark" href="${base}/connect">Contact us</a></p></aside>
    </div></section>`,
  };
}

function staff() {
  const initial = (n) => (n.trim().split(/\s+/).pop() || '?')[0];
  return {
    head: { kicker: 'Staff & leaders', title: html`The people who <span class="serif">serve.</span>`, lead: 'Our pastors, staff, and deacons, serving our church family week in and week out.' },
    body: html`<section class="wrap sec-tight sec-last">
      <div class="staff-grid">${C.STAFF.map((s, i) => { const ph = staffPhoto(s.key); return html`<article class="card staff-card${i === 0 ? ' staff-lead' : ''}${ph ? ' has-photo' : ''}">
        ${ph ? html`<div class="staff-photo"><img src="/img/staff/${s.key}.jpg?v=${ph}" alt="${s.names}" width="1000" height="750" ${i === 0 ? '' : raw('loading="lazy"')}></div>`
    : html`<span class="staff-av"><span aria-hidden="true">${initial(s.names)}</span></span>`}
        <div class="staff-text"><h2>${s.names}</h2><p class="tag staff-role">${s.role}</p><p class="body">${s.body}</p></div>
      </article>`; })}</div>
      ${(() => { const ph = staffPhoto('deacons'); return html`<article class="card staff-card staff-deacons${ph ? ' has-photo' : ''}">
        ${ph ? html`<div class="staff-photo"><img src="/img/staff/deacons.jpg?v=${ph}" alt="" width="1000" height="750" loading="lazy"></div>` : ''}
        <div class="staff-text"><p class="eyebrow">Deacons</p><h2>${C.DEACONS.join(', ')}</h2>
          <p class="body">Our deacons serve our church family by caring for members in need, supporting our pastor, and helping the church carry out its ministry.</p></div>
      </article>`; })()}
    </section>`,
  };
}

function give({ base }) {
  return {
    head: { kicker: 'Give', title: html`Generosity that reaches Winfield and the <span class="serif">world.</span>`, lead: '“Each one must give as he has decided in his heart, not reluctantly or under compulsion, for God loves a cheerful giver.” 2 Corinthians 9:7' },
    body: html`<section class="wrap sec-tight sec-last grid2">
      <div class="card pad-card dark-card"><p class="eyebrow eyebrow-gold">Give online</p><h2>Give once, or set up recurring giving.</h2><p class="body">Through Vanco, our secure online giving partner. You can use a bank account or card. You’ll leave this site for Vanco’s secure giving page.</p><a class="btn btn-gold" href="${CHURCH.give}" target="_blank" rel="noopener">Give online now ${OUT}</a></div>
      <div class="card pad-card"><p class="eyebrow">Other ways to give</p><h2>In worship or by mail.</h2>
        <p class="body"><strong>During worship:</strong> place your gift in the offering on Sunday morning.</p>
        <p class="body"><strong>By mail:</strong> make checks payable to Central Baptist Church and mail them to 904 Wheat Rd., Winfield, KS 67156.</p>
        <p class="body"><strong>Questions?</strong> Call <a href="${CHURCH.phoneHref}">${CHURCH.phone}</a> or <a href="${base}/connect?topic=Giving">send us a note</a>.</p></div>
    </section>`,
  };
}

function connect({ csrf, base, sent, values, error, topic }) {
  return {
    head: { kicker: 'Connect', title: html`We’d love to hear from <span class="serif">you.</span>`, lead: 'Whether you have a question about our services, want to learn more about our church, or just need someone to talk to, our doors and hearts are always open.' },
    body: html`<section class="wrap sec-tight sec-last"><div class="two">
      <div class="card form-card"><h2>Send us a message</h2>${sent ? html`<p class="ok" role="status">Thank you! Your message is on its way to the church office. We’ll get back to you soon.</p>` : contactForm({ csrf, base, topic, values, error })}</div>
      <div class="prose find">
        <h2>Find us</h2><p><a href="${CHURCH.maps}" target="_blank" rel="noopener">${CHURCH.street}<br>${CHURCH.cityLine}</a></p>
        <p><a class="btn btn-line" href="${CHURCH.maps}" target="_blank" rel="noopener">Get directions</a></p>
        <h2>Call or email</h2><p><a href="${CHURCH.phoneHref}">${CHURCH.phone}</a><br><a href="mailto:${CHURCH.email}">${CHURCH.email}</a></p>
        <h2>Need prayer?</h2><p><a href="${appUrl('/checkin/prayer')}">Share a request on the Prayer Wall</a>, or tell us in your message and our pastors will pray for you.</p>
      </div>
    </div></section>`,
  };
}

function serve({ csrf, base, sent, values = {}, error }) {
  return {
    head: { kicker: 'Serve', title: html`Find your place on the <span class="serif">team.</span>`, lead: '“For God is not unjust so as to overlook your work and the love that you have shown for his name in serving the saints, as you still do.” Hebrews 6:10' },
    body: html`<section class="wrap sec-tight sec-last"><div class="two">
      <div class="prose">
        <h2>Every Sunday happens because someone serves.</h2>
        <p>Tell us where you’d like to help, and someone from that team will reach out.</p>
        <ul class="ticks">${C.SERVE_AREAS.slice(0, -1).map((a) => html`<li>${a}</li>`)}</ul>
        <p class="note">Anyone serving with kids or teens completes our child-safety training before serving.</p>
      </div>
      <div class="card form-card"><h2>I’d like to serve</h2>
        ${sent ? html`<p class="ok" role="status">Thank you for offering to serve! Someone from that team will contact you soon.</p>` : html`<form method="post" action="${base}/serve" class="form" novalidate>
          ${csrfField(csrf)}
          ${error ? html`<p class="err" role="alert">${error}</p>` : ''}
          <div class="row2"><label>Name<input name="name" required autocomplete="name" value="${values.name || ''}"></label>
          <label>Phone <span class="opt">(optional)</span><input name="phone" type="tel" autocomplete="tel" value="${values.phone || ''}"></label></div>
          <label>Email<input name="email" type="email" required autocomplete="email" value="${values.email || ''}"></label>
          <label>Where would you like to serve?<select name="topic">${C.SERVE_AREAS.map((a) => html`<option${values.topic === a ? raw(' selected') : ''}>${a}</option>`)}</select></label>
          <label>Anything else? <span class="opt">(optional)</span><textarea name="message" rows="3">${values.message || ''}</textarea></label>
          <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button class="btn btn-dark btn-block" type="submit">Send</button>
        </form>`}
      </div>
    </div></section>`,
  };
}

function ride({ csrf, base, sent, values = {}, error }) {
  return {
    head: { kicker: 'Bus ministry', title: html`Need a ride to <span class="serif">church?</span>`, lead: 'For decades our bus and van ministry has brought kids and students to church, and to the Lord Jesus. We’d love to pick you up.' },
    body: html`<section class="wrap sec-tight sec-last"><div class="two">
      <div class="prose">
        <div class="card min-photo" style="margin-bottom:28px"><img src="/img/bus.webp" alt="The Central Baptist Church bus" width="1200" height="900"></div>
        <h2>How it works</h2>
        <ul class="ticks">
          <li><strong>${C.BUS.day}:</strong> the bus picks up ${C.BUS.pickup} and drops off ${C.BUS.dropoff}.</li>
          <li>Exact times depend on how far away you live. We’ll call you to set up your pickup.</li>
          <li>If you’re anywhere in Cowley County, let us know and we’ll see what we can do.</li>
        </ul>
        <p class="note">Questions? Call the church office at <a href="${CHURCH.phoneHref}">${CHURCH.phone}</a>.</p>
      </div>
      <div class="card form-card" id="request"><h2>Request a ride</h2>
        ${sent ? html`<p class="ok" role="status">Thank you! We got your ride request, and someone from our bus ministry will call you to set up a pickup time.</p>` : html`<form method="post" action="${base}/ride" class="form" novalidate>
          ${csrfField(csrf)}
          ${error ? html`<p class="err" role="alert">${error}</p>` : ''}
          <label>Parent or guardian name<input name="name" required autocomplete="name" value="${values.name || ''}"></label>
          <div class="row2"><label>Phone<input name="phone" type="tel" required autocomplete="tel" value="${values.phone || ''}"></label>
          <label>Email<input name="email" type="email" required autocomplete="email" value="${values.email || ''}"></label></div>
          <p class="small muted" style="margin:-4px 0 4px">We’ll also email you a short form about your kids (allergies, emergency contacts and permission) so we can care for them well.</p>
          <label>Pickup address<input name="address" required autocomplete="street-address" value="${values.address || ''}" placeholder="Street address"></label>
          <label>Town<input name="town" autocomplete="address-level2" value="${values.town || 'Winfield'}"></label>
          <label>Who needs a ride? <span class="opt">(names and ages)</span><textarea name="riders" rows="3" required placeholder="Emma, 9&#10;Noah, 13">${values.riders || ''}</textarea></label>
          <label>Anything we should know? <span class="opt">(optional)</span><textarea name="message" rows="2">${values.message || ''}</textarea></label>
          <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button class="btn btn-dark btn-block" type="submit">Request a ride</button>
        </form>`}
      </div>
    </div></section>`,
  };
}

function partners() {
  return {
    head: { kicker: 'Our partners', title: html`Cooperating for the <span class="serif">Gospel.</span>`, lead: 'We work together with Southern Baptists across Kansas, the nation, and the world.' },
    body: html`<section class="wrap sec-tight sec-last"><div class="partner-list">${C.PARTNERS.map(([n, u]) => html`<a class="card partner" href="${u}" target="_blank" rel="noopener"><span>${n}</span>${OUT}</a>`)}</div></section>`,
  };
}

function notFound({ base }) {
  return {
    head: { kicker: false, title: html`We couldn’t find that <span class="serif">page.</span>`, lead: 'It may have moved when we updated our website.', actions: html`<a class="btn btn-gold" href="${base}/">Go to the home page</a><a class="btn btn-ghost" href="${base}/connect">Contact us</a>` },
    body: html`<div class="sec-last"></div>`,
  };
}

// Calendar file for "Add to calendar".
function ics(e) {
  const [y, m, d] = e.date.split('-').map(Number);
  const stamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = t.zoned(y, m, d, ...(e.startHm || [10, 0]));
  const end = t.zoned(y, m, d, ...(e.endHm || [12, 0]));
  const esc = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Central Baptist Church//Website//EN', 'BEGIN:VEVENT',
    `UID:${e.key}-${e.date}@cbcwinfield.org`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)}`, `LOCATION:${esc('Central Baptist Church, 904 Wheat Rd, Winfield, KS 67156')}`, `DESCRIPTION:${esc(e.body)}`,
    'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

module.exports = { layout, ride, home, visit, about, ministries, sermons, events, staff, give, connect, serve, partners, notFound, ics };

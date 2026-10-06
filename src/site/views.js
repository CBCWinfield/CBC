'use strict';
// The church website: layout and pages.
const { html, raw } = require('../lib/html');
const t = require('../lib/time');
const C = require('./content');

const { CHURCH } = C;
const appUrl = (p) => `${CHURCH.app}${p}`;
const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const when = (iso) => { const d = new Date(iso); return iso && !Number.isNaN(d.getTime()) ? t.fmtDateYear(d) : ''; };
const longDate = (key) => t.fmtLong(t.zoned(...key.split('-').map(Number), 12));
const upcoming = () => C.EVENTS.filter((e) => e.date >= t.dateKey(new Date()));
const years = () => new Date().getFullYear() - CHURCH.founded;

// A wheat field drawn along the bottom of the opening banner. Deterministic, so it's the same every load.
function wheatField() {
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const stalks = [];
  for (let i = 0; i < 110; i++) {
    const x = (i / 110) * 1440 + rnd() * 10;
    const h = 70 + rnd() * 120;
    const lean = (rnd() - 0.5) * 22;
    const top = 260 - h;
    const grains = [];
    for (let g = 0; g < 7; g++) {
      const gy = top + g * 7;
      const gx = x + lean * ((gy - 260) / -h);
      grains.push(`<ellipse cx="${(gx - 3.2).toFixed(1)}" cy="${gy.toFixed(1)}" rx="2.6" ry="5.4" transform="rotate(-24 ${(gx - 3.2).toFixed(1)} ${gy.toFixed(1)})"/>`);
      grains.push(`<ellipse cx="${(gx + 3.2).toFixed(1)}" cy="${(gy + 3).toFixed(1)}" rx="2.6" ry="5.4" transform="rotate(24 ${(gx + 3.2).toFixed(1)} ${(gy + 3).toFixed(1)})"/>`);
    }
    const tone = rnd() > 0.55 ? 'w1' : rnd() > 0.5 ? 'w2' : 'w3';
    stalks.push(`<g class="stalk ${tone}" style="--d:${(rnd() * 0.9).toFixed(2)}s"><path d="M${x.toFixed(1)} 262 Q ${(x + lean * 0.4).toFixed(1)} ${(260 - h / 2).toFixed(1)} ${(x + lean).toFixed(1)} ${(top + 46).toFixed(1)}"/>${grains.join('')}</g>`);
  }
  return raw(`<svg class="wheat" viewBox="0 0 1440 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">${stalks.join('')}</svg>`);
}

const NAV = [['/about', 'About'], ['/ministries', 'Ministries'], ['/sermons', 'Sermons'], ['/events', 'Events'], ['/staff', 'Staff'], ['/connect', 'Connect']];
const MORE = [
  [appUrl('/checkin/prayer'), 'Prayer Wall', 'Share a request and pray with your church family'],
  [appUrl('/'), 'Church library', 'Borrow from more than 3,000 Christian books, Bibles and DVDs'],
  ['/serve', 'Serve', 'Find your place on a team'],
  [appUrl('/checkin/family'), 'Family check-in', 'Set up your family before Sunday'],
];

function layout({ title, desc, page, body, base = '' }) {
  const href = (p) => (p.startsWith('http') ? p : `${base}${p}`);
  const cur = (p) => (page === p ? raw(' aria-current="page"') : '');
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title ? `${title} | Central Baptist Church` : 'Central Baptist Church | Winfield, Kansas'}</title>
<meta name="description" content="${desc || 'Central Baptist Church is a Southern Baptist church family on Wheat Road in Winfield, Kansas. Sundays at 9:30 and 10:45 AM, Wednesdays at 6:00 PM.'}">
<meta name="theme-color" content="#173D22">
<meta property="og:title" content="${title || 'Central Baptist Church'}">
<meta property="og:description" content="${desc || `A church family on Wheat Road in Winfield, Kansas, for ${years()} years.`}">
<meta property="og:type" content="website">
<link rel="icon" href="/img/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/img/icon-192.png">
<link rel="preload" href="/fonts/bricolage.woff" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="/css/site.css?v=6">
<script src="/js/site.js?v=2" defer></script>
<script type="application/ld+json">${raw(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Church', name: CHURCH.name, telephone: CHURCH.phone, email: CHURCH.email, address: { '@type': 'PostalAddress', streetAddress: '904 Wheat Rd', addressLocality: 'Winfield', addressRegion: 'KS', postalCode: '67156', addressCountry: 'US' }, sameAs: [CHURCH.youtube, CHURCH.facebook] }).replace(/</g, '\\u003c'))}</script>
</head>
<body class="page-${page}">
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="top-in">
    <a class="brand" href="${href('/')}" aria-label="Central Baptist Church home"><img src="/img/logo-central-black.png" alt="Central Baptist Church" width="150" height="56"></a>
    <nav class="nav" aria-label="Main">
      ${NAV.map(([p, l]) => html`<a href="${href(p)}"${cur(p)}>${l}</a>`)}
      <details class="nav-more"><summary>More</summary><div class="nav-pop">
        ${MORE.map(([p, l, d]) => html`<a href="${href(p)}"><strong>${l}</strong><span>${d}</span></a>`)}
      </div></details>
    </nav>
    <div class="top-cta">
      <a class="btn btn-ghost" href="${CHURCH.give}" target="_blank" rel="noopener">Give</a>
      <a class="btn btn-wheat" href="${href('/visit')}">Plan a visit</a>
    </div>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="menu"><span class="menu-lines" aria-hidden="true"></span><span class="visually-hidden">Menu</span></button>
  </div>
</header>
<div class="menu" id="menu" hidden>
  <nav aria-label="Menu">
    ${[['/', 'Home'], ...NAV, ['/serve', 'Serve'], ['/give', 'Give']].map(([p, l]) => html`<a class="menu-big" href="${href(p)}"${cur(p)}>${l}</a>`)}
    <div class="menu-small">
      <a href="${appUrl('/checkin/prayer')}">Prayer Wall</a>
      <a href="${appUrl('/')}">Church library</a>
      <a href="${appUrl('/checkin/family')}">Family check-in</a>
    </div>
    <a class="btn btn-wheat menu-visit" href="${href('/visit')}">Plan a visit</a>
  </nav>
</div>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="foot-in">
    <div class="foot-id">
      <img src="/img/logo-central-black.png" alt="Central Baptist Church" width="150" height="56">
      <p>A Southern Baptist church family on Wheat Road in Winfield, Kansas, since ${CHURCH.founded}.</p>
    </div>
    <div>
      <h2>Visit</h2>
      <p><a href="${CHURCH.maps}" target="_blank" rel="noopener">${CHURCH.street}<br>${CHURCH.cityLine}</a></p>
      <p><a href="${CHURCH.phoneHref}">${CHURCH.phone}</a><br><a href="mailto:${CHURCH.email}">${CHURCH.email}</a></p>
    </div>
    <div>
      <h2>Gather</h2>
      <ul class="foot-times">${C.TIMES.map((x) => html`<li><span>${x.day} ${x.time}</span>${x.what}</li>`)}</ul>
    </div>
    <div>
      <h2>Explore</h2>
      <ul class="foot-links">
        <li><a href="${href('/sermons')}">Sermons</a></li><li><a href="${href('/give')}">Give</a></li><li><a href="${href('/serve')}">Serve</a></li>
        <li><a href="${appUrl('/checkin/prayer')}">Prayer Wall</a></li><li><a href="${appUrl('/')}">Library</a></li><li><a href="${href('/partners')}">Our partners</a></li>
      </ul>
      <p class="foot-social"><a href="${CHURCH.youtube}" target="_blank" rel="noopener">YouTube</a> <a href="${CHURCH.facebook}" target="_blank" rel="noopener">Facebook</a></p>
    </div>
  </div>
  <p class="foot-legal">© ${new Date().getFullYear()} Central Baptist Church <a href="/privacy">Privacy Policy</a> <a href="/terms">Terms of Service</a></p>
</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------- shared pieces
function sermonPlayer(v, { big = false } = {}) {
  if (!v) return html`<div class="player player-empty"><p>Watch Sunday’s message on <a href="${CHURCH.youtube}" target="_blank" rel="noopener">our YouTube channel</a>.</p></div>`;
  return html`<figure class="player${big ? ' player-big' : ''}">
    <button class="player-btn" type="button" data-video="${v.id}" aria-label="Play ${v.title}">
      <img src="https://i.ytimg.com/vi/${v.id}/${big ? 'maxresdefault' : 'hqdefault'}.jpg" data-fallback="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="" loading="${big ? 'eager' : 'lazy'}" width="1280" height="720">
      <span class="player-play" aria-hidden="true"><svg viewBox="0 0 68 48" width="68" height="48"><path d="M66.5 7.7c-.8-2.9-3-5.2-5.9-6C55.3.3 34 .3 34 .3s-21.3 0-26.6 1.4c-2.9.8-5.1 3.1-5.9 6C.1 13 .1 24 .1 24s0 11 1.4 16.3c.8 2.9 3 5.2 5.9 6 5.3 1.4 26.6 1.4 26.6 1.4s21.3 0 26.6-1.4c2.9-.8 5.1-3.1 5.9-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z" fill="#2E7D32"/><path d="M45 24 27 14v20z" fill="#fff"/></svg></span>
    </button>
    <figcaption><strong>${v.title}</strong><span>${when(v.published)}</span></figcaption>
  </figure>`;
}

function pageHead(title, lead, { kicker } = {}) {
  return html`<section class="phead"><div class="wrap">
    ${kicker ? html`<p class="phead-kicker">${kicker}</p>` : ''}
    <h1>${title}</h1>${lead ? html`<p class="phead-lead">${lead}</p>` : ''}
  </div></section>`;
}

function eventBlock(e, base) {
  const [y, m, d] = e.date.split('-').map(Number);
  const dt = t.zoned(y, m, d, 12);
  return html`<article class="event">
    <div class="event-date" aria-hidden="true"><span>${new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: t.TZ }).format(dt)}</span><strong>${d}</strong></div>
    <div class="event-text">
      <h3>${e.title}</h3>
      <p class="event-when">${longDate(e.date)}, ${e.start} to ${e.end}<br>${e.where}</p>
      <p>${e.body}</p>
      <a class="link" href="${base}/connect?topic=${encodeURIComponent(e.title)}">Ask a question about this event</a>
    </div>
  </article>`;
}

// ---------------------------------------------------------------- pages
function home({ latest, base }) {
  const ev = upcoming();
  return html`
  <section class="hero">
    <div class="hero-in wrap">
      <p class="hero-place">Winfield, Kansas</p>
      <h1 class="hero-title">A church family on Wheat Road for ${years()} years.</h1>
      <p class="hero-lead">Central Baptist Church is a place to know Jesus, grow in His Word, and belong to a family that will pray for you by name. Come as you are this Sunday.</p>
      <div class="hero-actions">
        <a class="btn btn-wheat btn-lg" href="${base}/visit">Plan your visit</a>
        <a class="btn btn-ghost btn-lg" href="#latest">Watch the latest sermon</a>
      </div>
    </div>
    <img class="hero-photo" src="/img/wheat-hero.jpg" alt="" width="1920" height="1280" fetchpriority="high" decoding="async">
    ${wheatField()}
  </section>

  <section class="times" aria-labelledby="times-h">
    <div class="wrap">
      <h2 id="times-h" class="visually-hidden">Service times</h2>
      <ul class="times-list">
        ${C.TIMES.filter((x) => x.day !== 'Monday').map((x) => html`<li><span class="times-day">${x.day}</span><span class="times-time">${x.time}</span><span class="times-what">${x.what}</span></li>`)}
      </ul>
      <p class="times-where"><a href="${CHURCH.maps}" target="_blank" rel="noopener">${CHURCH.street} ${CHURCH.cityLine}</a></p>
    </div>
  </section>

  ${ev.length ? html`<section class="band-wheat"><div class="wrap band-wheat-in">
    <div><p class="band-kicker">${longDate(ev[0].date)}</p><h2>${ev[0].title}</h2><p>${ev[0].start} to ${ev[0].end} at the church. ${ev[0].body.split('. ')[0]}.</p></div>
    <a class="btn btn-dark" href="${base}/events">See the details</a>
  </div></section>` : ''}

  <section class="latest" id="latest"><div class="wrap latest-in">
    <div class="latest-text">
      <h2>This week’s message</h2>
      <p>Missed Sunday, or want to hear it again? Watch Pastor Blake’s latest message here, or join us live on YouTube.</p>
      <p class="latest-links"><a class="btn btn-green" href="${base}/sermons">More sermons</a> <a class="link" href="${CHURCH.youtubeLive}" target="_blank" rel="noopener">Watch live on YouTube</a></p>
    </div>
    ${sermonPlayer(latest, { big: true })}
  </div></section>

  <section class="paths"><div class="wrap">
    <h2 class="sec-title">There’s a place for you here</h2>
    <div class="paths-grid">
      <a class="path path-kids" href="${base}/ministries#kids">
        <img src="/img/central-kids.webp" alt="Central Kids" width="640" height="320" loading="lazy">
        <span class="path-text"><strong>Kids</strong><span>Sunday School at 9:30, Children’s Church at 10:45, and Wednesday nights. Safe check-in every time.</span></span>
      </a>
      <a class="path path-teens" href="${base}/ministries#students">
        <img src="/img/central-teens.webp" alt="Central Teens" width="640" height="320" loading="lazy">
        <span class="path-text"><strong>Central Teens</strong><span>Middle and high school students, Wednesday nights at 6:00.</span></span>
      </a>
      <a class="path path-adults" href="${base}/ministries#adults">
        <span class="path-mark" aria-hidden="true">Adults</span>
        <span class="path-text"><strong>Adults</strong><span>Sunday Adult Study, Monday afternoon Bible study, and friendships for every season of life.</span></span>
      </a>
    </div>
  </div></section>

  <section class="duo"><div class="wrap duo-in">
    <a class="duo-card duo-prayer" href="${appUrl('/checkin/prayer')}">
      <h2>Prayer Wall</h2>
      <p>Share what’s on your heart, and let your church family pray with you. Tap “Pray” when you’ve prayed for someone, and we’ll let them know.</p>
      <span class="link">Share a prayer request</span>
    </a>
    <a class="duo-card duo-library" href="${appUrl('/')}">
      <h2>The church library</h2>
      <p>More than 3,000 Christian books, Bibles, devotionals and DVDs, free to borrow. Reserve online and pick up at the church.</p>
      <span class="link">Browse the library</span>
    </a>
  </div></section>

  <section class="give-band"><div class="wrap give-in">
    <h2>“Each one must give as he has decided in his heart, not reluctantly or under compulsion, for God loves a cheerful giver.”</h2>
    <p class="give-ref">2 Corinthians 9:7</p>
    <p><a class="btn btn-wheat btn-lg" href="${base}/give">Ways to give</a></p>
  </div></section>`;
}

function visit({ csrf, base, sent }) {
  return html`
  ${pageHead('Plan your visit', 'We can’t wait to meet you. Here’s what to expect on your first Sunday at Central.')}
  <section class="sec"><div class="wrap two">
    <div class="prose">
      <h2>When we gather</h2>
      <ul class="sched">${C.TIMES.map((x) => html`<li><span class="sched-when">${x.day}<br><strong>${x.time}</strong></span><span><strong>${x.what}</strong><br>${x.note}</span></li>`)}</ul>
      <h2>Where to go</h2>
      <p>We’re at <a href="${CHURCH.maps}" target="_blank" rel="noopener">904 Wheat Rd. in Winfield</a>. When you arrive, someone will be glad to welcome you and help you find your way.</p>
      <h2>Bringing kids?</h2>
      <p>Children are welcome in worship, and Children’s Church meets during the 10:45 service. At the welcome desk we’ll check your kids in, print their name tags and a matching pickup tag for you. Only you, or the people you list, can pick them up.</p>
      <p>Want to skip the line? <a href="${appUrl('/checkin/family')}">Set up your family online</a> before you come.</p>
      <h2>Questions before you come?</h2>
      <p>Call the church office at <a href="${CHURCH.phoneHref}">${CHURCH.phone}</a>, or send us a note and we’ll get back to you.</p>
    </div>
    <aside class="form-card">
      <h2>Let us know you’re coming</h2>
      <p>We’ll watch for you and help you get settled. No pressure, and we won’t add you to any lists.</p>
      ${sent ? html`<p class="ok" role="status">Thank you! We’ve got your note and look forward to seeing you.</p>` : contactForm({ csrf, base, topic: 'Planning a visit', button: 'Send', compact: true })}
    </aside>
  </div></section>`;
}

function about({ base }) {
  return html`
  ${pageHead('A community rooted in faith, hope, and love in Winfield, Kansas', `For ${years()} years, Central Baptist Church has been a cornerstone of the Winfield community, sharing the message of Christ’s love through worship, fellowship, and service.`)}
  <section class="sec"><div class="wrap two">
    <div class="prose">
      <h2>Who we are</h2>
      <p>We are a Southern Baptist congregation committed to sound doctrine and to a warm, welcoming place where people of every age can know Jesus and grow in Him.</p>
      <p>Our mission is simple: to make disciples of Jesus Christ here in Winfield and beyond, as a body of believers unified to worship God, to show Christ-like love for each other, and to serve our community and our world through the power of the Holy Spirit.</p>
      <h2>What we value</h2>
      <dl class="values">
        <div><dt>God’s Word</dt><dd>The Bible is our authority, and we open it together every week.</dd></div>
        <div><dt>Worship</dt><dd>We gather to praise the God who has been faithful to us for ${years()} years.</dd></div>
        <div><dt>Family</dt><dd>Kids, teens, and adults growing together and caring for each other.</dd></div>
        <div><dt>Mission</dt><dd>From Winfield to Juárez and around the world, we go and give.</dd></div>
      </dl>
    </div>
    <aside class="aside-75">
      <p class="big-75">${years()}</p>
      <p>years of God’s faithfulness on Wheat Road, ${CHURCH.founded} to ${new Date().getFullYear()}.</p>
      <a class="btn btn-wheat" href="${base}/visit">Come see for yourself</a>
    </aside>
  </div></section>`;
}

function ministries({ base }) {
  return html`
  ${pageHead('Ministries', 'Kids, teens, and adults growing in Christ together, and a church that serves Winfield and the world.')}
  ${C.MINISTRIES.map((m, i) => html`<section class="sec ministry${i % 2 ? ' alt' : ''}" id="${m.key}"><div class="wrap ministry-in">
    <div class="ministry-art">${m.key === 'kids' ? html`<img src="/img/central-kids.webp" alt="Central Kids" width="640" height="320">` : m.key === 'students' ? html`<img src="/img/central-teens.webp" alt="Central Teens" width="640" height="320">` : html`<span class="path-mark" aria-hidden="true">Adults</span>`}</div>
    <div class="prose">
      <h2>${m.name}</h2>
      <p class="ministry-ages">${m.ages}</p>
      <p>${m.body}</p>
      <ul class="ticks">${m.times.map((x) => html`<li>${x}</li>`)}</ul>
      ${m.safe ? html`<p class="note">${m.safe}</p>` : ''}
      ${m.key === 'kids' ? html`<p><a class="btn btn-green" href="${appUrl('/checkin/family')}">Set up your family for check-in</a></p>` : ''}
    </div>
  </div></section>`)}
  <section class="sec outreach"><div class="wrap">
    <h2 class="sec-title">Serving beyond our walls</h2>
    <div class="out-grid">${C.OUTREACH.map((o) => html`<article class="out"><h3>${o.name}</h3><p>${o.body}</p><a class="link" href="${o.url}" target="_blank" rel="noopener">Learn more</a>${o.url2 ? html` <a class="link" href="${o.url2}" target="_blank" rel="noopener">IMB</a>` : ''}</article>`)}</div>
    <p class="center"><a class="btn btn-green" href="${base}/serve">Find a place to serve</a></p>
  </div></section>`;
}

function sermons({ videos }) {
  const [latest, ...rest] = videos;
  return html`
  ${pageHead('Sermons', 'Messages from Sunday worship at Central. Watch here, or join us live on YouTube.')}
  <section class="sec"><div class="wrap">
    ${sermonPlayer(latest, { big: true })}
    <p class="center sermon-links"><a class="btn btn-green" href="${CHURCH.youtubeLive}" target="_blank" rel="noopener">Watch live on YouTube</a> <a class="link" href="${CHURCH.youtube}" target="_blank" rel="noopener">Subscribe to our channel</a></p>
  </div></section>
  ${rest.length ? html`<section class="sec alt"><div class="wrap">
    <h2 class="sec-title">Recent messages</h2>
    <div class="sermon-grid">${rest.map((v) => sermonPlayer(v))}</div>
  </div></section>` : ''}`;
}

function events({ base }) {
  const ev = upcoming();
  return html`
  ${pageHead('Events', 'What’s coming up at Central, and our weekly rhythm.')}
  <section class="sec"><div class="wrap">
    ${ev.length ? html`<h2 class="sec-title">Coming up</h2>${ev.map((e) => eventBlock(e, base))}` : html`<p class="lead-p">No special events on the calendar right now. Join us for our weekly gatherings below.</p>`}
    <h2 class="sec-title">Every week</h2>
    <ul class="sched sched-wide">${C.TIMES.map((x) => html`<li><span class="sched-when">${x.day}<br><strong>${x.time}</strong></span><span><strong>${x.what}</strong><br>${x.note}</span></li>`)}</ul>
  </div></section>`;
}

function staff() {
  const initials = (n) => (n.trim().split(/\s+/).pop() || '?')[0]; // family last-name initial
  return html`
  ${pageHead('Our staff & leaders', 'The people who serve our church family week in and week out.')}
  <section class="sec"><div class="wrap">
    <div class="staff-grid">${C.STAFF.map((s, i) => html`<article class="staff${i === 0 ? ' staff-lead' : ''}">
      <span class="staff-mono" aria-hidden="true">${initials(s.names)}</span>
      <div><h2>${s.names}</h2><p class="staff-role">${s.role}</p><p>${s.body}</p></div>
    </article>`)}</div>
    <div class="deacons"><h2>Deacons</h2><p>${C.DEACONS.join(', ')}</p></div>
  </div></section>`;
}

function give({ base }) {
  return html`
  ${pageHead('Give', 'Your generosity supports the ministry of Central Baptist Church in Winfield, and missions around the world.')}
  <section class="sec"><div class="wrap two">
    <div class="give-online">
      <h2>Give online</h2>
      <p>Give once or set up recurring giving through Vanco, our secure online giving partner. You can use a bank account or card.</p>
      <p><a class="btn btn-wheat btn-lg" href="${CHURCH.give}" target="_blank" rel="noopener">Give online now</a></p>
      <p class="note">You’ll leave this site for Vanco’s secure giving page.</p>
    </div>
    <div class="prose">
      <h2>Other ways to give</h2>
      <h3>During worship</h3><p>Place your gift in the offering on Sunday morning.</p>
      <h3>By mail</h3><p>Make checks payable to Central Baptist Church and mail them to<br>904 Wheat Rd., Winfield, KS 67156.</p>
      <h3>Questions</h3><p>Our treasurers are glad to help. Call <a href="${CHURCH.phoneHref}">${CHURCH.phone}</a> or <a href="${base}/connect?topic=Giving">send us a note</a>.</p>
    </div>
  </div></section>`;
}

function contactForm({ csrf, base, topic = '', button = 'Send message', compact = false, values = {}, error }) {
  return html`<form method="post" action="${base}/connect" class="form" novalidate>
    ${csrfField(csrf)}<input type="hidden" name="topic" value="${values.topic || topic}">
    ${error ? html`<p class="err" role="alert">${error}</p>` : ''}
    <div class="row2"><label>Name<input name="name" required autocomplete="name" value="${values.name || ''}"></label>
    <label>Phone <span class="opt">(optional)</span><input name="phone" type="tel" autocomplete="tel" value="${values.phone || ''}"></label></div>
    <label>Email<input name="email" type="email" required autocomplete="email" value="${values.email || ''}"></label>
    <label>${compact ? 'Anything we should know? ' : 'How can we help?'}${compact ? html`<span class="opt">(optional)</span>` : ''}<textarea name="message" rows="${compact ? 3 : 5}" ${compact ? '' : raw('required')}>${values.message || ''}</textarea></label>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn btn-green btn-block" type="submit">${button}</button>
  </form>`;
}

function connect({ csrf, base, sent, values, error, topic }) {
  return html`
  ${pageHead('We’d love to hear from you', 'Whether you have a question about our services, want to learn more about our church, or just need someone to talk to, our doors and hearts are always open.')}
  <section class="sec"><div class="wrap two">
    <div class="form-card">
      <h2>Send us a message</h2>
      ${sent ? html`<p class="ok" role="status">Thank you! Your message is on its way to the church office. We’ll get back to you soon.</p>` : contactForm({ csrf, base, topic, values, error })}
    </div>
    <div class="prose find">
      <h2>Find us</h2>
      <p><a href="${CHURCH.maps}" target="_blank" rel="noopener">${CHURCH.street}<br>${CHURCH.cityLine}</a></p>
      <p><a class="btn btn-ghost-dark" href="${CHURCH.maps}" target="_blank" rel="noopener">Get directions</a></p>
      <h2>Call or email</h2>
      <p><a href="${CHURCH.phoneHref}">${CHURCH.phone}</a><br><a href="mailto:${CHURCH.email}">${CHURCH.email}</a></p>
      <h2>Service times</h2>
      <p>Sundays at 9:30 AM (Sunday School) and 10:45 AM (Worship)<br>Wednesdays at 6:00 PM</p>
      <h2>Need prayer?</h2>
      <p><a href="${appUrl('/checkin/prayer')}">Share a request on the Prayer Wall</a>, or tell us in your message and our pastors will pray for you.</p>
    </div>
  </div></section>`;
}

function serve({ csrf, base, sent, values = {}, error }) {
  return html`
  ${pageHead('Get involved', '“For God is not unjust so as to overlook your work and the love that you have shown for his name in serving the saints, as you still do.” Hebrews 6:10')}
  <section class="sec"><div class="wrap two">
    <div class="prose">
      <h2>Find your place</h2>
      <p>Every Sunday and Wednesday happens because people like you use their gifts. Tell us where you’d like to help, and someone from that team will reach out.</p>
      <ul class="ticks">${C.SERVE_AREAS.slice(0, -1).map((a) => html`<li>${a}</li>`)}</ul>
      <p class="note">Anyone serving with kids or teens completes our child-safety training before serving.</p>
    </div>
    <div class="form-card">
      <h2>I’d like to serve</h2>
      ${sent ? html`<p class="ok" role="status">Thank you for offering to serve! Someone from that team will contact you soon.</p>` : html`<form method="post" action="${base}/serve" class="form" novalidate>
        ${csrfField(csrf)}
        ${error ? html`<p class="err" role="alert">${error}</p>` : ''}
        <div class="row2"><label>Name<input name="name" required autocomplete="name" value="${values.name || ''}"></label>
        <label>Phone <span class="opt">(optional)</span><input name="phone" type="tel" autocomplete="tel" value="${values.phone || ''}"></label></div>
        <label>Email<input name="email" type="email" required autocomplete="email" value="${values.email || ''}"></label>
        <label>Where would you like to serve?<select name="topic">${C.SERVE_AREAS.map((a) => html`<option${values.topic === a ? raw(' selected') : ''}>${a}</option>`)}</select></label>
        <label>Anything else? <span class="opt">(optional)</span><textarea name="message" rows="3">${values.message || ''}</textarea></label>
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <button class="btn btn-green btn-block" type="submit">Send</button>
      </form>`}
    </div>
  </div></section>`;
}

function partners() {
  return html`
  ${pageHead('Our partners', 'We cooperate with Southern Baptists across Kansas, the nation, and the world.')}
  <section class="sec"><div class="wrap"><ul class="partner-list">${C.PARTNERS.map(([n, u]) => html`<li><a href="${u}" target="_blank" rel="noopener">${n}</a></li>`)}</ul></div></section>`;
}

function notFound({ base }) {
  return html`${pageHead('We couldn’t find that page', 'It may have moved when we updated our website.')}
  <section class="sec"><div class="wrap"><p><a class="btn btn-green" href="${base}/">Go to the home page</a> <a class="link" href="${base}/connect">Contact us</a></p></div></section>`;
}

module.exports = { layout, home, visit, about, ministries, sermons, events, staff, give, connect, serve, partners, notFound };

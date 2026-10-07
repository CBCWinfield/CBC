'use strict';
const { html, raw } = require('../lib/html');
const { fullName } = require('../models');

function nav(user, current) {
  const link = (href, label, key) => html`<a href="${href}"${current === key ? raw(' aria-current="page"') : ''}>${label}</a>`;
  const items = [link('/catalog', 'Catalog', 'catalog')];
  if (user) {
    items.push(link('/my', 'My Library', 'my'));
    if (user.role !== 'patron') items.push(link('/admin', 'Librarian', 'admin'));
  } else {
    items.push(link('/apply', 'Join', 'apply'));
    items.push(link('/login', 'Log in', 'login'));
  }
  return items;
}

// The menu under the logo that switches between the church's apps.
function appSwitcher(user, current) {
  const staff = user && user.checkin_role;
  const items = [
    ['/', 'Library', 'Borrow books, DVDs and more', 'library'],
    ['/checkin', staff ? 'Check-In' : 'My Family', staff ? 'Check kids and families in and out' : 'Your family, kids and permission forms', 'checkin'],
  ];
  if (user) items.push(['/checkin/inbox', 'Inbox', 'Messages with families and the church team', 'inbox'], ['/checkin/prayer', 'Prayer Wall', 'Share requests and pray for one another', 'prayer']);
  return html`<details class="app-switch">
    <summary aria-label="Switch app"><img src="/img/logo-central-black.png" alt="Central Baptist Church" width="122" height="46"><span class="brand-label">${current === 'checkin' ? (staff ? 'Check-In' : 'My Family') : 'Library'}</span><span class="app-switch-caret" aria-hidden="true">▾</span></summary>
    <div class="app-switch-menu">
      ${items.map(([href, label, sub, key]) => html`<a href="${href}"${current === key ? raw(' aria-current="page"') : ''}><strong>${label}</strong><span>${sub}</span></a>`)}
    </div>
  </details>`;
}

function layout({ title, user, csrf, flash = [], body, current, settings, wide = false, description }) {
  const s = settings || {};
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${title} | ${s.short_name || 'CBC Library'}` : s.library_name}</title>
<meta name="description" content="${description || s.welcome_message || ''}">
<meta name="csrf-token" content="${csrf || ''}">
<meta name="theme-color" content="#000000">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/img/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/img/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Montserrat:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/css/style.css?v=12">
<script src="/js/app.js?v=9" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="masthead">
  <div class="masthead-inner">
    ${appSwitcher(user, 'library')}
    <form class="ask suggest-wrap" id="ask-form" action="/catalog" method="get" role="search">
      <label class="visually-hidden" for="ask-input">Ask the library</label>
      <input id="ask-input" name="q" type="search" placeholder="Ask the library…" autocomplete="off" maxlength="300" data-suggest="public" data-suggest-ask>
      <button type="submit">Ask</button>
    </form>
    <nav class="main-nav" aria-label="Main">${nav(user, current)}${user ? html`<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${csrf}"><button class="linklike" type="submit">Log out</button></form>` : ''}</nav>
  </div>
  <section class="ask-panel" id="ask-panel" hidden aria-live="polite">
    <div class="ask-panel-inner">
      <div class="ask-head">
        <p class="ask-q" id="ask-q"></p>
        <button type="button" class="ask-collapse" id="ask-collapse" aria-expanded="true" aria-controls="ask-body">Collapse</button>
      </div>
      <div id="ask-body">
        <p class="ask-answer" id="ask-answer"></p>
        <ul class="ask-results" id="ask-results"></ul>
        <p class="ask-note">Answers come from this library's catalog. Nothing you type leaves this site.</p>
      </div>
    </div>
  </section>
</header>
<main id="main" class="${wide ? 'wrap wide' : 'wrap'}">
${flash.length ? html`<div class="flashes">${flash.map((f) => html`<p class="flash flash-${f.type}" role="${f.type === 'error' ? 'alert' : 'status'}">${f.message}</p>`)}</div>` : ''}
${body}
</main>
<footer class="site-foot">
  <div class="wrap">
    <img class="foot-logo" src="/img/logo-central-black.png" alt="" width="144" height="54">
    <p><strong>${s.library_name}</strong></p>
    ${s.library_address ? html`<p>${s.library_address}</p>` : ''}
    <p>${[s.contact_phone, s.contact_email].filter(Boolean).join('  ·  ')}</p>
    ${user ? html`<p class="muted">Signed in as ${fullName(user)}</p>` : ''}
    <p class="foot-legal">${require('../lib/privacy').links()}</p>
  </div>
</footer>
</body>
</html>`;
}

module.exports = { layout, appSwitcher };

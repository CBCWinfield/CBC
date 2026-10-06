'use strict';
// Screens for Central Check-In.
const { html, raw, selected, checked } = require('../lib/html');
const t = require('../lib/time');
const P = require('../views/parts');
const D = require('./data');
const { AGREEMENTS } = require('./agreements');
const { appSwitcher } = require('../views/layout');
const allergens = require('./allergens');

const csrfField = P.csrfField;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtDateKey = (k) => t.fmtLong(t.zoned(...k.split('-').map(Number), 12));
const dateKeyOf = (d) => (d instanceof Date ? t.dateKey(d) : String(d).slice(0, 10));

// ---------------------------------------------------------------- layout
function layout({ title, user, csrf, flash = [], body, tab, event, bare = false, unread = 0 }) {
  const staff = D.rank(user) > 0;
  const tabs = staff ? [
    ['/checkin', 'Check in', 'station', '✓'],
    ['/checkin/roster', 'Checked in', 'roster', '☰'],
    ['/checkin/scan', 'Scan', 'scan', '▥'],
    ['/checkin/families', 'Families', 'families', '⌂'],
    ['/checkin/print-queue', 'Printing', 'print', '⎙'],
  ] : [];
  // Everything else lives in the "More" menu.
  const more = [];
  if (staff) more.push(['/checkin/serve', 'Serving calendar', 'serve']);
  if (D.can(user, 'leader')) more.push(['/checkin/events', 'Events', 'events']);
  if (user) more.push(['/checkin/policies', 'Policies', 'policies']);
  if (D.can(user, 'coadmin')) more.push(['/checkin/reports', 'Reports', 'reports'], ['/checkin/staff', 'Team', 'staff'], ['/checkin/automations', 'Automations', 'automations']);
  if (user) more.push(['/checkin/family', 'My family', 'family'], ['/checkin/settings', 'Settings', 'settings'], ['/checkin/install', 'Get the app', 'install']);
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title ? `${title} | Central Check-In` : 'Central Check-In'}</title>
<meta name="csrf-token" content="${csrf || ''}">
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Central">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<link rel="manifest" href="/checkin/manifest.webmanifest">
<link rel="icon" href="/img/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/img/checkin-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Montserrat:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/css/style.css?v=6">
<link rel="stylesheet" href="/css/checkin.css?v=6">
<script src="/js/app.js?v=7" defer></script>
<script src="/js/checkin.js?v=5" defer></script>
</head>
<body class="ci${bare ? ' ci-bare' : ''}">
<a class="skip" href="#main">Skip to content</a>
<header class="masthead ci-top">
  <div class="ci-top-inner">
    ${appSwitcher(user, 'checkin')}
    ${user ? html`<form class="ci-ask" id="ci-ask-form" role="search" autocomplete="off">
      <label for="ci-ask-input" class="visually-hidden">Ask</label>
      <span class="ci-ask-icon" aria-hidden="true">?</span>
      <input id="ci-ask-input" name="q" type="search" placeholder="Ask" maxlength="200" enterkeyhint="search">
    </form>` : ''}
    <nav class="ci-actions" aria-label="Account">
      ${user ? html`<button type="button" class="ci-help-btn" id="ci-help-open" data-tour="help">HELP</button>
      <a class="ci-inbox-link" href="/checkin/inbox"${tab === 'inbox' ? raw(' aria-current="page"') : ''} title="Inbox"><span aria-hidden="true">✉</span><span class="ci-inbox-word">Inbox</span>${unread ? html`<span class="ci-unread" aria-label="${unread} unread">${unread > 99 ? '99+' : unread}</span>` : ''}</a>
      <details class="ci-more">
        <summary class="${more.some(([, , key]) => key === tab) ? 'is-current' : ''}">More <span aria-hidden="true">▾</span></summary>
        <div class="ci-more-menu">
          ${more.map(([href, label, key]) => html`<a href="${href}"${tab === key ? raw(' aria-current="page"') : ''}>${label}</a>`)}
          <form method="post" action="/logout">${csrfField(csrf)}<button class="linklike" type="submit">Log out</button></form>
        </div>
      </details>` : html`<a class="ci-login" href="/login?next=/checkin">Log in</a>`}
    </nav>
  </div>
  ${tabs.length || event ? html`<div class="ci-subnav${event ? ' has-event' : ''}"><div class="ci-subnav-inner">
    <nav class="ci-nav" aria-label="Check-in">
      ${tabs.map(([href, label, key]) => html`<a href="${href}"${tab === key ? raw(' aria-current="page"') : ''}>${label}</a>`)}
    </nav>
    ${event ? html`<a class="ci-event-pill" href="/checkin?change=1" title="Change event"><span class="ci-dot"></span>${event.name} · ${t.fmtDate(t.zoned(...dateKeyOf(event.event_date).split('-').map(Number), 12))}</a>` : ''}
  </div></div>` : ''}
</header>
${user ? html`<div class="ci-ask-panel" id="ci-ask-panel" hidden aria-live="polite">
  <div class="ci-ask-panel-inner"><div class="ci-ask-head"><strong id="ci-ask-q"></strong><button type="button" class="linklike" id="ci-ask-close">Close</button></div>
  <p id="ci-ask-answer"></p><ul id="ci-ask-items" class="ci-ask-items"></ul><p id="ci-ask-topics" class="ci-ask-topics"></p></div>
</div>
<div class="ci-modal" id="ci-help" hidden role="dialog" aria-modal="true" aria-labelledby="ci-help-title">
  <div class="ci-modal-box">
    <div class="ci-modal-head"><h2 id="ci-help-title">How can we help?</h2><button type="button" class="ci-modal-x" data-help-close aria-label="Close">×</button></div>
    <input type="search" id="ci-help-search" placeholder="Search help: print, guest, allergy, pickup…" autocomplete="off">
    <div id="ci-help-body" class="ci-help-body"><p class="muted">Loading…</p></div>
  </div>
</div>` : ''}
<main id="main" class="ci-main">
${flash.length ? html`<div class="flashes">${flash.map((f) => html`<p class="flash flash-${f.type}" role="${f.type === 'error' ? 'alert' : 'status'}">${f.message}</p>`)}</div>` : ''}
${body}
</main>
${tabs.length ? html`<nav class="ci-tabbar" aria-label="Check-in sections">${tabs.map(([href, label, key, icon]) => html`<a href="${href}"${tab === key ? raw(' aria-current="page"') : ''}><span aria-hidden="true">${icon}</span>${label}</a>`)}</nav>` : ''}
</body>
</html>`;
}

// ---------------------------------------------------------------- shared bits
function alertsFor(p, user, { full = false } = {}) {
  const out = [];
  if (p.allergies) {
    const keys = allergens.detect(p.allergies);
    out.push(html`<span class="ci-flag ci-flag-allergy" title="${p.allergies}"><span class="ci-allergen-icons">${keys.map((k) => raw(allergens.icon(k)))}</span>${full ? html`Allergy: ${p.allergies}` : keys.filter((k) => k !== 'other').map((k) => allergens.LABELS[k]).join(', ') || 'Allergy'}</span>`);
  }
  if (p.medical_notes || p.medications) out.push(html`<span class="ci-flag ci-flag-medical" title="${[p.medical_notes, p.medications].filter(Boolean).join(' · ')}">Medical${full ? html`: ${[p.medical_notes, p.medications].filter(Boolean).join(' · ')}` : ''}</span>`);
  if (p.special_needs) out.push(html`<span class="ci-flag ci-flag-needs">${full ? html`Needs: ${p.special_needs}` : 'Special needs'}</span>`);
  if (p.custody_alert) out.push(html`<span class="ci-flag ci-flag-custody">${D.can(user, 'leader') && full && p.custody_notes ? html`Custody: ${p.custody_notes}` : 'Custody alert: get a leader'}</span>`);
  return out;
}

function avatar(p) {
  const id = p.person_id || p.id;
  if (p.photo_at && id) return html`<img class="ci-avatar ci-avatar-photo" src="/checkin/people/${id}/photo?v=${new Date(p.photo_at).getTime()}" alt="Photo of ${p.preferred_name || p.first_name}" loading="lazy">`;
  const initials = `${(p.preferred_name || p.first_name || '?')[0]}${(p.last_name || '')[0] || ''}`;
  return html`<span class="ci-avatar ci-avatar-${p.kind}" aria-hidden="true">${initials}</span>`;
}

// Add or change a person's photo. On phones and tablets this opens the camera or the photo library;
// the picture is shrunk on the device before it's sent.
function photoButton(p, csrf, back) {
  return html`<form method="post" action="/checkin/people/${p.id}/photo" class="ci-photo-form" data-photo-form>
    ${csrfField(csrf)}<input type="hidden" name="back" value="${back}"><input type="hidden" name="photo_data" data-photo-data>
    <label class="btn btn-quiet btn-small ci-photo-btn">${p.photo_at ? 'Change photo' : '📷 Add photo'}<input type="file" accept="image/*" data-photo-input hidden></label>
    ${p.photo_at ? html`<button class="linklike small" type="submit" name="remove" value="1">Remove</button>` : ''}
  </form>`;
}

// ---------------------------------------------------------------- station
function eventPicker({ csrf, names, suggested, current }) {
  const choices = [...new Set([suggested, 'Sunday School', "Children's Church", 'Wednesday Night Service', ...names].filter(Boolean))];
  return html`<section class="ci-card ci-event-pick">
    <h1>What are we checking in for?</h1>
    <p class="muted">${t.fmtLong(new Date())}</p>
    <form method="post" action="/checkin/event" class="ci-event-choices">
      ${csrfField(csrf)}
      ${choices.map((n) => html`<button class="ci-choice${current && current.name === n ? ' is-current' : ''}" type="submit" name="name" value="${n}">${n}${EVENT_TIMES[n] ? html`<small class="ci-choice-time">${EVENT_TIMES[n]}</small>` : ''}${n === suggested ? html`<small>Today</small>` : ''}</button>`)}
    </form>
    <form method="post" action="/checkin/event" class="ci-new-event">
      ${csrfField(csrf)}
      <label for="ev-new">Or name a new event</label>
      <div class="ci-inline"><input id="ev-new" name="name" maxlength="80" placeholder="e.g. VBS Night 1, Youth Lock-in" required><button class="btn" type="submit">Start</button></div>
      <p class="hint">New names are saved, so they show up as a choice next time.</p>
    </form>
  </section>`;
}

function station({ csrf, event, recent, counts }) {
  return html`
  <section class="ci-search-hero">
    <form action="/checkin" method="get" class="ci-search suggest-wrap" role="search">
      <label for="fam-q" class="visually-hidden">Find a family</label>
      <input id="fam-q" name="q" type="search" placeholder="Family name, child's name or phone" autocomplete="off" autofocus data-family-search data-csrf="${csrf}">
      <div class="ci-results" id="fam-results" aria-live="polite"></div>
    </form>
    <p class="ci-counts">${plural(counts.kids, 'kid')} · ${plural(counts.adults, 'adult')} checked in · <a href="/checkin/roster">See everyone</a></p>
  </section>
  <section class="ci-section">
    <div class="ci-section-head"><h2>Recent families</h2><span class="ci-family-tools"><a class="btn btn-quiet btn-small" href="/checkin/guest">Quick guest</a><a class="btn btn-quiet btn-small" href="/checkin/new">New family</a></span></div>
    <ul class="ci-family-list">${recent.map((f) => familyRow(f, { csrf, back: '/checkin' }))}</ul>
  </section>`;
}

// A family in a list. With csrf, a one-tap "Check in" button checks the whole family in
// for the service happening now and prints their tags.
function familyRow(f, { csrf, back } = {}) {
  return html`<li class="${csrf ? 'ci-family-item' : ''}"><a class="ci-family-row" href="/checkin/f/${f.id}">
    <span class="ci-family-name">${f.name}${f.status === 'new' ? html` <span class="badge badge-info">New</span>` : ''}</span>
    <span class="ci-family-members">${f.members || 'No one added yet'}</span>
    ${f.checked ? html`<span class="badge badge-ok">${f.checked} in</span>` : ''}
  </a>${csrf ? html`<form method="post" action="/checkin/quick/${f.id}" class="ci-quick-form" data-quick-checkin>
    ${csrfField(csrf)}<input type="hidden" name="back" value="${back || '/checkin/families'}">
    <button class="btn ci-quick-btn" type="submit" data-tour="quick" title="Check in everyone in ${f.name} and print the kids’ name tags">Quick Check</button>
  </form>` : ''}</li>`;
}

function familyCheckin({ csrf, user, full, event, attendance }) {
  const { family, adults, kids, pickups } = full;
  const inMap = new Map(attendance.map((a) => [a.person_id, a]));
  const row = (p) => {
    const a = inMap.get(p.id);
    const isIn = a && !a.checked_out_at;
    return html`<li class="ci-person${isIn ? ' is-in' : ''}">
      <label class="ci-person-check">
        <input type="checkbox" name="people[]" value="${p.id}"${checked(!a)}${isIn ? raw(' disabled') : ''}>
        ${avatar(p)}
        <span class="ci-person-text">
          <span class="ci-person-name">${D.displayName(p)}</span>
          <span class="ci-person-meta">${p.kind === 'child' ? [D.ageLabel(p.birthdate), p.grade, D.groupFor(p)].filter(Boolean).join(' · ') : p.relationship || 'Adult'}</span>
          ${alertsFor(p, user).length ? html`<span class="ci-flags">${alertsFor(p, user)}</span>` : ''}
        </span>
        ${isIn ? html`<span class="badge badge-ok">In · ${a.security_code}</span>` : a ? html`<span class="badge badge-muted">Picked up</span>` : ''}
      </label>
    </li>`;
  };
  const blocked = pickups.filter((x) => x.not_allowed);
  return html`
  <p class="crumb"><a href="/checkin">Back to search</a></p>
  <form method="post" action="/checkin/f/${family.id}" class="ci-checkin-form" data-checkin-form>
    ${csrfField(csrf)}
    <input type="hidden" name="event_id" value="${event.id}">
    <div class="ci-family-head">
      <div><h1>${family.name}</h1><p class="muted">${event.name}</p></div>
      <div class="ci-family-tools">
        <button type="button" class="btn btn-quiet btn-small" data-check-all>Select all</button>
        <button type="button" class="btn btn-quiet btn-small" data-check-none>Clear</button>
        ${D.can(user, 'leader') ? html`<a class="btn btn-quiet btn-small" href="/checkin/families/${family.id}">Edit family</a>` : ''}
      </div>
    </div>
    ${blocked.length ? html`<div class="ci-alert ci-alert-danger" role="alert"><strong>Not allowed to pick up:</strong> ${blocked.map((b) => b.name).join(', ')}${D.can(user, 'leader') && blocked.some((b) => b.notes) ? html`<br><span class="small">${blocked.map((b) => b.notes).filter(Boolean).join(' · ')}</span>` : ''}</div>` : ''}
    ${kids.length ? html`<h2 class="ci-group-label">Kids</h2><ul class="ci-people">${kids.map(row)}</ul>` : html`<p class="muted">No children added yet.</p>`}
    ${adults.length ? html`<h2 class="ci-group-label">Adults</h2><ul class="ci-people">${adults.map(row)}</ul>` : ''}
    <div class="ci-sticky-actions">
      <p class="small muted" data-selected-count></p>
      <button class="btn ci-big-btn" type="submit">Check in</button>
    </div>
  </form>`;
}

// ---------------------------------------------------------------- labels
const code128 = require('./code128');

// Medical = red square with a cross; allergies use their own picture symbols (allergens.js).
const MARK_MEDICAL = raw('<svg class="mark mark-medical" viewBox="0 0 40 40" aria-label="Medical"><rect x="1" y="1" width="38" height="38" rx="5" fill="#D0021B"/><path d="M16 8h8v8h8v8h-8v8h-8v-8H8v-8h8z" fill="#fff"/></svg>');

function labelsPage({ labels, returnTo, autoPrint = true, embed = false }) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Name tags</title>
<link rel="stylesheet" href="/css/labels.css?v=3">
<script src="/js/labels.js?v=2" defer></script>
</head><body data-return="${returnTo}"${autoPrint ? raw(' data-autoprint') : ''}${embed ? raw(' data-embed') : ''}>
${embed ? '' : html`<div class="no-print label-toolbar">
  <p><strong>${labels.length} label${labels.length === 1 ? '' : 's'} ready.</strong> In the print window choose the Brother QL-810W, paper <strong>62mm × 100mm</strong>, <strong>landscape</strong>, margins <strong>none</strong>.</p>
  <p class="small">With the red/black DK-2251 roll the allergy and medical symbols print in red; on the standard roll they print in black.</p>
  <button type="button" data-print>Print again</button> <a href="${returnTo}">Done</a>
</div>`}
${labels.map((l) => (l.kind === 'child' ? html`<section class="label child-label">
  <div class="l-head"><img src="/img/logo-central-black.png" alt=""><span>${l.when}</span></div>
  <div class="l-main">
    <div class="l-text">
      <div class="l-name">${l.first}</div>
      <div class="l-class">${l.cls}</div>
      ${l.allergies.length ? html`<div class="l-note"><strong>Allergy:</strong> ${l.allergyText}</div>` : ''}
      ${l.medical ? html`<div class="l-note"><strong>Medical:</strong> see leader</div>` : ''}
    </div>
    ${l.allergies.length || l.medical ? html`<div class="l-marks">
      ${l.allergies.slice(0, 3).map((k) => html`<figure class="l-sym">${raw(allergens.icon(k))}<figcaption>${allergens.LABELS[k]}</figcaption></figure>`)}
      ${l.medical ? html`<figure class="l-sym">${MARK_MEDICAL}<figcaption>Medical</figcaption></figure>` : ''}
    </div>` : ''}
  </div>
  <div class="l-foot"><div class="l-code"><small>Pickup code</small>${l.code}</div><div class="l-barcode">${raw(code128.svg(l.code, { height: 40 }))}</div></div>
</section>` : html`<section class="label parent-label">
  <div class="l-head"><img src="/img/logo-central-black.png" alt=""><span>${l.when}</span></div>
  <div class="l-title">Parent pickup tag · keep this</div>
  <div class="l-family">${l.family}</div>
  <div class="l-kids">${l.kids}</div>
  <div class="l-foot"><div class="l-code l-code-big"><small>Code</small>${l.code}</div><div class="l-barcode">${raw(code128.svg(l.code, { height: 46 }))}</div></div>
</section>`))}
</body></html>`;
}

// ---------------------------------------------------------------- print queue
function printQueue({ csrf, jobs, isPrinter }) {
  const waiting = jobs.filter((j) => j.status === 'queued');
  const done = jobs.filter((j) => j.status !== 'queued');
  const badge = { printed: html`<span class="badge badge-ok">Printed</span>`, cancelled: html`<span class="badge badge-muted">Cancelled</span>` };
  return html`
  <div class="ci-section-head"><div><h1>Printing</h1><p class="muted">Name tags from every check-in device wait here for the printer.</p></div></div>
  <section class="ci-card ci-printer-card${isPrinter ? ' is-on' : ''}" data-tour="printer">
    <label class="ci-switch"><input type="checkbox" data-printer-toggle${checked(isPrinter)}><span><strong>This device is the printer</strong><br><span class="small muted">Turn this on for the laptop or computer connected to the Brother QL-810W. Keep this page open and tags print automatically.</span></span></label>
    <p class="ci-printer-status small" data-printer-status>${isPrinter ? 'Watching for new name tags…' : 'Off. Tags checked in on this device go to the printer device.'}</p>
  </section>
  <section class="ci-section" data-tour="queue">
    <div class="ci-section-head"><h2>Waiting <span class="muted" data-waiting-count>${waiting.length}</span></h2>
      ${waiting.length ? html`<a class="btn btn-small" href="/checkin/print?jobs=${waiting.map((j) => j.id).join(',')}&return=/checkin/print-queue">Print all waiting</a>` : ''}</div>
    ${waiting.length ? html`<ul class="ci-queue">${waiting.map((j) => html`<li class="ci-queue-row">
      <div class="ci-person-text"><span class="ci-person-name">${j.family_name}</span><span class="ci-person-meta">${j.summary}${j.include_parent ? ' + parent tag' : ''} · ${j.event_name} · ${t.fmtTime(j.created_at)}${j.by_name ? ` · by ${j.by_name}` : ''}</span></div>
      <div class="ci-row-actions"><a class="btn btn-small" href="/checkin/print?jobs=${j.id}&return=/checkin/print-queue">Print</a>
      <form method="post" action="/checkin/print-jobs/${j.id}/cancel" class="inline">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">Cancel</button></form></div>
    </li>`)}</ul>` : html`<p class="muted">Nothing waiting. New tags show up here as families check in.</p>`}
  </section>
  ${done.length ? html`<section class="ci-section"><h2>Earlier today</h2><ul class="ci-queue">${done.map((j) => html`<li class="ci-queue-row is-done">
    <div class="ci-person-text"><span class="ci-person-name">${j.family_name}</span><span class="ci-person-meta">${j.summary} · ${j.event_name} · ${t.fmtTime(j.printed_at || j.created_at)}</span></div>
    ${badge[j.status]}
    ${j.status === 'printed' ? html`<a class="btn btn-quiet btn-small" href="/checkin/print?jobs=${j.id}&return=/checkin/print-queue">Print again</a>` : ''}
  </li>`)}</ul></section>` : ''}
  <iframe class="ci-print-frame" data-print-frame title="Printing" aria-hidden="true" tabindex="-1"></iframe>`;
}

// ---------------------------------------------------------------- events
const EVENT_TIMES = { 'Sunday School': 'Sundays 9:30 AM', "Children's Church": 'Sundays 10:45 AM', 'Wednesday Night Service': 'Wednesdays 6:00 PM' };
function eventsPage({ csrf, user, names, recent, builtIn, current }) {
  const active = names.filter((n) => !n.archived);
  const archived = names.filter((n) => n.archived);
  const row = (n) => {
    const fixed = builtIn.includes(n.name);
    return html`<li class="ci-event-row${n.archived ? ' is-archived' : ''}">
      <div class="ci-person-text">
        <span class="ci-person-name">${n.name}${fixed ? html` <span class="badge badge-info">Regular service</span>` : ''}</span>
        <span class="ci-person-meta">${[EVENT_TIMES[n.name], n.times ? `held ${plural(n.times, 'time')}` : 'not held yet', n.last_date ? `last ${t.fmtDate(t.zoned(...n.last_date.split('-').map(Number), 12))}` : '', n.checkins ? plural(n.checkins, 'check-in') : '', n.archived && n.archived_at ? `archived ${t.fmtDate(n.archived_at)}` : ''].filter(Boolean).join(' · ')}</span>
        ${n.notes ? html`<span class="small muted">${n.notes}</span>` : ''}
      </div>
      <div class="ci-row-actions">
        ${n.checkins ? html`<a class="btn btn-quiet btn-small" href="/checkin/reports?event=${encodeURIComponent(n.name)}">Attendance</a>` : ''}
        ${n.archived ? html`<form method="post" action="/checkin/events/${n.id}/restore" class="inline">${csrfField(csrf)}<button class="btn btn-small" type="submit">Restore</button></form>`
    : html`<form method="post" action="/checkin/event" class="inline">${csrfField(csrf)}<input type="hidden" name="name" value="${n.name}"><button class="btn btn-quiet btn-small" type="submit"${current && current.name === n.name ? raw(' disabled') : ''}>${current && current.name === n.name ? 'Checking in now' : 'Check in for this'}</button></form>
          ${fixed ? '' : html`<form method="post" action="/checkin/events/${n.id}/archive" class="inline" data-confirm="Archive ${n.name}? It comes off the check-in screen. Its attendance stays in Reports."><button class="btn btn-small" type="submit" data-tour="archive">Archive</button>${csrfField(csrf)}</form>`}`}
        ${!fixed && D.can(user, 'coadmin') ? html`<details class="ci-rename"><summary class="btn btn-quiet btn-small">Rename</summary>
          <form method="post" action="/checkin/events/${n.id}/rename" class="ci-inline">${csrfField(csrf)}<input name="name" value="${n.name}" maxlength="80" required aria-label="New name"><button class="btn btn-small" type="submit">Save</button></form></details>` : ''}
      </div>
    </li>`;
  };
  return html`
  <div class="ci-section-head"><div><h1>Events</h1><p class="muted">Every event you’ve created. Archive old ones to take them off the check-in screen; their attendance stays in Reports.</p></div></div>
  <form method="post" action="/checkin/events" class="ci-card ci-event-add">
    ${csrfField(csrf)}
    <label for="ev-add"><strong>Add an event</strong></label>
    <div class="ci-inline"><input id="ev-add" name="name" maxlength="80" placeholder="e.g. VBS 2027, Youth Lock-in, Christmas Eve" required><button class="btn" type="submit">Add</button></div>
    <input name="notes" maxlength="300" placeholder="Note (optional): dates, room, who’s leading">
  </form>
  <section class="ci-section" data-tour="events">
    <h2>On the check-in screen <span class="muted">${active.length}</span></h2>
    <ul class="ci-events">${active.map(row)}</ul>
  </section>
  <section class="ci-section">
    <h2>Archived <span class="muted">${archived.length}</span></h2>
    ${archived.length ? html`<ul class="ci-events">${archived.map(row)}</ul>` : html`<p class="muted">Nothing archived yet.</p>`}
  </section>
  <section class="ci-section">
    <h2>Recent dates</h2>
    <ul class="ci-events">${recent.map((e) => html`<li class="ci-event-row">
      <div class="ci-person-text"><span class="ci-person-name">${e.name}</span><span class="ci-person-meta">${fmtDateKey(e.event_date)} · ${e.total ? `${plural(e.kids, 'kid')}, ${plural(e.total - e.kids, 'adult')}` : 'no one checked in'}</span></div>
      <div class="ci-row-actions">${e.total ? '' : html`<form method="post" action="/checkin/events/day/${e.id}/delete" class="inline" data-confirm="Remove ${e.name} on this date? No one was checked in.">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">Remove</button></form>`}</div>
    </li>`)}</ul>
  </section>`;
}

// ---------------------------------------------------------------- add a family at the desk
function newFamilyFlow({ csrf, name = '', error, v = {} }) {
  const last = String(name || '').replace(/^the\s+/i, '').replace(/\s+family$/i, '').trim();
  const f = (n, label, opts = {}) => html`<div class="field${opts.cls ? ' ' + opts.cls : ''}"><label for="nf-${n}">${label}</label><input id="nf-${n}" name="${n}" type="${opts.type || 'text'}" value="${v[n] ?? opts.value ?? ''}"${opts.req ? raw(' required') : ''}${opts.ac ? raw(` autocomplete="${opts.ac}"`) : ''}${opts.ph ? html` placeholder="${opts.ph}"` : ''}>${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ''}</div>`;
  return html`<div class="ci-narrow">
    <p class="crumb"><a href="/checkin">Back to search</a></p>
    <h1>Add a new family</h1>
    <ol class="ci-steps"><li class="current"><a>Family & emergency contact</a></li><li><a>Kids</a></li><li><a>Check in</a></li></ol>
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    <form method="post" action="/checkin/new" class="stack ci-form" data-tour="new-family">
      ${csrfField(csrf)}
      <section class="box"><h2 class="box-head">Parent or guardian</h2><div class="box-body stack">
        <div class="row">${f('first_name', 'First name', { req: true, ac: 'given-name' })}${f('last_name', 'Last name', { req: true, value: last ? last.replace(/\b\w/g, (c) => c.toUpperCase()) : '', ac: 'family-name' })}</div>
        <div class="row">${f('phone', 'Mobile phone', { type: 'tel', req: true, ac: 'tel' })}${f('email', 'Email', { type: 'email', ac: 'email', hint: 'So we can send check-in notices and their sign-up link.' })}</div>
        <div class="field short"><label for="nf-rel">Relationship</label><select id="nf-rel" name="relationship">${RELATIONSHIPS.map((r) => html`<option${selected(r, v.relationship)}>${r}</option>`)}</select></div>
      </div></section>
      <section class="box"><h2 class="box-head">Emergency contact</h2><div class="box-body stack">
        <p class="small muted">Someone other than the parent we can call if we can't reach them.</p>
        <div class="row">${f('ec_name', 'Name')}${f('ec_relationship', 'Relationship', { ph: 'e.g. Grandma' })}${f('ec_phone', 'Phone', { type: 'tel' })}</div>
      </div></section>
      <section class="box"><h2 class="box-head">Family</h2><div class="box-body stack">
        ${f('family_name', 'Family name', { value: last ? `The ${last.replace(/\b\w/g, (c) => c.toUpperCase())} Family` : '', hint: 'Leave blank to use “The [last name] Family”.' })}
        <label class="check"><input type="checkbox" name="send_invite" value="1" checked> Email the parent a link to finish their family profile and sign the permission forms</label>
      </div></section>
      <div class="ci-sticky-actions"><button class="btn ci-big-btn" type="submit">Next: add kids</button></div>
    </form>
  </div>`;
}

function newKidsFlow({ csrf, full, error }) {
  const { family, kids } = full;
  return html`<div class="ci-narrow">
    <p class="crumb"><a href="/checkin">Back to search</a></p>
    <h1>${family.name}</h1>
    <ol class="ci-steps"><li class="done"><a>Family & emergency contact</a></li><li class="current"><a>Kids</a></li><li><a>Check in</a></li></ol>
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    ${kids.length ? html`<ul class="ci-person-cards">${kids.map((k) => html`<li class="ci-person-card">${avatar(k)}<div class="ci-person-text"><span class="ci-person-name">${D.displayName(k)}</span><span class="ci-person-meta">${[D.ageLabel(k.birthdate), D.groupFor(k)].filter(Boolean).join(' · ')}</span>${alertsFor(k, null).length ? html`<span class="ci-flags">${alertsFor(k, null)}</span>` : ''}</div>${photoButton(k, csrf, `/checkin/new/${family.id}/kids`)}</li>`)}</ul>` : ''}
    <section class="box"><h2 class="box-head">${kids.length ? 'Add another child' : 'Add a child'}</h2><div class="box-body">
      <form method="post" action="/checkin/new/${family.id}/kids" class="stack ci-form" data-tour="new-kid">
        ${csrfField(csrf)}
        <div class="row"><div class="field"><label for="nk-first">First name</label><input id="nk-first" name="first_name" required autofocus></div>
          <div class="field"><label for="nk-last">Last name</label><input id="nk-last" name="last_name" value="${(full.adults[0] || {}).last_name || ''}" required></div></div>
        <div class="row"><div class="field"><label for="nk-bday">Birthday</label><input id="nk-bday" name="birthdate" type="date"><p class="hint">Sets the class automatically.</p></div>
          <div class="field"><label for="nk-class">Or pick a class</label><select id="nk-class" name="class_override"><option value="">By birthday</option>${D.CLASSES.map((c) => html`<option>${c}</option>`)}</select></div></div>
        <div class="field"><label for="nk-allergies">Allergies <span class="muted">(leave blank if none)</span></label><input id="nk-allergies" name="allergies"></div>
        <div class="field"><label for="nk-medical">Medical conditions or medications <span class="muted">(optional)</span></label><input id="nk-medical" name="medical_notes"></div>
        <button class="btn btn-quiet" type="submit">Add child</button>
      </form></div></section>
    <div class="ci-sticky-actions"><a class="btn ci-big-btn${kids.length ? '' : ' btn-quiet'}" href="/checkin/f/${family.id}">${kids.length ? 'Done: check them in' : 'Skip: check in adults only'}</a></div>
  </div>`;
}

function guestPage({ csrf, name = '', error, v = {} }) {
  return html`<div class="ci-narrow">
    <p class="crumb"><a href="/checkin">Back to search</a></p>
    <h1>Quick guest check-in</h1>
    <p class="muted">For a child visiting without a parent, like a friend who came with another family. Only a few details are needed.</p>
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    <form method="post" action="/checkin/guest" class="stack ci-form" data-guest-form>
      ${csrfField(csrf)}
      <div class="row"><div class="field"><label for="g-first">Child's first name</label><input id="g-first" name="first_name" value="${v.first_name || name}" required autofocus></div>
        <div class="field"><label for="g-last">Last name <span class="muted">(optional)</span></label><input id="g-last" name="last_name" value="${v.last_name || ''}"></div></div>
      <div class="row">
        <div class="field"><label for="g-class">Class</label><select id="g-class" name="class_override" required><option value="">Choose…</option>${D.CLASSES.map((c) => html`<option${selected(c, v.class_override)}>${c}</option>`)}</select></div>
        <div class="field"><label for="g-phone">Parent or guardian's phone</label><input id="g-phone" name="phone" type="tel" value="${v.phone || ''}" required></div>
      </div>
      <div class="field"><label for="g-allergies">Allergies <span class="muted">(ask: leave blank if none)</span></label><input id="g-allergies" name="allergies" value="${v.allergies || ''}"></div>
      <fieldset class="ci-custody"><legend>Who did they come with?</legend>
        <input type="hidden" name="host_family_id" value="${v.host_family_id || ''}" data-host-id>
        <div class="field suggest-wrap"><label for="g-host">Family or friend they came with</label><input id="g-host" type="search" autocomplete="off" placeholder="Search a family" data-host-search value="${v.host_name || ''}"><div class="ci-results" data-host-results></div>
          <p class="hint" data-host-chosen>${v.host_name ? `Coming with ${v.host_name}. Their pickup tag covers this child.` : 'The guest will share that family’s pickup code.'}</p></div>
        <label class="check"><input type="checkbox" name="on_own" value="1"${checked(v.on_own)} data-on-own> They came on their own (or the parent is in the service)</label>
      </fieldset>
      <div class="ci-sticky-actions"><button class="btn ci-big-btn" type="submit">Check in guest</button></div>
    </form>
  </div>`;
}

// ---------------------------------------------------------------- roster
function roster({ csrf, user, event, rows, q, show }) {
  const groups = new Map();
  for (const r of rows) {
    const g = D.groupFor(r);
    (groups.get(g) || groups.set(g, []).get(g)).push(r);
  }
  const ordered = D.GROUP_ORDER.filter((g) => groups.has(g));
  const inCount = rows.filter((r) => !r.checked_out_at);
  return html`
  <div class="ci-section-head">
    <div><h1>Checked in</h1><p class="muted">${event.name} · ${plural(inCount.filter((r) => r.kind === 'child').length, 'kid')} and ${plural(inCount.filter((r) => r.kind === 'adult').length, 'adult')} here now</p></div>
    <div class="ci-family-tools">
      <a class="btn btn-quiet btn-small" href="/checkin/roster?show=${show === 'all' ? 'here' : 'all'}">${show === 'all' ? 'Only who’s here' : 'Include picked up'}</a>
      ${inCount.some((r) => r.kind === 'child') ? html`<form method="post" action="/checkin/checkout-all" class="inline" data-confirm="Check out every child still checked in for ${event.name}? Parents get a pickup notice.">${csrfField(csrf)}<input type="hidden" name="event_id" value="${event.id}"><button class="btn btn-small" type="submit">Check out all kids</button></form>` : ''}
    </div>
  </div>
  <form class="ci-filter" method="get" action="/checkin/roster"><input type="search" name="q" value="${q || ''}" placeholder="Filter by name or code" data-live-filter="#roster-list"><input type="hidden" name="show" value="${show || ''}"></form>
  <div id="roster-list">
  ${ordered.length ? ordered.map((g) => html`<section class="ci-roster-group">
    <h2 class="ci-group-label">${g} <span class="muted">${groups.get(g).filter((r) => !r.checked_out_at).length}</span></h2>
    <ul class="ci-roster">${groups.get(g).map((r) => html`<li class="ci-roster-row${r.checked_out_at ? ' is-out' : ''}" data-filter-text="${`${r.first_name} ${r.last_name} ${r.preferred_name || ''} ${r.security_code} ${r.family_name}`}">
      ${avatar(r)}
      <div class="ci-person-text">
        <a class="ci-person-name" href="/checkin/f/${r.family_id}">${D.displayName(r)}</a>
        <span class="ci-person-meta">${r.kind === 'child' ? [D.ageLabel(r.birthdate), r.grade].filter(Boolean).join(' · ') : r.family_name} · in ${t.fmtTime(r.checked_in_at)}${r.checked_out_at ? ` · out ${t.fmtTime(r.checked_out_at)}` : ''}</span>
        ${alertsFor(r, user, { full: true }).length ? html`<span class="ci-flags">${alertsFor(r, user, { full: true })}</span>` : ''}
      </div>
      <span class="ci-code">${r.security_code}</span>
      <div class="ci-row-actions">
        ${!r.checked_out_at ? html`
          ${r.kind === 'child' ? html`<form method="post" action="/checkin/reprint" class="inline">${csrfField(csrf)}<input type="hidden" name="event_id" value="${event.id}"><input type="hidden" name="family_id" value="${r.family_id}"><input type="hidden" name="people" value="${r.person_id}"><input type="hidden" name="parent" value="0"><button class="btn btn-quiet btn-small" type="submit">Reprint</button></form>` : ''}
          <form method="post" action="/checkin/attendance/${r.id}/out" class="inline">${csrfField(csrf)}<button class="btn btn-small" type="submit">Check out</button></form>
          <form method="post" action="/checkin/attendance/${r.id}/remove" class="inline" data-confirm="Remove ${r.first_name} from tonight's list? Use this if they were checked in by mistake.">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit" title="Checked in by mistake">Remove</button></form>` : ''}
      </div>
    </li>`)}</ul>
  </section>`) : html`<div class="empty"><p>No one is checked in for ${event.name} yet.</p><p><a class="btn" href="/checkin">Check in a family</a></p></div>`}
  </div>`;
}

// ---------------------------------------------------------------- pickup / scan
function scanPage({ csrf, event, match, code, error, user }) {
  return html`
  <script src="/js/scan128.js?v=1" defer></script>
  <h1>Scan to pick up</h1>
  <p class="muted">Scan the barcode on the parent’s pickup tag, or type the 4-letter code.</p>
  <div class="ci-scan">
    <button type="button" class="btn ci-big-btn ci-scan-btn" data-start-scan hidden data-tour="scan-camera">📷 Scan a pickup tag</button>
    <div class="ci-camera" data-scanner hidden>
      <div class="ci-camera-view"><video playsinline muted></video><span class="ci-camera-box" aria-hidden="true"></span></div>
      <p class="small muted" data-scanner-status>Point the camera at the barcode.</p>
      <button type="button" class="btn btn-quiet btn-small" data-stop-scan>Stop camera</button>
    </div>
    <form method="post" action="/checkin/scan" class="ci-code-form" data-scan-form>
      ${csrfField(csrf)}
      <input type="hidden" name="event_id" value="${event.id}">
      <label for="scan-code">Pickup code</label>
      <div class="ci-inline"><input id="scan-code" name="code" value="${code || ''}" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="e.g. 7KXM" autofocus><button class="btn" type="submit">Find</button></div>
      <p class="hint">Handheld USB or Bluetooth barcode scanners work too: scan into this box.</p>
    </form>
  </div>
  ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
  ${match ? html`<section class="ci-card ci-match">
    <h2>${match.family.name} · code ${match.code}</h2>
    ${match.blocked.length ? html`<div class="ci-alert ci-alert-danger" role="alert"><strong>Stop. Not allowed to pick up:</strong> ${match.blocked.map((b) => b.name).join(', ')}. If one of these people is here, don't release the child; get a leader now.</div>` : ''}
    ${match.kids.some((k) => k.custody_alert) ? html`<div class="ci-alert ci-alert-warn">A child in this family has a custody alert. Check the person's ID against the approved list before releasing.</div>` : ''}
    <form method="post" action="/checkin/release" data-checkin-form>
      ${csrfField(csrf)}
      <input type="hidden" name="event_id" value="${event.id}">
      <ul class="ci-people">${match.rows.map((r) => html`<li class="ci-person${r.checked_out_at ? ' is-in' : ''}"><label class="ci-person-check">
        <input type="checkbox" name="attendance[]" value="${r.id}"${checked(!r.checked_out_at)}${r.checked_out_at ? raw(' disabled') : ''}>
        ${avatar(r)}<span class="ci-person-text"><span class="ci-person-name">${D.displayName(r)}</span><span class="ci-person-meta">${D.groupFor(r)}${r.checked_out_at ? ` · picked up ${t.fmtTime(r.checked_out_at)}` : ''}</span></span>
      </label></li>`)}</ul>
      <div class="field"><label for="rel-to">Picked up by</label>
        <select id="rel-to" name="to">${[...match.adults.map((a) => `${a.first_name} ${a.last_name} (${a.relationship || 'parent'})`), ...match.allowed.map((a) => `${a.name} (${a.relationship || 'approved pickup'})`)].map((n) => html`<option>${n}</option>`)}<option value="">Someone else (approved by a leader)</option></select></div>
      <button class="btn ci-big-btn" type="submit">Release checked children</button>
    </form>
  </section>` : ''}`;
}

// ---------------------------------------------------------------- families (staff)
function familiesPage({ csrf, rows, q, user, event }) {
  return html`
  <div class="ci-section-head"><h1>Families</h1>
    <div class="ci-family-tools">${D.can(user, 'leader') ? html`<a class="btn btn-small" href="/checkin/new">New family</a> <a class="btn btn-quiet btn-small" href="/checkin/invite">Email a sign-up link</a>` : ''}</div></div>
  <form class="ci-filter" method="get" action="/checkin/families"><input type="search" name="q" value="${q || ''}" placeholder="Search families, people, phone or email"></form>
  <p class="small muted">${event ? html`<strong>Quick Check</strong> checks the whole family in for <strong>${event.name}</strong> and prints the kids’ name tags. Tap a family’s name instead to choose who’s here.` : html`Tap a family to check them in. <a href="/checkin?change=1">Choose an event</a> to use Quick Check.`}</p>
  <ul class="ci-family-list" data-tour="families">${rows.map((f) => familyRow(f, event ? { csrf, back: `/checkin/families${q ? `?q=${encodeURIComponent(q)}` : ''}` } : {}))}</ul>
  ${!rows.length ? html`<p class="muted">No families found.</p>` : ''}`;
}

const GRADES = ['', 'Nursery', 'Pre-K', 'Kindergarten', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const RELATIONSHIPS = ['Mother', 'Father', 'Guardian', 'Grandparent', 'Stepparent', 'Foster parent', 'Other'];

function personFields(p = {}, { kind = p.kind || 'child', user, parentView = false } = {}) {
  const v = (k) => p[k] ?? '';
  const f = (name, label, opts = {}) => html`<div class="field${opts.cls ? ' ' + opts.cls : ''}"><label for="p-${name}">${label}</label>
    <input id="p-${name}" name="${name}" type="${opts.type || 'text'}" value="${opts.value ?? v(name)}"${opts.req ? raw(' required') : ''}${opts.ac ? raw(` autocomplete="${opts.ac}"`) : ''}>${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ''}</div>`;
  const ta = (name, label, hint) => html`<div class="field"><label for="p-${name}">${label}</label><textarea id="p-${name}" name="${name}" rows="2">${v(name)}</textarea>${hint ? html`<p class="hint">${hint}</p>` : ''}</div>`;
  return html`
    <input type="hidden" name="kind" value="${kind}">
    <div class="row">${f('first_name', 'First name', { req: true })}${f('last_name', 'Last name', { req: true })}${f('preferred_name', 'Goes by', { hint: 'Optional nickname for the name tag' })}</div>
    ${kind === 'adult' ? html`
      <div class="row">
        <div class="field"><label for="p-relationship">Relationship</label><select id="p-relationship" name="relationship">${RELATIONSHIPS.map((r) => html`<option${selected(r, p.relationship)}>${r}</option>`)}</select></div>
        ${f('email', 'Email', { type: 'email', ac: 'email' })}${f('phone', 'Mobile phone', { type: 'tel', ac: 'tel' })}
      </div>
      <div class="row">
        <div class="field"><label for="p-contact">Best way to reach</label><select id="p-contact" name="contact_method">${[['app', 'App notification and email'], ['email', 'Email'], ['phone', 'Phone call']].map(([k, l]) => html`<option value="${k}"${selected(k, p.contact_method || 'app')}>${l}</option>`)}</select></div>
        ${f('birthdate', 'Birthday', { type: 'date', hint: 'Optional. We’d love to wish you a happy birthday.' })}
      </div>
      <label class="check"><input type="checkbox" name="is_primary" value="1"${checked(p.is_primary)}> Primary contact for this family</label>`
    : html`
      <div class="row">
        ${f('birthdate', 'Birthday', { type: 'date', req: true })}
        <div class="field short"><label for="p-grade">Grade</label><select id="p-grade" name="grade">${GRADES.map((g) => html`<option value="${g}"${selected(g, p.grade || '')}>${g || '—'}</option>`)}</select></div>
        <div class="field short"><label for="p-gender">Boy or girl</label><select id="p-gender" name="gender">${['', 'Boy', 'Girl'].map((g) => html`<option value="${g}"${selected(g, p.gender || '')}>${g || '—'}</option>`)}</select></div>
      </div>
      ${ta('allergies', 'Allergies', 'Foods, medicines, bee stings… Leave blank if none. Allergies print on the name tag.')}
      ${ta('medical_notes', 'Medical conditions', 'e.g. asthma, seizures, diabetes')}
      ${ta('medications', 'Medications', 'Anything leaders should know about, including an EpiPen or inhaler')}
      ${ta('special_needs', 'Anything else that helps us care for them', 'e.g. sensory needs, how to calm them, potty training')}
      <fieldset class="ci-custody">
        <legend>Custody or protective orders</legend>
        <label class="check"><input type="checkbox" name="custody_alert" value="1"${checked(p.custody_alert)} data-toggle="#custody-notes"> There is a court order or someone who must not pick up this child</label>
        <div id="custody-notes"${p.custody_alert ? '' : raw(' hidden')}>${ta('custody_notes', 'Details for ministry leaders', parentView ? 'Only ministry leaders can see this. Please also bring a copy of any court order to the children’s ministry director.' : 'Only leaders and admins can see these notes.')}</div>
      </fieldset>`}`;
}

function familyAdmin({ csrf, user, full, invites = [] }) {
  const { family, adults, kids, contacts, pickups, waivers } = full;
  const signed = D.agreementStatus(waivers, AGREEMENTS);
  const personCard = (p) => html`<li class="ci-person-card">
    ${avatar(p)}
    <div class="ci-person-text">
      <span class="ci-person-name">${D.displayName(p)}${p.is_primary ? html` <span class="badge badge-info">Primary</span>` : ''}${p.user_id ? html` <span class="badge badge-ok">Has app login</span>` : ''}</span>
      <span class="ci-person-meta">${p.kind === 'child' ? [p.birthdate ? `${D.ageLabel(p.birthdate)} · born ${t.fmtDateYear(t.zoned(...dateKeyOf(p.birthdate).split('-').map(Number), 12))}` : '', p.grade].filter(Boolean).join(' · ') : [p.relationship, p.email, p.phone].filter(Boolean).join(' · ')}</span>
      ${alertsFor(p, user, { full: true }).length ? html`<span class="ci-flags">${alertsFor(p, user, { full: true })}</span>` : ''}
    </div>
    <div class="ci-card-actions">${photoButton(p, csrf, `/checkin/families/${family.id}`)}<a class="btn btn-quiet btn-small" href="/checkin/people/${p.id}">Edit</a></div>
  </li>`;
  return html`
  <p class="crumb"><a href="/checkin/families">Families</a></p>
  <div class="ci-section-head"><div><h1>${family.name}</h1><p class="muted">${[family.address, family.city, family.state].filter(Boolean).join(', ')}${family.home_phone ? ` · ${family.home_phone}` : ''}</p></div>
    <div class="ci-family-tools"><a class="btn btn-small" href="/checkin/f/${family.id}">Check in</a></div></div>
  <div class="two-col">
    <div>
      <section class="box"><h2 class="box-head">Kids</h2><div class="box-body"><ul class="ci-person-cards">${kids.map(personCard)}</ul>
        <a class="btn btn-quiet btn-small" href="/checkin/families/${family.id}/people/new?kind=child">Add a child</a></div></section>
      <section class="box"><h2 class="box-head">Parents and guardians</h2><div class="box-body"><ul class="ci-person-cards">${adults.map(personCard)}</ul>
        <a class="btn btn-quiet btn-small" href="/checkin/families/${family.id}/people/new?kind=adult">Add an adult</a></div></section>
      <section class="box"><h2 class="box-head">Signed agreements</h2><div class="box-body">
        <ul class="ci-agreements">${Object.entries(AGREEMENTS).map(([k, a]) => html`<li>${signed[k] ? html`<span class="badge badge-ok">Signed</span>` : html`<span class="badge ${a.required ? 'badge-warn' : 'badge-muted'}">${a.required ? 'Not signed' : 'Declined or not signed'}</span>`} ${a.title}${signed[k] ? html` <span class="small muted">by ${signed[k].signer_name}, ${t.fmtDateYear(signed[k].signed_at)}</span>` : ''}</li>`)}</ul>
        ${waivers.length ? html`<p><a href="/checkin/families/${family.id}/agreements">View signed copies</a></p>` : ''}
      </div></section>
    </div>
    <div>
      <section class="box"><h2 class="box-head">Emergency contacts</h2><div class="box-body">
        <ul class="ci-mini-list">${contacts.map((c) => html`<li><span><strong>${c.name}</strong>${c.relationship ? ` (${c.relationship})` : ''}<br><a href="tel:${c.phone}">${c.phone}</a></span>
          <form method="post" action="/checkin/contacts/${c.id}/delete" class="inline" data-confirm="Remove ${c.name}?">${csrfField(csrf)}<button class="linklike small" type="submit">Remove</button></form></li>`)}</ul>
        <form method="post" action="/checkin/families/${family.id}/contacts" class="stack ci-compact">${csrfField(csrf)}
          <div class="row"><div class="field"><label for="ec-name">Name</label><input id="ec-name" name="name" required></div><div class="field"><label for="ec-rel">Relationship</label><input id="ec-rel" name="relationship" placeholder="e.g. Aunt"></div></div>
          <div class="row"><div class="field"><label for="ec-phone">Phone</label><input id="ec-phone" name="phone" type="tel" required></div><button class="btn btn-quiet btn-small ci-add-btn" type="submit">Add contact</button></div>
        </form></div></section>
      <section class="box"><h2 class="box-head">Who may pick up</h2><div class="box-body">
        <ul class="ci-mini-list">${pickups.map((c) => html`<li class="${c.not_allowed ? 'is-blocked' : ''}"><span><strong>${c.name}</strong>${c.relationship ? ` (${c.relationship})` : ''}${c.not_allowed ? html` <span class="badge badge-danger">Not allowed</span>` : ''}${c.phone ? html`<br>${c.phone}` : ''}${c.notes && D.can(user, 'leader') ? html`<br><span class="small muted">${c.notes}</span>` : ''}</span>
          <form method="post" action="/checkin/pickups/${c.id}/delete" class="inline" data-confirm="Remove ${c.name}?">${csrfField(csrf)}<button class="linklike small" type="submit">Remove</button></form></li>`)}</ul>
        <form method="post" action="/checkin/families/${family.id}/pickups" class="stack ci-compact">${csrfField(csrf)}
          <div class="row"><div class="field"><label for="pu-name">Name</label><input id="pu-name" name="name" required></div><div class="field"><label for="pu-rel">Relationship</label><input id="pu-rel" name="relationship" placeholder="e.g. Grandpa"></div></div>
          <div class="row"><div class="field"><label for="pu-phone">Phone</label><input id="pu-phone" name="phone" type="tel"></div></div>
          <label class="check"><input type="checkbox" name="not_allowed" value="1"> This person is <strong>not</strong> allowed to pick up (court order)</label>
          <div class="field"><label for="pu-notes">Notes for leaders</label><input id="pu-notes" name="notes"></div>
          <button class="btn btn-quiet btn-small" type="submit">Add person</button>
        </form></div></section>
      <section class="box"><h2 class="box-head">Family details</h2><div class="box-body">
        <form method="post" action="/checkin/families/${family.id}" class="stack ci-compact">${csrfField(csrf)}
          <div class="field"><label for="fd-name">Family name</label><input id="fd-name" name="name" value="${family.name}" required></div>
          <div class="field"><label for="fd-addr">Address</label><input id="fd-addr" name="address" value="${family.address || ''}"></div>
          <div class="row"><div class="field"><label for="fd-city">City</label><input id="fd-city" name="city" value="${family.city || ''}"></div><div class="field short"><label for="fd-state">State</label><input id="fd-state" name="state" value="${family.state || ''}"></div><div class="field short"><label for="fd-zip">ZIP</label><input id="fd-zip" name="zip" value="${family.zip || ''}"></div></div>
          <div class="field"><label for="fd-phone">Home phone</label><input id="fd-phone" name="home_phone" value="${family.home_phone || ''}"></div>
          ${D.can(user, 'leader') ? html`<div class="field"><label for="fd-notes">Staff notes</label><textarea id="fd-notes" name="staff_notes" rows="2">${family.staff_notes || ''}</textarea><p class="hint">Only leaders and admins see these.</p></div>` : ''}
          <button class="btn btn-quiet btn-small" type="submit">Save details</button>
        </form></div></section>
      <section class="box"><h2 class="box-head">App sign-up</h2><div class="box-body">
        <p class="small">Email a link so a parent can create their login, update details and sign forms from home.</p>
        <form method="post" action="/checkin/invite" class="ci-inline">${csrfField(csrf)}<input type="hidden" name="family_id" value="${family.id}">
          <input name="email" type="email" required placeholder="parent@email.com" value="${(adults.find((a) => a.email && !a.user_id) || {}).email || ''}"><button class="btn btn-small" type="submit">Send link</button></form>
        ${invites.length ? html`<p class="small muted">Sent: ${invites.map((i) => `${i.email} (${t.fmtDate(i.created_at)}${i.used_at ? ', used' : ''})`).join('; ')}</p>` : ''}
      </div></section>
    </div>
  </div>`;
}

function personPage({ csrf, user, person, family, isNew }) {
  return html`
  <p class="crumb"><a href="/checkin/families/${family.id}">${family.name}</a></p>
  <h1>${isNew ? (person.kind === 'adult' ? 'Add an adult' : 'Add a child') : D.displayName(person)}</h1>
  <form method="post" action="${isNew ? `/checkin/families/${family.id}/people` : `/checkin/people/${person.id}`}" class="stack ci-form">
    ${csrfField(csrf)}
    ${personFields(person, { kind: person.kind, user })}
    <div class="form-actions"><button class="btn" type="submit">${isNew ? 'Add' : 'Save'}</button><a class="btn btn-quiet" href="/checkin/families/${family.id}">Cancel</a></div>
  </form>
  ${!isNew ? html`<form method="post" action="/checkin/people/${person.id}/remove" class="danger-zone" data-confirm="Remove ${person.first_name} from this family? Attendance history is kept.">${csrfField(csrf)}<button class="btn btn-danger btn-small" type="submit">Remove from family</button></form>` : ''}`;
}

function newFamilyPage({ csrf, user }) {
  return html`
  <p class="crumb"><a href="/checkin/families">Families</a></p>
  <h1>New family</h1>
  <p class="muted">Add the parent or guardian now. You can add kids on the next screen, or send them a sign-up link to do it from home.</p>
  <form method="post" action="/checkin/families" class="stack ci-form">
    ${csrfField(csrf)}
    <div class="field"><label for="nf-name">Family name</label><input id="nf-name" name="family_name" placeholder="e.g. The Smith Family" required></div>
    ${personFields({ is_primary: true }, { kind: 'adult', user })}
    <div class="form-actions"><button class="btn" type="submit">Create family</button></div>
  </form>`;
}

function invitePage({ csrf, sent }) {
  return html`
  <h1>Email a sign-up link</h1>
  <p>The parent gets an email with a link to set up their family: kids, allergies, emergency contacts, pickups and the Central Kids/Teens forms.</p>
  ${sent ? html`<p class="flash flash-ok" role="status">Link sent to ${sent}.</p>` : ''}
  <form method="post" action="/checkin/invite" class="ci-inline ci-form">${csrfField(csrf)}<input name="email" type="email" required placeholder="parent@email.com" aria-label="Parent email"><button class="btn" type="submit">Send link</button></form>`;
}

// ---------------------------------------------------------------- staff
function staffPage({ csrf, user, staff, tempPassword, created }) {
  const assignable = D.can(user, 'admin') ? ['admin', 'coadmin', 'leader', 'volunteer'] : ['leader', 'volunteer'];
  return html`
  <h1>Check-in team</h1>
  <p class="muted">Volunteers check families in and out and see allergy and medical notes. Leaders also edit families and see custody details. Co-admins manage the team and reports. The primary admin can do everything.</p>
  ${tempPassword ? html`<div class="card card-note" role="status"><h2>Account created</h2><p>${created}'s temporary password: <strong class="code-big">${tempPassword}</strong></p><p class="small">They can change it after logging in. This is the only time it's shown.</p></div>` : ''}
  <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Email</th><th></th></tr></thead><tbody>
  ${staff.map((s) => html`<tr><td>${s.first_name} ${s.last_name}</td><td>${D.ROLE_LABEL[s.checkin_role]}</td><td>${s.email}</td>
    <td class="actions">${s.id !== user.id && (D.can(user, 'admin') || D.RANK[s.checkin_role] < D.RANK.coadmin) ? html`
      <form method="post" action="/checkin/staff/${s.id}" class="inline">${csrfField(csrf)}<select name="role" aria-label="Role for ${s.first_name}">${assignable.map((r) => html`<option value="${r}"${selected(r, s.checkin_role)}>${D.ROLE_LABEL[r]}</option>`)}<option value="">Remove from team</option></select> <button class="btn btn-quiet btn-small" type="submit">Save</button></form>` : html`<span class="small muted">${s.id === user.id ? 'You' : ''}</span>`}</td></tr>`)}
  </tbody></table></div>
  <div class="two-col">
    <section class="card"><h2>Add someone who already has an account</h2>
      <form method="post" action="/checkin/staff" class="stack">${csrfField(csrf)}
        <div class="field"><label for="st-email">Their email</label><input id="st-email" name="email" type="email" required></div>
        <div class="field"><label for="st-role">Role</label><select id="st-role" name="role">${assignable.map((r) => html`<option value="${r}"${selected(r, 'volunteer')}>${D.ROLE_LABEL[r]}</option>`)}</select></div>
        <button class="btn btn-small" type="submit">Add to team</button></form></section>
    <section class="card"><h2>Create a new account</h2>
      <form method="post" action="/checkin/staff/create" class="stack">${csrfField(csrf)}
        <div class="row"><div class="field"><label for="sc-first">First name</label><input id="sc-first" name="first_name" required></div><div class="field"><label for="sc-last">Last name</label><input id="sc-last" name="last_name" required></div></div>
        <div class="field"><label for="sc-email">Email</label><input id="sc-email" name="email" type="email" required></div>
        <div class="field"><label for="sc-role">Role</label><select id="sc-role" name="role">${assignable.map((r) => html`<option value="${r}"${selected(r, 'volunteer')}>${D.ROLE_LABEL[r]}</option>`)}</select></div>
        <button class="btn btn-small" type="submit">Create account</button></form></section>
  </div>`;
}

// ---------------------------------------------------------------- reports
function bar(value, max) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return html`<span class="ci-bar" style="--w:${pct}%"><span></span></span>`;
}

function reportsPage({ filter, names, weekly, monthly, yearly, byGroup, firstTimers, from, to }) {
  const maxW = Math.max(1, ...weekly.map((w) => w.total));
  const maxM = Math.max(1, ...monthly.map((m) => m.avg_total));
  const qs = (extra) => `?${new URLSearchParams({ event: filter || '', from, to, ...extra })}`;
  return html`
  <div class="ci-section-head"><h1>Attendance reports</h1>
    <div class="ci-family-tools"><a class="btn btn-quiet btn-small" href="/checkin/reports.csv${qs({})}">Download spreadsheet</a></div></div>
  <form class="filters" method="get" action="/checkin/reports">
    <div class="field"><label for="r-ev">Event</label><select id="r-ev" name="event" data-autosubmit><option value="">All events</option>${names.map((n) => html`<option${selected(n, filter)}>${n}</option>`)}</select></div>
    <div class="field"><label for="r-from">From</label><input id="r-from" type="date" name="from" value="${from}"></div>
    <div class="field"><label for="r-to">To</label><input id="r-to" type="date" name="to" value="${to}"></div>
    <button class="btn btn-quiet" type="submit">Show</button>
  </form>

  <div class="ci-stats">
    ${yearly.slice(0, 1).map((y) => html`
      <div class="ci-stat"><span>${y.year} average</span><strong>${y.avg_total}</strong><small>${y.avg_kids} kids · ${y.avg_adults} adults per service</small></div>
      <div class="ci-stat"><span>${y.year} services</span><strong>${y.services}</strong><small>${y.total.toLocaleString()} check-ins</small></div>`)}
    <div class="ci-stat"><span>First-time guests</span><strong>${firstTimers}</strong><small>in this date range</small></div>
  </div>

  <section class="box"><h2 class="box-head">Each service</h2><div class="box-body">
    <div class="table-wrap"><table class="table ci-report"><thead><tr><th>Date</th><th>Event</th><th>Kids</th><th>Adults</th><th>Total</th><th class="ci-bar-col"></th></tr></thead><tbody>
      ${weekly.map((w) => html`<tr><td>${t.fmtDateYear(t.zoned(...dateKeyOf(w.event_date).split('-').map(Number), 12))}</td><td>${w.name}</td><td>${w.kids}</td><td>${w.adults}</td><td><strong>${w.total}</strong></td><td>${bar(w.total, maxW)}</td></tr>`)}
    </tbody></table></div>
    ${!weekly.length ? html`<p class="muted">No attendance in this range yet.</p>` : ''}
  </div></section>

  <div class="two-col">
    <section class="box"><h2 class="box-head">Monthly average per service</h2><div class="box-body">
      <table class="table ci-report"><thead><tr><th>Month</th><th>Services</th><th>Avg kids</th><th>Avg adults</th><th>Avg total</th><th class="ci-bar-col"></th></tr></thead><tbody>
      ${monthly.map((m) => html`<tr><td>${m.label}</td><td>${m.services}</td><td>${m.avg_kids}</td><td>${m.avg_adults}</td><td><strong>${m.avg_total}</strong></td><td>${bar(m.avg_total, maxM)}</td></tr>`)}</tbody></table>
    </div></section>
    <section class="box"><h2 class="box-head">By year</h2><div class="box-body">
      <table class="table ci-report"><thead><tr><th>Year</th><th>Services</th><th>Total check-ins</th><th>Avg per service</th><th>Unique people</th></tr></thead><tbody>
      ${yearly.map((y) => html`<tr><td>${y.year}</td><td>${y.services}</td><td>${y.total.toLocaleString()}</td><td>${y.avg_total}</td><td>${y.unique_people}</td></tr>`)}</tbody></table>
      <h3 class="box-sub">Kids by age group (this range)</h3>
      <table class="table ci-report"><tbody>${byGroup.map((g) => html`<tr><td>${g.group}</td><td>${g.n} check-ins</td><td>${g.people} children</td></tr>`)}</tbody></table>
    </div></section>
  </div>`;
}

// ---------------------------------------------------------------- policies
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function policiesPage({ csrf, user, rows, acks, ackReport }) {
  const admin = D.can(user, 'coadmin');
  return html`
  <div class="ci-section-head"><div><h1>Policies</h1><p class="muted">Child safety, check-in procedures and other documents for ${admin ? 'the team and families' : 'you to read'}.</p></div></div>
  ${rows.length ? html`<ul class="ci-policy-list">${rows.map((p) => html`<li class="ci-card ci-policy">
    <div class="ci-policy-icon" aria-hidden="true">${/pdf/.test(p.mime || '') ? 'PDF' : /word|doc/.test(p.mime || '') ? 'DOC' : /image/.test(p.mime || '') ? 'IMG' : 'TXT'}</div>
    <div class="ci-person-text">
      <span class="ci-person-name">${p.title}</span>
      ${p.description ? html`<span class="ci-person-meta">${p.description}</span>` : ''}
      <span class="small muted">${p.audience === 'everyone' ? 'Team and families' : 'Team only'} · updated ${t.fmtDateYear(p.updated_at)}${p.size ? ` · ${fmtSize(p.size)}` : ''}</span>
      ${admin && p.requires_ack && ackReport[p.id] ? html`<details class="small"><summary>${ackReport[p.id].done.length} of ${ackReport[p.id].total} team members have read this</summary>
        <p>${ackReport[p.id].missing.length ? html`Still to read: ${ackReport[p.id].missing.join(', ')}` : 'Everyone on the team has read it.'}</p></details>` : ''}
    </div>
    <div class="ci-row-actions">
      ${p.filename ? html`<a class="btn btn-small" href="/checkin/policies/${p.id}/file" target="_blank" rel="noopener">Open</a>` : ''}
      ${p.requires_ack ? (acks.has(p.id) ? html`<span class="badge badge-ok">You read this</span>`
        : html`<form method="post" action="/checkin/policies/${p.id}/ack" class="inline">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">I've read this</button></form>`) : ''}
      ${admin ? html`<form method="post" action="/checkin/policies/${p.id}/delete" class="inline" data-confirm="Delete “${p.title}”?">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">Delete</button></form>` : ''}
    </div>
  </li>`)}</ul>` : html`<div class="empty"><p>No policies have been added yet.</p></div>`}
  ${admin ? html`<section class="box"><h2 class="box-head">Add a policy</h2><div class="box-body">
    <form method="post" action="/checkin/policies" class="stack ci-form" data-policy-form>
      ${csrfField(csrf)}
      <div class="field"><label for="po-title">Title</label><input id="po-title" name="title" required placeholder="e.g. Child Safety Policy"></div>
      <div class="field"><label for="po-desc">Short description <span class="muted">(optional)</span></label><input id="po-desc" name="description"></div>
      <div class="field"><label for="po-file">File (PDF, Word document or picture, up to 15 MB)</label><input id="po-file" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt" data-policy-file><p class="hint" data-policy-info></p></div>
      <input type="hidden" name="file_name" data-file-name><input type="hidden" name="file_data" data-file-data>
      <div class="row">
        <div class="field"><label for="po-aud">Who can see it</label><select id="po-aud" name="audience"><option value="team">Check-in team only</option><option value="everyone">Team and families</option></select></div>
      </div>
      <label class="check"><input type="checkbox" name="requires_ack" value="1"> Team members must confirm they've read it</label>
      <button class="btn" type="submit">Add policy</button>
    </form></div></section>` : ''}`;
}

// ---------------------------------------------------------------- serving calendar
const AREAS = ['Nursery', 'Toddlers', 'Kids', 'Teens', 'Adults'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function servingMonth({ csrf, user, month, weeks, services, mine, prev, next, label }) {
  const admin = D.can(user, 'coadmin');
  const byDate = new Map();
  for (const sv of services) (byDate.get(sv.service_date) || byDate.set(sv.service_date, []).get(sv.service_date)).push(sv);
  const todayKey = t.dateKey(new Date());
  return html`
  <div class="ci-section-head">
    <div><h1>Serving calendar</h1><p class="muted">Tap a service to see who's serving and sign up.</p></div>
    <div class="ci-family-tools">
      <a class="btn btn-quiet btn-small" href="/checkin/serve?month=${prev}" aria-label="Previous month">‹</a>
      <strong class="ci-month">${label}</strong>
      <a class="btn btn-quiet btn-small" href="/checkin/serve?month=${next}" aria-label="Next month">›</a>
      ${admin ? html`<a class="btn btn-quiet btn-small" href="/checkin/serve/import">Import</a>` : ''}
    </div>
  </div>
  ${mine.length ? html`<div class="ci-alert ci-alert-ok"><strong>You're serving:</strong> ${mine.map((m) => `${t.fmtDate(t.zoned(...m.service_date.split('-').map(Number), 12))} ${m.name} (${m.area})`).join(' · ')}</div>` : ''}
  <div class="ci-cal" role="grid" aria-label="${label}">
    ${WEEKDAYS.map((d) => html`<div class="ci-cal-dow" role="columnheader">${d}</div>`)}
    ${weeks.flat().map((day) => {
      const list = byDate.get(day.key) || [];
      return html`<div class="ci-cal-day${day.inMonth ? '' : ' is-out'}${day.key === todayKey ? ' is-today' : ''}${list.length ? ' has-services' : ''}" role="gridcell">
        <span class="ci-cal-num">${day.n}</span>
        ${list.map((sv) => html`<a class="ci-cal-svc${sv.cancelled ? ' is-cancelled' : ''}" href="/checkin/serve/${sv.id}">
          <span class="ci-cal-name">${sv.name}</span>${sv.start_time ? html`<span class="ci-cal-time">${sv.start_time}</span>` : ''}
          <span class="ci-cal-fill" aria-label="${sv.filled} of 5 areas have someone">${AREAS.map((a) => html`<i class="${sv.areas.includes(a) ? 'on' : ''}" title="${a}"></i>`)}</span>
        </a>`)}
      </div>`;
    })}
  </div>
  <p class="small muted">Each dot is one area: Nursery, Toddlers, Kids, Teens, Adults. Green means someone is signed up.</p>
  ${admin ? html`<section class="box"><h2 class="box-head">Add a special service</h2><div class="box-body">
    <form method="post" action="/checkin/serve/add" class="row ci-form">${csrfField(csrf)}
      <div class="field short"><label for="sv-date">Date</label><input id="sv-date" type="date" name="date" required></div>
      <div class="field"><label for="sv-name">Name</label><input id="sv-name" name="name" required placeholder="e.g. VBS Night 1"></div>
      <div class="field short"><label for="sv-time">Time</label><input id="sv-time" name="start_time" placeholder="6:30 PM"></div>
      <button class="btn btn-small ci-add-btn" type="submit">Add</button>
    </form></div></section>` : ''}`;
}

function servingDay({ csrf, user, service, slots, team }) {
  const admin = D.can(user, 'coadmin');
  const date = t.fmtLong(t.zoned(...service.service_date.split('-').map(Number), 12));
  return html`
  <p class="crumb"><a href="/checkin/serve?month=${service.service_date.slice(0, 7)}">Serving calendar</a></p>
  <div class="ci-section-head"><div><h1>${service.name}</h1><p class="muted">${date}${service.start_time ? ` · ${service.start_time}` : ''}${service.cancelled ? ' · Cancelled' : ''}</p></div></div>
  <div class="ci-areas">${AREAS.map((area) => {
    const here = slots.filter((x) => x.area === area);
    const meIn = here.find((x) => x.user_id === user.id);
    return html`<section class="ci-area ci-card">
      <h2>${area}</h2>
      <ul class="ci-mini-list">${here.map((x) => html`<li><span>${x.name}${x.note ? html`<br><span class="small muted">${x.note}</span>` : ''}</span>
        ${admin || x.user_id === user.id ? html`<form method="post" action="/checkin/serve/slots/${x.id}/delete" class="inline">${csrfField(csrf)}<button class="linklike small" type="submit">Remove</button></form>` : ''}</li>`)}</ul>
      ${!here.length ? html`<p class="small muted">No one yet.</p>` : ''}
      ${!meIn && !service.cancelled ? html`<form method="post" action="/checkin/serve/${service.id}/join" class="inline">${csrfField(csrf)}<input type="hidden" name="area" value="${area}"><button class="btn btn-small" type="submit">Sign me up</button></form>` : ''}
      ${admin ? html`<form method="post" action="/checkin/serve/${service.id}/assign" class="ci-assign">${csrfField(csrf)}<input type="hidden" name="area" value="${area}">
        <input name="who" list="team-list" placeholder="Add a name" aria-label="Add someone to ${area}" required><button class="btn btn-quiet btn-small" type="submit">Add</button></form>` : ''}
    </section>`;
  })}</div>
  ${admin ? html`<datalist id="team-list">${team.map((u) => html`<option value="${u.first_name} ${u.last_name}">`)}</datalist>
    <section class="box"><h2 class="box-head">Service details</h2><div class="box-body">
      <form method="post" action="/checkin/serve/${service.id}" class="row ci-form">${csrfField(csrf)}
        <div class="field short"><label for="sd-time">Time</label><input id="sd-time" name="start_time" value="${service.start_time || ''}"></div>
        <label class="check"><input type="checkbox" name="cancelled" value="1"${checked(service.cancelled)}> Cancelled this week</label>
        <button class="btn btn-quiet btn-small ci-add-btn" type="submit">Save</button>
      </form></div></section>` : ''}`;
}

function servingImport({ csrf, result }) {
  return html`
  <p class="crumb"><a href="/checkin/serve">Serving calendar</a></p>
  <h1>Import the serving schedule</h1>
  <p>Upload a spreadsheet saved as CSV with these columns: <strong>date</strong> (like 2026-10-11), <strong>service</strong> (Sunday School, Children's Church, Wednesday Night Service, or any other name), <strong>area</strong> (Nursery, Toddlers, Kids, Teens or Adults), <strong>name</strong>, and optionally <strong>email</strong> to link it to their login.</p>
  <p><a href="/checkin/serve/template.csv" download>Download a template</a></p>
  ${result ? html`<div class="card card-note" role="status"><h2>Import finished</h2><p>${result.added} added${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.</p>
    ${result.skipped.length ? html`<ul class="small">${result.skipped.slice(0, 30).map((x) => html`<li>Row ${x.row}: ${x.reason}</li>`)}</ul>` : ''}</div>` : ''}
  <form method="post" action="/checkin/serve/import" class="stack ci-form" id="import-form">${csrfField(csrf)}
    <div class="field"><label for="csv-file">CSV file</label><input type="file" id="csv-file" accept=".csv,text/csv"><p class="hint" id="csv-info"></p></div>
    <div class="field" id="csv-paste"><label for="csv-text">Or paste the rows</label><textarea id="csv-text" name="csv" rows="8" required placeholder="date,service,area,name,email"></textarea></div>
    <button class="btn" type="submit">Import</button>
  </form>`;
}

// ---------------------------------------------------------------- parents
function joinPage({ csrf, invite, email, error, loggedIn }) {
  return html`<section class="ci-card ci-narrow">
    <h1>Welcome to Central</h1>
    <p>Set up your family for check-in at Central Baptist Church. It takes about five minutes.</p>
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    ${loggedIn ? html`<form method="post" action="/checkin/join/${invite}" class="stack">${csrfField(csrf)}<button class="btn ci-big-btn" type="submit">Continue as ${loggedIn}</button></form>`
    : html`<form method="post" action="/checkin/join/${invite}" class="stack">${csrfField(csrf)}
      <div class="row"><div class="field"><label for="j-first">Your first name</label><input id="j-first" name="first_name" required autocomplete="given-name"></div><div class="field"><label for="j-last">Last name</label><input id="j-last" name="last_name" required autocomplete="family-name"></div></div>
      <div class="field"><label for="j-email">Email</label><input id="j-email" name="email" type="email" value="${email || ''}" required autocomplete="email"></div>
      <div class="field"><label for="j-pw">Create a password</label><input id="j-pw" name="password" type="password" minlength="8" required autocomplete="new-password"><p class="hint">At least 8 characters.</p></div>
      <button class="btn ci-big-btn" type="submit">Create my account</button>
      <p class="small">Already have a login for the church library? <a href="/login?next=/checkin/join/${invite}">Log in</a> and come back to this link.</p>
    </form>`}
  </section>`;
}

const STEPS = [
  ['family', 'Your family'],
  ['kids', 'Children'],
  ['health', 'Health & safety'],
  ['contacts', 'Emergency & pickup'],
  ['agreements', 'Permission forms'],
];

function stepper(current) {
  const i = STEPS.findIndex(([k]) => k === current);
  return html`<ol class="ci-steps">${STEPS.map(([k, label], j) => html`<li class="${j < i ? 'done' : j === i ? 'current' : ''}"${j === i ? raw(' aria-current="step"') : ''}><a href="/checkin/welcome/${k}">${label}</a></li>`)}</ol>`;
}

function wizard({ step, csrf, user, full, error }) {
  const { family, adults, kids, contacts, pickups, waivers } = full;
  const nextBtn = (label = 'Save and continue') => html`<div class="form-actions"><button class="btn ci-big-btn" type="submit">${label}</button></div>`;
  let body;
  if (step === 'family') {
    const me = adults.find((a) => a.user_id === user.id) || {};
    const other = adults.find((a) => a.user_id !== user.id) || {};
    body = html`<form method="post" action="/checkin/welcome/family" class="stack ci-form">${csrfField(csrf)}
      <div class="field"><label for="w-fam">Family name</label><input id="w-fam" name="family_name" value="${family.name}" required><p class="hint">How your family shows up at check-in, e.g. “The Smith Family”.</p></div>
      <div class="row"><div class="field"><label for="w-addr">Street address</label><input id="w-addr" name="address" value="${family.address || ''}" autocomplete="street-address"></div></div>
      <div class="row"><div class="field"><label for="w-city">City</label><input id="w-city" name="city" value="${family.city || 'Winfield'}"></div><div class="field short"><label for="w-state">State</label><input id="w-state" name="state" value="${family.state || 'KS'}"></div><div class="field short"><label for="w-zip">ZIP</label><input id="w-zip" name="zip" value="${family.zip || ''}"></div></div>
      <h2>You</h2>
      <div class="row">
        <div class="field"><label for="w-rel">Relationship to the children</label><select id="w-rel" name="relationship">${RELATIONSHIPS.map((r) => html`<option${selected(r, me.relationship)}>${r}</option>`)}</select></div>
        <div class="field"><label for="w-phone">Mobile phone</label><input id="w-phone" name="phone" type="tel" value="${me.phone || ''}" required autocomplete="tel"></div>
      </div>
      <div class="row">
        <div class="field"><label for="w-contact">Best way to reach you</label><select id="w-contact" name="contact_method">${[['app', 'App notification and email'], ['email', 'Email'], ['phone', 'Phone call']].map(([k, l]) => html`<option value="${k}"${selected(k, me.contact_method || 'app')}>${l}</option>`)}</select></div>
        <div class="field"><label for="w-bday">Your birthday <span class="muted">(optional)</span></label><input id="w-bday" name="birthdate" type="date" value="${me.birthdate ? dateKeyOf(me.birthdate) : ''}"></div>
      </div>
      <h2>Another parent or guardian <span class="muted small">(optional)</span></h2>
      <input type="hidden" name="other_id" value="${other.id || ''}">
      <div class="row"><div class="field"><label for="w-ofirst">First name</label><input id="w-ofirst" name="other_first_name" value="${other.first_name || ''}"></div><div class="field"><label for="w-olast">Last name</label><input id="w-olast" name="other_last_name" value="${other.last_name || ''}"></div></div>
      <div class="row"><div class="field"><label for="w-orel">Relationship</label><select id="w-orel" name="other_relationship">${RELATIONSHIPS.map((r) => html`<option${selected(r, other.relationship)}>${r}</option>`)}</select></div>
        <div class="field"><label for="w-oemail">Email</label><input id="w-oemail" name="other_email" type="email" value="${other.email || ''}"></div><div class="field"><label for="w-ophone">Phone</label><input id="w-ophone" name="other_phone" type="tel" value="${other.phone || ''}"></div></div>
      <p class="hint">We'll send them their own sign-up link so they get notices too.</p>
      ${nextBtn()}</form>`;
  } else if (step === 'kids') {
    body = html`
      ${kids.length ? html`<ul class="ci-person-cards">${kids.map((k) => html`<li class="ci-person-card">${avatar(k)}<div class="ci-person-text"><span class="ci-person-name">${D.displayName(k)}</span><span class="ci-person-meta">${[D.ageLabel(k.birthdate), k.grade].filter(Boolean).join(' · ')}</span></div>
        <a class="btn btn-quiet btn-small" href="/checkin/welcome/kids?edit=${k.id}">Edit</a></li>`)}</ul>` : html`<p class="muted">No children added yet.</p>`}
      <section class="box"><h2 class="box-head">Add a child</h2><div class="box-body">
        <form method="post" action="/checkin/welcome/kids" class="stack ci-form">${csrfField(csrf)}
          <div class="row"><div class="field"><label for="k-first">First name</label><input id="k-first" name="first_name" required></div><div class="field"><label for="k-last">Last name</label><input id="k-last" name="last_name" value="${(adults[0] || {}).last_name || ''}" required></div><div class="field"><label for="k-pref">Goes by <span class="muted">(optional)</span></label><input id="k-pref" name="preferred_name"></div></div>
          <div class="row"><div class="field"><label for="k-bday">Birthday</label><input id="k-bday" name="birthdate" type="date" required></div>
            <div class="field short"><label for="k-grade">Grade</label><select id="k-grade" name="grade">${GRADES.map((g) => html`<option value="${g}">${g || '—'}</option>`)}</select></div>
            <div class="field short"><label for="k-gender">Boy or girl</label><select id="k-gender" name="gender">${['', 'Boy', 'Girl'].map((g) => html`<option value="${g}">${g || '—'}</option>`)}</select></div></div>
          <button class="btn btn-quiet" type="submit">Add child</button>
        </form></div></section>
      <form method="get" action="/checkin/welcome/health">${nextBtn(kids.length ? 'Continue' : 'Skip for now')}</form>`;
  } else if (step === 'health') {
    body = html`<form method="post" action="/checkin/welcome/health" class="stack ci-form">${csrfField(csrf)}
      ${kids.length ? kids.map((k) => html`<section class="box"><h2 class="box-head">${D.displayName(k)}</h2><div class="box-body stack">
        ${['allergies', 'medical_notes', 'medications', 'special_needs'].map((f) => html`<div class="field"><label for="h-${f}-${k.id}">${{ allergies: 'Allergies', medical_notes: 'Medical conditions', medications: 'Medications (e.g. EpiPen, inhaler)', special_needs: 'Anything else that helps us care for them' }[f]}</label>
          <textarea id="h-${f}-${k.id}" name="${f}_${k.id}" rows="2" placeholder="${f === 'allergies' ? 'Leave blank if none' : ''}">${k[f] || ''}</textarea></div>`)}
        <label class="check"><input type="checkbox" name="custody_${k.id}" value="1"${checked(k.custody_alert)}${k.custody_alert ? raw(' disabled') : ''} data-toggle="#cn-${k.id}"> There is a court order or someone who must not pick up ${k.first_name}</label>
        ${k.custody_alert ? html`<p class="hint">This alert is on file. To change or remove it, please contact the church office.</p>` : ''}
        <div id="cn-${k.id}"${k.custody_alert ? '' : raw(' hidden')} class="field"><label for="h-cn-${k.id}">Details (only ministry leaders see this)</label><textarea id="h-cn-${k.id}" name="custody_notes_${k.id}" rows="2">${k.custody_notes || ''}</textarea><p class="hint">Please also bring a copy of the court order to the children's ministry director.</p></div>
      </div></section>`) : html`<p class="muted">Add your children first.</p>`}
      ${nextBtn()}</form>`;
  } else if (step === 'contacts') {
    body = html`<form method="post" action="/checkin/welcome/contacts" class="stack ci-form">${csrfField(csrf)}
      <section class="box"><h2 class="box-head">Emergency contacts</h2><div class="box-body stack">
        <p class="small">Someone other than you we can call if we can't reach you.</p>
        ${[0, 1].map((i) => { const c = contacts[i] || {}; return html`<div class="row"><input type="hidden" name="ec_id_${i}" value="${c.id || ''}">
          <div class="field"><label for="ec-n-${i}">Name</label><input id="ec-n-${i}" name="ec_name_${i}" value="${c.name || ''}"${i === 0 ? raw(' required') : ''}></div>
          <div class="field"><label for="ec-r-${i}">Relationship</label><input id="ec-r-${i}" name="ec_rel_${i}" value="${c.relationship || ''}"></div>
          <div class="field"><label for="ec-p-${i}">Phone</label><input id="ec-p-${i}" name="ec_phone_${i}" type="tel" value="${c.phone || ''}"${i === 0 ? raw(' required') : ''}></div></div>`; })}
      </div></section>
      <section class="box"><h2 class="box-head">Who else may pick up your children</h2><div class="box-body stack">
        <p class="small">Parents listed in your family can always pick up. Add grandparents, sitters or friends you approve.</p>
        ${[0, 1, 2].map((i) => { const c = pickups.filter((x) => !x.not_allowed)[i] || {}; return html`<div class="row"><input type="hidden" name="pu_id_${i}" value="${c.id || ''}">
          <div class="field"><label for="pu-n-${i}">Name</label><input id="pu-n-${i}" name="pu_name_${i}" value="${c.name || ''}"></div>
          <div class="field"><label for="pu-r-${i}">Relationship</label><input id="pu-r-${i}" name="pu_rel_${i}" value="${c.relationship || ''}"></div>
          <div class="field"><label for="pu-p-${i}">Phone</label><input id="pu-p-${i}" name="pu_phone_${i}" type="tel" value="${c.phone || ''}"></div></div>`; })}
      </div></section>
      ${nextBtn()}</form>`;
  } else {
    const signed = D.agreementStatus(waivers, AGREEMENTS);
    const me = adults.find((a) => a.user_id === user.id) || {};
    body = html`<form method="post" action="/checkin/welcome/agreements" class="stack ci-form">${csrfField(csrf)}
      <p>Please read each form. ${kids.length ? html`These cover <strong>${kids.map((k) => k.first_name).join(', ')}</strong>.` : ''}</p>
      ${Object.entries(AGREEMENTS).map(([k, a]) => html`<section class="box ci-agreement"><h2 class="box-head">${a.title}${signed[k] ? html` <span class="badge badge-ok">Signed ${t.fmtDateYear(signed[k].signed_at)}</span>` : ''}</h2><div class="box-body">
        <div class="ci-agreement-text" tabindex="0">${a.text.split(/\n\n/).map((p) => html`<p>${p}</p>`)}</div>
        ${a.required ? html`<label class="check"><input type="checkbox" name="agree_${k}" value="1" required${checked(signed[k])}> I have read and agree</label>`
        : html`<div class="ci-choice-row"><label class="check"><input type="radio" name="agree_${k}" value="1"${checked(signed[k])}> Yes, I give permission</label><label class="check"><input type="radio" name="agree_${k}" value="0"${checked(!signed[k])}> No, thank you</label></div>`}
      </div></section>`)}
      <section class="box"><h2 class="box-head">Your signature</h2><div class="box-body stack">
        <div class="row"><div class="field"><label for="sig">Type your full legal name</label><input id="sig" name="signature" required autocomplete="name" value="${me.first_name ? `${me.first_name} ${me.last_name}` : ''}"></div>
          <div class="field"><label for="sig-rel">Relationship</label><input id="sig-rel" name="signer_relationship" value="${me.relationship || 'Parent'}" required></div></div>
        <p class="small muted">Signed ${t.fmtLong(new Date())}. We keep a record of the date, time and the exact wording you agreed to.</p>
      </div></section>
      ${nextBtn('Sign agreements')}</form>`;
  }
  return html`<div class="ci-narrow ci-wizard">
    <h1>${family.name}</h1>
    ${stepper(step)}
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    ${body}
  </div>`;
}

function familyHome({ csrf, user, full, recent, pushEnabled }) {
  const { family, adults, kids, contacts, pickups, waivers } = full;
  const signed = D.agreementStatus(waivers, AGREEMENTS);
  const missing = Object.entries(AGREEMENTS).filter(([k, a]) => a.required && !signed[k]);
  return html`<div class="ci-narrow">
    <h1>${family.name}</h1>
    ${missing.length ? html`<div class="ci-alert ci-alert-warn"><strong>Almost done:</strong> please sign the permission forms so your kids can check in. <a href="/checkin/welcome/agreements">Sign now</a></div>` : ''}
    <section class="box"><h2 class="box-head">Your family</h2><div class="box-body">
      <ul class="ci-person-cards">${[...kids, ...adults].map((k) => html`<li class="ci-person-card">${avatar(k)}<div class="ci-person-text"><span class="ci-person-name">${D.displayName(k)}</span><span class="ci-person-meta">${k.kind === 'child' ? [D.ageLabel(k.birthdate), k.grade].filter(Boolean).join(' · ') : k.relationship || 'Parent'}</span>${alertsFor(k, user, { full: true }).length ? html`<span class="ci-flags">${alertsFor(k, user, { full: true })}</span>` : ''}</div>${photoButton(k, csrf, '/checkin/family')}</li>`)}</ul>
      <p class="small muted">A photo helps volunteers recognize each child at pickup. Only the church team and your family can see it.</p>
      <p><a href="/checkin/welcome/kids">Add or edit children</a> · <a href="/checkin/welcome/health">Health & safety</a></p></div></section>
    <section class="box"><h2 class="box-head">Recent check-ins</h2><div class="box-body">
      ${recent.length ? html`<ul class="ci-mini-list">${recent.map((r) => html`<li><span>${r.first_name} · ${r.event_name}</span><span class="small muted">${t.fmtDateTime(r.checked_in_at)}${r.checked_out_at ? ` · picked up ${t.fmtTime(r.checked_out_at)}` : ''}</span></li>`)}</ul>` : html`<p class="muted">No check-ins yet.</p>`}
    </div></section>
    <section class="box"><h2 class="box-head">Notifications</h2><div class="box-body">
      <p class="small">You get an email when your children check in and are picked up${pushEnabled ? ', and a notification on this phone if you turn it on below' : ''}.</p>
      ${pushEnabled ? html`<div class="push-box" data-push><button class="btn btn-quiet btn-small" type="button" data-push-toggle hidden>Turn on notifications</button><p class="small muted" data-push-status></p></div>` : ''}
      <p class="small"><a href="/checkin/install">How to add the Central app to your phone</a></p>
    </div></section>
    <section class="box"><h2 class="box-head">Family details</h2><div class="box-body">
      <p class="small">${adults.map((a) => `${a.first_name} ${a.last_name} (${a.relationship || 'parent'})`).join(' · ')}</p>
      <p class="small">Emergency: ${contacts.map((c) => `${c.name} ${c.phone}`).join(' · ') || 'none yet'}</p>
      <p class="small">May pick up: ${pickups.filter((p) => !p.not_allowed).map((p) => p.name).join(', ') || 'parents only'}</p>
      <p><a href="/checkin/welcome/family">Edit family</a> · <a href="/checkin/welcome/contacts">Emergency & pickup</a> · <a href="/checkin/welcome/agreements">Permission forms</a></p>
    </div></section>
  </div>`;
}

function installPage() {
  return html`<div class="ci-narrow">
    <h1>Add Central to your device</h1>
    <p>The Central app is a web app: no app store needed. Once added, it opens full-screen from its own icon and can show notifications.</p>
    <section class="box"><h2 class="box-head">iPhone or iPad</h2><div class="box-body"><ol>
      <li>Open this page in <strong>Safari</strong>.</li><li>Tap the <strong>Share</strong> button (the square with an arrow).</li>
      <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li><li>Open Central from the new icon, log in, and turn on notifications.</li></ol></div></section>
    <section class="box"><h2 class="box-head">Android phone or tablet</h2><div class="box-body"><ol>
      <li>Open this page in <strong>Chrome</strong>.</li><li>Tap the <strong>⋮</strong> menu, then <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li><li>Open Central from the new icon.</li></ol></div></section>
    <section class="box"><h2 class="box-head">Windows or Mac computer (check-in station)</h2><div class="box-body"><ol>
      <li>Open this page in <strong>Chrome</strong> or <strong>Edge</strong>.</li><li>Click the <strong>install</strong> icon at the right end of the address bar, then <strong>Install</strong>.</li>
      <li>Set up the Brother QL-810W in the computer's printer settings, with the 62mm roll loaded and auto-cut on.</li>
      <li>The first time you print name tags, choose the Brother printer, paper <strong>62mm × 100mm</strong>, <strong>landscape</strong>, and margins <strong>none</strong>. Chrome remembers it.</li></ol></div></section>
    <p><a class="btn" href="/checkin">Open Central Check-In</a></p>
  </div>`;
}

module.exports = {
  layout, eventPicker, station, familyCheckin, labelsPage, printQueue, eventsPage, newFamilyFlow, newKidsFlow, guestPage, roster, scanPage, familiesPage, familyAdmin, personPage, newFamilyPage,
  invitePage, staffPage, reportsPage, policiesPage, servingMonth, servingDay, servingImport, AREAS, joinPage, wizard, familyHome, installPage, familyRow, STEPS,
};

'use strict';
// Screens for Central Check-In.
const { html, raw, selected, checked } = require('../lib/html');
const t = require('../lib/time');
const P = require('../views/parts');
const D = require('./data');
const { AGREEMENTS } = require('./agreements');
const { appSwitcher } = require('../views/layout');

const csrfField = P.csrfField;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtDateKey = (k) => t.fmtLong(t.zoned(...k.split('-').map(Number), 12));
const dateKeyOf = (d) => (d instanceof Date ? t.dateKey(d) : String(d).slice(0, 10));

// ---------------------------------------------------------------- layout
function layout({ title, user, csrf, flash = [], body, tab, event, bare = false }) {
  const staff = D.rank(user) > 0;
  const tabs = staff ? [
    ['/checkin', 'Check in', 'station', '✓'],
    ['/checkin/roster', 'Checked in', 'roster', '☰'],
    ['/checkin/scan', 'Pick up', 'scan', '▥'],
    ['/checkin/families', 'Families', 'families', '⌂'],
  ] : [];
  const more = [];
  if (D.can(user, 'leader')) more.push(['/checkin/reports', 'Reports', 'reports']);
  if (D.can(user, 'coadmin')) more.push(['/checkin/staff', 'Team', 'staff']);
  if (user) more.push(['/checkin/family', 'My family', 'family']);
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
<link rel="stylesheet" href="/css/checkin.css?v=2">
<script src="/js/app.js?v=7" defer></script>
<script src="/js/checkin.js?v=1" defer></script>
</head>
<body class="ci${bare ? ' ci-bare' : ''}">
<a class="skip" href="#main">Skip to content</a>
<header class="masthead ci-top">
  <div class="ci-top-inner">
    ${appSwitcher(user, 'checkin')}
    ${event ? html`<a class="ci-event-pill" href="/checkin?change=1" title="Change event"><span class="ci-dot"></span>${event.name} · ${t.fmtDate(t.zoned(...dateKeyOf(event.event_date).split('-').map(Number), 12))}</a>` : ''}
    <nav class="ci-nav" aria-label="Check-in">
      ${tabs.map(([href, label, key]) => html`<a href="${href}"${tab === key ? raw(' aria-current="page"') : ''}>${label}</a>`)}
      ${more.map(([href, label, key]) => html`<a class="ci-nav-more" href="${href}"${tab === key ? raw(' aria-current="page"') : ''}>${label}</a>`)}
      ${user ? html`<form method="post" action="/logout" class="inline">${csrfField(csrf)}<button class="linklike" type="submit">Log out</button></form>` : html`<a href="/login?next=/checkin">Log in</a>`}
    </nav>
  </div>
</header>
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
  if (p.allergies) out.push(html`<span class="ci-flag ci-flag-allergy" title="${p.allergies}">Allergy${full ? html`: ${p.allergies}` : ''}</span>`);
  if (p.medical_notes || p.medications) out.push(html`<span class="ci-flag ci-flag-medical" title="${[p.medical_notes, p.medications].filter(Boolean).join(' · ')}">Medical${full ? html`: ${[p.medical_notes, p.medications].filter(Boolean).join(' · ')}` : ''}</span>`);
  if (p.special_needs) out.push(html`<span class="ci-flag ci-flag-needs">${full ? html`Needs: ${p.special_needs}` : 'Special needs'}</span>`);
  if (p.custody_alert) out.push(html`<span class="ci-flag ci-flag-custody">${D.can(user, 'leader') && full && p.custody_notes ? html`Custody: ${p.custody_notes}` : 'Custody alert: get a leader'}</span>`);
  return out;
}

function avatar(p) {
  const initials = `${(p.preferred_name || p.first_name || '?')[0]}${(p.last_name || '')[0] || ''}`;
  return html`<span class="ci-avatar ci-avatar-${p.kind}" aria-hidden="true">${initials}</span>`;
}

// ---------------------------------------------------------------- station
function eventPicker({ csrf, names, suggested, current }) {
  const choices = [...new Set([suggested, 'Sunday Service', 'Wednesday Service', ...names].filter(Boolean))];
  return html`<section class="ci-card ci-event-pick">
    <h1>What are we checking in for?</h1>
    <p class="muted">${t.fmtLong(new Date())}</p>
    <form method="post" action="/checkin/event" class="ci-event-choices">
      ${csrfField(csrf)}
      ${choices.map((n) => html`<button class="ci-choice${current && current.name === n ? ' is-current' : ''}" type="submit" name="name" value="${n}">${n}${n === suggested ? html`<small>Today</small>` : ''}</button>`)}
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
      <input id="fam-q" name="q" type="search" placeholder="Family name, child's name or phone" autocomplete="off" autofocus data-family-search>
      <div class="ci-results" id="fam-results" aria-live="polite"></div>
    </form>
    <p class="ci-counts">${plural(counts.kids, 'kid')} · ${plural(counts.adults, 'adult')} checked in · <a href="/checkin/roster">See everyone</a></p>
  </section>
  <section class="ci-section">
    <div class="ci-section-head"><h2>Recent families</h2><a class="btn btn-quiet btn-small" href="/checkin/families/new">New family</a></div>
    <ul class="ci-family-list">${recent.map((f) => familyRow(f))}</ul>
  </section>`;
}

function familyRow(f) {
  return html`<li><a class="ci-family-row" href="/checkin/f/${f.id}">
    <span class="ci-family-name">${f.name}${f.status === 'new' ? html` <span class="badge badge-info">New</span>` : ''}</span>
    <span class="ci-family-members">${f.members || 'No one added yet'}</span>
    ${f.checked ? html`<span class="badge badge-ok">${f.checked} in</span>` : ''}
  </a></li>`;
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

function labelsPage({ labels, returnTo, autoPrint = true }) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Name tags</title>
<link rel="stylesheet" href="/css/labels.css?v=1">
<script src="/js/labels.js?v=1" defer></script>
</head><body data-return="${returnTo}"${autoPrint ? raw(' data-autoprint') : ''}>
<div class="no-print label-toolbar">
  <p><strong>${labels.length} label${labels.length === 1 ? '' : 's'} ready.</strong> In the print window choose the Brother QL-810W, paper <strong>62mm × 100mm</strong>, <strong>landscape</strong>, margins <strong>none</strong>.</p>
  <button type="button" data-print>Print again</button> <a href="${returnTo}">Done</a>
</div>
${labels.map((l) => (l.kind === 'child' ? html`<section class="label child-label">
  <div class="l-head"><img src="/img/logo-central-black.png" alt=""><span>${l.event} · ${l.date}</span></div>
  <div class="l-name">${l.first}</div>
  <div class="l-last">${l.last}${l.group ? html` · ${l.group}` : ''}</div>
  ${l.alert ? html`<div class="l-alert">${l.alert}</div>` : html`<div class="l-alert l-none"></div>`}
  <div class="l-foot"><div class="l-code"><small>Pickup code</small>${l.code}</div><div class="l-barcode">${raw(code128.svg(l.code, { height: 40 }))}</div></div>
</section>` : html`<section class="label parent-label">
  <div class="l-head"><img src="/img/logo-central-black.png" alt=""><span>${l.event} · ${l.date}</span></div>
  <div class="l-title">Pickup tag · keep this</div>
  <div class="l-family">${l.family}</div>
  <div class="l-kids">${l.kids}</div>
  <div class="l-foot"><div class="l-code l-code-big"><small>Code</small>${l.code}</div><div class="l-barcode">${raw(code128.svg(l.code, { height: 46 }))}</div></div>
</section>`))}
</body></html>`;
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
          ${r.kind === 'child' ? html`<a class="btn btn-quiet btn-small" href="/checkin/print?event=${event.id}&family=${r.family_id}&people=${r.person_id}&parent=0">Reprint</a>` : ''}
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
  <h1>Pick up</h1>
  <p class="muted">Scan the parent's pickup tag, or type the 4-letter code.</p>
  <div class="ci-scan">
    <div class="ci-camera" data-scanner hidden>
      <video playsinline muted></video>
      <p class="small muted" data-scanner-status>Point the camera at the barcode.</p>
    </div>
    <button type="button" class="btn btn-quiet" data-start-scan hidden>Use the camera</button>
    <form method="post" action="/checkin/scan" class="ci-code-form" data-scan-form>
      ${csrfField(csrf)}
      <input type="hidden" name="event_id" value="${event.id}">
      <label for="scan-code">Pickup code</label>
      <div class="ci-inline"><input id="scan-code" name="code" value="${code || ''}" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="e.g. 7KXM" autofocus><button class="btn" type="submit">Find</button></div>
      <p class="hint">Handheld barcode scanners work too: scan into this box.</p>
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
function familiesPage({ rows, q, user }) {
  return html`
  <div class="ci-section-head"><h1>Families</h1>
    <div class="ci-family-tools">${D.can(user, 'leader') ? html`<a class="btn btn-small" href="/checkin/families/new">New family</a> <a class="btn btn-quiet btn-small" href="/checkin/invite">Email a sign-up link</a>` : ''}</div></div>
  <form class="ci-filter" method="get" action="/checkin/families"><input type="search" name="q" value="${q || ''}" placeholder="Search families, people, phone or email"></form>
  <ul class="ci-family-list">${rows.map(familyRow)}</ul>
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
    <a class="btn btn-quiet btn-small" href="/checkin/people/${p.id}">Edit</a>
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
    <section class="box"><h2 class="box-head">Your children</h2><div class="box-body">
      <ul class="ci-person-cards">${kids.map((k) => html`<li class="ci-person-card">${avatar(k)}<div class="ci-person-text"><span class="ci-person-name">${D.displayName(k)}</span><span class="ci-person-meta">${[D.ageLabel(k.birthdate), k.grade].filter(Boolean).join(' · ')}</span>${alertsFor(k, user, { full: true }).length ? html`<span class="ci-flags">${alertsFor(k, user, { full: true })}</span>` : ''}</div></li>`)}</ul>
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
  layout, eventPicker, station, familyCheckin, labelsPage, roster, scanPage, familiesPage, familyAdmin, personPage, newFamilyPage,
  invitePage, staffPage, reportsPage, joinPage, wizard, familyHome, installPage, familyRow, STEPS,
};

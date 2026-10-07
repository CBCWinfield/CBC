'use strict';
// Membership requests: check-in admins can approve new accounts here, the same as the
// librarian can in the library admin. Approving gives a library card number.
const db = require('../db');
const security = require('../lib/security');
const { HttpError } = require('../lib/http');
const { html } = require('../lib/html');
const t = require('../lib/time');
const notify = require('../notify');
const { users, fullName } = require('../models');
const { intParam } = require('../routes/guards');
const D = require('./data');

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const SOURCE = { prayer: ['🙏', 'Prayer Wall'], family: ['👨‍👩‍👧', 'Family check-in'], library: ['📚', 'Library'] };

function page({ csrf, pending, recent }) {
  return html`
  <div class="ci-section-head"><div><h1>Membership requests</h1>
    <p class="muted">New people who applied for a membership account. You or the librarian can approve them. Approving gives them a library card number and opens the Prayer Wall and messages.</p></div></div>
  ${pending.length ? html`<div class="mr-list">${pending.map((u) => html`<article class="ci-card mr-card">
    <div class="mr-top">
      <span class="ci-avatar ci-avatar-adult" aria-hidden="true">${`${u.first_name[0] || ''}${u.last_name[0] || ''}`}</span>
      <div class="mr-who"><strong>${fullName(u)}</strong>
        <span class="small muted">Applied ${t.fmtDateTime(u.created_at)}${SOURCE[u.signup_source] ? ` · from the ${SOURCE[u.signup_source][1]}` : ''}</span></div>
      ${SOURCE[u.signup_source] ? html`<span class="badge badge-info">${SOURCE[u.signup_source][0]} ${SOURCE[u.signup_source][1]}</span>` : ''}
    </div>
    <dl class="mr-facts">
      <div><dt>Email</dt><dd><a href="mailto:${u.email}">${u.email}</a> ${u.email_verified_at ? html`<span class="badge badge-ok">✓ confirmed</span>` : html`<span class="badge badge-warn">not confirmed yet</span>`}</dd></div>
      ${u.phone ? html`<div><dt>Phone</dt><dd><a href="tel:${u.phone}">${u.phone}</a></dd></div>` : ''}
      ${u.address ? html`<div><dt>Address</dt><dd>${[u.address, u.city, [u.state, u.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</dd></div>` : ''}
      <div><dt>Privacy notice</dt><dd>${u.privacy_accepted_at ? `Agreed ${t.fmtDate(u.privacy_accepted_at)}` : '—'}</dd></div>
    </dl>
    ${u.about ? html`<p class="mr-about">“${u.about}”</p>` : ''}
    <div class="mr-actions">
      <form method="post" action="/checkin/members/${u.id}/approve" class="inline">${csrfField(csrf)}<button class="btn" type="submit">✓ Approve</button></form>
      <form method="post" action="/checkin/members/${u.id}/deny" class="inline" data-confirm="Deny ${fullName(u)}’s application? They’ll get a polite email.">${csrfField(csrf)}<button class="btn btn-quiet" type="submit">Deny</button></form>
    </div>
  </article>`)}</div>`
    : html`<div class="empty ci-card"><p><strong>You’re all caught up.</strong></p><p>New applications show up here, and you’ll get an email and app notification when someone applies.</p></div>`}
  ${recent.length ? html`<section class="ci-section"><h2>Recently decided</h2><ul class="ci-queue">${recent.map((u) => html`<li class="ci-queue-row is-done"><span class="ci-person-text">
    <span class="ci-person-name">${fullName(u)} ${u.status === 'approved' ? html`<span class="badge badge-ok">Approved · ${u.library_code || ''}</span>` : html`<span class="badge badge-muted">Denied</span>`}</span>
    <span class="ci-person-meta">${u.email}${u.approved_at ? ` · ${t.fmtDate(u.approved_at)}` : ''}</span></span></li>`)}</ul></section>` : ''}`;
}

function routes(app, { render, needRole, currentEvent }) {
  app.get('/checkin/members', needRole('coadmin'), async (req, res) => {
    req.ciEvent = await currentEvent(req);
    const pending = await db.many(`SELECT * FROM users WHERE status = 'pending' ORDER BY created_at`);
    const recent = await db.many(`SELECT id, first_name, last_name, email, status, library_code, approved_at FROM users
      WHERE status IN ('approved', 'denied') AND role = 'patron' AND checkin_role IS NULL ORDER BY COALESCE(approved_at, created_at) DESC LIMIT 10`);
    render(req, res, page({ csrf: res.locals.csrf, pending, recent }), { title: 'Membership requests', tab: 'members' });
  });

  app.post('/checkin/members/:id/approve', needRole('coadmin'), async (req, res) => {
    const u = await users.get(intParam(req.params.id));
    if (!u) throw new HttpError(404, 'That person wasn’t found.');
    if (u.status === 'approved') security.flash(req, 'ok', `${fullName(u)} is already approved.`);
    else {
      const updated = await users.approve(u);
      notify.approved(updated);
      D.audit(req.user, 'member_approve', { detail: `${u.email} -> ${updated.library_code}` });
      security.flash(req, 'ok', `Approved ${fullName(u)}. Their library card number is ${updated.library_code}, and we emailed it to them.`);
    }
    res.redirect('/checkin/members');
  });

  app.post('/checkin/members/:id/deny', needRole('coadmin'), async (req, res) => {
    const u = await db.one(`UPDATE users SET status = 'denied' WHERE id = $1 AND status = 'pending' AND role = 'patron' RETURNING *`, [intParam(req.params.id)]);
    if (u) {
      notify.denied(u);
      D.audit(req.user, 'member_deny', { detail: u.email });
      security.flash(req, 'ok', `${fullName(u)}’s application was denied.`);
    }
    res.redirect('/checkin/members');
  });
}

// ---------------------------------------------------------------- website messages
const KIND = { connect: ['✉', 'Message'], visit: ['👋', 'Planning a visit'], serve: ['🙋', 'Wants to serve'], ride: ['🚌', 'Bus ride request'], lead: ['📇', 'Contact'] };
function inquiriesPage({ csrf, rows, showAll }) {
  return html`
  <div class="ci-section-head"><div><h1>Website messages &amp; contacts</h1>
    <p class="muted">Messages, visit plans, ride requests and volunteer offers from the church website, plus contacts you import. Website messages are also emailed to the church office.</p></div>
    <div class="ci-family-tools"><a class="btn btn-quiet btn-small" href="/checkin/import/leads">⇪ Import contacts</a> <a class="btn btn-quiet btn-small" href="/checkin/inquiries${showAll ? '' : '?all=1'}">${showAll ? 'Show only new' : 'Show answered too'}</a></div></div>
  ${rows.length ? html`<div class="mr-list">${rows.map((q) => html`<article class="ci-card mr-card${q.handled_at ? ' is-done' : ''}">
    <div class="mr-top"><span class="ci-avatar ci-avatar-adult" aria-hidden="true">${(KIND[q.kind] || ['✉'])[0]}</span>
      <div class="mr-who"><strong>${q.name}</strong><span class="small muted">${(KIND[q.kind] || [, 'Message'])[1]}${q.topic && q.kind !== 'visit' ? `: ${q.topic}` : ''} · ${t.fmtDateTime(q.created_at)}</span></div>
      ${q.handled_at ? html`<span class="badge badge-ok">Answered</span>` : html`<span class="badge badge-warn">New</span>`}</div>
    <dl class="mr-facts">${q.email ? html`<div><dt>Email</dt><dd><a href="mailto:${q.email}">${q.email}</a></dd></div>` : ''}${q.phone ? html`<div><dt>Phone</dt><dd><a href="tel:${q.phone}">${q.phone}</a></dd></div>` : ''}</dl>
    ${q.message ? html`<p class="mr-about pre">${q.message}</p>` : ''}
    ${q.handled_at ? '' : html`<div class="mr-actions">${q.email ? html`<a class="btn" href="mailto:${q.email}?subject=${encodeURIComponent('Central Baptist Church')}">Reply by email</a>` : q.phone ? html`<a class="btn" href="tel:${q.phone}">Call ${q.phone}</a>` : ''}
      <form method="post" action="/checkin/inquiries/${q.id}/handled" class="inline">${csrfField(csrf)}<button class="btn btn-quiet" type="submit">Mark answered</button></form></div>`}
  </article>`)}</div>` : html`<div class="empty ci-card"><p><strong>No new messages.</strong></p><p>When someone uses the contact, plan-a-visit or serve forms on the website, it shows up here.</p></div>`}`;
}

function inquiryRoutes(app, { render, needRole, currentEvent }) {
  app.get('/checkin/inquiries', needRole('coadmin'), async (req, res) => {
    req.ciEvent = await currentEvent(req);
    const showAll = req.query.all === '1';
    const rows = await db.many(`SELECT * FROM site_inquiries ${showAll ? '' : 'WHERE handled_at IS NULL'} ORDER BY created_at DESC LIMIT 200`);
    render(req, res, inquiriesPage({ csrf: res.locals.csrf, rows, showAll }), { title: 'Website messages', tab: 'inquiries' });
  });
  app.post('/checkin/inquiries/:id/handled', needRole('coadmin'), async (req, res) => {
    await db.query('UPDATE site_inquiries SET handled_at = now(), handled_by = $2 WHERE id = $1', [intParam(req.params.id), req.user.id]);
    security.flash(req, 'ok', 'Marked as answered.');
    res.redirect('/checkin/inquiries');
  });
}

module.exports = { routes: (app, deps) => { routes(app, deps); inquiryRoutes(app, deps); } };

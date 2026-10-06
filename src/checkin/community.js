'use strict';
// Group messages from admins (with "click to confirm" replies) and the Prayer Wall.
const db = require('../db');
const security = require('../lib/security');
const { HttpError } = require('../lib/http');
const { html, raw, checked } = require('../lib/html');
const t = require('../lib/time');
const { pushTo } = require('../notify');
const { intParam, clean } = require('../routes/guards');
const D = require('./data');
const P = require('./prefs');
const social = require('./social');

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const fullName = (u) => `${u.first_name} ${u.last_name}`.trim();
const ago = (d) => {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} hr ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? '' : 's'} ago`;
  return t.fmtDateYear(d);
};

// ---------------------------------------------------------------- group messages
const BUILT_IN_TEMPLATES = [
  { title: 'Team meeting', kind: 'confirm', yes_label: 'I’ll be there', no_label: 'Can’t make it', body: 'Team meeting today at 5:30 PM in the fellowship hall. Please click to confirm you can come.' },
  { title: 'You’re serving this Sunday', kind: 'confirm', yes_label: 'Confirmed', no_label: 'I need a sub', body: 'Reminder: you’re on the serving calendar this Sunday. Please confirm, or let us know if you need someone to cover for you.' },
  { title: 'Wednesday night reminder', kind: 'confirm', yes_label: 'I’ll be there', no_label: 'Can’t make it', body: 'Reminder: you’re serving Wednesday night at 6:00 PM. Please click to confirm.' },
  { title: 'Volunteers needed', kind: 'confirm', yes_label: 'I can help', no_label: 'Not this time', body: 'We need extra help in the nursery this Sunday. Can you help?' },
  { title: 'Training reminder', kind: 'info', body: 'Please finish your required training and policy reading in the Central app (More › Training) so your check-in account unlocks.' },
  { title: 'Service cancelled', kind: 'info', body: 'Due to weather, tonight’s service and children’s activities are cancelled. Stay safe!' },
  { title: 'Update your family info', kind: 'info', body: 'Please take a minute to check your family’s allergies, emergency contacts and pickup list in the Central app (My family).' },
];

const GROUPS = [
  ['team', 'Everyone on the check-in team'],
  ['volunteers', 'Volunteers'],
  ['leaders', 'Ministry leaders'],
  ['admins', 'Admins and co-admins'],
  ['parents', 'All parents and guardians with an account'],
  ['everyone', 'Everyone with an account'],
];

async function groupMembers(group, date) {
  const sql = {
    team: `SELECT id FROM users WHERE checkin_role IS NOT NULL`,
    volunteers: `SELECT id FROM users WHERE checkin_role = 'volunteer'`,
    leaders: `SELECT id FROM users WHERE checkin_role = 'leader'`,
    admins: `SELECT id FROM users WHERE checkin_role IN ('admin', 'coadmin')`,
    parents: `SELECT DISTINCT p.user_id AS id FROM people p JOIN families f ON f.id = p.family_id AND f.status <> 'archived' WHERE p.kind = 'adult' AND p.active AND p.user_id IS NOT NULL`,
    everyone: `SELECT id FROM users WHERE status NOT IN ('denied', 'paused')`,
  }[group];
  if (sql) return (await db.many(sql)).map((r) => r.id);
  if (group === 'serving' && /^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return (await db.many(`SELECT DISTINCT x.user_id AS id FROM serve_slots x JOIN serve_services s ON s.id = x.service_id WHERE s.service_date = $1 AND x.user_id IS NOT NULL AND NOT s.cancelled`, [date])).map((r) => r.id);
  }
  return [];
}

function broadcastPage({ csrf, people, templates, groupCounts, error, v = {} }) {
  const all = [...BUILT_IN_TEMPLATES.map((x) => ({ ...x, builtIn: true })), ...templates];
  return html`
  <p class="crumb"><a href="/checkin/admin">Admin</a></p>
  <h1>Message a group</h1>
  <p class="muted">Each person gets the message in their Inbox, with an app notification. Replies come back to you privately.</p>
  ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
  <section class="ci-section"><h2>Start from a ready-made message</h2>
    <div class="ci-templates">${all.map((x) => html`<button type="button" class="ci-template" data-template="${JSON.stringify({ title: x.title, body: x.body, kind: x.kind, yes: x.yes_label || '', no: x.no_label || '' })}">
      <strong>${x.title}</strong><span>${x.kind === 'confirm' ? '✓ Click to confirm' : 'Announcement'}</span></button>
      ${x.id ? html`<form method="post" action="/checkin/broadcast/templates/${x.id}/delete" class="inline ci-template-del" data-confirm="Delete this saved message?">${csrfField(csrf)}<button class="linklike small" type="submit" aria-label="Delete saved message ${x.title}">×</button></form>` : ''}`)}</div>
  </section>
  <form method="post" action="/checkin/broadcast" class="stack ci-form ci-broadcast" data-broadcast-form>
    ${csrfField(csrf)}
    <div class="field"><label for="bc-title">Title <span class="muted">(optional)</span></label><input id="bc-title" name="title" maxlength="120" value="${v.title || ''}"></div>
    <div class="field"><label for="bc-body">Message</label><textarea id="bc-body" name="body" rows="5" maxlength="3000" required>${v.body || ''}</textarea></div>
    <fieldset class="ci-pref-group"><legend>Type</legend>
      <label class="ci-pref"><input type="radio" name="kind" value="info"${checked(v.kind !== 'confirm')}><span>Announcement (no reply needed)</span></label>
      <label class="ci-pref"><input type="radio" name="kind" value="confirm"${checked(v.kind === 'confirm')}><span>Ask people to click to confirm</span></label>
      <div class="row" data-confirm-labels><div class="field"><label for="bc-yes">Confirm button</label><input id="bc-yes" name="yes_label" maxlength="40" value="${v.yes_label || 'I’ll be there'}"></div>
        <div class="field"><label for="bc-no">Decline button</label><input id="bc-no" name="no_label" maxlength="40" value="${v.no_label || 'Can’t make it'}"></div></div>
    </fieldset>
    <fieldset class="ci-pref-group"><legend>Send to</legend>
      ${GROUPS.map(([k, l]) => html`<label class="ci-pref"><input type="checkbox" name="groups[]" value="${k}" data-count="${groupCounts[k] || 0}"><span>${l} <span class="muted">(${groupCounts[k] || 0})</span></span></label>`)}
      <label class="ci-pref"><input type="checkbox" name="groups[]" value="serving"><span>People serving on <input type="date" name="serving_date" aria-label="Serving date" class="ci-inline-date"></span></label>
      <details class="ci-pick-people"${v.people && v.people.length ? raw(' open') : ''}><summary>Choose individual people</summary>
        <input type="search" placeholder="Filter by name" data-filter-people class="ci-filter-input">
        <ul class="ci-dir ci-dir-compact">${people.map((u) => html`<li data-name="${`${u.first_name} ${u.last_name} ${u.family_name || ''}`.toLowerCase()}"><label class="ci-dir-row"><input type="checkbox" name="people[]" value="${u.id}"${checked((v.people || []).includes(u.id))}>
          <span class="ci-conv-text"><span class="ci-conv-name">${fullName(u)}${u.team ? html` <span class="badge badge-info">${u.team}</span>` : ''}</span><span class="ci-conv-last">${u.family_name || u.email}</span></span></label></li>`)}</ul>
      </details>
    </fieldset>
    <label class="check"><input type="checkbox" name="save_template" value="1"> Save this as a ready-made message for next time</label>
    <button class="btn ci-big-btn" type="submit">Send</button>
  </form>`;
}

function broadcastResults({ csrf, b, rows }) {
  const yes = rows.filter((r) => r.response === 'yes');
  const no = rows.filter((r) => r.response === 'no');
  const waiting = rows.filter((r) => !r.response);
  return html`
  <p class="crumb"><a href="/checkin/admin">Admin</a></p>
  <h1>${b.title || 'Group message'}</h1>
  <p class="muted">Sent ${t.fmtDateTime(b.created_at)} to ${rows.length} ${rows.length === 1 ? 'person' : 'people'}${b.audience ? ` (${b.audience})` : ''}.</p>
  <div class="ci-card"><p class="pre">${b.body}</p></div>
  ${b.kind === 'confirm' ? html`<div class="ci-stats">
    <div class="ci-stat"><strong>${yes.length}</strong><small>${b.yes_label || 'Confirmed'}</small></div>
    <div class="ci-stat"><strong>${no.length}</strong><small>${b.no_label || 'Declined'}</small></div>
    <div class="ci-stat"><strong>${waiting.length}</strong><small>No answer yet</small></div>
  </div>
  ${waiting.length ? html`<form method="post" action="/checkin/broadcast/${b.id}/remind" class="inline">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">Remind the ${waiting.length} who haven’t answered</button></form>` : ''}` : ''}
  <div class="table-wrap ci-section"><table class="ci-table"><thead><tr><th>Name</th><th>Answer</th><th>When</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td>${fullName(r)}</td><td>${r.response === 'yes' ? html`<span class="badge badge-ok">${b.yes_label || 'Yes'}</span>` : r.response === 'no' ? html`<span class="badge badge-muted">${b.no_label || 'No'}</span>` : b.kind === 'confirm' ? '—' : ''}</td><td>${r.responded_at ? t.fmtDateTime(r.responded_at) : ''}</td></tr>`)}
  </tbody></table></div>`;
}

// ---------------------------------------------------------------- prayer wall
function prayerCard({ csrf, user, p, comments, open }) {
  const mine = p.user_id === user.id;
  const admin = D.can(user, 'coadmin');
  const who = p.anonymous ? (admin || mine ? html`Anonymous <span class="small muted">(${p.author || 'unknown'})</span>` : 'Anonymous') : p.author || 'Someone';
  return html`<li class="ci-card ci-prayer${p.status === 'answered' ? ' is-answered' : ''}" id="prayer-${p.id}">
    <div class="ci-prayer-head"><span class="ci-avatar ci-avatar-adult" aria-hidden="true">${p.anonymous ? '🙏' : (p.author || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
      <div><strong>${who}</strong><span class="small muted"> · ${ago(p.created_at)}${p.audience === 'team' ? ' · Shared with the church team only' : ''}</span></div>
      ${p.status === 'answered' ? html`<span class="badge badge-ok">Answered prayer</span>` : ''}</div>
    <p class="ci-prayer-body pre">${p.body}</p>
    ${p.status === 'answered' && p.answered_note ? html`<p class="ci-prayer-praise"><strong>Praise report:</strong> ${p.answered_note}</p>` : ''}
    <div class="ci-prayer-actions">
      <form method="post" action="/checkin/prayer/${p.id}/pray" class="inline">${csrfField(csrf)}
        <button class="ci-pray-btn${p.i_pray ? ' is-on' : ''}" type="submit" aria-pressed="${p.i_pray ? 'true' : 'false'}"><span aria-hidden="true">🙏</span> ${p.i_pray ? 'Praying' : 'I’m praying'}</button></form>
      <span class="ci-pray-count">${p.praying ? `${p.praying} ${p.praying === 1 ? 'person is' : 'people are'} praying` : 'Be the first to pray'}</span>
      <a class="ci-comment-link" href="/checkin/prayer?open=${p.id}#prayer-${p.id}">💬 ${p.comments ? `${p.comments} comment${p.comments === 1 ? '' : 's'}` : 'Comment'}</a>
    </div>
    ${open ? html`<div class="ci-comments">
      ${comments.map((c) => html`<div class="ci-comment"><strong>${c.author || 'Someone'}</strong> <span class="small muted">${ago(c.created_at)}</span>
        ${c.user_id === user.id || admin ? html`<form method="post" action="/checkin/prayer/comments/${c.id}/delete" class="inline">${csrfField(csrf)}<button class="linklike small" type="submit">Remove</button></form>` : ''}
        <p class="pre">${c.body}</p></div>`)}
      <form method="post" action="/checkin/prayer/${p.id}/comments" class="ci-compose ci-comment-form">${csrfField(csrf)}
        <label for="cm-${p.id}" class="visually-hidden">Comment</label><textarea id="cm-${p.id}" name="body" rows="1" maxlength="1500" placeholder="Write an encouragement…" required></textarea><button class="btn btn-small" type="submit">Post</button></form>
    </div>` : ''}
    ${mine || admin ? html`<details class="ci-prayer-manage"><summary class="small">Manage</summary>
      ${mine && p.status !== 'answered' ? html`<form method="post" action="/checkin/prayer/${p.id}/answered" class="stack">${csrfField(csrf)}<label for="an-${p.id}" class="small">God answered! Share a praise report (optional)</label><input id="an-${p.id}" name="note" maxlength="600"><button class="btn btn-small" type="submit">Mark as answered</button></form>` : ''}
      <form method="post" action="/checkin/prayer/${p.id}/delete" class="inline" data-confirm="Remove this prayer request?">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">${mine ? 'Delete' : 'Hide (admin)'}</button></form>
    </details>` : ''}
  </li>`;
}

function prayerPage({ csrf, user, prayers, commentsFor, openId, filter }) {
  return html`
  <div class="ci-narrow">
    <h1>Prayer Wall</h1>
    <p class="muted">“Bear one another’s burdens, and so fulfill the law of Christ.” (Galatians 6:2) Share a request, and let others know you’re praying.</p>
    <form method="post" action="/checkin/prayer" class="ci-card stack ci-prayer-new">
      ${csrfField(csrf)}
      <label for="pr-body"><strong>Share a prayer request</strong></label>
      <textarea id="pr-body" name="body" rows="3" maxlength="2000" required placeholder="How can we pray for you?"></textarea>
      <div class="ci-prayer-opts">
        <label class="check"><input type="checkbox" name="anonymous" value="1"> Post anonymously</label>
        <label class="check"><input type="checkbox" name="team_only" value="1"> Share with the pastors and church team only</label>
      </div>
      <button class="btn" type="submit">Post request</button>
      <p class="hint">Please don’t share other people’s private details without their permission.</p>
    </form>
    <p class="ci-chips">${[['', 'All requests'], ['mine', 'My requests'], ['answered', 'Answered prayers']].map(([k, l]) => html`<a class="ci-chip${filter === k ? ' is-on' : ''}" href="/checkin/prayer${k ? `?f=${k}` : ''}">${l}</a>`)}</p>
    ${prayers.length ? html`<ul class="ci-prayers">${prayers.map((p) => prayerCard({ csrf, user, p, comments: commentsFor.get(p.id) || [], open: openId === p.id }))}</ul>` : html`<div class="empty"><p>No prayer requests here yet.</p></div>`}
  </div>`;
}

// ---------------------------------------------------------------- routes
function routes(app, { render, needLogin, needRole, currentEvent }) {
  const withEvent = async (req) => { if (D.can(req.user, 'volunteer')) req.ciEvent = await currentEvent(req); };

  // ---- Group messages (admins)
  app.get('/checkin/broadcast', needRole('coadmin'), async (req, res) => {
    await withEvent(req);
    const groupCounts = {};
    for (const [k] of GROUPS) groupCounts[k] = (await groupMembers(k)).filter((id) => id !== req.user.id).length;
    render(req, res, broadcastPage({ csrf: res.locals.csrf, people: await social.directory(req.user, '', 1000), templates: await db.many('SELECT * FROM message_templates ORDER BY title'), groupCounts }), { title: 'Message a group', tab: 'admin' });
  });

  app.post('/checkin/broadcast', needRole('coadmin'), security.rateLimit('ci-broadcast', { max: 30, windowMs: 3600000 }), async (req, res) => {
    const b = req.body;
    const v = { title: clean(b.title, 120) || null, body: clean(b.body, 3000), kind: b.kind === 'confirm' ? 'confirm' : 'info', yes_label: clean(b.yes_label, 40) || null, no_label: clean(b.no_label, 40) || null };
    const groups = [].concat(b.groups || []).filter((g) => GROUPS.some(([k]) => k === g) || g === 'serving');
    const picked = [].concat(b.people || []).map(Number).filter(Boolean);
    const ids = new Set(picked);
    for (const g of groups) for (const id of await groupMembers(g, b.serving_date)) ids.add(id);
    ids.delete(req.user.id);
    // Respect blocks: someone who blocked the sender doesn't get it.
    const blocked = new Set((await db.many('SELECT user_id FROM user_blocks WHERE blocked_id = $1', [req.user.id])).map((r) => r.user_id));
    const recipients = [...ids].filter((id) => !blocked.has(id));
    const error = !v.body ? 'Write a message.' : !recipients.length ? 'Choose at least one group or person to send to.' : null;
    if (error) {
      await withEvent(req);
      return render(req, res, broadcastPage({ csrf: res.locals.csrf, people: await social.directory(req.user, '', 1000), templates: await db.many('SELECT * FROM message_templates ORDER BY title'), groupCounts: {}, error, v: { ...v, people: picked } }), { title: 'Message a group', tab: 'admin' });
    }
    const audience = [...groups.map((g) => (g === 'serving' ? `serving ${b.serving_date}` : GROUPS.find(([k]) => k === g)[1])), picked.length ? `${picked.length} chosen` : ''].filter(Boolean).join(', ');
    const bc = await db.one(`INSERT INTO broadcasts (title, body, kind, yes_label, no_label, audience, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [v.title, v.body, v.kind, v.kind === 'confirm' ? v.yes_label : null, v.kind === 'confirm' ? v.no_label : null, audience, req.user.id]);
    for (const uid of recipients) {
      await db.query('INSERT INTO broadcast_recipients (broadcast_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [bc.id, uid]);
      const conv = await social.directConversation(req.user.id, uid);
      await social.sendMessage(conv, req.user, v.body, { broadcastId: bc.id });
    }
    if (b.save_template === '1') {
      await db.query('INSERT INTO message_templates (title, body, kind, yes_label, no_label, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [v.title || v.body.slice(0, 40), v.body, v.kind, v.yes_label, v.no_label, req.user.id]);
    }
    D.audit(req.user, 'broadcast', { detail: `${recipients.length} recipients: ${v.title || v.body.slice(0, 60)}` });
    security.flash(req, 'ok', `Sent to ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}.`);
    res.redirect(`/checkin/broadcast/${bc.id}`);
  });

  app.post('/checkin/broadcast/templates/:id/delete', needRole('coadmin'), async (req, res) => {
    await db.query('DELETE FROM message_templates WHERE id = $1', [intParam(req.params.id)]);
    res.redirect('/checkin/broadcast');
  });

  app.get('/checkin/broadcast/:id', needRole('coadmin'), async (req, res) => {
    await withEvent(req);
    const b = await db.one('SELECT * FROM broadcasts WHERE id = $1', [intParam(req.params.id)]);
    if (!b) throw new HttpError(404, 'That message was not found.');
    const rows = await db.many(`SELECT u.id, u.first_name, u.last_name, r.response, r.responded_at FROM broadcast_recipients r JOIN users u ON u.id = r.user_id
      WHERE r.broadcast_id = $1 ORDER BY r.response NULLS LAST, u.last_name, u.first_name`, [b.id]);
    render(req, res, broadcastResults({ csrf: res.locals.csrf, b, rows }), { title: 'Group message', tab: 'admin' });
  });

  app.post('/checkin/broadcast/:id/remind', needRole('coadmin'), async (req, res) => {
    const b = await db.one('SELECT * FROM broadcasts WHERE id = $1', [intParam(req.params.id)]);
    if (!b) throw new HttpError(404, 'That message was not found.');
    const waiting = await db.many('SELECT user_id FROM broadcast_recipients WHERE broadcast_id = $1 AND response IS NULL', [b.id]);
    pushTo(waiting.map((w) => w.user_id), { title: 'Please reply', body: b.title || b.body.slice(0, 120), url: '/checkin/inbox' }).catch(() => {});
    security.flash(req, 'ok', `Reminder sent to ${waiting.length}.`);
    res.redirect(`/checkin/broadcast/${b.id}`);
  });

  app.post('/checkin/broadcast/:id/respond', async (req, res) => {
    if (needLogin(req, res)) return;
    const id = intParam(req.params.id);
    const response = req.body.response === 'no' ? 'no' : 'yes';
    const row = await db.one('UPDATE broadcast_recipients SET response = $3, responded_at = now() WHERE broadcast_id = $1 AND user_id = $2 RETURNING broadcast_id', [id, req.user.id, response]);
    if (!row) throw new HttpError(404, 'That message was not found.');
    const b = await db.one('SELECT * FROM broadcasts WHERE id = $1', [id]);
    const conv = await social.directConversation(b.created_by, req.user.id);
    security.flash(req, 'ok', `Thanks! You answered “${response === 'yes' ? b.yes_label || 'Yes' : b.no_label || 'No'}”.`);
    res.redirect(`/checkin/inbox/${conv.id}`);
  });

  // ---- Prayer Wall (everyone with an account)
  const canPost = (u) => u && !['denied', 'paused'].includes(u.status);

  app.get('/checkin/prayer', async (req, res) => {
    if (needLogin(req, res)) return;
    await withEvent(req);
    const filter = ['mine', 'answered'].includes(req.query.f) ? req.query.f : '';
    const team = D.isTeam(req.user);
    const where = [`p.status <> 'hidden'`];
    const params = [req.user.id];
    if (!team) where.push(`(p.audience = 'everyone' OR p.user_id = $1)`);
    if (filter === 'mine') where.push('p.user_id = $1');
    if (filter === 'answered') where.push(`p.status = 'answered'`);
    const prayers = await db.many(`SELECT p.*, u.first_name || ' ' || u.last_name AS author,
        (SELECT count(*)::int FROM prayer_praying x WHERE x.prayer_id = p.id) AS praying,
        EXISTS (SELECT 1 FROM prayer_praying x WHERE x.prayer_id = p.id AND x.user_id = $1) AS i_pray,
        (SELECT count(*)::int FROM prayer_comments c WHERE c.prayer_id = p.id AND c.deleted_at IS NULL) AS comments
      FROM prayers p LEFT JOIN users u ON u.id = p.user_id WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT 100`, params);
    const openId = Number(req.query.open) || 0;
    const commentsFor = new Map();
    if (openId) {
      commentsFor.set(openId, await db.many(`SELECT c.*, u.first_name || ' ' || u.last_name AS author FROM prayer_comments c LEFT JOIN users u ON u.id = c.user_id
        WHERE c.prayer_id = $1 AND c.deleted_at IS NULL ORDER BY c.created_at`, [openId]));
    }
    render(req, res, prayerPage({ csrf: res.locals.csrf, user: req.user, prayers, commentsFor, openId, filter }), { title: 'Prayer Wall', tab: 'prayer' });
  });

  app.post('/checkin/prayer', security.rateLimit('ci-prayer', { max: 20, windowMs: 3600000 }), async (req, res) => {
    if (needLogin(req, res)) return;
    if (!canPost(req.user)) throw new HttpError(403, 'Your account can’t post right now.');
    const body = clean(req.body.body, 2000);
    if (!body) { security.flash(req, 'error', 'Write your prayer request.'); return res.redirect('/checkin/prayer'); }
    const p = await db.one(`INSERT INTO prayers (user_id, body, anonymous, audience) VALUES ($1, $2, $3, $4) RETURNING id`, [req.user.id, body, req.body.anonymous === '1', req.body.team_only === '1' ? 'team' : 'everyone']);
    security.flash(req, 'ok', 'Your prayer request is posted. We’re praying with you.');
    res.redirect(`/checkin/prayer#prayer-${p.id}`);
  });

  const visiblePrayer = async (req, id) => {
    const p = await db.one(`SELECT * FROM prayers WHERE id = $1 AND status <> 'hidden'`, [id]);
    if (!p || (p.audience === 'team' && !D.isTeam(req.user) && p.user_id !== req.user.id)) throw new HttpError(404, 'That prayer request was not found.');
    return p;
  };
  const notifyOwner = async (p, actor, text) => {
    if (!p.user_id || p.user_id === actor.id) return;
    const owner = await db.one('SELECT id, prefs FROM users WHERE id = $1', [p.user_id]);
    if (owner && P.of(owner).push_prayer !== false) pushTo([owner.id], { title: 'Prayer Wall', body: text, url: `/checkin/prayer?open=${p.id}#prayer-${p.id}` }).catch(() => {});
  };

  app.post('/checkin/prayer/:id/pray', async (req, res) => {
    if (needLogin(req, res)) return;
    const p = await visiblePrayer(req, intParam(req.params.id));
    const removed = await db.one('DELETE FROM prayer_praying WHERE prayer_id = $1 AND user_id = $2 RETURNING prayer_id', [p.id, req.user.id]);
    if (!removed) {
      await db.query('INSERT INTO prayer_praying (prayer_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [p.id, req.user.id]);
      notifyOwner(p, req.user, `${req.user.first_name} is praying for your request 🙏`);
    }
    if (/json/.test(req.headers.accept || '')) {
      const n = (await db.one('SELECT count(*)::int AS n FROM prayer_praying WHERE prayer_id = $1', [p.id])).n;
      return res.json({ praying: n, mine: !removed });
    }
    res.redirect(`/checkin/prayer#prayer-${p.id}`);
  });

  app.post('/checkin/prayer/:id/comments', security.rateLimit('ci-prayer-c', { max: 60, windowMs: 3600000 }), async (req, res) => {
    if (needLogin(req, res)) return;
    if (!canPost(req.user)) throw new HttpError(403, 'Your account can’t post right now.');
    const p = await visiblePrayer(req, intParam(req.params.id));
    const body = clean(req.body.body, 1500);
    if (body) {
      await db.query('INSERT INTO prayer_comments (prayer_id, user_id, body) VALUES ($1, $2, $3)', [p.id, req.user.id, body]);
      notifyOwner(p, req.user, `${req.user.first_name} commented on your prayer request: “${body.slice(0, 80)}”`);
    }
    res.redirect(`/checkin/prayer?open=${p.id}#prayer-${p.id}`);
  });

  app.post('/checkin/prayer/comments/:id/delete', async (req, res) => {
    if (needLogin(req, res)) return;
    const c = await db.one('SELECT * FROM prayer_comments WHERE id = $1', [intParam(req.params.id)]);
    if (!c || (c.user_id !== req.user.id && !D.can(req.user, 'coadmin'))) throw new HttpError(404, 'That comment was not found.');
    await db.query('UPDATE prayer_comments SET deleted_at = now() WHERE id = $1', [c.id]);
    res.redirect(`/checkin/prayer?open=${c.prayer_id}#prayer-${c.prayer_id}`);
  });

  app.post('/checkin/prayer/:id/answered', async (req, res) => {
    if (needLogin(req, res)) return;
    const p = await db.one('SELECT * FROM prayers WHERE id = $1 AND user_id = $2', [intParam(req.params.id), req.user.id]);
    if (!p) throw new HttpError(404, 'That prayer request was not found.');
    await db.query(`UPDATE prayers SET status = 'answered', answered_note = $2, updated_at = now() WHERE id = $1`, [p.id, clean(req.body.note, 600) || null]);
    const prayers = await db.many('SELECT user_id FROM prayer_praying WHERE prayer_id = $1 AND user_id <> $2', [p.id, req.user.id]);
    pushTo(prayers.map((x) => x.user_id), { title: 'Answered prayer! 🙌', body: 'A request you prayed for was answered. Praise God!', url: `/checkin/prayer#prayer-${p.id}` }).catch(() => {});
    security.flash(req, 'ok', 'Praise God! Marked as answered.');
    res.redirect(`/checkin/prayer#prayer-${p.id}`);
  });

  app.post('/checkin/prayer/:id/delete', async (req, res) => {
    if (needLogin(req, res)) return;
    const p = await db.one('SELECT * FROM prayers WHERE id = $1', [intParam(req.params.id)]);
    if (!p || (p.user_id !== req.user.id && !D.can(req.user, 'coadmin'))) throw new HttpError(404, 'That prayer request was not found.');
    if (p.user_id === req.user.id) await db.query('DELETE FROM prayers WHERE id = $1', [p.id]);
    else { await db.query(`UPDATE prayers SET status = 'hidden', updated_at = now() WHERE id = $1`, [p.id]); D.audit(req.user, 'prayer_hidden', { detail: `prayer ${p.id}` }); }
    security.flash(req, 'ok', 'Removed.');
    res.redirect('/checkin/prayer');
  });
}

module.exports = { routes, BUILT_IN_TEMPLATES, GROUPS };

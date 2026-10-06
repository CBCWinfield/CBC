'use strict';
// Inbox (messages between families, users and the church team), personal
// Settings (notifications + privacy) and the admins' Automations page.
const db = require('../db');
const security = require('../lib/security');
const { HttpError } = require('../lib/http');
const { html, raw, checked } = require('../lib/html');
const mailer = require('../lib/mailer');
const push = require('../lib/push');
const t = require('../lib/time');
const { pushTo, url } = require('../notify');
const { esc } = require('../lib/html');
const { intParam, clean } = require('../routes/guards');
const D = require('./data');
const P = require('./prefs');
const A = require('./automations');

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const fullName = (u) => `${u.first_name} ${u.last_name}`.trim();
const initials = (u) => `${(u.first_name || '?')[0]}${(u.last_name || '')[0] || ''}`.toUpperCase();
const isStaff = (u) => D.can(u, 'volunteer');
const when = (raw) => {
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const k = t.dateKey(d);
  const today = t.dateKey(new Date());
  if (k === today) return t.fmtTime(d);
  if (k === t.addDaysKey(today, -1)) return `Yesterday ${t.fmtTime(d)}`;
  return `${t.fmtDate(d)} ${t.fmtTime(d)}`;
};

// ---------------------------------------------------------------- data
const unreadCount = async (userId) => (await db.one(
  `SELECT count(*)::int AS n FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1 AND cm.left_at IS NULL
   WHERE m.deleted_at IS NULL AND m.user_id IS DISTINCT FROM $1 AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at - interval '1 second')`, [userId])).n;

const blockedEither = async (a, b) => Boolean(await db.one('SELECT 1 AS x FROM user_blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1) LIMIT 1', [a, b]));

// Can `me` start a conversation with `them`?
function canReach(me, them) {
  if (!them || them.id === me.id || ['denied', 'paused'].includes(them.status)) return false;
  if (isStaff(me)) return true;
  const p = P.of(them);
  if (!isStaff(them) && !p.directory) return false;
  if (p.messages_from === 'team') return false;
  return true;
}

// People `me` may message, optionally filtered by a search.
async function directory(me, q = '', limit = 40) {
  const term = String(q || '').trim();
  const rows = await db.many(`SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.status, u.checkin_role, u.prefs,
      (SELECT string_agg(DISTINCT k.first_name, ', ') FROM people a JOIN people k ON k.family_id = a.family_id AND k.kind = 'child' AND k.active WHERE a.user_id = u.id AND a.active) AS kids,
      (SELECT f.name FROM people a JOIN families f ON f.id = a.family_id WHERE a.user_id = u.id AND a.active LIMIT 1) AS family_name
    FROM users u
    WHERE u.id <> $1 AND u.status NOT IN ('denied', 'paused')
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.user_id = $1 AND b.blocked_id = u.id) OR (b.user_id = u.id AND b.blocked_id = $1))
      ${term ? `AND ((u.first_name || ' ' || u.last_name) ILIKE $2 OR u.last_name ILIKE $2 OR EXISTS (SELECT 1 FROM people a JOIN families f ON f.id = a.family_id WHERE a.user_id = u.id AND f.name ILIKE $2))` : ''}
    ORDER BY (u.checkin_role IS NOT NULL) DESC, u.last_name, u.first_name LIMIT 400`, term ? [me.id, `%${term}%`] : [me.id]);
  return rows.filter((u) => canReach(me, u)).slice(0, limit).map((u) => {
    const p = P.of(u);
    const showAll = isStaff(me);
    return {
      ...u,
      shownPhone: (showAll || p.show_phone) ? u.phone : null,
      shownEmail: (showAll || p.show_email) ? u.email : null,
      shownKids: (showAll || p.show_kids) ? u.kids : null,
      team: u.checkin_role ? D.ROLE_LABEL[u.checkin_role] : null,
    };
  });
}

async function conversationsFor(userId) {
  return db.many(`SELECT c.*, cm.muted, cm.last_read_at,
      (SELECT string_agg(u.first_name || ' ' || u.last_name, ', ' ORDER BY u.first_name) FROM conversation_members o JOIN users u ON u.id = o.user_id
        WHERE o.conversation_id = c.id AND o.user_id <> $1 AND o.left_at IS NULL) AS others,
      (SELECT json_build_object('body', m.body, 'at', m.created_at, 'by', m.user_id, 'name', u.first_name) FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1) AS last,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.user_id IS DISTINCT FROM $1
        AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at - interval '1 second')) AS unread
    FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1 AND cm.left_at IS NULL
    ORDER BY c.last_message_at DESC LIMIT 200`, [userId]);
}

async function conversationFor(req, id, { allowReview = true } = {}) {
  const c = await db.one('SELECT * FROM conversations WHERE id = $1', [id]);
  if (!c) throw new HttpError(404, 'That conversation was not found.');
  const me = await db.one('SELECT * FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL', [id, req.user.id]);
  const reviewing = !me && allowReview && D.can(req.user, 'coadmin');
  if (!me && !reviewing) throw new HttpError(404, 'That conversation was not found.');
  const members = await db.many(`SELECT u.id, u.first_name, u.last_name, u.checkin_role, cm.left_at FROM conversation_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = $1 ORDER BY u.first_name`, [id]);
  return { c, me, reviewing, members };
}

const messagesSQL = `SELECT m.id, m.user_id, m.body, m.created_at, m.deleted_at, u.first_name, u.last_name, u.checkin_role
  FROM messages m LEFT JOIN users u ON u.id = m.user_id`;

const messageJSON = (m, meId) => ({
  id: m.id, mine: m.user_id === meId, name: m.user_id ? fullName(m) : 'Someone', initials: m.user_id ? initials(m) : '?',
  team: m.checkin_role ? D.ROLE_LABEL[m.checkin_role] : null, body: m.deleted_at ? null : m.body, at: when(m.created_at),
});

// Tell the other members: app notification, and an email if they haven't read it (at most every 30 minutes).
async function notifyMembers(conversation, sender, body) {
  try {
    const others = await db.many(`SELECT u.*, cm.muted, cm.last_read_at, cm.last_emailed_at FROM conversation_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = $1 AND cm.user_id <> $2 AND cm.left_at IS NULL AND NOT cm.muted`, [conversation.id, sender.id]);
    const title = conversation.is_group && conversation.title ? `${sender.first_name} in ${conversation.title}` : `Message from ${fullName(sender)}`;
    const snippet = body.length > 140 ? `${body.slice(0, 137)}…` : body;
    await pushTo(others.filter((u) => P.of(u).push_messages !== false).map((u) => u.id), { title, body: snippet, url: `/checkin/inbox/${conversation.id}` });
    if (!(await A.enabled('message_email'))) return;
    for (const u of others) {
      if (!P.wants(u, 'email_messages') || !u.email) continue;
      if (u.last_emailed_at && Date.now() - new Date(u.last_emailed_at).getTime() < 30 * 60000) continue;
      await db.query('UPDATE conversation_members SET last_emailed_at = now() WHERE conversation_id = $1 AND user_id = $2', [conversation.id, u.id]);
      await mailer.send({
        to: u.email,
        libraryName: A.CHURCH.name,
        footer: A.FOOTER,
        subject: title,
        heading: title,
        paragraphs: [`<em>“${esc(snippet)}”</em>`, 'Open your inbox to read and reply. You can turn these emails off in Settings.'],
        button: { label: 'Open my inbox', url: url(`/checkin/inbox/${conversation.id}`) },
      });
    }
  } catch (err) { console.error('Message notice failed:', err.message); }
}

async function sendMessage(conversation, sender, body) {
  const m = await db.one('INSERT INTO messages (conversation_id, user_id, body) VALUES ($1, $2, $3) RETURNING *', [conversation.id, sender.id, body]);
  await db.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [conversation.id]);
  await db.query('UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2', [conversation.id, sender.id]);
  notifyMembers(conversation, sender, body);
  return m;
}

// ---------------------------------------------------------------- views
function avatar(u, cls = '') {
  return html`<span class="ci-avatar ci-avatar-adult ${cls}" aria-hidden="true">${initials(u)}</span>`;
}

function inboxPage({ user, convs, openReports }) {
  return html`
  <div class="ci-section-head"><div><h1>Inbox</h1><p class="muted">Messages with families, friends and the church team.</p></div>
    <div class="ci-family-tools">
      ${D.can(user, 'coadmin') ? html`<a class="btn btn-quiet btn-small" href="/checkin/inbox/review">Review${openReports ? html` <span class="ci-unread">${openReports}</span>` : ''}</a>` : ''}
      <a class="btn btn-quiet btn-small" href="/checkin/settings#privacy">Privacy</a>
      <a class="btn btn-small" href="/checkin/inbox/new">New message</a>
    </div></div>
  ${convs.length ? html`<ul class="ci-convs">${convs.map((c) => html`<li><a class="ci-conv${c.unread ? ' is-unread' : ''}" href="/checkin/inbox/${c.id}">
    <span class="ci-avatar ci-avatar-adult" aria-hidden="true">${c.is_group ? '👥' : (c.others || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
    <span class="ci-conv-text">
      <span class="ci-conv-name">${c.is_group && c.title ? c.title : c.others || 'Just you'}${c.muted ? html` <span class="badge badge-muted">Muted</span>` : ''}</span>
      <span class="ci-conv-last">${c.last ? `${c.last.by === user.id ? 'You' : c.last.name || 'Someone'}: ${c.last.body}` : 'No messages yet'}</span>
    </span>
    <span class="ci-conv-meta">${c.last ? when(c.last.at) : ''}${c.unread ? html`<span class="ci-unread">${c.unread}</span>` : ''}</span>
  </a></li>`)}</ul>` : html`<div class="empty ci-card"><p><strong>No messages yet.</strong></p><p>Start a conversation with another family or someone on the church team.</p><p><a class="btn" href="/checkin/inbox/new">New message</a></p></div>`}`;
}

function newMessagePage({ csrf, people, q, to = [], error, body = '' }) {
  return html`
  <p class="crumb"><a href="/checkin/inbox">Inbox</a></p>
  <h1>New message</h1>
  ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
  <form method="get" action="/checkin/inbox/new" class="ci-filter"><input type="search" name="q" value="${q || ''}" placeholder="Search people or families" autofocus></form>
  <form method="post" action="/checkin/inbox/new" class="ci-new-msg">
    ${csrfField(csrf)}
    <fieldset class="ci-people-pick"><legend class="small muted">Choose one person, or several for a group</legend>
    ${people.length ? html`<ul class="ci-dir">${people.map((u) => html`<li><label class="ci-dir-row">
      <input type="checkbox" name="to[]" value="${u.id}"${checked(to.includes(u.id))}>
      ${avatar(u)}
      <span class="ci-conv-text"><span class="ci-conv-name">${fullName(u)}${u.team ? html` <span class="badge badge-info">${u.team}</span>` : ''}</span>
      <span class="ci-conv-last">${[u.family_name, u.shownKids ? `Kids: ${u.shownKids}` : '', u.shownPhone, u.shownEmail].filter(Boolean).join(' · ')}</span></span>
    </label></li>`)}</ul>` : html`<p class="muted">No one found${q ? ` for “${q}”` : ''}. People who turned off the directory in their privacy settings don’t show here.</p>`}
    </fieldset>
    <div class="field"><label for="g-title">Group name <span class="muted">(only for 3 or more people)</span></label><input id="g-title" name="title" maxlength="80" placeholder="e.g. Nursery volunteers, Small group"></div>
    <div class="field"><label for="m-body">Message</label><textarea id="m-body" name="body" rows="4" maxlength="4000" required>${body}</textarea></div>
    <button class="btn" type="submit">Send</button>
  </form>`;
}

function threadPage({ csrf, user, c, me, reviewing, members, messages, reportedIds }) {
  const others = members.filter((m) => m.id !== user.id && !m.left_at);
  const name = c.is_group && c.title ? c.title : others.map(fullName).join(', ') || 'Conversation';
  const direct = !c.is_group && others.length === 1 ? others[0] : null;
  return html`
  <p class="crumb"><a href="/checkin/inbox">${reviewing ? 'Inbox' : 'Inbox'}</a>${reviewing ? html` · <a href="/checkin/inbox/review">Review</a>` : ''}</p>
  <div class="ci-thread-head">
    <div><h1>${name}</h1><p class="muted small">${members.filter((m) => !m.left_at).map((m) => fullName(m) + (m.checkin_role ? ` (${D.ROLE_LABEL[m.checkin_role]})` : '')).join(', ')}</p></div>
    ${me ? html`<div class="ci-family-tools">
      <form method="post" action="/checkin/inbox/${c.id}/mute" class="inline">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">${me.muted ? 'Unmute' : 'Mute'}</button></form>
      ${direct ? html`<form method="post" action="/checkin/users/${direct.id}/block" class="inline" data-confirm="Block ${fullName(direct)}? They won’t be able to message you, and you won’t see each other in the directory.">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">Block</button></form>` : ''}
      <form method="post" action="/checkin/inbox/${c.id}/leave" class="inline" data-confirm="Leave this conversation?">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">Leave</button></form>
    </div>` : ''}
  </div>
  ${reviewing ? html`<div class="ci-alert ci-alert-warn">You’re reviewing this conversation as a church admin. Members aren’t notified, and you can’t post here.</div>` : ''}
  <div class="ci-thread" id="ci-thread" data-thread="${c.id}" data-last="${messages.length ? messages[messages.length - 1].id : 0}" data-me="${user.id}">
    ${messages.length ? '' : html`<p class="muted ci-thread-empty">No messages yet. Say hello!</p>`}
    ${messages.map((m) => {
      const j = messageJSON(m, user.id);
      return html`<div class="ci-msg${j.mine ? ' is-mine' : ''}" data-msg="${m.id}">
        ${j.mine ? '' : html`<span class="ci-msg-who">${j.name}${j.team ? html` <span class="badge badge-info">${j.team}</span>` : ''}</span>`}
        <div class="ci-bubble">${j.body == null ? html`<em class="muted">Message removed</em>` : j.body}</div>
        <span class="ci-msg-meta">${j.at}
          ${j.body != null && (j.mine || D.can(user, 'coadmin')) ? html` · <form method="post" action="/checkin/inbox/messages/${m.id}/delete" class="inline" data-confirm="Remove this message?">${csrfField(csrf)}<button class="linklike" type="submit">Remove</button></form>` : ''}
          ${j.body != null && !j.mine && me ? (reportedIds.has(m.id) ? ' · Reported' : html` · <form method="post" action="/checkin/inbox/messages/${m.id}/report" class="inline" data-confirm="Report this message to the church admins?">${csrfField(csrf)}<button class="linklike" type="submit">Report</button></form>`) : ''}
        </span>
      </div>`;
    })}
  </div>
  ${me ? html`<form method="post" action="/checkin/inbox/${c.id}" class="ci-compose" data-compose>
    ${csrfField(csrf)}
    <label for="ci-msg-body" class="visually-hidden">Message</label>
    <textarea id="ci-msg-body" name="body" rows="1" maxlength="4000" placeholder="Write a message…" required></textarea>
    <button class="btn" type="submit">Send</button>
  </form>` : ''}`;
}

function reviewPage({ csrf, convs, reports }) {
  return html`
  <p class="crumb"><a href="/checkin/inbox">Inbox</a></p>
  <h1>Review conversations</h1>
  <p class="muted">For pastoral oversight and safety. Church admins can read any conversation here; members can see this explained on their Settings page.</p>
  <section class="ci-section"><h2>Reported messages <span class="muted">${reports.length}</span></h2>
    ${reports.length ? html`<ul class="ci-queue">${reports.map((r) => html`<li class="ci-queue-row">
      <div class="ci-person-text"><span class="ci-person-name">${r.author || 'Someone'}: “${r.body}”</span><span class="ci-person-meta">Reported by ${r.reporter || 'someone'} · ${when(r.created_at)}</span></div>
      <div class="ci-row-actions"><a class="btn btn-quiet btn-small" href="/checkin/inbox/${r.conversation_id}">Open</a>
      <form method="post" action="/checkin/inbox/reports/${r.id}/resolve" class="inline">${csrfField(csrf)}<button class="btn btn-small" type="submit">Mark handled</button></form></div>
    </li>`)}</ul>` : html`<p class="muted">Nothing reported.</p>`}
  </section>
  <section class="ci-section"><h2>Recent conversations</h2>
    <ul class="ci-convs">${convs.map((c) => html`<li><a class="ci-conv" href="/checkin/inbox/${c.id}">
      <span class="ci-conv-text"><span class="ci-conv-name">${c.is_group && c.title ? c.title : c.members}</span><span class="ci-conv-last">${c.members} · ${c.count} message${c.count === 1 ? '' : 's'}</span></span>
      <span class="ci-conv-meta">${when(c.last_message_at)}</span></a></li>`)}</ul>
  </section>`;
}

function settingsPage({ csrf, user, prefs, blocked, pushEnabled }) {
  const groups = [...new Set(P.NOTIFY.map((n) => n.group))];
  return html`
  <h1>Settings</h1>
  <form method="post" action="/checkin/settings" class="ci-settings">
    ${csrfField(csrf)}
    <section class="ci-card"><h2>Notifications</h2>
      <p class="muted small">Choose how we let you know about things. Emails go to ${user.email}.</p>
      ${pushEnabled ? html`<div class="push-box" data-push><button class="btn btn-quiet btn-small" type="button" data-push-toggle hidden>Turn on notifications on this device</button><p class="small muted" data-push-status></p></div>` : ''}
      ${groups.map((g) => html`<fieldset class="ci-pref-group"><legend>${g}</legend>
        ${P.NOTIFY.filter((n) => n.group === g).map((n) => html`<label class="ci-pref"><input type="checkbox" name="${n.key}" value="1"${checked(prefs[n.key])}><span>${n.label}</span></label>`)}
      </fieldset>`)}
      <p class="small muted">Password resets and important safety notices are always sent.</p>
    </section>
    <section class="ci-card" id="privacy"><h2>Privacy</h2>
      ${P.PRIVACY.map((n) => html`<label class="ci-pref"><input type="checkbox" name="${n.key}" value="1"${checked(prefs[n.key])}><span>${n.label}</span></label>`)}
      <fieldset class="ci-pref-group"><legend>Who can start a conversation with me</legend>
        ${P.MESSAGES_FROM.map(([k, label]) => html`<label class="ci-pref"><input type="radio" name="messages_from" value="${k}"${checked(prefs.messages_from === k)}><span>${label}</span></label>`)}
      </fieldset>
      <p class="small muted">Your children’s details (allergies, medical notes, pickup list) are never shown to other families. The church team can always reach you, and church admins may review conversations to keep everyone safe.</p>
    </section>
    <div class="ci-sticky-actions"><button class="btn ci-big-btn" type="submit">Save settings</button></div>
  </form>
  <section class="ci-card ci-section"><h2>Blocked people</h2>
    ${blocked.length ? html`<ul class="ci-queue">${blocked.map((b) => html`<li class="ci-queue-row"><span class="ci-person-name">${fullName(b)}</span>
      <form method="post" action="/checkin/users/${b.id}/unblock" class="inline">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">Unblock</button></form></li>`)}</ul>` : html`<p class="muted">You haven’t blocked anyone. You can block someone from a conversation.</p>`}
  </section>
  <section class="ci-card ci-section"><h2>Your account</h2>
    <p>${fullName(user)} · ${user.email}</p>
    <p><a class="btn btn-quiet btn-small" href="/my">Update name, phone or password</a> <a class="btn btn-quiet btn-small" href="/checkin/family">My family</a> <a class="btn btn-quiet btn-small" href="/checkin/install">Get the app</a></p>
  </section>`;
}

function automationsPage({ csrf, list, log }) {
  return html`
  <h1>Automations</h1>
  <p class="muted">Emails the app sends by itself. Turn each one on or off, and reword the ones with a message. Every email ends with the church’s address, phone and email. People can still opt out of their own notices in Settings.</p>
  ${list.map((a) => html`<form method="post" action="/checkin/automations/${a.key}" class="ci-card ci-auto${a.enabled ? ' is-on' : ''}">
    ${csrfField(csrf)}
    <div class="ci-auto-head">
      <label class="ci-switch"><input type="checkbox" name="enabled" value="1"${checked(a.enabled)}><span><strong>${a.title}</strong><br><span class="small muted">${a.when}</span></span></label>
      <span class="badge ${a.enabled ? 'badge-ok' : 'badge-muted'}">${a.enabled ? 'On' : 'Off'}</span>
    </div>
    ${a.editable ? html`<details class="ci-auto-edit"${a.key === 'welcome_signup' ? raw(' open') : ''}><summary>Edit the email${a.customized ? ' (customized)' : ''}</summary>
      <div class="field"><label for="s-${a.key}">Subject</label><input id="s-${a.key}" name="subject" value="${a.subject}" maxlength="200"></div>
      <div class="field"><label for="b-${a.key}">Message</label><textarea id="b-${a.key}" name="body" rows="9" maxlength="5000">${a.body}</textarea>
        <p class="hint">You can use ${a.placeholders.map((p) => `{${p}}`).join(', ')}. Leave a blank line between paragraphs.${a.key === 'welcome_signup' ? ' A button linking to their account and the church’s contact details are added for you.' : ''}</p></div>
    </details>` : ''}
    <div class="ci-auto-actions">
      <button class="btn btn-small" type="submit">Save</button>
      ${a.editable ? html`<button class="btn btn-quiet btn-small" type="submit" name="action" value="test">Send me a test</button>` : ''}
      ${a.customized ? html`<button class="btn btn-quiet btn-small" type="submit" name="action" value="reset">Reset to the original wording</button>` : ''}
    </div>
  </form>`)}
  <section class="ci-section"><h2>Recently sent</h2>
    ${log.length ? html`<ul class="ci-queue">${log.map((l) => html`<li class="ci-queue-row is-done"><span class="ci-person-text"><span class="ci-person-name">${(A.DEFS.find((d) => d.key === l.key) || { title: l.key }).title}</span><span class="ci-person-meta">${l.email || ''} · ${when(l.sent_at)}</span></span></li>`)}</ul>` : html`<p class="muted">Nothing sent yet.</p>`}
  </section>`;
}

// ---------------------------------------------------------------- routes
function routes(app, { render, needLogin, needRole, currentEvent }) {
  const withEvent = async (req) => { if (isStaff(req.user)) req.ciEvent = await currentEvent(req); };

  app.get('/checkin/inbox', async (req, res) => {
    if (needLogin(req, res)) return;
    await withEvent(req);
    const convs = await conversationsFor(req.user.id);
    const openReports = D.can(req.user, 'coadmin') ? (await db.one('SELECT count(*)::int AS n FROM message_reports WHERE resolved_at IS NULL')).n : 0;
    render(req, res, inboxPage({ user: req.user, convs, openReports }), { title: 'Inbox', tab: 'inbox' });
  });

  app.get('/checkin/inbox/new', async (req, res) => {
    if (needLogin(req, res)) return;
    await withEvent(req);
    const q = clean(req.query.q, 80);
    const to = [].concat(req.query.to || []).map(Number).filter(Boolean);
    const people = await directory(req.user, q);
    // Keep a person passed in ?to= at the top even when the search doesn't match them.
    for (const id of to) if (!people.some((p) => p.id === id)) { const extra = (await directory(req.user, '', 400)).find((p) => p.id === id); if (extra) people.unshift(extra); }
    render(req, res, newMessagePage({ csrf: res.locals.csrf, people, q, to }), { title: 'New message', tab: 'inbox' });
  });

  app.post('/checkin/inbox/new', security.rateLimit('ci-msg-new', { max: 30, windowMs: 3600000 }), async (req, res) => {
    if (needLogin(req, res)) return;
    const ids = [...new Set([].concat(req.body.to || []).map(Number).filter(Boolean))].slice(0, 50);
    const body = clean(req.body.body, 4000);
    const reachable = (await directory(req.user, '', 1000)).filter((u) => ids.includes(u.id));
    const error = !reachable.length ? 'Choose who to send it to.' : !body ? 'Write a message.' : null;
    if (error) {
      await withEvent(req);
      return render(req, res, newMessagePage({ csrf: res.locals.csrf, people: await directory(req.user, ''), to: ids, error, body }), { title: 'New message', tab: 'inbox' });
    }
    let conv = null;
    if (reachable.length === 1) {
      conv = await db.one(`SELECT c.* FROM conversations c WHERE NOT c.is_group
        AND EXISTS (SELECT 1 FROM conversation_members a WHERE a.conversation_id = c.id AND a.user_id = $1)
        AND EXISTS (SELECT 1 FROM conversation_members b WHERE b.conversation_id = c.id AND b.user_id = $2) LIMIT 1`, [req.user.id, reachable[0].id]);
      if (conv) await db.query('UPDATE conversation_members SET left_at = NULL WHERE conversation_id = $1', [conv.id]);
    }
    if (!conv) {
      conv = await db.tx(async (c) => {
        const row = await c.one('INSERT INTO conversations (title, is_group, created_by) VALUES ($1, $2, $3) RETURNING *',
          [reachable.length > 1 ? clean(req.body.title, 80) || null : null, reachable.length > 1, req.user.id]);
        for (const uid of [req.user.id, ...reachable.map((u) => u.id)]) await c.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row.id, uid]);
        return row;
      });
    }
    await sendMessage(conv, req.user, body);
    res.redirect(`/checkin/inbox/${conv.id}`);
  });

  app.get('/checkin/inbox/review', needRole('coadmin'), async (req, res) => {
    await withEvent(req);
    const reports = await db.many(`SELECT r.*, m.body, m.conversation_id, a.first_name || ' ' || a.last_name AS author, b.first_name || ' ' || b.last_name AS reporter
      FROM message_reports r JOIN messages m ON m.id = r.message_id LEFT JOIN users a ON a.id = m.user_id LEFT JOIN users b ON b.id = r.user_id
      WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC`);
    const convs = await db.many(`SELECT c.*, (SELECT string_agg(u.first_name || ' ' || u.last_name, ', ' ORDER BY u.first_name) FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = c.id) AS members,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS count FROM conversations c ORDER BY c.last_message_at DESC LIMIT 100`);
    render(req, res, reviewPage({ csrf: res.locals.csrf, convs, reports }), { title: 'Review conversations', tab: 'inbox' });
  });

  app.post('/checkin/inbox/reports/:id/resolve', needRole('coadmin'), async (req, res) => {
    await db.query('UPDATE message_reports SET resolved_at = now(), resolved_by = $2 WHERE id = $1', [intParam(req.params.id), req.user.id]);
    security.flash(req, 'ok', 'Marked as handled.');
    res.redirect('/checkin/inbox/review');
  });

  app.get('/checkin/inbox/:id', async (req, res) => {
    if (needLogin(req, res)) return;
    await withEvent(req);
    const ctx = await conversationFor(req, intParam(req.params.id));
    const messages = (await db.many(`${messagesSQL} WHERE m.conversation_id = $1 ORDER BY m.id DESC LIMIT 300`, [ctx.c.id])).reverse();
    const reportedIds = new Set((await db.many('SELECT message_id FROM message_reports WHERE user_id = $1', [req.user.id])).map((r) => r.message_id));
    if (ctx.me) {
      await db.query('UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2', [ctx.c.id, req.user.id]);
      req.ciUnread = await unreadCount(req.user.id);
    } else {
      D.audit(req.user, 'review_conversation', { detail: `conversation ${ctx.c.id}` });
    }
    render(req, res, threadPage({ csrf: res.locals.csrf, user: req.user, ...ctx, messages, reportedIds }), { title: 'Inbox', tab: 'inbox' });
  });

  // New messages since `after` (the thread page checks every few seconds).
  app.get('/checkin/api/inbox/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.user) return res.json({ messages: [] });
    const ctx = await conversationFor(req, intParam(req.params.id));
    const rows = await db.many(`${messagesSQL} WHERE m.conversation_id = $1 AND m.id > $2 ORDER BY m.id LIMIT 100`, [ctx.c.id, Number(req.query.after) || 0]);
    if (ctx.me && rows.length) await db.query('UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2', [ctx.c.id, req.user.id]);
    res.json({ messages: rows.map((m) => messageJSON(m, req.user.id)), unread: await unreadCount(req.user.id) });
  });

  app.get('/checkin/api/unread', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ unread: req.user ? await unreadCount(req.user.id) : 0 });
  });

  app.post('/checkin/inbox/:id', security.rateLimit('ci-msg', { max: 120, windowMs: 600000 }), async (req, res) => {
    if (needLogin(req, res)) return;
    const ctx = await conversationFor(req, intParam(req.params.id), { allowReview: false });
    const body = clean(req.body.body, 4000);
    const others = ctx.members.filter((m) => m.id !== req.user.id && !m.left_at);
    if (!ctx.c.is_group && others.length === 1 && await blockedEither(req.user.id, others[0].id)) {
      if (/json/.test(req.headers.accept || '')) return res.status(403).json({ error: 'You can’t message this person.' });
      security.flash(req, 'error', 'You can’t message this person.');
      return res.redirect(`/checkin/inbox/${ctx.c.id}`);
    }
    if (!body) return res.redirect(`/checkin/inbox/${ctx.c.id}`);
    const m = await sendMessage(ctx.c, req.user, body);
    if (/json/.test(req.headers.accept || '')) {
      const row = await db.one(`${messagesSQL} WHERE m.id = $1`, [m.id]);
      return res.json({ message: messageJSON(row, req.user.id) });
    }
    res.redirect(`/checkin/inbox/${ctx.c.id}`);
  });

  app.post('/checkin/inbox/:id/mute', async (req, res) => {
    if (needLogin(req, res)) return;
    await db.query('UPDATE conversation_members SET muted = NOT muted WHERE conversation_id = $1 AND user_id = $2', [intParam(req.params.id), req.user.id]);
    res.redirect(`/checkin/inbox/${intParam(req.params.id)}`);
  });

  app.post('/checkin/inbox/:id/leave', async (req, res) => {
    if (needLogin(req, res)) return;
    await db.query('UPDATE conversation_members SET left_at = now() WHERE conversation_id = $1 AND user_id = $2', [intParam(req.params.id), req.user.id]);
    security.flash(req, 'ok', 'You left the conversation.');
    res.redirect('/checkin/inbox');
  });

  app.post('/checkin/inbox/messages/:id/delete', async (req, res) => {
    if (needLogin(req, res)) return;
    const m = await db.one('SELECT * FROM messages WHERE id = $1', [intParam(req.params.id)]);
    if (!m) throw new HttpError(404, 'That message was not found.');
    if (m.user_id !== req.user.id && !D.can(req.user, 'coadmin')) throw new HttpError(403, 'You can only remove your own messages.');
    await db.query('UPDATE messages SET deleted_at = now() WHERE id = $1', [m.id]);
    if (m.user_id !== req.user.id) D.audit(req.user, 'remove_message', { detail: `message ${m.id}` });
    res.redirect(`/checkin/inbox/${m.conversation_id}`);
  });

  app.post('/checkin/inbox/messages/:id/report', async (req, res) => {
    if (needLogin(req, res)) return;
    const m = await db.one(`SELECT m.* FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $2 WHERE m.id = $1`, [intParam(req.params.id), req.user.id]);
    if (!m) throw new HttpError(404, 'That message was not found.');
    await db.query('INSERT INTO message_reports (message_id, user_id, reason) VALUES ($1, $2, $3)', [m.id, req.user.id, clean(req.body.reason, 300) || null]);
    const admins = await db.many(`SELECT id FROM users WHERE checkin_role IN ('admin', 'coadmin')`);
    pushTo(admins.map((a) => a.id), { title: 'A message was reported', body: 'Open Inbox › Review to look at it.', url: '/checkin/inbox/review' }).catch(() => {});
    security.flash(req, 'ok', 'Thanks. The church admins will take a look.');
    res.redirect(`/checkin/inbox/${m.conversation_id}`);
  });

  app.post('/checkin/users/:id/block', async (req, res) => {
    if (needLogin(req, res)) return;
    const id = intParam(req.params.id);
    if (id !== req.user.id) await db.query('INSERT INTO user_blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, id]);
    security.flash(req, 'ok', 'Blocked. You can unblock them in Settings.');
    res.redirect('/checkin/inbox');
  });

  app.post('/checkin/users/:id/unblock', async (req, res) => {
    if (needLogin(req, res)) return;
    await db.query('DELETE FROM user_blocks WHERE user_id = $1 AND blocked_id = $2', [req.user.id, intParam(req.params.id)]);
    security.flash(req, 'ok', 'Unblocked.');
    res.redirect('/checkin/settings');
  });

  // ---- Settings (everyone)
  app.get('/checkin/settings', async (req, res) => {
    if (needLogin(req, res)) return;
    await withEvent(req);
    const blocked = await db.many('SELECT u.id, u.first_name, u.last_name FROM user_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = $1 ORDER BY u.first_name', [req.user.id]);
    render(req, res, settingsPage({ csrf: res.locals.csrf, user: req.user, prefs: P.of(req.user), blocked, pushEnabled: push.enabled() }), { title: 'Settings', tab: 'settings' });
  });

  app.post('/checkin/settings', async (req, res) => {
    if (needLogin(req, res)) return;
    const values = {};
    for (const x of [...P.NOTIFY, ...P.PRIVACY]) values[x.key] = req.body[x.key] === '1';
    values.messages_from = req.body.messages_from;
    await P.save(req.user.id, values);
    security.flash(req, 'ok', 'Settings saved.');
    res.redirect('/checkin/settings');
  });

  // ---- Automations (admins)
  app.get('/checkin/automations', needRole('coadmin'), async (req, res) => {
    await withEvent(req);
    render(req, res, automationsPage({ csrf: res.locals.csrf, list: await A.settings(), log: await A.recentLog() }), { title: 'Automations', tab: 'automations' });
  });

  app.post('/checkin/automations/:key', needRole('coadmin'), async (req, res) => {
    const key = String(req.params.key);
    const def = A.DEFS.find((d) => d.key === key);
    if (!def) throw new HttpError(404, 'That automation was not found.');
    if (req.body.action === 'reset') {
      await A.save(key, { enabled: req.body.enabled === '1' }, req.user.id);
      security.flash(req, 'ok', `${def.title}: back to the original wording.`);
    } else {
      await A.save(key, { enabled: req.body.enabled === '1', subject: req.body.subject, body: req.body.body }, req.user.id);
      if (req.body.action === 'test') {
        await A.sendTest(key, req.user);
        security.flash(req, 'ok', `Saved, and a test was sent to ${req.user.email}.`);
      } else {
        security.flash(req, 'ok', `${def.title}: saved${req.body.enabled === '1' ? '' : ' (turned off)'}.`);
      }
    }
    D.audit(req.user, 'automation_update', { detail: key });
    res.redirect(`/checkin/automations#${key}`);
  });
}

module.exports = { routes, unreadCount, directory, canReach };

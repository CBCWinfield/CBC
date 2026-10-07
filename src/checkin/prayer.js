'use strict';
// The Prayer Wall: share a request, tap "Pray", encourage each other in the comments,
// and celebrate answered prayers. Automations (see `jobs`) send a Monday prayer list
// to everyone praying, and check in with whoever asked: "Has God answered?"
const db = require('../db');
const security = require('../lib/security');
const mailer = require('../lib/mailer');
const { HttpError } = require('../lib/http');
const { html, raw, esc } = require('../lib/html');
const t = require('../lib/time');
const { pushTo, url } = require('../notify');
const { intParam, clean } = require('../routes/guards');
const D = require('./data');
const P = require('./prefs');
const social = require('./social');

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const DAY = 86400000;
// How often we ask the person who posted whether the prayer was answered:
// weekly for the first month, then monthly until it's answered or removed.
const checkinGap = (count) => (count < 4 ? 7 : 30) * DAY;

const ago = (d) => {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)}d ago`;
  return t.fmtDateYear(d);
};
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const tone = (id) => `pw-tone-${(Number(id) || 0) % 6}`;

// SQL: prayers this user may see. $1 is always the viewer's id.
// (Team members see everything, but $1 is still referenced so the parameter count always matches.)
const visibleSql = (user) => `p.status <> 'hidden' AND ${D.isTeam(user) ? '$1::int IS NOT NULL' : `(p.audience = 'everyone' OR p.user_id = $1)`}`;

async function list(user, { filter = '', id = null, since = null } = {}) {
  const where = [visibleSql(user)];
  const params = [user.id];
  if (id) { params.push(id); where.push(`p.id = $${params.length}`); }
  if (filter === 'mine') where.push('p.user_id = $1');
  if (filter === 'answered') where.push(`p.status = 'answered'`);
  if (filter === 'praying') where.push(`EXISTS (SELECT 1 FROM prayer_praying x WHERE x.prayer_id = p.id AND x.user_id = $1) AND p.status = 'open'`);
  if (filter === 'new') { params.push(since || new Date(Date.now() - 7 * DAY)); where.push(`p.created_at > $${params.length} AND p.user_id IS DISTINCT FROM $1`); }
  return db.many(`SELECT p.*, u.first_name AS author_first, u.first_name || ' ' || u.last_name AS author,
      u.status AS author_status, u.prefs AS author_prefs, u.checkin_role AS author_role,
      (SELECT count(*)::int FROM prayer_praying x WHERE x.prayer_id = p.id) AS praying,
      EXISTS (SELECT 1 FROM prayer_praying x WHERE x.prayer_id = p.id AND x.user_id = $1) AS i_pray,
      (SELECT count(*)::int FROM prayer_comments c WHERE c.prayer_id = p.id AND c.deleted_at IS NULL) AS comments,
      (SELECT string_agg(n, '|') FROM (SELECT u2.first_name || ' ' || u2.last_name AS n FROM prayer_praying x JOIN users u2 ON u2.id = x.user_id
         WHERE x.prayer_id = p.id AND x.user_id <> $1 ORDER BY x.created_at DESC LIMIT 3) s) AS pray_names
    FROM prayers p LEFT JOIN users u ON u.id = p.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.created_at DESC LIMIT 150`, params);
}

async function commentsFor(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const rows = await db.many(`SELECT c.*, u.first_name || ' ' || u.last_name AS author FROM prayer_comments c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.prayer_id = ANY($1::int[]) AND c.deleted_at IS NULL ORDER BY c.created_at`, [ids]);
  for (const c of rows) { if (!map.has(c.prayer_id)) map.set(c.prayer_id, []); map.get(c.prayer_id).push(c); }
  return map;
}

// "You and 4 others are praying" / "Sarah Lee and 2 others are praying".
function prayingText(n, names, mine) {
  if (!n) return 'Be the first to pray';
  if (mine) return n === 1 ? 'You’re praying' : `You and ${n - 1} ${n - 1 === 1 ? 'other' : 'others'} are praying`;
  const first = (names || [])[0];
  if (!first) return `${n} ${n === 1 ? 'person is' : 'people are'} praying`;
  return n === 1 ? `${first} is praying` : `${first} and ${n - 1} ${n - 1 === 1 ? 'other' : 'others'} are praying`;
}
const namesOf = (p) => (p.pray_names ? p.pray_names.split('|') : []);

// Count of requests posted since this person last opened the wall (for the header badge).
async function newCount(user) {
  const row = await db.one(`SELECT count(*)::int AS n FROM prayers p, users me
    WHERE me.id = $1 AND ${visibleSql(user)} AND p.status = 'open' AND p.user_id IS DISTINCT FROM $1
      AND p.created_at > COALESCE(me.prayer_seen_at, me.created_at, now() - interval '7 days')`, [user.id]);
  return row ? row.n : 0;
}

async function stats(user) {
  return db.one(`SELECT
      (SELECT count(*)::int FROM prayers p WHERE ${visibleSql(user)} AND p.status = 'open') AS open,
      (SELECT count(*)::int FROM prayer_praying x JOIN prayers p ON p.id = x.prayer_id WHERE ${visibleSql(user)} AND x.created_at > now() - interval '7 days') AS week,
      (SELECT count(*)::int FROM prayers p WHERE ${visibleSql(user)} AND p.status = 'answered') AS answered`, [user.id]);
}

const dueCheckins = (userId) => db.many(`SELECT p.*, (SELECT count(*)::int FROM prayer_praying x WHERE x.prayer_id = p.id) AS praying_n FROM prayers p WHERE p.user_id = $1 AND p.status = 'open' AND p.checkin_pending ORDER BY p.created_at`, [userId]);

// ---------------------------------------------------------------- views
function avatar(name, id, { anon = false, cls = '' } = {}) {
  return html`<span class="pw-avatar ${anon ? 'pw-avatar-anon' : tone(id)} ${cls}" aria-hidden="true">${anon ? '🙏' : initials(name)}</span>`;
}

function prayCluster(p, user) {
  const names = namesOf(p);
  const faces = (p.i_pray ? [`${user.first_name} ${user.last_name}`] : []).concat(names).slice(0, 3);
  return html`<span class="pw-faces" aria-hidden="true">${faces.map((n, i) => html`<span class="pw-face ${tone(n.length + i)}">${initials(n)}</span>`)}</span>
    <span class="pw-praying-text" data-pray-text>${prayingText(p.praying, names, p.i_pray)}</span>`;
}

function prayerCard({ csrf, user, p, comments = [], open = false, isNew = false, single = false }) {
  const mine = p.user_id === user.id;
  const admin = D.can(user, 'coadmin');
  const anon = p.anonymous;
  const name = anon ? 'Anonymous' : (p.author || 'Someone');
  const back = single ? html`<input type="hidden" name="back" value="single">` : '';
  const author = { id: p.user_id, status: p.author_status, prefs: p.author_prefs, checkin_role: p.author_role };
  const canNote = !mine && !anon && p.user_id && social.canReach(user, author);
  const answered = p.status === 'answered';
  return html`<article class="pw-card${answered ? ' is-answered' : ''}${isNew ? ' is-new' : ''}${p.audience === 'team' ? ' is-team' : ''}" id="prayer-${p.id}">
    ${answered ? html`<div class="pw-ribbon"><span aria-hidden="true">✦</span> Answered prayer</div>` : ''}
    <header class="pw-card-head">
      ${avatar(name, p.user_id, { anon })}
      <div class="pw-who">
        <strong>${name}${anon && (admin || mine) ? html` <span class="pw-real">(${p.author || 'unknown'})</span>` : ''}</strong>
        <span class="pw-meta"><a href="/checkin/prayer/${p.id}" class="pw-time" title="${t.fmtDateTime(p.created_at)}">${ago(p.created_at)}</a>${p.audience === 'team' ? html`<span class="pw-chip-lock" title="Only the pastors and church team can see this">🔒 Pastors &amp; team</span>` : ''}</span>
      </div>
      ${isNew ? html`<span class="pw-new">New</span>` : ''}
      ${mine || admin ? html`<details class="pw-menu">
        <summary aria-label="Options for this request"><span aria-hidden="true">•••</span></summary>
        <div class="pw-menu-pop">
          ${mine && !answered ? html`<a href="/checkin/prayer/${p.id}#answer">Mark as answered</a>` : ''}
          <form method="post" action="/checkin/prayer/${p.id}/delete" data-confirm="${mine ? 'Remove your prayer request? This can’t be undone.' : 'Hide this prayer request from the wall?'}">${csrfField(csrf)}<button type="submit">${mine ? 'Remove request' : 'Hide (admin)'}</button></form>
        </div>
      </details>` : ''}
    </header>
    <p class="pw-body">${p.body}</p>
    ${answered ? html`<div class="pw-praise"><span class="pw-praise-label">Praise report${p.answered_at ? html` · ${t.fmtDate(p.answered_at)}` : ''}</span>${p.answered_note ? html`<p>${p.answered_note}</p>` : html`<p>God answered this prayer. Thank you for praying!</p>`}</div>` : ''}
    <footer class="pw-bar">
      <form method="post" action="/checkin/prayer/${p.id}/pray" class="pw-pray-form" data-pray>${csrfField(csrf)}${back}
        <button class="pw-pray${p.i_pray ? ' is-on' : ''}" type="submit" aria-pressed="${p.i_pray ? 'true' : 'false'}">
          <span class="pw-pray-icon" aria-hidden="true">🙏</span><span class="pw-pray-label">${p.i_pray ? 'Praying' : 'Pray'}</span><span class="pw-pray-n" data-pray-n>${p.praying || ''}</span>
        </button>
      </form>
      <span class="pw-praying">${prayCluster(p, user)}</span>
      ${canNote ? html`<a class="pw-note" href="/checkin/inbox/new?to=${p.user_id}" title="Send ${p.author_first || 'them'} a private note"><span aria-hidden="true">✉</span><span class="pw-note-word"> Note</span></a>` : ''}
    </footer>
    <details class="pw-comments"${open ? raw(' open') : ''}>
      <summary><span aria-hidden="true">💬</span> ${p.comments ? `${p.comments} ${p.comments === 1 ? 'encouragement' : 'encouragements'}` : 'Write an encouragement'}</summary>
      <div class="pw-thread">
        ${comments.map((c) => html`<div class="pw-comment">
          ${avatar(c.author, c.user_id, { cls: 'pw-avatar-sm' })}
          <div class="pw-comment-bubble"><strong>${c.author || 'Someone'}</strong> <span class="pw-meta">${ago(c.created_at)}</span>
            <p>${c.body}</p>
            ${c.user_id === user.id || admin ? html`<form method="post" action="/checkin/prayer/comments/${c.id}/delete" class="pw-comment-del">${csrfField(csrf)}${back}<button type="submit" class="linklike">Remove</button></form>` : ''}
          </div></div>`)}
        <form method="post" action="/checkin/prayer/${p.id}/comments" class="pw-reply">${csrfField(csrf)}${back}
          ${avatar(`${user.first_name} ${user.last_name}`, user.id, { cls: 'pw-avatar-sm' })}
          <label for="cm-${p.id}" class="visually-hidden">Write an encouragement</label>
          <textarea id="cm-${p.id}" name="body" rows="1" maxlength="1500" placeholder="Write an encouragement or a verse…" required></textarea>
          <button class="pw-send" type="submit" aria-label="Post">➤</button>
        </form>
      </div>
    </details>
  </article>`;
}

// "Has God answered?" card shown to the person who asked.
function checkinPanel({ csrf, p, single = false }) {
  const weeks = Math.max(1, Math.round((Date.now() - new Date(p.created_at).getTime()) / (7 * DAY)));
  return html`<section class="pw-checkin" id="${single ? 'answer' : `checkin-${p.id}`}">
    <div class="pw-checkin-icon" aria-hidden="true">🕊️</div>
    <div class="pw-checkin-main">
      <h2>Has God answered your prayer?</h2>
      <p class="pw-checkin-quote">“${p.body.length > 140 ? `${p.body.slice(0, 140)}…` : p.body}”</p>
      <p class="pw-meta">You shared this ${weeks === 1 ? 'about a week' : `${weeks} weeks`} ago${p.praying_n ? ` · ${p.praying_n} praying` : ''}.</p>
      <form method="post" action="/checkin/prayer/${p.id}/answered" class="pw-checkin-answer">${csrfField(csrf)}${single ? html`<input type="hidden" name="back" value="single">` : ''}
        <label for="praise-${p.id}">Yes! Share a praise report <span class="pw-meta">(optional)</span></label>
        <textarea id="praise-${p.id}" name="note" rows="2" maxlength="600" placeholder="Tell the church what God did…"></textarea>
        <button class="pw-btn pw-btn-gold" type="submit">✦ Yes, it’s answered</button>
      </form>
      <div class="pw-checkin-actions">
        <form method="post" action="/checkin/prayer/${p.id}/still">${csrfField(csrf)}${single ? html`<input type="hidden" name="back" value="single">` : ''}<button class="pw-btn pw-btn-soft" type="submit">Still praying</button></form>
        <form method="post" action="/checkin/prayer/${p.id}/delete" data-confirm="Remove this prayer request from the wall?">${csrfField(csrf)}<button class="pw-btn pw-btn-ghost" type="submit">Remove request</button></form>
      </div>
    </div>
  </section>`;
}

const VERSES = [
  ['Bear one another’s burdens, and so fulfill the law of Christ.', 'Galatians 6:2'],
  ['Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God.', 'Philippians 4:6'],
  ['The prayer of a righteous person has great power as it is working.', 'James 5:16'],
  ['Rejoice always, pray without ceasing, give thanks in all circumstances.', '1 Thessalonians 5:16–18'],
  ['Cast all your anxieties on him, because he cares for you.', '1 Peter 5:7'],
  ['For where two or three are gathered in my name, there am I among them.', 'Matthew 18:20'],
  ['Call to me and I will answer you, and will tell you great and hidden things that you have not known.', 'Jeremiah 33:3'],
];

function wallPage({ csrf, user, prayers, comments, openId, filter, seenBefore, st, due, newN }) {
  const [verse, ref] = VERSES[Math.floor(Date.now() / (7 * DAY)) % VERSES.length]; // a new verse each week
  const tabs = [['', 'All'], ['new', 'New', newN], ['praying', 'I’m praying'], ['mine', 'Mine'], ['answered', 'Answered']];
  const isNew = (p) => p.user_id !== user.id && p.status === 'open' && seenBefore && new Date(p.created_at) > seenBefore;
  const empty = {
    '': ['The wall is quiet.', 'Be the first to share a request. Your church family wants to pray with you.'],
    new: ['You’re all caught up.', 'No new requests since your last visit.'],
    praying: ['Your prayer list is empty.', 'Tap “Pray” on any request and it will show up here, and in your Monday reminder.'],
    mine: ['You haven’t shared a request yet.', 'Whatever is on your heart, big or small, we’d love to pray with you.'],
    answered: ['No answered prayers yet.', 'When God answers a request, it’s celebrated here.'],
  }[filter];
  return html`
  <div class="pw">
    <header class="pw-hero">
      <div class="pw-hero-glow" aria-hidden="true"></div>
      <p class="pw-eyebrow">Central Baptist Church</p>
      <h1>Prayer Wall</h1>
      <blockquote class="pw-verse"><p>“${verse}”</p><cite>${ref}</cite></blockquote>
      <dl class="pw-stats">
        <div><dt>Open requests</dt><dd>${st.open}</dd></div>
        <div><dt>Prayers this week</dt><dd>${st.week}</dd></div>
        <div><dt>Answered</dt><dd>${st.answered}</dd></div>
      </dl>
    </header>

    ${due.map((p) => checkinPanel({ csrf, p }))}

    <form method="post" action="/checkin/prayer" class="pw-compose" data-pw-compose>
      ${csrfField(csrf)}
      <div class="pw-compose-row">
        ${avatar(`${user.first_name} ${user.last_name}`, user.id)}
        <label for="pr-body" class="visually-hidden">Share a prayer request</label>
        <textarea id="pr-body" name="body" rows="2" maxlength="2000" required placeholder="How can we pray for you, ${user.first_name}?"></textarea>
      </div>
      <div class="pw-compose-foot">
        <label class="pw-toggle"><input type="checkbox" name="anonymous" value="1"><span>Post anonymously</span></label>
        <label class="pw-toggle"><input type="checkbox" name="team_only" value="1"><span>🔒 Pastors &amp; team only</span></label>
        <button class="pw-btn pw-btn-primary" type="submit">Share request</button>
      </div>
      <p class="pw-compose-hint">We’ll check in with you about this request now and then, and you can mark it answered anytime. Please don’t share someone else’s private details without their permission.</p>
    </form>

    <nav class="pw-tabs" aria-label="Filter prayer requests">
      ${tabs.map(([k, l, n]) => html`<a href="/checkin/prayer${k ? `?f=${k}` : ''}"${filter === k ? raw(' aria-current="page"') : ''}>${l}${n ? html`<span class="pw-tab-n">${n}</span>` : ''}</a>`)}
    </nav>

    ${prayers.length ? html`<div class="pw-list">${prayers.map((p) => prayerCard({ csrf, user, p, comments: comments.get(p.id) || [], open: openId === p.id, isNew: isNew(p) }))}</div>`
    : html`<div class="pw-empty"><div class="pw-empty-icon" aria-hidden="true">🕯️</div><h2>${empty[0]}</h2><p>${empty[1]}</p></div>`}
  </div>`;
}

function singlePage({ csrf, user, p, comments, due }) {
  return html`<div class="pw pw-single">
    <p class="pw-back"><a href="/checkin/prayer">← Prayer Wall</a></p>
    ${due ? checkinPanel({ csrf, p, single: true }) : ''}
    ${prayerCard({ csrf, user, p, comments, open: true, single: true })}
  </div>`;
}

// Signed-out visitors see the Prayer Wall faintly behind a sign-in box.
// The requests shown are examples only, so no one's real prayer is ever visible without signing in.
function gatePage({ csrf, next }) {
  const ago = (days) => new Date(Date.now() - days * DAY - 3600000);
  const sample = [
    { id: 1, user_id: 901, author: 'Ellen M.', author_first: 'Ellen', body: 'Please pray for my husband’s knee surgery on Thursday, and for a quick and full recovery. Thank you, church family.', created_at: ago(0.2), praying: 14, i_pray: false, comments: 5, pray_names: 'Ruth A.|Daniel H.', status: 'open', audience: 'everyone' },
    { id: 2, user_id: 902, anonymous: true, body: 'Praying for peace in our home and wisdom for us as parents this season.', created_at: ago(1), praying: 9, i_pray: false, comments: 3, pray_names: 'Carol S.', status: 'open', audience: 'everyone' },
    { id: 3, user_id: 903, author: 'Micah N.', author_first: 'Micah', body: 'Pray for safe travels and open hearts for our mission team going to Juárez.', created_at: ago(9), praying: 22, i_pray: false, comments: 8, pray_names: 'Lacy R.|Kitty C.', status: 'answered', answered_note: 'Everyone made it home safe, and the family moved into their new house. Thank you for praying!', answered_at: ago(2), audience: 'everyone' },
    { id: 4, user_id: 904, author: 'James R.', author_first: 'James', body: 'My mom starts a new job on Monday. Pray she finds favor, good friends, and peace there.', created_at: ago(3), praying: 6, i_pray: false, comments: 1, pray_names: 'Stacey H.', status: 'open', audience: 'everyone' },
  ];
  const viewer = { id: -1, first_name: 'friend', last_name: '' };
  const preview = wallPage({ csrf: '', user: viewer, prayers: sample, comments: new Map(), openId: 0, filter: '', seenBefore: null, st: { open: 12, week: 48, answered: 7 }, due: [], newN: 0 });
  return html`<div class="pw-gate-wrap">
    <div class="pw-gate-preview" inert aria-hidden="true">${preview}</div>
    <div class="pw-gate">
      <section class="pw-gate-card" aria-labelledby="gate-h">
        <div class="pw-gate-icon" aria-hidden="true">🙏</div>
        <h1 id="gate-h">Join your church family in prayer</h1>
        <p class="pw-gate-lead">Sign in to share a request, pray for others, and see who’s praying for you.</p>
        <form method="post" action="/login" class="pw-gate-form">
          ${csrfField(csrf)}<input type="hidden" name="next" value="${next}">
          <label for="g-email">Email</label>
          <input id="g-email" name="email" type="email" autocomplete="email" required>
          <label for="g-pw">Password</label>
          <input id="g-pw" name="password" type="password" autocomplete="current-password" required>
          <button class="pw-btn pw-btn-primary pw-gate-submit" type="submit">Sign in</button>
          <a class="pw-gate-forgot" href="/forgot">Forgot your password?</a>
        </form>
        <div class="pw-gate-or"><span>New to Central?</span></div>
        <a class="pw-btn pw-btn-soft pw-gate-join" href="/apply?next=${encodeURIComponent(next)}">Create a free account</a>
        <p class="pw-gate-note">The requests behind this box are examples. Real prayer requests are only visible to signed-in members.</p>
      </section>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- routes
function routes(app, { render, needLogin, currentEvent }) {
  const withEvent = async (req) => { if (D.can(req.user, 'volunteer')) req.ciEvent = await currentEvent(req); };
  const canPost = (u) => u && u.status === 'approved';
  const backTo = (req, p, hash = '') => (req.body.back === 'single' ? `/checkin/prayer/${p.id}${hash}` : `/checkin/prayer${hash.startsWith('?') ? hash : `#prayer-${p.id}`}`);

  // Applicants still waiting for approval see a friendly "almost there" page.
  const waiting = (req, res) => {
    if (req.user.status !== 'pending') return false;
    render(req, res, require('./views').pendingPage({ user: req.user, what: 'the Prayer Wall' }), { title: 'Prayer Wall', tab: 'prayer' });
    return true;
  };

  const gate = (req, res) => {
    if (req.user) return false;
    render(req, res, gatePage({ csrf: res.locals.csrf, next: req.originalUrl && req.originalUrl.startsWith('/checkin/prayer') ? req.originalUrl : '/checkin/prayer' }), { title: 'Prayer Wall', tab: 'prayer' });
    return true;
  };

  app.get('/checkin/prayer', async (req, res) => {
    if (gate(req, res)) return;
    await withEvent(req);
    if (waiting(req, res)) return;
    const filter = ['new', 'praying', 'mine', 'answered'].includes(req.query.f) ? req.query.f : '';
    const me = await db.one('SELECT prayer_seen_at, created_at FROM users WHERE id = $1', [req.user.id]);
    const seenBefore = me.prayer_seen_at || me.created_at ? new Date(me.prayer_seen_at || me.created_at) : null;
    const newN = await newCount(req.user);
    const prayers = await list(req.user, { filter, since: seenBefore || new Date(Date.now() - 7 * DAY) });
    const [comments, st, due] = await Promise.all([commentsFor(prayers.map((p) => p.id)), stats(req.user), dueCheckins(req.user.id)]);
    await db.query('UPDATE users SET prayer_seen_at = now() WHERE id = $1', [req.user.id]);
    req.ciPrayerNew = 0;
    render(req, res, wallPage({ csrf: res.locals.csrf, user: req.user, prayers, comments, openId: Number(req.query.open) || 0, filter, seenBefore, st, due, newN }), { title: 'Prayer Wall', tab: 'prayer' });
  });

  app.get('/checkin/prayer/:id', async (req, res) => {
    if (gate(req, res)) return;
    await withEvent(req);
    if (waiting(req, res)) return;
    const [p] = await list(req.user, { id: intParam(req.params.id) });
    if (!p) throw new HttpError(404, 'That prayer request was not found. It may have been removed.');
    const comments = (await commentsFor([p.id])).get(p.id) || [];
    const due = p.user_id === req.user.id && p.status === 'open' && (p.checkin_pending || req.query.checkin === '1');
    render(req, res, singlePage({ csrf: res.locals.csrf, user: req.user, p, comments, due }), { title: 'Prayer request', tab: 'prayer' });
  });

  app.post('/checkin/prayer', security.rateLimit('ci-prayer', { max: 20, windowMs: 3600000 }), async (req, res) => {
    if (needLogin(req, res)) return;
    if (!canPost(req.user)) throw new HttpError(403, 'Your account can’t post right now.');
    const body = clean(req.body.body, 2000);
    if (!body) { security.flash(req, 'error', 'Write your prayer request.'); return res.redirect('/checkin/prayer'); }
    if (!require('../lib/profanity').isClean(body)) { security.flash(req, 'error', 'Please keep the Prayer Wall free of foul language. Reword your request and post it again.'); return res.redirect('/checkin/prayer'); }
    const audience = req.body.team_only === '1' ? 'team' : 'everyone';
    const anonymous = req.body.anonymous === '1';
    const p = await db.one(`INSERT INTO prayers (user_id, body, anonymous, audience, checkin_at) VALUES ($1, $2, $3, $4, now()) RETURNING id`, [req.user.id, body, anonymous, audience]);
    // People who asked to hear about new requests (Settings → Prayer wall).
    const listeners = await db.many(`SELECT id, prefs, checkin_role FROM users WHERE id <> $1 AND status = 'approved' AND prefs IS NOT NULL`, [req.user.id]);
    const ids = listeners.filter((u) => P.of(u).push_prayer_new === true && (audience === 'everyone' || D.isTeam(u))).map((u) => u.id);
    if (ids.length) pushTo(ids, { title: '🙏 New prayer request', body: `${anonymous ? 'Someone' : req.user.first_name} asked for prayer: “${body.slice(0, 90)}${body.length > 90 ? '…' : ''}”`, url: `/checkin/prayer/${p.id}` }).catch(() => {});
    security.flash(req, 'ok', 'Your request is on the wall. Your church family is praying with you.');
    res.redirect(`/checkin/prayer#prayer-${p.id}`);
  });

  const visible = async (req, id) => {
    if (req.user.status !== 'approved') throw new HttpError(403, 'Your membership needs to be approved first.');
    const p = await db.one(`SELECT * FROM prayers WHERE id = $1 AND status <> 'hidden'`, [id]);
    if (!p || (p.audience === 'team' && !D.isTeam(req.user) && p.user_id !== req.user.id)) throw new HttpError(404, 'That prayer request was not found.');
    return p;
  };
  const notifyOwner = async (p, actor, text) => {
    if (!p.user_id || p.user_id === actor.id) return;
    const owner = await db.one('SELECT id, prefs FROM users WHERE id = $1', [p.user_id]);
    if (owner && P.of(owner).push_prayer !== false) pushTo([owner.id], { title: 'Prayer Wall', body: text, url: `/checkin/prayer/${p.id}` }).catch(() => {});
  };

  app.post('/checkin/prayer/:id/pray', async (req, res) => {
    if (needLogin(req, res)) return;
    const p = await visible(req, intParam(req.params.id));
    const removed = await db.one('DELETE FROM prayer_praying WHERE prayer_id = $1 AND user_id = $2 RETURNING prayer_id', [p.id, req.user.id]);
    if (!removed) {
      await db.query('INSERT INTO prayer_praying (prayer_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [p.id, req.user.id]);
      notifyOwner(p, req.user, `${req.user.first_name} is praying for you 🙏`);
    }
    if (/json/.test(req.headers.accept || '')) {
      const [row] = await list(req.user, { id: p.id });
      return res.json({ praying: row.praying, mine: row.i_pray, text: prayingText(row.praying, namesOf(row), row.i_pray) });
    }
    res.redirect(backTo(req, p));
  });

  app.post('/checkin/prayer/:id/comments', security.rateLimit('ci-prayer-c', { max: 60, windowMs: 3600000 }), async (req, res) => {
    if (needLogin(req, res)) return;
    if (!canPost(req.user)) throw new HttpError(403, 'Your account can’t post right now.');
    const p = await visible(req, intParam(req.params.id));
    const body = clean(req.body.body, 1500);
    if (body && !require('../lib/profanity').isClean(body)) {
      security.flash(req, 'error', 'Please keep the Prayer Wall free of foul language. Reword your note and send it again.');
      return res.redirect(req.body.back === 'single' ? `/checkin/prayer/${p.id}` : `/checkin/prayer?open=${p.id}#prayer-${p.id}`);
    }
    if (body) {
      await db.query('INSERT INTO prayer_comments (prayer_id, user_id, body) VALUES ($1, $2, $3)', [p.id, req.user.id, body]);
      notifyOwner(p, req.user, `${req.user.first_name} sent you encouragement: “${body.slice(0, 80)}”`);
    }
    res.redirect(req.body.back === 'single' ? `/checkin/prayer/${p.id}` : `/checkin/prayer?open=${p.id}#prayer-${p.id}`);
  });

  app.post('/checkin/prayer/comments/:id/delete', async (req, res) => {
    if (needLogin(req, res)) return;
    const c = await db.one('SELECT * FROM prayer_comments WHERE id = $1', [intParam(req.params.id)]);
    if (!c || (c.user_id !== req.user.id && !D.can(req.user, 'coadmin'))) throw new HttpError(404, 'That comment was not found.');
    await db.query('UPDATE prayer_comments SET deleted_at = now() WHERE id = $1', [c.id]);
    res.redirect(req.body.back === 'single' ? `/checkin/prayer/${c.prayer_id}` : `/checkin/prayer?open=${c.prayer_id}#prayer-${c.prayer_id}`);
  });

  app.post('/checkin/prayer/:id/answered', async (req, res) => {
    if (needLogin(req, res)) return;
    const p = await db.one(`SELECT * FROM prayers WHERE id = $1 AND user_id = $2 AND status <> 'hidden'`, [intParam(req.params.id), req.user.id]);
    if (!p) throw new HttpError(404, 'That prayer request was not found.');
    await db.query(`UPDATE prayers SET status = 'answered', answered_note = $2, answered_at = now(), checkin_pending = false, updated_at = now() WHERE id = $1`, [p.id, clean(req.body.note, 600) || null]);
    const prayed = await db.many('SELECT user_id FROM prayer_praying WHERE prayer_id = $1 AND user_id <> $2', [p.id, req.user.id]);
    pushTo(prayed.map((x) => x.user_id), { title: 'Answered prayer! 🙌', body: 'A request you prayed for was answered. Praise God!', url: `/checkin/prayer/${p.id}` }).catch(() => {});
    security.flash(req, 'ok', `Praise God! ${prayed.length ? `We let the ${prayed.length} ${prayed.length === 1 ? 'person' : 'people'} who prayed know.` : 'It’s marked as answered.'}`);
    res.redirect(backTo(req, p));
  });

  app.post('/checkin/prayer/:id/still', async (req, res) => {
    if (needLogin(req, res)) return;
    const p = await db.one(`UPDATE prayers SET checkin_pending = false, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *`, [intParam(req.params.id), req.user.id]);
    if (!p) throw new HttpError(404, 'That prayer request was not found.');
    const next = new Date(new Date(p.checkin_at || p.created_at).getTime() + checkinGap(p.checkin_count));
    security.flash(req, 'ok', `We’ll keep praying with you. We’ll check in again around ${t.fmtDate(next)}.`);
    res.redirect(backTo(req, p));
  });

  app.post('/checkin/prayer/:id/delete', async (req, res) => {
    if (needLogin(req, res)) return;
    const p = await db.one('SELECT * FROM prayers WHERE id = $1', [intParam(req.params.id)]);
    if (!p || (p.user_id !== req.user.id && !D.can(req.user, 'coadmin'))) throw new HttpError(404, 'That prayer request was not found.');
    if (p.user_id === req.user.id) await db.query('DELETE FROM prayers WHERE id = $1', [p.id]);
    else { await db.query(`UPDATE prayers SET status = 'hidden', updated_at = now() WHERE id = $1`, [p.id]); D.audit(req.user, 'prayer_hidden', { detail: `prayer ${p.id}` }); }
    security.flash(req, 'ok', 'The request was removed from the wall.');
    res.redirect('/checkin/prayer');
  });
}

// ---------------------------------------------------------------- automations
const FOOT = 'Central Baptist Church<br>904 Wheat Rd, Winfield, KS 67156<br>(620) 221-2980 · centralbaptistchurchcalendar@gmail.com';
const settingsLink = () => `<span style="color:#55635C;font-size:13px">Change these reminders anytime in <a href="${esc(url('/checkin/settings'))}">your settings</a>.</span>`;
const quote = (p) => `<span style="display:block;border-left:3px solid #8CC63F;padding:6px 0 6px 12px;margin:4px 0">
  <strong>${esc(p.anonymous ? 'Anonymous' : p.author || 'Someone')}</strong> <span style="color:#55635C">· ${Number(p.praying) || 0} praying</span><br>
  ${esc(p.body.length > 220 ? `${p.body.slice(0, 220)}…` : p.body)}</span>`;

// Monday-morning prayer list for everyone who is praying for at least one open request,
// plus anyone who opted in, with the week's new requests.
async function weekly(now, log) {
  const p = t.parts(now);
  if (p.weekday !== 1) return 0;
  const week = t.dateKey(now);
  const users = await db.many(`SELECT u.id, u.email, u.first_name, u.last_name, u.prefs, u.notify_email, u.checkin_role, u.status FROM users u
    WHERE u.status IN ('approved', 'pending') AND EXISTS (SELECT 1 FROM prayer_praying x JOIN prayers pr ON pr.id = x.prayer_id WHERE x.user_id = u.id AND pr.status = 'open')`);
  let sent = 0;
  for (const u of users) {
    const wantsEmail = P.wants(u, 'email_prayer_weekly') && u.email;
    const wantsPush = P.wants(u, 'push_prayer_weekly');
    if (!wantsEmail && !wantsPush) continue;
    const mine = (await list(u, { filter: 'praying' })).slice(0, 12);
    const fresh = (await list(u, { filter: 'new', since: new Date(now.getTime() - 7 * DAY) })).filter((x) => x.status === 'open' && !x.i_pray).slice(0, 6);
    if (!mine.length && !fresh.length) continue;
    if (!(await log('prayer_weekly', `${u.id}-${week}`, u.email, u.id))) continue;
    if (wantsPush) pushTo([u.id], { title: '🙏 Keep praying this week', body: `${mine.length} ${mine.length === 1 ? 'request' : 'requests'} on your prayer list${fresh.length ? ` · ${fresh.length} new` : ''}.`, url: '/checkin/prayer?f=praying' }).catch(() => {});
    if (wantsEmail) {
      await mailer.send({
        to: u.email, libraryName: 'Central Baptist Church · Prayer Wall', footer: FOOT,
        subject: `Your prayer list for this week (${mine.length})`,
        heading: `Keep praying, ${u.first_name}`,
        paragraphs: [
          'Thank you for carrying these burdens with your church family. Here’s what you’re praying for this week:',
          ...mine.map(quote),
          fresh.length ? '<strong>New this week</strong>' : '',
          ...fresh.map(quote),
          '“The prayer of a righteous person has great power as it is working.” (James 5:16)',
          settingsLink(),
        ],
        button: { label: 'Open the Prayer Wall', url: url('/checkin/prayer?f=praying') },
      }).catch((err) => console.error('Prayer list email failed:', err.message));
    }
    sent++;
  }
  return sent;
}

// Ask whoever posted: weekly for the first month, then monthly, until it's answered or removed.
async function checkins(now, log) {
  const rows = await db.many(`SELECT p.*, u.email, u.first_name, u.prefs, u.notify_email,
      (SELECT count(*)::int FROM prayer_praying x WHERE x.prayer_id = p.id) AS praying_n
    FROM prayers p JOIN users u ON u.id = p.user_id
    WHERE p.status = 'open' AND u.status IN ('approved', 'pending')`);
  let sent = 0;
  for (const p of rows) {
    const last = new Date(p.checkin_at || p.created_at).getTime();
    if (now.getTime() - last < checkinGap(p.checkin_count)) continue;
    if (!(await log('prayer_checkin', `${p.id}-${p.checkin_count + 1}`, p.email, p.user_id))) continue;
    await db.query('UPDATE prayers SET checkin_at = $2, checkin_count = checkin_count + 1, checkin_pending = true WHERE id = $1', [p.id, now]);
    const link = url(`/checkin/prayer/${p.id}?checkin=1#answer`);
    if (P.of(p).push_prayer !== false) pushTo([p.user_id], { title: '🕊️ Has God answered?', body: `Checking in on your prayer request: “${p.body.slice(0, 80)}${p.body.length > 80 ? '…' : ''}”`, url: `/checkin/prayer/${p.id}?checkin=1#answer` }).catch(() => {});
    if (P.wants(p, 'email_prayer_checkin') && p.email) {
      await mailer.send({
        to: p.email, libraryName: 'Central Baptist Church · Prayer Wall', footer: FOOT,
        subject: 'Checking in on your prayer request',
        heading: `${p.first_name}, how can we keep praying?`,
        paragraphs: [
          'Your church family has been praying with you about this:',
          `<span style="display:block;border-left:3px solid #8CC63F;padding:6px 0 6px 12px;margin:4px 0">${esc(p.body.length > 300 ? `${p.body.slice(0, 300)}…` : p.body)}</span>`,
          p.praying_n ? `<strong>${p.praying_n} ${p.praying_n === 1 ? 'person has' : 'people have'}</strong> told you they’re praying.` : '',
          'Has God answered? Tap below to share a praise report, let us know you’re still praying, or take the request down.',
          settingsLink(),
        ],
        button: { label: 'Update my request', url: link },
      }).catch((err) => console.error('Prayer check-in email failed:', err.message));
    }
    sent++;
  }
  return sent;
}

async function jobs(now, on, log) {
  const out = { prayer_weekly: 0, prayer_checkin: 0 };
  if (t.parts(now).hour < 8) return out;
  if (!on.prayer_weekly || on.prayer_weekly.enabled) out.prayer_weekly = await weekly(now, log);
  if (!on.prayer_checkin || on.prayer_checkin.enabled) out.prayer_checkin = await checkins(now, log);
  return out;
}

module.exports = { routes, newCount, jobs, prayingText, checkinGap };

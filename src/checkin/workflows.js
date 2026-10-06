'use strict';
// Custom workflows: admins build their own automatic messages on the Automations page.
// A workflow is "when X happens (or on this schedule), send this message to these people
// by email, Inbox message and/or app notification".
const db = require('../db');
const security = require('../lib/security');
const mailer = require('../lib/mailer');
const { HttpError } = require('../lib/http');
const { html, checked, selected } = require('../lib/html');
const t = require('../lib/time');
const { pushTo, url } = require('../notify');
const { intParam, clean } = require('../routes/guards');
const D = require('./data');
const A = require('./automations');
const social = require('./social');
const community = require('./community');

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const DAY = 86400000;
const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CHANNELS = [['email', 'Email', '✉'], ['inbox', 'Inbox message', '💬'], ['push', 'App notification', '🔔']];
const PLACEHOLDERS = ['first_name', 'last_name', 'family_name', 'serve_date', 'serve_role', 'church_name', 'church_phone', 'church_email', 'church_address'];

const TRIGGERS = [
  { key: 'schedule', icon: '🗓', title: 'On a schedule', blurb: 'Once, every week or every month, to a group you choose.' },
  { key: 'signup', icon: '👋', title: 'After someone creates an account', blurb: 'A follow-up a few days after they sign up.' },
  { key: 'first_visit', icon: '⭐', title: 'After a family’s first visit', blurb: 'Goes to the parents a set number of days after their first check-in.' },
  { key: 'lapsed', icon: '💚', title: 'When a family hasn’t been back', blurb: 'Reach out after a family misses a number of weeks.' },
  { key: 'serving', icon: '🙋', title: 'Before someone serves', blurb: 'Reminder to people on the serving calendar.' },
];
const TRIGGER = Object.fromEntries(TRIGGERS.map((x) => [x.key, x]));

const PRESETS = {
  guest: { name: 'Thank first-time guests', trigger: 'first_visit', config: { days: 2 }, channels: ['email'],
    subject: 'Thanks for visiting Central, {first_name}!',
    body: 'Hi {first_name},\n\nThank you for visiting Central Baptist Church! It was a joy to have {family_name} with us, and we hope your kids had a great time.\n\nIf you have any questions about our children’s and youth ministries, or anything else, just reply to this email. We’d love to see you again soon.',
    button_label: 'Open my family account', button_url: '/checkin/family' },
  missed: { name: 'We miss you', trigger: 'lapsed', config: { weeks: 6 }, channels: ['email'],
    subject: 'We miss you at Central, {first_name}',
    body: 'Hi {first_name},\n\nWe’ve missed seeing {family_name} at Central! We just wanted you to know we’re thinking of you and praying for you.\n\nIf there’s anything going on that we can pray about or help with, reply to this email or give the church office a call. Hope to see you soon!' },
  serving: { name: 'Serving reminder', trigger: 'serving', config: { days: 2 }, channels: ['inbox', 'email'],
    subject: 'You’re serving {serve_date}',
    body: 'Hi {first_name},\n\nThanks for serving! This is a reminder that you’re on the serving calendar for {serve_role} on {serve_date}.\n\nIf you can’t make it, please let us know as soon as you can so we can find someone to cover.',
    button_label: 'See the serving calendar', button_url: '/checkin/serve' },
  welcome: { name: 'One-week welcome follow-up', trigger: 'signup', config: { days: 7 }, channels: ['email'],
    subject: 'How’s it going, {first_name}?',
    body: 'Hi {first_name},\n\nIt’s been about a week since you joined Central’s app. We hope it’s been helpful!\n\nA few things you can do: add your kids’ allergies and pickup people, share a request on the Prayer Wall, and message other families. If you have any questions, just reply.',
    button_label: 'Open my account', button_url: '/checkin/family' },
  volunteers: { name: 'Weekly volunteer encouragement', trigger: 'schedule', config: { repeat: 'weekly', weekday: 5, time: '09:00' }, audience: 'team', channels: ['inbox'],
    subject: 'Thank you for serving',
    body: 'Hi {first_name}, thank you for everything you do for the kids and families at Central. “Let us not grow weary of doing good.” (Galatians 6:9) See you Sunday!' },
};

// ---------------------------------------------------------------- helpers
const parseCfg = (w) => (typeof w.config === 'string' ? JSON.parse(w.config || '{}') : w.config || {});
const parseCh = (w) => (typeof w.channels === 'string' ? JSON.parse(w.channels || '[]') : w.channels || []);
const fill = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const absUrl = (u) => (!u ? '' : /^https?:\/\//.test(u) ? u : url(u.startsWith('/') ? u : `/${u}`));
const fmtTime = (hhmm) => {
  const [h, m] = String(hhmm || '09:00').split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const groupLabel = (k) => (community.GROUPS.find(([g]) => g === k) || [k, k])[1];

function describe(w) {
  const c = parseCfg(w);
  const n = (v, word) => `${v} ${word}${Number(v) === 1 ? '' : 's'}`;
  switch (w.trigger) {
    case 'schedule':
      if (c.repeat === 'once') return `Once on ${c.date ? t.fmtLong(t.zoned(...c.date.split('-').map(Number), 12)) : '—'} at ${fmtTime(c.time)} to ${groupLabel(w.audience).toLowerCase()}`;
      if (c.repeat === 'monthly') return `Monthly on day ${c.day} at ${fmtTime(c.time)} to ${groupLabel(w.audience).toLowerCase()}`;
      return `Every ${WEEKDAYS[c.weekday] || 'week'} at ${fmtTime(c.time)} to ${groupLabel(w.audience).toLowerCase()}`;
    case 'signup': return Number(c.days) ? `${n(c.days, 'day')} after someone creates an account` : 'Right after someone creates an account';
    case 'first_visit': return Number(c.days) ? `${n(c.days, 'day')} after a family’s first visit` : 'The day of a family’s first visit';
    case 'lapsed': return `When a family hasn’t checked in for ${n(c.weeks, 'week')}`;
    case 'serving': return Number(c.days) ? `${n(c.days, 'day')} before someone serves` : 'The morning someone serves';
    default: return '';
  }
}

// ---------------------------------------------------------------- who gets it
async function usersByIds(ids) {
  if (!ids.length) return [];
  return db.many(`SELECT u.id AS user_id, u.email, u.first_name, u.last_name, u.notify_email,
      (SELECT f.name FROM people p JOIN families f ON f.id = p.family_id WHERE p.user_id = u.id AND p.active LIMIT 1) AS family_name
    FROM users u WHERE u.id = ANY($1::int[]) AND u.status NOT IN ('denied', 'paused')`, [ids]);
}
// Adults in a family: people with accounts, or just an email on file.
const familyAdults = (familyId) => db.many(`SELECT p.id AS person_id, p.user_id, COALESCE(u.email, p.email) AS email, p.first_name, p.last_name, f.name AS family_name, u.notify_email
  FROM people p JOIN families f ON f.id = p.family_id LEFT JOIN users u ON u.id = p.user_id
  WHERE p.family_id = $1 AND p.kind = 'adult' AND p.active AND f.status <> 'archived' AND (p.user_id IS NOT NULL OR p.email IS NOT NULL)
    AND (u.id IS NULL OR u.status NOT IN ('denied', 'paused'))`, [familyId]);

// Everyone due to get this workflow right now, each with a unique `ref` so nobody gets it twice.
async function due(w, now) {
  const c = parseCfg(w);
  const p = t.parts(now);
  const today = t.dateKey(now);
  const created = new Date(w.created_at).getTime();
  const awake = p.hour >= 8 && p.hour < 20; // event-based messages only go out 8 AM – 8 PM
  const out = [];
  if (w.trigger === 'schedule') {
    const [hh, mm] = String(c.time || '09:00').split(':').map(Number);
    let period = null;
    if (c.repeat === 'once' && c.date) { if (now >= t.zoned(...c.date.split('-').map(Number), hh, mm)) period = 'once'; }
    else if (c.repeat === 'monthly') { const at = t.zoned(p.year, p.month, p.day, hh, mm); if (p.day === Number(c.day) && now >= at && at.getTime() >= created) period = today; }
    else { const at = t.zoned(p.year, p.month, p.day, hh, mm); if (p.weekday === Number(c.weekday) && now >= at && at.getTime() >= created) period = today; }
    if (!period) return out;
    for (const u of await usersByIds(await community.groupMembers(w.audience || 'everyone'))) out.push({ ...u, ref: `${period}-u${u.user_id}` });
    return out;
  }
  if (!awake) return out;
  if (w.trigger === 'signup') {
    const days = Number(c.days) || 0;
    const rows = await db.many(`SELECT id FROM users WHERE status NOT IN ('denied', 'paused')
      AND created_at <= $1::timestamptz - make_interval(days => $2) AND created_at + make_interval(days => $2) >= $3::timestamptz`, [now, days, w.created_at]);
    for (const u of await usersByIds(rows.map((r) => r.id))) out.push({ ...u, ref: `u${u.user_id}` });
  } else if (w.trigger === 'first_visit') {
    const days = Number(c.days) || 0;
    const fams = await db.many(`SELECT family_id FROM attendance GROUP BY family_id
      HAVING min(checked_in_at) <= $1::timestamptz - make_interval(days => $2) AND min(checked_in_at) + make_interval(days => $2) >= $3::timestamptz`, [now, days, w.created_at]);
    for (const f of fams) for (const a of await familyAdults(f.family_id)) out.push({ ...a, ref: `f${f.family_id}-p${a.person_id}` });
  } else if (w.trigger === 'lapsed') {
    const weeks = Math.max(1, Number(c.weeks) || 6);
    const fams = await db.many(`SELECT family_id, max(checked_in_at) AS last FROM attendance GROUP BY family_id
      HAVING max(checked_in_at) <= $1::timestamptz - make_interval(weeks => $2) AND max(checked_in_at) + make_interval(weeks => $2) >= $3::timestamptz - interval '14 days'`, [now, weeks, w.created_at]);
    for (const f of fams) for (const a of await familyAdults(f.family_id)) out.push({ ...a, ref: `f${f.family_id}-${t.dateKey(new Date(f.last))}-p${a.person_id}` });
  } else if (w.trigger === 'serving') {
    const date = t.addDaysKey(today, Number(c.days) || 0);
    const slots = await db.many(`SELECT x.id, x.user_id, x.area, x.name AS slot_name, COALESCE(u.email, x.email) AS email, u.first_name, u.last_name, u.notify_email, s.name AS service, s.service_date::text AS service_date, s.start_time
      FROM serve_slots x JOIN serve_services s ON s.id = x.service_id LEFT JOIN users u ON u.id = x.user_id
      WHERE s.service_date = $1::date AND NOT s.cancelled AND (x.user_id IS NOT NULL OR x.email IS NOT NULL)`, [date]);
    for (const s of slots) {
      out.push({
        user_id: s.user_id, email: s.email, notify_email: s.notify_email,
        first_name: s.first_name || String(s.slot_name || '').split(' ')[0], last_name: s.last_name || '',
        serve_date: `${t.fmtLong(t.zoned(...s.service_date.split('-').map(Number), 12))}${s.start_time ? ` at ${s.start_time}` : ''}`,
        serve_role: `${s.service} (${s.area})`, ref: `s${s.id}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- sending
async function senderFor(w) {
  return (w.created_by && await db.one('SELECT id, first_name, last_name FROM users WHERE id = $1', [w.created_by]))
    || db.one(`SELECT id, first_name, last_name FROM users WHERE checkin_role = 'admin' ORDER BY id LIMIT 1`);
}

async function deliver(w, r, sender, { test = false } = {}) {
  const ch = new Set(parseCh(w));
  const vars = {
    first_name: r.first_name || 'friend', last_name: r.last_name || '', family_name: r.family_name || (r.last_name ? `the ${r.last_name} family` : 'your family'),
    serve_date: r.serve_date || 'Sunday', serve_role: r.serve_role || 'Kids',
    church_name: A.CHURCH.name, church_phone: A.CHURCH.phone, church_email: A.CHURCH.email, church_address: A.CHURCH.address,
  };
  const subject = fill(w.subject || w.name, vars);
  const text = fill(w.body, vars);
  const button = w.button_label && w.button_url ? { label: fill(w.button_label, vars), url: absUrl(w.button_url) } : null;
  const done = [];
  if (ch.has('email') && r.email && r.notify_email !== false) {
    await mailer.send({
      to: r.email, libraryName: A.CHURCH.name, footer: A.FOOTER, subject: test ? `[Test] ${subject}` : subject, heading: subject,
      paragraphs: [...A.paragraphs(w.body, vars), `<span style="color:#555">Questions? We’d love to hear from you:</span><br><strong>${A.CHURCH.name}</strong><br>${A.CHURCH.address}<br>${A.CHURCH.phone} · ${A.CHURCH.email}`],
      button,
    });
    done.push('email');
  }
  let pushed = false;
  if (ch.has('inbox') && r.user_id && sender && r.user_id !== sender.id) {
    const conv = await social.directConversation(sender.id, r.user_id);
    await social.sendMessage(conv, sender, `${w.subject ? `${subject}\n\n` : ''}${text}${button ? `\n\n${button.label}: ${button.url}` : ''}`);
    done.push('inbox'); pushed = true; // Inbox messages already send an app notification
  }
  if (ch.has('push') && r.user_id && !pushed) {
    await pushTo([r.user_id], { title: subject, body: text.replace(/\s+/g, ' ').slice(0, 160), url: w.button_url && w.button_url.startsWith('/') ? w.button_url : '/checkin/inbox' }).catch(() => {});
    done.push('push');
  }
  return done;
}

async function runOne(w, now = new Date()) {
  const list = await due(w, now);
  if (!list.length) return 0;
  const sender = await senderFor(w);
  let sent = 0;
  for (const r of list) {
    if (!(await A.logOnce(`wf-${w.id}`, r.ref, r.email, r.user_id))) continue;
    try { if ((await deliver(w, r, sender)).length) sent++; } catch (err) { console.error(`Workflow ${w.id} failed for ${r.ref}:`, err.message); }
  }
  if (sent) await db.query('UPDATE workflows SET last_run_at = now() WHERE id = $1', [w.id]);
  return sent;
}

async function run(now = new Date()) {
  const out = {};
  for (const w of await db.many('SELECT * FROM workflows WHERE enabled ORDER BY id')) {
    try { out[w.id] = await runOne(w, now); } catch (err) { console.error(`Workflow ${w.id} failed:`, err.message); }
  }
  return out;
}

const stats = () => db.many(`SELECT key, count(*)::int AS n, max(sent_at) AS last FROM automation_log WHERE key LIKE 'wf-%' GROUP BY key`);
const all = async () => {
  const s = Object.fromEntries((await stats()).map((r) => [r.key, r]));
  return (await db.many('SELECT * FROM workflows ORDER BY created_at DESC')).map((w) => ({ ...w, sent: (s[`wf-${w.id}`] || {}).n || 0, last: (s[`wf-${w.id}`] || {}).last }));
};

// ---------------------------------------------------------------- views
function listSection({ csrf, workflows }) {
  return html`<section class="wf-section" id="workflows">
    <div class="wf-section-head">
      <div><h2>Your workflows</h2><p class="muted">Messages you set up yourself: follow-ups, reminders and encouragement that send on their own.</p></div>
    </div>
    ${workflows.length ? html`<div class="wf-grid">${workflows.map((w) => html`<article class="wf-card${w.enabled ? ' is-on' : ''}">
      <div class="wf-card-top">
        <span class="wf-icon" aria-hidden="true">${(TRIGGER[w.trigger] || {}).icon || '⚙'}</span>
        <div class="wf-card-text"><a class="wf-name" href="/checkin/workflows/${w.id}">${w.name}</a><span class="wf-when">${describe(w)}</span></div>
        <form method="post" action="/checkin/workflows/${w.id}/toggle" class="wf-toggle-form">${csrfField(csrf)}
          <button type="submit" class="wf-switch${w.enabled ? ' is-on' : ''}" role="switch" aria-checked="${w.enabled ? 'true' : 'false'}" aria-label="${w.enabled ? 'Turn off' : 'Turn on'} ${w.name}"><span></span></button></form>
      </div>
      <div class="wf-card-foot">
        <span class="wf-chips">${parseCh(w).map((c) => { const x = CHANNELS.find(([k]) => k === c); return x ? html`<span class="wf-chip">${x[2]} ${x[1]}</span>` : ''; })}</span>
        <span class="wf-sent">${w.sent ? `Sent ${w.sent}× · last ${t.fmtDate(w.last)}` : w.enabled ? 'Waiting for its first send' : 'Off'}</span>
      </div>
    </article>`)}</div>`
    : html`<div class="wf-empty">
      <p><strong>No workflows yet.</strong> Start from one of these, or build your own:</p>
      <div class="wf-presets">${Object.entries(PRESETS).map(([k, x]) => html`<a class="wf-preset" href="/checkin/workflows/new?preset=${k}"><span aria-hidden="true">${TRIGGER[x.trigger].icon}</span><strong>${x.name}</strong><small>${describe({ ...x, audience: x.audience })}</small></a>`)}</div>
    </div>`}
  </section>`;
}

function builder({ csrf, w, error, isNew }) {
  const c = parseCfg(w);
  const ch = new Set(parseCh(w));
  const trig = w.trigger || 'schedule';
  const num = (name, val, min, max, unit) => html`<input class="wf-num" type="number" name="${name}" value="${val}" min="${min}" max="${max}" inputmode="numeric"> ${unit}`;
  const cfgFor = {
    schedule: html`<div class="wf-row">
        <label>Repeat <select name="repeat">${[['weekly', 'Every week'], ['monthly', 'Every month'], ['once', 'Just once']].map(([k, l]) => html`<option value="${k}"${selected(c.repeat || 'weekly', k)}>${l}</option>`)}</select></label>
        <label class="wf-only-weekly">on <select name="weekday">${WEEKDAYS.slice(1).map((d, i) => html`<option value="${i + 1}"${selected(Number(c.weekday || 7), i + 1)}>${d}</option>`)}</select></label>
        <label class="wf-only-monthly">on day ${num('day', c.day || 1, 1, 28, '')}</label>
        <label class="wf-only-once">on <input type="date" name="date" value="${c.date || ''}"></label>
        <label>at <input type="time" name="time" value="${c.time || '09:00'}" step="300"></label>
      </div>
      <label class="wf-block">To <select name="audience">${community.GROUPS.map(([k, l]) => html`<option value="${k}"${selected(w.audience || 'everyone', k)}>${l}</option>`)}</select></label>`,
    signup: html`<div class="wf-row"><label>Send ${num('signup_days', c.days ?? 3, 0, 365, 'days')} after they create their account</label></div>`,
    first_visit: html`<div class="wf-row"><label>Send ${num('first_days', c.days ?? 2, 0, 90, 'days')} after the family’s first check-in, to the parents</label></div>`,
    lapsed: html`<div class="wf-row"><label>Send when a family hasn’t checked in for ${num('weeks', c.weeks ?? 6, 1, 52, 'weeks')}</label></div><p class="hint">Sent once each time a family drifts away, to the parents.</p>`,
    serving: html`<div class="wf-row"><label>Send ${num('serve_days', c.days ?? 2, 0, 14, 'days')} before their serving day</label></div><p class="hint">Goes to everyone on the serving calendar for that day.</p>`,
  };
  return html`
  <p class="crumb"><a href="/checkin/automations#workflows">Automations</a></p>
  <div class="wf-builder">
    <h1>${isNew ? 'New workflow' : w.name}</h1>
    ${isNew ? html`<p class="wf-presets-line">Start from: ${Object.entries(PRESETS).map(([k, x]) => html`<a class="wf-mini-preset" href="/checkin/workflows/new?preset=${k}">${TRIGGER[x.trigger].icon} ${x.name}</a>`)}</p>` : ''}
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    <form method="post" action="${isNew ? '/checkin/workflows' : `/checkin/workflows/${w.id}`}" class="wf-form">
      ${csrfField(csrf)}
      <div class="wf-step"><span class="wf-step-n">1</span><div class="wf-step-body">
        <label for="wf-name" class="wf-label">Name</label>
        <input id="wf-name" name="name" value="${w.name || ''}" maxlength="80" required placeholder="e.g. Thank first-time guests">
      </div></div>

      <div class="wf-step"><span class="wf-step-n">2</span><div class="wf-step-body">
        <span class="wf-label">When should it send?</span>
        <div class="wf-triggers">${TRIGGERS.map((x) => html`<div class="wf-trigger">
          <label class="wf-trigger-pick"><input type="radio" name="trigger" value="${x.key}"${checked(trig === x.key)}>
            <span class="wf-trigger-icon" aria-hidden="true">${x.icon}</span><span><strong>${x.title}</strong><small>${x.blurb}</small></span></label>
          <div class="wf-config">${cfgFor[x.key]}</div>
        </div>`)}</div>
      </div></div>

      <div class="wf-step"><span class="wf-step-n">3</span><div class="wf-step-body">
        <span class="wf-label">How should it reach them?</span>
        <div class="wf-channels">${CHANNELS.map(([k, l, i]) => html`<label class="wf-channel"><input type="checkbox" name="channels[]" value="${k}"${checked(ch.has(k))}><span><b aria-hidden="true">${i}</b> ${l}</span></label>`)}</div>
        <p class="hint">Inbox messages come from ${isNew ? 'you' : 'the person who made this workflow'} and include an app notification. Replies come back to that Inbox.</p>
      </div></div>

      <div class="wf-step"><span class="wf-step-n">4</span><div class="wf-step-body">
        <label for="wf-subject" class="wf-label">Message</label>
        <input id="wf-subject" name="subject" value="${w.subject || ''}" maxlength="200" placeholder="Subject or title, e.g. Thanks for visiting, {first_name}!">
        <textarea id="wf-body" name="body" rows="9" maxlength="5000" required placeholder="Write your message…">${w.body || ''}</textarea>
        <p class="hint">Personalize with ${PLACEHOLDERS.map((p, i) => html`${i ? ', ' : ''}<code>{${p}}</code>`)}. ({family_name} reads like “The Miller Family”.) Leave a blank line between paragraphs. Emails end with the church’s contact details.</p>
        <div class="wf-row wf-button-row">
          <label>Button text <input name="button_label" value="${w.button_label || ''}" maxlength="60" placeholder="Optional, e.g. Open my account"></label>
          <label>Button link <input name="button_url" value="${w.button_url || ''}" maxlength="400" placeholder="/checkin/family or https://…"></label>
        </div>
      </div></div>

      <label class="wf-enable"><input type="checkbox" name="enabled" value="1"${checked(w.enabled !== false)}> Turn this workflow on</label>
      <div class="wf-actions">
        <button class="btn" type="submit" name="action" value="save">${isNew ? 'Create workflow' : 'Save'}</button>
        <button class="btn btn-quiet" type="submit" name="action" value="test">Save and send me a test</button>
        ${!isNew && trig === 'schedule' ? html`<button class="btn btn-quiet" type="submit" name="action" value="now" data-confirm-click="Send this to ${groupLabel(w.audience).toLowerCase()} right now?">Send now</button>` : ''}
      </div>
    </form>
    ${!isNew ? html`<form method="post" action="/checkin/workflows/${w.id}/delete" class="wf-delete" data-confirm="Delete the “${w.name}” workflow? This can’t be undone.">${csrfField(csrf)}<button class="linklike" type="submit">Delete this workflow</button></form>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- routes
function fromBody(b) {
  const trigger = TRIGGER[b.trigger] ? b.trigger : 'schedule';
  const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const config = {
    schedule: { repeat: ['weekly', 'monthly', 'once'].includes(b.repeat) ? b.repeat : 'weekly', weekday: int(b.weekday, 1, 7, 7), day: int(b.day, 1, 28, 1), date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null, time: /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '09:00' },
    signup: { days: int(b.signup_days, 0, 365, 3) },
    first_visit: { days: int(b.first_days, 0, 90, 2) },
    lapsed: { weeks: int(b.weeks, 1, 52, 6) },
    serving: { days: int(b.serve_days, 0, 14, 2) },
  }[trigger];
  const channels = [].concat(b.channels || []).filter((c) => CHANNELS.some(([k]) => k === c));
  const buttonUrl = clean(b.button_url, 400);
  return {
    name: clean(b.name, 80), trigger, config, audience: trigger === 'schedule' && community.GROUPS.some(([k]) => k === b.audience) ? b.audience : null,
    channels, subject: clean(b.subject, 200) || null, body: String(b.body || '').replace(/\r/g, '').trim().slice(0, 5000),
    button_label: clean(b.button_label, 60) || null, button_url: buttonUrl && (/^https?:\/\//.test(buttonUrl) || buttonUrl.startsWith('/')) ? buttonUrl : null,
    enabled: b.enabled === '1',
  };
}
const problem = (v) => (!v.name ? 'Give the workflow a name.' : !v.body ? 'Write the message.' : !v.channels.length ? 'Choose at least one way to send it.'
  : v.trigger === 'schedule' && v.config.repeat === 'once' && !v.config.date ? 'Pick the date to send it.' : null);

function routes(app, { render, needRole, currentEvent }) {
  const withEvent = async (req) => { req.ciEvent = await currentEvent(req); };
  const page = (req, res, w, opts = {}) => render(req, res, builder({ csrf: res.locals.csrf, w, ...opts }), { title: opts.isNew ? 'New workflow' : w.name || 'Workflow', tab: 'automations' });
  const load = async (id) => { const w = await db.one('SELECT * FROM workflows WHERE id = $1', [intParam(id)]); if (!w) throw new HttpError(404, 'That workflow was not found.'); return w; };

  async function afterSave(req, res, w, action) {
    if (action === 'test') {
      const me = { user_id: req.user.id, email: req.user.email, first_name: req.user.first_name, last_name: req.user.last_name, family_name: req.user.last_name, notify_email: true };
      const done = await deliver({ ...w, channels: parseCh(w).filter((c) => c !== 'inbox').concat(parseCh(w).includes('inbox') ? ['push'] : []) }, me, req.user, { test: true });
      security.flash(req, 'ok', `Saved. Test sent to you by ${done.length ? done.join(' and ').replace('push', 'app notification') : 'nothing (add an email address or turn on notifications)'}.`);
    } else if (action === 'now' && w.trigger === 'schedule') {
      const list = await usersByIds(await community.groupMembers(w.audience || 'everyone'));
      const stamp = Date.now();
      let n = 0;
      for (const r of list) { if (await A.logOnce(`wf-${w.id}`, `now${stamp}-u${r.user_id}`, r.email, r.user_id) && (await deliver(w, r, req.user)).length) n++; }
      await db.query('UPDATE workflows SET last_run_at = now() WHERE id = $1', [w.id]);
      security.flash(req, 'ok', `Sent to ${n} ${n === 1 ? 'person' : 'people'}.`);
    } else {
      security.flash(req, 'ok', `“${w.name}” saved${w.enabled ? ' and on' : ' (off)'}.`);
    }
    D.audit(req.user, 'workflow_save', { detail: `${w.id} ${w.name}${action !== 'save' ? ` (${action})` : ''}` });
    res.redirect(action === 'save' ? '/checkin/automations#workflows' : `/checkin/workflows/${w.id}`);
  }

  app.get('/checkin/workflows/new', needRole('coadmin'), async (req, res) => {
    await withEvent(req);
    const preset = PRESETS[req.query.preset];
    page(req, res, preset ? { ...preset, enabled: true } : { channels: ['email'], enabled: true, config: {} }, { isNew: true });
  });

  app.post('/checkin/workflows', needRole('coadmin'), async (req, res) => {
    const v = fromBody(req.body);
    const error = problem(v);
    if (error) { await withEvent(req); return page(req, res, v, { isNew: true, error }); }
    const w = await db.one(`INSERT INTO workflows (name, trigger, config, audience, channels, subject, body, button_label, button_url, enabled, created_by)
      VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [v.name, v.trigger, JSON.stringify(v.config), v.audience, JSON.stringify(v.channels), v.subject, v.body, v.button_label, v.button_url, v.enabled, req.user.id]);
    await afterSave(req, res, w, req.body.action || 'save');
  });

  app.get('/checkin/workflows/:id', needRole('coadmin'), async (req, res) => {
    await withEvent(req);
    page(req, res, await load(req.params.id));
  });

  app.post('/checkin/workflows/:id', needRole('coadmin'), async (req, res) => {
    const old = await load(req.params.id);
    const v = fromBody(req.body);
    const error = problem(v);
    if (error) { await withEvent(req); return page(req, res, { ...old, ...v }, { error }); }
    const w = await db.one(`UPDATE workflows SET name = $2, trigger = $3, config = $4::jsonb, audience = $5, channels = $6::jsonb, subject = $7, body = $8,
        button_label = $9, button_url = $10, enabled = $11, updated_at = now() WHERE id = $1 RETURNING *`,
    [old.id, v.name, v.trigger, JSON.stringify(v.config), v.audience, JSON.stringify(v.channels), v.subject, v.body, v.button_label, v.button_url, v.enabled]);
    await afterSave(req, res, w, req.body.action || 'save');
  });

  app.post('/checkin/workflows/:id/toggle', needRole('coadmin'), async (req, res) => {
    const w = await db.one('UPDATE workflows SET enabled = NOT enabled, updated_at = now() WHERE id = $1 RETURNING *', [intParam(req.params.id)]);
    if (!w) throw new HttpError(404, 'That workflow was not found.');
    security.flash(req, 'ok', `“${w.name}” is ${w.enabled ? 'on' : 'off'}.`);
    res.redirect('/checkin/automations#workflows');
  });

  app.post('/checkin/workflows/:id/delete', needRole('coadmin'), async (req, res) => {
    const w = await load(req.params.id);
    await db.query('DELETE FROM workflows WHERE id = $1', [w.id]);
    D.audit(req.user, 'workflow_delete', { detail: `${w.id} ${w.name}` });
    security.flash(req, 'ok', `Deleted “${w.name}”.`);
    res.redirect('/checkin/automations#workflows');
  });
}

module.exports = { routes, run, runOne, due, all, listSection, describe, PRESETS };

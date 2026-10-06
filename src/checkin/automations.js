'use strict';
// Automatic emails: welcome on sign-up, check-in/pickup notices, message emails,
// and birthday / Christmas / Easter greetings. Admins switch each one on or off
// and can reword the ones marked `editable` on the Automations page.
const db = require('../db');
const mailer = require('../lib/mailer');
const { esc } = require('../lib/html');
const t = require('../lib/time');
const { url } = require('../notify');
const prefs = require('./prefs');

const CHURCH = {
  name: 'Central Baptist Church',
  address: '904 Wheat Rd, Winfield, KS 67156',
  phone: '(620) 221-2980',
  email: 'centralbaptistchurchcalendar@gmail.com',
};
const FOOTER = `${CHURCH.name}<br>${CHURCH.address}<br>${CHURCH.phone} · ${CHURCH.email}`;
const CONTACT_HTML = `<strong>${CHURCH.name}</strong><br>${CHURCH.address}<br>Phone: <a href="tel:+16202212980">${CHURCH.phone}</a><br>Email: <a href="mailto:${CHURCH.email}">${CHURCH.email}</a>`;

const DEFS = [
  {
    key: 'welcome_signup', title: 'Welcome email when someone signs up', when: 'Right after a new account is created (family sign-up link or library application).',
    editable: true, button: 'Open my account', placeholders: ['first_name', 'account_link'],
    subject: 'Welcome to Central Baptist Church, {first_name}!',
    body: `Hi {first_name},

Thank you for signing up with Central Baptist Church. Your account is ready, and you can open it anytime with the button below.

From your account you can keep your family's details up to date, add allergies and emergency contacts for your children, sign permission forms, message other families, and choose which notifications you get.

We're so glad you're here. If you have any questions, reply to this email or give the church office a call.`,
  },
  { key: 'checkin_notice', title: 'Check-in notice to parents', when: 'When a child is checked in. Parents can turn it off for themselves in Settings.' },
  { key: 'pickup_notice', title: 'Pickup notice to parents', when: 'When a child is checked out or picked up.' },
  { key: 'prayer_weekly', title: 'Weekly prayer reminder', when: 'Monday mornings: everyone praying for an open request gets their prayer list (and the week’s new requests) by email and app notification, until the request is answered or removed.' },
  { key: 'prayer_checkin', title: '“Has God answered?” check-in', when: 'Asks the person who posted a prayer request whether it was answered: once a week for the first month, then once a month, until they mark it answered or remove it.' },
  { key: 'message_email', title: 'Email about unread messages', when: 'When someone gets a new message and hasn’t read it (at most one email per conversation every 30 minutes).' },
  {
    key: 'birthday_child', title: 'Happy birthday to children', when: 'Morning of a child’s birthday, emailed to their parents.',
    editable: true, placeholders: ['first_name', 'child_name', 'age'],
    subject: 'Happy birthday, {child_name}!',
    body: `Hi {first_name},

Everyone at Central wants to wish {child_name} a very happy birthday! We thank God for {child_name} and are so glad to have your family with us.

"For you formed my inward parts; you knitted me together in my mother's womb. I praise you, for I am fearfully and wonderfully made." (Psalm 139:13-14)`,
  },
  {
    key: 'birthday_adult', title: 'Happy birthday to adults', when: 'Morning of an adult’s birthday (when their birthday is on file).',
    editable: true, placeholders: ['first_name'],
    subject: 'Happy birthday, {first_name}!',
    body: `Happy birthday, {first_name}!

Your church family at Central is thankful for you and praying God's blessing over you this year.

"The LORD bless you and keep you; the LORD make his face to shine upon you and be gracious to you." (Numbers 6:24-25)`,
  },
  {
    key: 'anniversary', title: 'Happy anniversary', when: 'Morning of a couple’s wedding anniversary (when it’s on file).',
    editable: true, placeholders: ['first_name', 'years'],
    subject: 'Happy anniversary from Central!',
    body: `Happy anniversary, {first_name}!

Congratulations on {years} years of marriage. Your church family at Central is celebrating with you and thanking God for your marriage.

"Therefore what God has joined together, let no one separate." (Mark 10:9)`,
  },
  {
    key: 'christmas', title: 'Merry Christmas', when: 'Christmas morning, December 25.',
    editable: true, placeholders: ['first_name'],
    subject: 'Merry Christmas from Central Baptist Church',
    body: `Merry Christmas, {first_name}!

"For unto you is born this day in the city of David a Saviour, which is Christ the Lord." (Luke 2:11)

From all of us at Central Baptist Church, we pray you and your family have a joyful Christmas celebrating the birth of Jesus.`,
  },
  {
    key: 'easter', title: 'Happy Easter', when: 'Easter Sunday morning.',
    editable: true, placeholders: ['first_name'],
    subject: 'He is risen! Happy Easter from Central',
    body: `Happy Easter, {first_name}!

"He is not here: for he is risen, as he said." (Matthew 28:6)

We celebrate the risen Savior with you today. From all of us at Central Baptist Church, have a blessed Easter.`,
  },
];
const DEF = Object.fromEntries(DEFS.map((d) => [d.key, d]));

async function settings() {
  const rows = await db.many('SELECT * FROM automations');
  const saved = Object.fromEntries(rows.map((r) => [r.key, r]));
  return DEFS.map((d) => ({
    ...d,
    enabled: saved[d.key] ? saved[d.key].enabled : true,
    subject: (saved[d.key] && saved[d.key].subject) || d.subject,
    body: (saved[d.key] && saved[d.key].body) || d.body,
    customized: Boolean(saved[d.key] && (saved[d.key].subject || saved[d.key].body)),
    updated_at: saved[d.key] && saved[d.key].updated_at,
  }));
}
async function get(key) { return (await settings()).find((a) => a.key === key); }
const enabled = async (key) => { const a = await get(key); return !a || a.enabled; };

async function save(key, { enabled: on, subject, body }, userId) {
  if (!DEF[key]) return;
  const d = DEF[key];
  const sub = d.editable && subject && subject.trim() !== d.subject ? subject.trim().slice(0, 200) : null;
  const bod = d.editable && body && body.replace(/\r/g, '').trim() !== d.body ? body.replace(/\r/g, '').trim().slice(0, 5000) : null;
  await db.query(`INSERT INTO automations (key, enabled, subject, body, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, now())
    ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, subject = EXCLUDED.subject, body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [key, Boolean(on), sub, bod, userId || null]);
}

// "{first_name}" etc. Values are escaped; blank lines start new paragraphs.
function fill(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}
function paragraphs(text, vars) {
  const safeVars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, esc(v)]));
  return fill(esc(text).replace(/\{(\w+)\}/g, '{$1}'), safeVars).split(/\n\s*\n/).map((p) => p.trim().replace(/\n/g, '<br>')).filter(Boolean);
}

async function sendAutomation(a, to, vars, { button } = {}) {
  await mailer.send({
    to,
    libraryName: CHURCH.name,
    footer: FOOTER,
    subject: fill(a.subject, vars),
    heading: fill(a.subject, vars),
    paragraphs: [...paragraphs(a.body, vars), `<span style="color:#555">Questions? We’d love to hear from you:</span><br>${CONTACT_HTML}`],
    button,
  });
}

// Log once per (key, ref). Returns false if it was already sent.
async function once(key, ref, email, userId) {
  const row = await db.one('INSERT INTO automation_log (key, ref, email, user_id) VALUES ($1, $2, $3, $4) ON CONFLICT (key, ref) DO NOTHING RETURNING id', [key, String(ref), email || null, userId || null]);
  return Boolean(row);
}

// Welcome email for a brand-new account. `link` is the page their account opens to.
async function welcome(user, { link = '/checkin/family' } = {}) {
  try {
    const a = await get('welcome_signup');
    if (!a.enabled || !user || !user.email) return;
    if (!(await once('welcome_signup', `user-${user.id}`, user.email, user.id))) return;
    const accountLink = url(link);
    await sendAutomation(a, user.email, { first_name: user.first_name, account_link: accountLink }, { button: { label: DEF.welcome_signup.button, url: accountLink } });
  } catch (err) { console.error('Welcome email failed:', err.message); }
}

async function sendTest(key, user) {
  const a = await get(key);
  const vars = { first_name: user.first_name, child_name: 'Emma', age: 7, years: 10, account_link: url('/checkin/family') };
  await sendAutomation({ ...a, subject: `[Test] ${a.subject}` }, user.email, vars, a.key === 'welcome_signup' ? { button: { label: DEF.welcome_signup.button, url: vars.account_link } } : {});
}

// Easter Sunday (Gregorian, "anonymous" algorithm) as YYYY-MM-DD.
function easterKey(y) {
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100; const d = Math.floor(b / 4); const e = b % 4;
  const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Everyone who should get church-wide greetings: accounts plus parents on file, one email each.
async function greetingList() {
  const rows = await db.many(`SELECT DISTINCT ON (lower(email)) email, first_name, user_id, prefs, notify_email FROM (
      SELECT u.email, u.first_name, u.id AS user_id, u.prefs, u.notify_email FROM users u WHERE u.status IN ('approved', 'pending')
      UNION ALL
      SELECT p.email, p.first_name, u.id, u.prefs, u.notify_email FROM people p JOIN families f ON f.id = p.family_id AND f.status <> 'archived'
        LEFT JOIN users u ON u.id = p.user_id WHERE p.kind = 'adult' AND p.active AND p.email IS NOT NULL
    ) x WHERE email IS NOT NULL ORDER BY lower(email), user_id NULLS LAST`);
  return rows.filter((r) => !r.user_id || prefs.wants(r, 'email_greetings'));
}

// Runs every half hour; sends the day's greetings once, after 8 AM church time.
async function daily(now = new Date()) {
  const p = t.parts(now);
  if (p.hour < 8) return { skipped: 'before 8am' };
  const key = t.dateKey(now);
  const md = key.slice(5);
  const sent = { birthday_child: 0, birthday_adult: 0, anniversary: 0, christmas: 0, easter: 0 };
  const list = await settings();
  const on = Object.fromEntries(list.map((a) => [a.key, a]));

  if (on.birthday_child.enabled) {
    const kids = await db.many(`SELECT p.id, p.first_name, p.preferred_name, p.family_id, p.birthdate::text AS birthdate FROM people p JOIN families f ON f.id = p.family_id AND f.status <> 'archived'
      WHERE p.kind = 'child' AND p.active AND to_char(p.birthdate, 'MM-DD') = $1`, [md]);
    for (const k of kids) {
      const parents = await db.many(`SELECT p.email, p.first_name, u.id AS user_id, u.prefs, u.notify_email FROM people p LEFT JOIN users u ON u.id = p.user_id
        WHERE p.family_id = $1 AND p.kind = 'adult' AND p.active AND p.email IS NOT NULL`, [k.family_id]);
      for (const par of parents.filter((x) => !x.user_id || prefs.wants(x, 'email_greetings'))) {
        if (!(await once('birthday_child', `${k.id}-${par.email.toLowerCase()}-${p.year}`, par.email, par.user_id))) continue;
        await sendAutomation(on.birthday_child, par.email, { first_name: par.first_name, child_name: k.preferred_name || k.first_name, age: p.year - Number(k.birthdate.slice(0, 4)) });
        sent.birthday_child++;
      }
    }
  }
  if (on.birthday_adult.enabled) {
    const adults = await db.many(`SELECT DISTINCT ON (lower(p.email)) p.id, p.email, p.first_name, u.id AS user_id, u.prefs, u.notify_email FROM people p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.kind = 'adult' AND p.active AND p.email IS NOT NULL AND to_char(p.birthdate, 'MM-DD') = $1`, [md]);
    for (const a of adults.filter((x) => !x.user_id || prefs.wants(x, 'email_greetings'))) {
      if (!(await once('birthday_adult', `${a.email.toLowerCase()}-${p.year}`, a.email, a.user_id))) continue;
      await sendAutomation(on.birthday_adult, a.email, { first_name: a.first_name });
      sent.birthday_adult++;
    }
  }
  if (on.anniversary.enabled) {
    const couples = await db.many(`SELECT DISTINCT ON (lower(p.email)) p.email, p.first_name, p.family_id, p.anniversary::text AS anniversary, u.id AS user_id, u.prefs, u.notify_email
      FROM people p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.kind = 'adult' AND p.active AND p.email IS NOT NULL AND to_char(p.anniversary, 'MM-DD') = $1`, [md]);
    for (const a of couples.filter((x) => !x.user_id || prefs.wants(x, 'email_greetings'))) {
      if (!(await once('anniversary', `${a.email.toLowerCase()}-${p.year}`, a.email, a.user_id))) continue;
      await sendAutomation(on.anniversary, a.email, { first_name: a.first_name, years: p.year - Number(a.anniversary.slice(0, 4)) });
      sent.anniversary++;
    }
  }
  const holiday = md === '12-25' ? 'christmas' : key === easterKey(p.year) ? 'easter' : null;
  if (holiday && on[holiday].enabled) {
    for (const r of await greetingList()) {
      if (!(await once(holiday, `${r.email.toLowerCase()}-${p.year}`, r.email, r.user_id))) continue;
      await sendAutomation(on[holiday], r.email, { first_name: r.first_name });
      sent[holiday]++;
    }
  }
  Object.assign(sent, await require('./prayer').jobs(now, on, once));
  return sent;
}

function start() {
  const tick = () => daily().catch((err) => console.error('Greeting run failed:', err.message));
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, 30 * 60 * 1000).unref();
}

const recentLog = () => db.many(`SELECT l.*, u.first_name, u.last_name FROM automation_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.sent_at DESC LIMIT 25`);

module.exports = { CHURCH, FOOTER, DEFS, settings, get, enabled, save, welcome, sendTest, daily, start, easterKey, recentLog, paragraphs };

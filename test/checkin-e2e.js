'use strict';
// End-to-end walk-through of Central Check-In against a running server.
// Usage: BASE=http://localhost:3100 DATABASE_URL=... node test/checkin-e2e.js
const assert = require('node:assert');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const BASE = process.env.BASE || 'http://localhost:3100';
const DB = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/cbc';
const sql = (q) => execFileSync('psql', [DB, '-X', '-t', '-A', '-q', '-c', q], { encoding: 'utf8' }).trim();

class Browser {
  constructor() { this.cookies = {}; }
  async go(p, opts = {}) {
    const res = await fetch(BASE + p, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) this.cookies[k] = v; else delete this.cookies[k]; }
    const body = await res.text();
    const m = /name="csrf-token" content="([^"]+)"/.exec(body);
    if (m) this.csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), body };
  }
  async post(p, data) {
    if (!this.csrf) await this.go('/');
    const body = new URLSearchParams();
    body.append('_csrf', this.csrf);
    for (const [k, v] of Object.entries(data)) [].concat(v).forEach((x) => body.append(k, x));
    return this.go(p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  }
  async follow(r) { while (r.location) r = await this.go(r.location); return r; }
  async login(email, password) { await this.go('/login'); return this.post('/login', { email, password }); }
}

(async () => {
  const booksBefore = sql('SELECT count(*) FROM books');
  const admin = new Browser();
  let r = await admin.login('centralbaptistchurchcalendar@gmail.com', 'testpass123');
  assert.ok(r.location, 'admin can log in');

  // Event picker (or auto event on Sunday/Wednesday)
  r = await admin.go('/checkin?change=1');
  assert.match(r.body, /What are we checking in for\?/);
  r = await admin.follow(await admin.post('/checkin/event', { name: 'Sunday School' }));
  assert.match(r.body, /Recent families/);

  // New family with a child who has an allergy and a custody alert
  r = await admin.post('/checkin/families', { family_name: 'The Miller Family', kind: 'adult', first_name: 'Dana', last_name: 'Miller', relationship: 'Mother', email: 'dana@example.com', phone: '620-555-0110', contact_method: 'app', is_primary: '1' });
  const famId = /\/checkin\/families\/(\d+)/.exec(r.location)[1];
  await admin.post(`/checkin/families/${famId}/people`, { kind: 'child', first_name: 'Emma', last_name: 'Miller', birthdate: '2018-04-12', grade: '2nd', allergies: 'Peanuts', custody_alert: '1', custody_notes: 'Father may not pick up (order on file)' });
  await admin.post(`/checkin/families/${famId}/people`, { kind: 'child', first_name: 'Noah', last_name: 'Miller', birthdate: '2024-01-03' });
  await admin.post(`/checkin/families/${famId}/contacts`, { name: 'Grandma Jo', relationship: 'Grandmother', phone: '620-555-0199' });
  await admin.post(`/checkin/families/${famId}/pickups`, { name: 'Rick Miller', relationship: 'Father', not_allowed: '1', notes: 'Protective order 2026' });
  r = await admin.go(`/checkin/families/${famId}`);
  assert.match(r.body, /Allergy: Peanuts/);
  assert.match(r.body, /Custody: Father may not pick up/);

  // Search API finds the family by a child's name and by phone digits
  let j = JSON.parse((await admin.go('/checkin/api/families?q=emma')).body);
  assert.strictEqual(j[0].name, 'The Miller Family');
  j = JSON.parse((await admin.go('/checkin/api/families?q=5550110')).body);
  assert.strictEqual(j[0].name, 'The Miller Family');

  // Family check-in screen: everyone ticked, blocked pickup warning shown
  r = await admin.go(`/checkin/f/${famId}`);
  assert.match(r.body, /Not allowed to pick up:<\/strong> Rick Miller/);
  const people = [...r.body.matchAll(/name="people\[\]" value="(\d+)" checked/g)].map((m) => m[1]);
  assert.strictEqual(people.length, 3, 'two kids and one parent pre-ticked');
  const eventId = /name="event_id" value="(\d+)"/.exec(r.body)[1];
  // Volunteer unticks the parent: only kids check in
  const kidsIds = people.slice(0, 2);
  // Not the printer device: tags go to the print queue
  r = await admin.post(`/checkin/f/${famId}`, { event_id: eventId, 'people[]': kidsIds });
  assert.strictEqual(r.location, '/checkin');
  r = await admin.go(r.location);
  assert.match(r.body, /Name tags sent to the printer/);
  r = await admin.go('/checkin/print-queue');
  assert.match(r.body, /This device is the printer/);
  assert.match(r.body, /Emma, Noah \+ parent tag/);
  j = JSON.parse((await admin.go('/checkin/api/print-jobs')).body);
  assert.strictEqual(j.length, 1);
  r = await admin.go(`/checkin/print?embed=1&jobs=${j[0].id}`);
  assert.match(r.body, /data-embed/);
  const labels = (r.body.match(/class="label /g) || []).length;
  assert.strictEqual(labels, 3, 'two name tags and one parent pickup tag');
  assert.match(r.body, /Allergy:<\/strong> Peanuts/);
  assert.match(r.body, /aria-label="Peanut allergy"/, 'peanut symbol on the tag');
  assert.match(r.body, /<figcaption>Peanut<\/figcaption>/);
  assert.match(r.body, /class="l-class">Kids</);
  assert.match(r.body, /class="l-class">Toddlers</);
  const code = /<small>Code<\/small>([A-Z0-9]{4})/.exec(r.body)[1];
  assert.strictEqual(JSON.parse((await admin.go('/checkin/api/print-jobs')).body).length, 0, 'job marked printed');
  console.log('Printed 3 labels, pickup code', code);

  // Roster shows both kids in their age groups
  r = await admin.go('/checkin/roster');
  assert.match(r.body, /ci-group-label">Kids/);
  assert.match(r.body, /ci-group-label">Toddlers/);

  // Wrong code, then right code at pickup
  r = await admin.post('/checkin/scan', { event_id: eventId, code: 'ZZZZ' });
  assert.match(r.body, /No children are checked in with code ZZZZ/);
  r = await admin.post('/checkin/scan', { event_id: eventId, code: code.toLowerCase() });
  assert.match(r.body, /Stop\. Not allowed to pick up:<\/strong> Rick Miller/);
  const att = [...r.body.matchAll(/name="attendance\[\]" value="(\d+)" checked/g)].map((m) => m[1]);
  assert.strictEqual(att.length, 2);
  r = await admin.follow(await admin.post('/checkin/release', { event_id: eventId, 'attendance[]': att, to: 'Dana Miller (Mother)' }));
  assert.match(r.body, /Released Emma, Noah/);

  // This device becomes the printer: check-in goes straight to the tags
  admin.cookies.ci_printer = '1';
  r = await admin.post(`/checkin/f/${famId}`, { event_id: eventId, 'people[]': people });
  assert.match(r.location, /^\/checkin\/print\?jobs=\d+/);
  delete admin.cookies.ci_printer;
  // Reprint from the roster goes through the queue
  r = await admin.go('/checkin/roster');
  assert.match(r.body, /action="\/checkin\/reprint"/);
  r = await admin.post('/checkin/reprint', { event_id: eventId, family_id: famId, people: people[0], parent: '0' });
  assert.strictEqual(r.location, '/checkin/roster');
  // Then "check out all"
  r = await admin.follow(await admin.post('/checkin/checkout-all', { event_id: eventId }));
  assert.match(r.body, /2 children checked out/);

  // Parent invite → account → onboarding wizard → signed forms
  const tok = crypto.randomBytes(16).toString('base64url');
  sql(`INSERT INTO family_invites (family_id, email, token_hash, expires_at) VALUES (${famId}, 'dana@example.com', '${crypto.createHash('sha256').update(tok).digest('hex')}', now() + interval '1 day')`);
  const parent = new Browser();
  r = await parent.go(`/checkin/join/${tok}`);
  assert.match(r.body, /Welcome to Central/);
  r = await parent.post(`/checkin/join/${tok}`, { first_name: 'Dana', last_name: 'Miller', email: 'dana@example.com', password: 'danapass1' });
  assert.strictEqual(r.location, '/checkin/welcome/family');
  r = await parent.go('/checkin/welcome/family');
  assert.match(r.body, /The Miller Family/);
  await parent.post('/checkin/welcome/family', { family_name: 'The Miller Family', address: '1 Oak', city: 'Winfield', state: 'KS', zip: '67156', relationship: 'Mother', phone: '620-555-0110', contact_method: 'app', other_first_name: '' });
  r = await parent.follow(await parent.post('/checkin/welcome/kids', { first_name: 'Lily', last_name: 'Miller', birthdate: '2012-09-01', grade: '8th' }));
  assert.match(r.body, /Lily/);
  r = await parent.go('/checkin/welcome/health');
  const lilyId = /name="allergies_(\d+)"[^>]*><\/textarea>/.exec(r.body.replace(/\n/g, ''));
  await parent.post('/checkin/welcome/health', Object.fromEntries([...r.body.matchAll(/name="(allergies|medical_notes|medications|special_needs|custody_notes)_(\d+)"/g)].map((m) => [`${m[1]}_${m[2]}`, m[1] === 'allergies' && m[2] === (lilyId && lilyId[1]) ? 'Bee stings' : ''])));
  await parent.post('/checkin/welcome/contacts', { ec_name_0: 'Grandma Jo', ec_rel_0: 'Grandmother', ec_phone_0: '620-555-0199', pu_name_0: 'Aunt Sue', pu_rel_0: 'Aunt', pu_phone_0: '620-555-0123' });
  r = await parent.post('/checkin/welcome/agreements', { agree_participation: '1', agree_medical: '1', agree_esign: '1', signature: 'Dana' });
  assert.match(r.body, /Type your full name/, 'one-word signature rejected');
  r = await parent.follow(await parent.post('/checkin/welcome/agreements', { agree_participation: '1', agree_medical: '1', agree_esign: '1', agree_photo: '0', signature: 'Dana Miller', signer_relationship: 'Mother' }));
  assert.match(r.body, /Your family is all set/);
  assert.strictEqual(sql(`SELECT count(*) FROM waivers WHERE family_id = ${famId}`), '3', 'three required agreements recorded');
  assert.strictEqual(sql(`SELECT count(*) FROM people WHERE family_id = ${famId} AND photo_consent = false`), '3');
  // Parent can't reach staff pages
  assert.strictEqual((await parent.go('/checkin/roster')).status, 403);
  assert.strictEqual((await parent.go(`/checkin/families/${famId}`)).status, 403);

  // Team: create a volunteer; volunteer can check in but not manage families or team
  r = await admin.post('/checkin/staff/create', { first_name: 'Val', last_name: 'Helper', email: 'val@example.com', role: 'volunteer' });
  const temp = /code-big">([a-z]+-[a-z]+-\d+)</.exec(r.body)[1];
  const vol = new Browser();
  await vol.login('val@example.com', temp);
  assert.strictEqual((await vol.go('/checkin')).status, 200);
  assert.strictEqual((await vol.go('/checkin/staff')).status, 403);
  assert.strictEqual((await vol.go(`/checkin/families/${famId}`)).status, 403);
  await vol.post('/checkin/event', { name: 'Sunday School' });
  r = await vol.go(`/checkin/f/${famId}`);
  assert.match(r.body, /Custody alert: get a leader/, 'volunteer sees the alert but not the details');
  assert.ok(!/Father may not pick up/.test(r.body));

  // Families list: one-tap check-in for the current service
  r = await admin.go('/checkin/families');
  assert.match(r.body, new RegExp(`action="/checkin/quick/${famId}"`));
  r = await admin.follow(await admin.post(`/checkin/quick/${famId}`, { back: '/checkin/families' }));
  assert.match(r.body, /The Miller Family: \d+ checked in for Sunday School/);
  r = await admin.follow(await admin.post(`/checkin/quick/${famId}`, { back: '/checkin/families' }));
  assert.match(r.body, /already checked in/);

  // Not found at the desk: add a family, then the kids
  r = await admin.post('/checkin/new', { first_name: 'Sam', last_name: 'Ortiz', phone: '620-555-0177', relationship: 'Father', ec_name: 'Ana Ortiz', ec_phone: '620-555-0178' });
  const newFam = /\/checkin\/new\/(\d+)\/kids/.exec(r.location)[1];
  r = await admin.post(`/checkin/new/${newFam}/kids`, { first_name: 'Mia', last_name: 'Ortiz', class_override: 'Toddlers', allergies: 'Milk, eggs' });
  assert.ok(r.location);
  assert.strictEqual(sql(`SELECT count(*) FROM emergency_contacts WHERE family_id = ${newFam}`), '1');

  // Quick guest with the family they came with
  r = await admin.follow(await admin.post('/checkin/guest', { first_name: 'Jayden', phone: '620-555-0144', class_override: 'Kids', host_family_id: famId }));
  assert.match(r.body, /Jayden checked in as a guest with The Miller Family/);

  // Ask + HELP
  j = JSON.parse((await admin.go('/checkin/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf }, body: JSON.stringify({ q: 'who has allergies' }) })).body);
  assert.match(j.answer, /allerg/);
  assert.ok(j.items.some((x) => /Lily/.test(x.title) && /Bee/.test(x.sub)));
  j = JSON.parse((await admin.go('/checkin/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf }, body: JSON.stringify({ q: 'how do I archive an event' }) })).body);
  assert.ok(j.topics.some((x) => x.id === 'events'));
  j = JSON.parse((await admin.go('/checkin/api/help')).body);
  assert.ok(j.find((x) => x.id === 'tags'));
  r = await admin.go('/checkin');
  assert.match(r.body, /id="ci-ask-input"/);
  assert.match(r.body, />HELP</);

  // Events: listed, archive, restore; regular services can't be archived
  await admin.post('/checkin/event', { name: 'VBS Night 1' });
  r = await admin.go('/checkin/events');
  assert.match(r.body, /VBS Night 1/);
  const vbsId = sql("SELECT id FROM event_names WHERE name = 'VBS Night 1'");
  const ssId = sql("SELECT id FROM event_names WHERE name = 'Sunday School'");
  r = await admin.follow(await admin.post(`/checkin/events/${vbsId}/archive`, {}));
  assert.match(r.body, /VBS Night 1 archived/);
  r = await admin.go('/checkin?change=1');
  assert.ok(!/value="VBS Night 1"/.test(r.body), 'archived event not offered');
  r = await admin.follow(await admin.post(`/checkin/events/${ssId}/archive`, {}));
  assert.match(r.body, /regular service and stays/);
  r = await admin.follow(await admin.post(`/checkin/events/${vbsId}/restore`, {}));
  assert.match(r.body, /back on the check-in screen/);
  await admin.post('/checkin/events', { name: 'Christmas Eve' });
  assert.strictEqual(sql("SELECT archived FROM event_names WHERE name = 'Christmas Eve'"), 'f');
  assert.strictEqual((await vol.go('/checkin/events')).status, 403, 'volunteers can’t manage events');
  await admin.post('/checkin/event', { name: 'Sunday School' });

  // Reports
  r = await admin.go('/checkin/reports');
  assert.match(r.body, /Attendance reports/);
  assert.match(r.body, /Sunday School/);
  r = await admin.go('/checkin/reports.csv');
  assert.match(r.body, /Date,Event,Kids,Adults,Total/);
  console.log('Report CSV:', r.body.trim().split('\n').slice(1).join(' | '));


  // Reports and Team are admin-only now; volunteers are turned away
  assert.strictEqual((await vol.go('/checkin/reports')).status, 403);
  assert.strictEqual((await vol.go('/checkin/staff')).status, 403);
  assert.strictEqual((await vol.go('/checkin/automations')).status, 403);
  r = await vol.go('/checkin');
  assert.ok(!/href="\/checkin\/reports"/.test(r.body), 'volunteer menu has no Reports');

  // Welcome automation fired when the parent signed up
  assert.strictEqual(sql(`SELECT count(*) FROM automation_log WHERE key = 'welcome_signup' AND email = 'dana@example.com'`), '1');
  // Automations: edit the welcome email, turn greetings off
  r = await admin.go('/checkin/automations');
  assert.match(r.body, /Welcome email when someone signs up/);
  await admin.post('/checkin/automations/welcome_signup', { enabled: '1', subject: 'Welcome to Central, {first_name}!', body: 'Hi {first_name},\n\nSo glad you joined us.' });
  assert.strictEqual(sql(`SELECT subject FROM automations WHERE key = 'welcome_signup'`), 'Welcome to Central, {first_name}!');
  await admin.post('/checkin/automations/christmas', {});
  assert.strictEqual(sql(`SELECT enabled FROM automations WHERE key = 'christmas'`), 'f');

  // Settings: parent turns off check-in emails and hides from the directory
  r = await parent.go('/checkin/settings');
  assert.match(r.body, /Notifications/);
  assert.match(r.body, /Privacy/);
  await parent.post('/checkin/settings', { email_pickup: '1', push_checkin: '1', push_pickup: '1', email_messages: '1', push_messages: '1', directory: '1', messages_from: 'everyone' });
  const prefs = JSON.parse(sql(`SELECT prefs FROM users WHERE email = 'dana@example.com'`));
  assert.strictEqual(prefs.email_checkin, false);
  assert.strictEqual(prefs.email_pickup, true);

  // Inbox: volunteer messages the parent; parent sees it unread, replies
  r = await vol.go('/checkin/inbox/new?q=dana');
  assert.match(r.body, /Dana Miller/);
  const danaId = sql(`SELECT id FROM users WHERE email = 'dana@example.com'`);
  r = await vol.post('/checkin/inbox/new', { 'to[]': danaId, body: 'Hi Dana! Emma did great tonight.' });
  const convId = /\/checkin\/inbox\/(\d+)/.exec(r.location)[1];
  r = await parent.go('/checkin/inbox');
  assert.match(r.body, /Emma did great tonight/);
  assert.match(r.body, /class="ci-unread"/);
  r = await parent.go(`/checkin/inbox/${convId}`);
  assert.match(r.body, /Emma did great tonight/);
  r = await parent.go('/checkin/inbox');
  assert.ok(!/ci-conv is-unread/.test(r.body), 'read after opening');
  r = await parent.go(`/checkin/inbox/${convId}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ _csrf: parent.csrf, body: 'Thank you!' }) });
  assert.strictEqual(JSON.parse(r.body).message.body, 'Thank you!');
  j = JSON.parse((await vol.go(`/checkin/api/inbox/${convId}?after=0`)).body);
  assert.strictEqual(j.messages.length, 2);
  // Someone outside the conversation can't read it; an admin can review it
  const other = new Browser();
  await other.login('librarian@example.com', 'testpass123');
  assert.strictEqual((await other.go(`/checkin/inbox/${convId}`)).status, 404);
  r = await admin.go(`/checkin/inbox/${convId}`);
  assert.match(r.body, /reviewing this conversation/);
  // Privacy: hidden from the directory means other families can't find her (the team still can)
  await parent.post('/checkin/settings', { messages_from: 'everyone' });
  r = await other.go('/checkin/inbox/new?q=dana');
  assert.ok(!/Dana Miller/.test(r.body), 'hidden from families');
  r = await vol.go('/checkin/inbox/new?q=dana');
  assert.match(r.body, /Dana Miller/);
  // Report + block
  const msgId = sql(`SELECT id FROM messages WHERE body LIKE 'Hi Dana%'`);
  await parent.post(`/checkin/inbox/messages/${msgId}/report`, {});
  r = await admin.go('/checkin/inbox/review');
  assert.match(r.body, /Emma did great tonight/);
  const valId = sql(`SELECT id FROM users WHERE email = 'val@example.com'`);
  await parent.post(`/checkin/users/${valId}/block`, {});
  r = await vol.go(`/checkin/inbox/${convId}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ _csrf: vol.csrf, body: 'hello?' }) });
  assert.strictEqual(r.status, 403, 'blocked person can’t message');


  // Photos: the team adds one at the desk; the parent can see it; other families can't
  const emmaId = sql(`SELECT id FROM people WHERE first_name = 'Emma'`);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  r = await vol.post(`/checkin/people/${emmaId}/photo`, { photo_data: png, back: `/checkin/f/${famId}` });
  assert.strictEqual(r.location, `/checkin/f/${famId}`);
  r = await vol.go(`/checkin/f/${famId}`);
  assert.match(r.body, new RegExp(`/checkin/people/${emmaId}/photo\\?v=`));
  let ph = await parent.go(`/checkin/people/${emmaId}/photo`);
  assert.strictEqual(ph.status, 200);
  assert.strictEqual((await other.go(`/checkin/people/${emmaId}/photo`)).status, 404, 'other families can’t see photos');
  r = await parent.go('/checkin/family');
  assert.match(r.body, /Change photo/);
  await parent.post(`/checkin/people/${emmaId}/photo`, { remove: '1' });
  assert.strictEqual(sql(`SELECT count(*) FROM person_photos WHERE person_id = ${emmaId}`), '0');
  r = await vol.go('/checkin/scan');
  assert.match(r.body, /Scan a pickup tag/);
  assert.match(r.body, /scan128\.js/);

  // Greeting automation: a child's birthday today sends once
  sql(`UPDATE people SET birthdate = (CURRENT_DATE - interval '8 years')::date WHERE first_name = 'Lily'`);

  // The library was not touched
  assert.strictEqual(sql('SELECT count(*) FROM books'), booksBefore, 'library books unchanged');
  console.log('\nAll check-in checks passed. Books in library:', booksBefore);
})().catch((err) => { console.error(err); process.exit(1); });

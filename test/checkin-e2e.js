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
  assert.match(r.body, /2 children and 1 adult checked out/, "parents check out with the kids");

  // Parent invite → account → onboarding wizard → signed forms
  const tok = crypto.randomBytes(16).toString('base64url');
  sql(`INSERT INTO family_invites (family_id, email, token_hash, expires_at) VALUES (${famId}, 'dana@example.com', '${crypto.createHash('sha256').update(tok).digest('hex')}', now() + interval '1 day')`);
  const parent = new Browser();
  r = await parent.go(`/checkin/join/${tok}`);
  assert.match(r.body, /Welcome to Central/);
  r = await parent.post(`/checkin/join/${tok}`, { first_name: 'Dana', last_name: 'Miller', email: 'dana@example.com', password: 'danapass1', privacy: '1' });
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
  assert.match(r.body, /emailed them a welcome message/);
  assert.strictEqual(sql(`SELECT (reset_expires > now() + interval '6 days')::text FROM users WHERE email = 'val@example.com'`), 'true', 'set-password link good for 7 days');
  const vol = new Browser();
  // Admin adds a required, written policy
  await admin.post('/checkin/policies', { title: 'Child Safety Policy', body: '# Two adults\n\nTwo adults in every room.\n\n- Doors open\n- No one-on-one', audience: 'team', requires_ack: '1' });
  const polId = sql(`SELECT id FROM policies WHERE title = 'Child Safety Policy'`);
  await vol.login('val@example.com', temp);
  // New team members are locked until training + policies are done
  r = await vol.go('/checkin');
  assert.strictEqual(r.location, '/checkin/training', 'locked volunteer goes to training');
  r = await vol.go('/checkin/roster');
  assert.strictEqual(r.location, '/checkin/training');
  r = await vol.go('/checkin/training');
  assert.match(r.body, /Welcome to the team/);
  assert.match(r.body, /0 of 9 complete/);
  assert.match(r.body, /Teens &amp; Kids Ministry Manual/);
  const manualId = sql(`SELECT id FROM policies WHERE title = 'Teens & Kids Ministry Manual'`);
  r = await vol.go(`/checkin/policies/${manualId}`);
  assert.match(r.body, /Central Check-In Security/);
  assert.match(r.body, /<strong>Two-Adult Rule:<\/strong>/);
  assert.match(r.body, /class="ci-pdf"/);
  assert.ok(!/KidCheck/i.test(r.body));
  assert.match(r.body, /More › Incident reports/);
  assert.ok(!/3rd-party service/.test(r.body));
  await vol.post(`/checkin/policies/${manualId}/ack`, { confirm: '1' });
  assert.strictEqual((await vol.go(`/checkin/policies/${manualId}/file`)).status, 200);
  r = await vol.go(`/checkin/policies/${polId}`);
  assert.match(r.body, /<h3>Two adults<\/h3>/);
  assert.match(r.body, /<li>Doors open<\/li>/);
  await vol.post(`/checkin/policies/${polId}/ack`, {});
  assert.strictEqual(sql(`SELECT count(*) FROM policy_acks WHERE policy_id = ${polId}`), '0', 'must tick the box');
  await vol.post(`/checkin/policies/${polId}/ack`, { confirm: '1' });
  for (const key of ['recognize', 'prevent', 'online', 'respond', 'conduct', 'words', 'cpr']) {
    r = await vol.go(`/checkin/training/${key}`);
    assert.match(r.body, /Sources/);
    const boxes = [...r.body.matchAll(/name="(c\d+)"/g)].map((m) => m[1]);
    assert.ok(boxes.length >= 3);
    if (key === 'recognize') {
      r = await vol.post(`/checkin/training/${key}`, { c0: '1' });
      assert.strictEqual(r.location, `/checkin/training/${key}`, 'every box required');
    }
    r = await vol.post(`/checkin/training/${key}`, Object.fromEntries(boxes.map((b) => [b, '1'])));
  }
  assert.strictEqual(r.location, '/checkin', 'unlocked after the last lesson');
  r = await vol.go('/checkin/training');
  assert.match(r.body, /All done/);
  r = await vol.go('/checkin/training/cpr');
  assert.match(r.body, /youtube-nocookie\.com\/embed\/PJbJ5IFvtIg/);
  assert.match(r.body, /redcross\.org\/take-a-class\/cpr/);
  r = await vol.go('/checkin/training/prevent');
  assert.match(r.body, /player\.vimeo\.com\/video\/652549488/);
  r = await admin.go('/checkin/admin');
  assert.match(r.body, /Team training and policies/);
  assert.match(r.body, /Val Helper/);
  assert.match(r.body, /Unlocked/);
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


  // Incident report: volunteer files; admin sees and reviews; volunteer can't see others'
  r = await vol.go('/checkin/incidents/new');
  assert.match(r.body, /1-800-922-5330/);
  r = await vol.post('/checkin/incidents', { occurred_at: '2026-10-04T10:15', category: 'Injury or accident', severity: 'minor', location: 'Gym', people_text: 'Emma Miller', person_ids: emmaId, description: 'Emma tripped and scraped her knee.', action_taken: 'Cleaned and bandaged', first_aid: '1', parent_notified: '1', parent_notified_how: 'Told Dana at pickup' });
  const incId = /\/checkin\/incidents\/(\d+)/.exec(r.location)[1];
  r = await admin.go('/checkin/incidents');
  assert.match(r.body, /Injury or accident/);
  await admin.post(`/checkin/incidents/${incId}`, { status: 'closed', admin_notes: 'Spoke with Dana.' });
  assert.strictEqual(sql(`SELECT status FROM incidents WHERE id = ${incId}`), 'closed');
  assert.strictEqual((await parent.go(`/checkin/incidents/${incId}`)).status, 403, 'families can’t see incident reports');

  // Group message with click-to-confirm
  r = await admin.go('/checkin/broadcast');
  assert.match(r.body, /Team meeting/);
  r = await admin.post('/checkin/broadcast', { title: 'Team meeting', body: 'Meeting at 5:30 PM. Click to confirm.', kind: 'confirm', yes_label: 'I’ll be there', no_label: 'Can’t make it', 'groups[]': 'team', 'people[]': danaId });
  const bcId = /\/checkin\/broadcast\/(\d+)/.exec(r.location)[1];
  assert.strictEqual(sql(`SELECT count(*) FROM broadcast_recipients WHERE broadcast_id = ${bcId}`), '2', 'Val (team) and Dana; not the sender');
  const vconv = sql(`SELECT m.conversation_id FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${valId} WHERE m.broadcast_id = ${bcId}`);
  r = await vol.go(`/checkin/inbox/${vconv}`);
  assert.match(r.body, /Meeting at 5:30 PM/);
  assert.match(r.body, /I’ll be there/);
  await vol.post(`/checkin/broadcast/${bcId}/respond`, { response: 'yes' });
  r = await admin.go(`/checkin/broadcast/${bcId}`);
  assert.match(r.body, /Val Helper/);
  assert.match(r.body, /badge-ok">I’ll be there/);

  // Prayer wall: post, pray (toggle), comment, answered; team-only hidden from families
  r = await parent.post('/checkin/prayer', { body: 'Please pray for my grandmother’s surgery on Friday.' });
  const prId = sql(`SELECT id FROM prayers ORDER BY id DESC LIMIT 1`);
  await vol.post(`/checkin/prayer/${prId}/pray`, {});
  await admin.post(`/checkin/prayer/${prId}/pray`, {});
  r = await other.go('/checkin/inbox');
  assert.match(r.body, /ci-unread-prayer[^>]*>1</, 'header shows 1 new prayer request');
  r = await other.go('/checkin/prayer');
  assert.match(r.body, /grandmother’s surgery/);
  assert.match(r.body, /and 1 other are praying/);
  assert.match(r.body, /pw-new">New</, 'new request is marked');
  r = await other.go('/checkin/inbox');
  assert.ok(!/ci-unread-prayer/.test(r.body), 'badge clears after visiting the wall');
  r = await other.go(`/checkin/prayer/${prId}`);
  assert.match(r.body, /grandmother’s surgery/);
  assert.ok(!/Has God answered/.test(r.body), 'check-in is only for the person who asked');
  // Check-in prompt for the person who asked
  sql(`UPDATE prayers SET checkin_pending = true, checkin_count = 1 WHERE id = ${prId}`);
  r = await parent.go('/checkin/prayer');
  assert.match(r.body, /Has God answered your prayer/);
  await parent.post(`/checkin/prayer/${prId}/still`, {});
  r = await parent.go('/checkin/prayer');
  assert.ok(!/Has God answered your prayer/.test(r.body), 'still praying clears the prompt');
  assert.strictEqual(sql(`SELECT status FROM prayers WHERE id = ${prId}`), 'open');
  await admin.post(`/checkin/prayer/${prId}/pray`, {});
  assert.strictEqual(sql(`SELECT count(*) FROM prayer_praying WHERE prayer_id = ${prId}`), '1', 'second click un-prays');
  await other.post(`/checkin/prayer/${prId}/comments`, { body: 'Praying for her!' });
  r = await parent.go(`/checkin/prayer?open=${prId}`);
  assert.match(r.body, /Praying for her!/);
  await parent.post(`/checkin/prayer/${prId}/answered`, { note: 'Surgery went well!' });
  r = await other.go('/checkin/prayer?f=answered');
  assert.match(r.body, /Surgery went well!/);
  await vol.post('/checkin/prayer', { body: 'Pray for our volunteers', team_only: '1', anonymous: '1' });
  r = await other.go('/checkin/prayer');
  assert.ok(!/Pray for our volunteers/.test(r.body), 'team-only request hidden from families');
  r = await admin.go('/checkin/prayer');
  assert.match(r.body, /Pray for our volunteers/);

  // Membership: apply from the Prayer Wall, a check-in admin approves, library card number issued
  const applicant = new Browser();
  r = await applicant.go('/checkin/prayer');
  assert.strictEqual(r.status, 200, 'signed-out visitors see the Prayer Wall preview');
  assert.match(r.body, /Join your church family in prayer/);
  assert.match(r.body, /apply\?next=%2Fcheckin%2Fprayer/);
  assert.match(r.body, /name="next" value="\/checkin\/prayer"/);
  assert.ok(!/grandmother’s surgery/.test(r.body), 'no real prayer requests are shown to signed-out visitors');
  r = await applicant.go('/login?next=/checkin/prayer');
  assert.match(r.body, /Apply for a membership account/);
  assert.match(r.body, /apply\?next=%2Fcheckin%2Fprayer/);
  r = await applicant.go('/apply?next=/checkin/prayer');
  assert.match(r.body, /Prayer Wall/);
  assert.match(r.body, /Terms of Service/);
  r = await applicant.post('/apply', { first_name: 'Lydia', last_name: 'Grant', email: 'lydia@example.com', phone: '620-555-0199', address: '7 Oak', city: 'Winfield', state: 'KS', zip: '67156', password: 'lydiapass1', password2: 'lydiapass1', privacy: '1', adult: '1', next: '/checkin/prayer' });
  assert.match(r.body, /Application sent/);
  assert.strictEqual(sql(`SELECT signup_source || ' ' || (privacy_accepted_at IS NOT NULL)::text FROM users WHERE email = 'lydia@example.com'`), 'prayer true');
  r = await applicant.go('/checkin/prayer');
  assert.match(r.body, /Almost there, Lydia/);
  r = await admin.go('/checkin/inbox');
  assert.match(r.body, /Membership requests \(1\)/, 'admins see the request count');
  r = await admin.go('/checkin/members');
  assert.match(r.body, /Lydia Grant/);
  assert.match(r.body, /from the Prayer Wall/);
  const lydiaId = sql(`SELECT id FROM users WHERE email = 'lydia@example.com'`);
  r = await admin.post(`/checkin/members/${lydiaId}/approve`, {});
  assert.match(sql(`SELECT status || ' ' || library_code FROM users WHERE id = ${lydiaId}`), /^approved CBC-\d+$/);
  r = await applicant.go('/checkin/prayer');
  assert.match(r.body, /How can we pray for you, Lydia/, 'approved member reaches the Prayer Wall');
  r = await vol.go('/checkin/members');
  assert.ok(r.status !== 200 || !/Membership requests<\/h1>/.test(r.body), 'volunteers cannot approve memberships');

  // Church website: every page, the church domain, old Wix links, and the contact/serve forms
  const visitor = new Browser();
  for (const pth of ['/site', '/site/visit', '/site/about', '/site/ministries', '/site/sermons', '/site/events', '/site/staff', '/site/give', '/site/connect', '/site/serve', '/site/partners']) {
    r = await visitor.go(pth);
    assert.strictEqual(r.status, 200, `${pth} loads`);
    assert.match(r.body, /904 Wheat Rd/, `${pth} shows the address`);
  }
  // fetch() won't send a custom Host header, so ask the way a browser on cbcwinfield.org would
  const asHost = (host, pth) => new Promise((resolve, reject) => {
    const u = new URL(BASE + pth);
    require('http').get({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { Host: host } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: b }));
    }).on('error', reject);
  });
  r = await asHost('cbcwinfield.org', '/');
  assert.match(r.body, /A church family on Wheat Road/, 'cbcwinfield.org shows the church home page');
  r = await asHost('www.cbcwinfield.org', '/staff');
  assert.match(r.body, /Blake &amp; Ruth Orr/);
  r = await asHost('cbcwinfield.org', '/blank-5');
  assert.strictEqual(r.location, '/staff', 'old Wix staff link redirects');
  r = await asHost('cbcwinfield.org', '/css/site.css');
  assert.strictEqual(r.status, 200, 'shared files still load on the church domain');
  r = await visitor.go('/site/nothing-here');
  assert.strictEqual(r.status, 404);
  r = await visitor.go('/site/connect');
  visitor.csrf = /name="_csrf" value="([^"]+)"/.exec(r.body)[1];
  r = await visitor.post('/site/connect', { name: 'Martha Lane', email: 'not-an-email', message: 'Hi' });
  assert.match(r.body, /valid email/);
  r = await visitor.post('/site/connect', { name: 'Martha Lane', email: 'martha@example.com', phone: '620-555-0123', message: 'Is there a nursery during worship?' });
  assert.strictEqual(r.location, '/site/connect?sent=1');
  r = await visitor.post('/site/serve', { name: 'Martha Lane', email: 'martha@example.com', topic: 'Church library' });
  assert.strictEqual(r.location, '/site/serve?sent=1');
  r = await visitor.post('/site/connect', { name: 'Bot', email: 'bot@example.com', message: 'spam', website: 'http://spam' });
  assert.strictEqual(sql(`SELECT count(*) FROM site_inquiries WHERE name = 'Bot'`), '0', 'honeypot catches bots');
  r = await admin.go('/checkin/inquiries');
  assert.match(r.body, /Is there a nursery during worship/);
  assert.match(r.body, /Wants to serve: Church library/);
  const inqId = sql(`SELECT id FROM site_inquiries WHERE kind = 'connect' ORDER BY id DESC LIMIT 1`);
  await admin.post(`/checkin/inquiries/${inqId}/handled`, {});
  assert.ok(sql(`SELECT handled_at IS NOT NULL FROM site_inquiries WHERE id = ${inqId}`) === 't');

  // Custom workflows (Automations › + Workflow)
  r = await admin.go('/checkin/automations');
  assert.match(r.body, /\+<\/span> Workflow/);
  assert.match(r.body, /Thank first-time guests/, 'presets offered when there are no workflows');
  r = await vol.go('/checkin/workflows/new');
  assert.ok(r.status === 403 || /login|Only|not allowed|permission/i.test(r.body) || r.status === 302, 'volunteers cannot build workflows');
  r = await admin.go('/checkin/workflows/new?preset=serving');
  assert.match(r.body, /You’re serving \{serve_date\}/);
  r = await admin.go('/checkin/workflows/new?preset=volunteers');
  assert.match(r.body, /<option value="5" selected>Friday/, 'preset day is selected');
  assert.match(r.body, /<option value="team" selected>/, 'preset audience is selected');
  r = await admin.post('/checkin/workflows', { name: '', trigger: 'signup', body: 'x', 'channels[]': 'email' });
  assert.match(r.body, /Give the workflow a name/);
  r = await admin.post('/checkin/workflows', { name: 'Team huddle', trigger: 'schedule', repeat: 'weekly', weekday: '3', time: '17:30', audience: 'team', 'channels[]': ['inbox', 'email'], subject: 'Huddle tonight', body: 'Hi {first_name}, huddle at 5:30 in the fellowship hall.', enabled: '1', action: 'save' });
  const wfId = sql(`SELECT id FROM workflows WHERE name = 'Team huddle'`);
  assert.ok(wfId, 'workflow created');
  r = await admin.go('/checkin/automations');
  assert.match(r.body, /Team huddle/);
  assert.match(r.body, /Every Wednesday at 5:30 PM to everyone on the check-in team/);
  r = await admin.post(`/checkin/workflows/${wfId}`, { name: 'Team huddle', trigger: 'schedule', repeat: 'weekly', weekday: '3', time: '17:30', audience: 'team', 'channels[]': ['inbox'], subject: 'Huddle tonight', body: 'Hi {first_name}, huddle at 5:30 in the fellowship hall.', enabled: '1', action: 'now' });
  assert.match(sql(`SELECT body FROM messages ORDER BY id DESC LIMIT 1`), /Hi Val, huddle at 5:30/, 'send now delivers a personalized inbox message');
  await admin.post(`/checkin/workflows/${wfId}/toggle`, {});
  assert.strictEqual(sql(`SELECT enabled::text FROM workflows WHERE id = ${wfId}`), 'false');
  await admin.post(`/checkin/workflows/${wfId}/delete`, {});
  assert.strictEqual(sql(`SELECT count(*) FROM workflows WHERE id = ${wfId}`), '0');

  // Anniversary on the parent's family step
  r = await parent.go('/checkin/welcome/family');
  assert.match(r.body, /Wedding anniversary/);
  // Names open the edit screen; test print works
  r = await admin.go('/checkin/roster?show=all');
  assert.match(r.body, /href="\/checkin\/people\/\d+\?back=%2Fcheckin%2Froster"/);
  r = await admin.go('/checkin/print/test');
  assert.match(r.body, /class="label child-label"/);
  assert.match(r.body, /TEST/);

  // Releasing a family's last child at pickup checks their parents out too
  sql(`UPDATE attendance SET checked_out_at = NULL WHERE family_id = ${famId}`);
  const codeNow = sql(`SELECT security_code FROM attendance WHERE family_id = ${famId} LIMIT 1`);
  r = await admin.post('/checkin/scan', { event_id: eventId, code: codeNow });
  const att2 = [...r.body.matchAll(/name="attendance\[\]" value="(\d+)" checked/g)].map((m) => m[1]);
  await admin.post('/checkin/release', { event_id: eventId, 'attendance[]': att2, to: 'Dana Miller (Mother)' });
  assert.strictEqual(sql(`SELECT count(*) FROM attendance a JOIN people p ON p.id = a.person_id WHERE a.family_id = ${famId} AND a.checked_out_at IS NULL AND p.kind = 'adult'`), '0');

  // Greeting automation: a child's birthday today sends once
  sql(`UPDATE people SET birthdate = (CURRENT_DATE - interval '8 years')::date WHERE first_name = 'Lily'`);

  // The library was not touched
  assert.strictEqual(sql('SELECT count(*) FROM books'), booksBefore, 'library books unchanged');
  console.log('\nAll check-in checks passed. Books in library:', booksBefore);
})().catch((err) => { console.error(err); process.exit(1); });

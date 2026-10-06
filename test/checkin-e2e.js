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
  r = await admin.follow(await admin.post('/checkin/event', { name: 'Sunday Service' }));
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
  r = await admin.post(`/checkin/f/${famId}`, { event_id: eventId, 'people[]': kidsIds });
  assert.match(r.location, /^\/checkin\/print\?/);
  r = await admin.go(r.location);
  const labels = (r.body.match(/class="label /g) || []).length;
  assert.strictEqual(labels, 3, 'two name tags and one parent pickup tag');
  assert.match(r.body, /Allergy: Peanuts/);
  const code = /<small>Code<\/small>([A-Z0-9]{4})/.exec(r.body)[1];
  console.log('Printed 3 labels, pickup code', code);

  // Roster shows both kids in their age groups
  r = await admin.go('/checkin/roster');
  assert.match(r.body, /Central Kids/);
  assert.match(r.body, /Nursery/);

  // Wrong code, then right code at pickup
  r = await admin.post('/checkin/scan', { event_id: eventId, code: 'ZZZZ' });
  assert.match(r.body, /No children are checked in with code ZZZZ/);
  r = await admin.post('/checkin/scan', { event_id: eventId, code: code.toLowerCase() });
  assert.match(r.body, /Stop\. Not allowed to pick up:<\/strong> Rick Miller/);
  const att = [...r.body.matchAll(/name="attendance\[\]" value="(\d+)" checked/g)].map((m) => m[1]);
  assert.strictEqual(att.length, 2);
  r = await admin.follow(await admin.post('/checkin/release', { event_id: eventId, 'attendance[]': att, to: 'Dana Miller (Mother)' }));
  assert.match(r.body, /Released Emma, Noah/);

  // Check in again, then "check out all"
  await admin.post(`/checkin/f/${famId}`, { event_id: eventId, 'people[]': people });
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
  await vol.post('/checkin/event', { name: 'Sunday Service' });
  r = await vol.go(`/checkin/f/${famId}`);
  assert.match(r.body, /Custody alert: get a leader/, 'volunteer sees the alert but not the details');
  assert.ok(!/Father may not pick up/.test(r.body));

  // Reports
  r = await admin.go('/checkin/reports');
  assert.match(r.body, /Attendance reports/);
  assert.match(r.body, /Sunday Service/);
  r = await admin.go('/checkin/reports.csv');
  assert.match(r.body, /Date,Event,Kids,Adults,Total/);
  console.log('Report CSV:', r.body.trim().split('\n').slice(1).join(' | '));

  // The library was not touched
  assert.strictEqual(sql('SELECT count(*) FROM books'), booksBefore, 'library books unchanged');
  console.log('\nAll check-in checks passed. Books in library:', booksBefore);
})().catch((err) => { console.error(err); process.exit(1); });

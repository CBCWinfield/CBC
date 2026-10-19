'use strict';
// Old library card numbers, a librarian changing a code by hand, and the church's email, against a running server.
// Run after test/e2e.js on the same database (it uses that test's librarian and patron Ruth).
// Usage: BASE=http://localhost:3100 node test/cards-e2e.js
const assert = require('node:assert');
const BASE = process.env.BASE || 'http://localhost:3100';
const jar = {};
async function go(p, opts = {}) {
  const res = await fetch(BASE + p, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) jar[k] = v; else delete jar[k]; }
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}
let csrf = '';
const get = async (p) => { const r = await go(p); csrf = (/name="csrf-token" content="([^"]+)"/.exec(r.body) || [])[1] || csrf; return r; };
const post = (p, o) => go(p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...o }) });
const follow = async (r) => { while (r.location) r = await get(r.location); return r; };
const ok = (m) => console.log('ok  ', m);
const codeOf = async (q) => { const r = await get(`/admin/patrons?q=${encodeURIComponent(q)}`); const m = /\/admin\/patrons\/(\d+)">[^<]*<\/a>(?:[^]*?)<td>(CBC-\d+)?<\/td>/.exec(r.body); return m ? { id: m[1], code: m[2] } : null; };

(async () => {
  // the church's email
  for (const p of ['/site', '/site/connect', '/privacy']) { const r = await get(p); assert.ok(r.body.includes('info@cbcwinfield.com'), p); assert.ok(!r.body.includes('centralbaptistchurchcalendar@gmail.com'), p); }
  ok('the site shows info@cbcwinfield.com');

  await get('/login');
  let r = await post('/login', { email: 'librarian@example.com', password: 'testpass123' });
  assert.strictEqual(r.location, '/admin');
  r = await get('/admin/patrons'); assert.match(r.body, /Card numbers from the old library/);

  // paste the old list and check it: nothing changes yet
  const list = 'Number,Name\n1023, ruth@example.com\n"17","Rarian, Lib"\n99, nobody@example.com\nhello there';
  r = await get('/admin/patrons/old-numbers'); assert.strictEqual(r.status, 200);
  r = await post('/admin/patrons/old-numbers', { list });
  assert.match(r.body, /<strong>CBC-1023<\/strong>/);
  assert.match(r.body, /<strong>CBC-17<\/strong>/);
  assert.match(r.body, /No account here matches/);
  assert.match(r.body, /No card number on this line/);
  assert.match(r.body, /Use these numbers \(2\)/);
  const before = await codeOf('ruth@example.com'); assert.notStrictEqual(before.code, 'CBC-1023', 'not changed by checking');
  ok('checking the list shows what would change, and changes nothing');

  // use them
  r = await follow(await post('/admin/patrons/old-numbers', { list, apply: '1' }));
  assert.match(r.body, /Gave 2 people their old library card number/);
  assert.strictEqual((await codeOf('ruth@example.com')).code, 'CBC-1023');
  assert.strictEqual((await codeOf('librarian@example.com')).code, 'CBC-17');
  ok('the old numbers are used: Ruth CBC-1023, the librarian CBC-17');

  // Ruth signs in at the desk with her old number
  r = await get('/admin/checkouts/new');
  r = await post('/admin/checkouts/new', { patron: '1023', book: '#2' });
  assert.ok(!/No patron has that library code/.test(r.body), 'the desk finds her by 1023');
  ok('the desk finds Ruth by 1023');

  // by hand on the patron page, and a number someone else has is refused
  const ruth = await codeOf('ruth@example.com');
  r = await get(`/admin/patrons/${ruth.id}`); assert.match(r.body, /name="library_code" value="CBC-1023"/);
  const form = { first_name: 'Ruth', last_name: 'Miller', email: 'ruth@example.com', phone: '620-555-0101' };
  r = await follow(await post(`/admin/patrons/${ruth.id}`, { ...form, library_code: 'CBC-17' }));
  assert.match(r.body, /CBC-17 already belongs to/);
  r = await follow(await post(`/admin/patrons/${ruth.id}`, { ...form, library_code: '#1040' }));
  assert.match(r.body, /library code is now CBC-1040/);
  assert.strictEqual((await codeOf('ruth@example.com')).code, 'CBC-1040');
  ok('a code can be changed by hand; one in use is refused');

  // new codes skip numbers that were given by hand
  // the next number the library would give out (codes given out so far run up from 1001; 1023 and up were set by hand above)
  const all = (await get('/admin/patrons')).body.match(/CBC-(\d+)/g).map((x) => +x.slice(4)).filter((n) => n >= 1001 && n < 1023);
  const next = Math.max(...all) + 1;
  r = await follow(await post(`/admin/patrons/${ruth.id}`, { ...form, library_code: String(next) }));
  r = await post('/admin/patrons/new', { first_name: 'Nina', last_name: 'New', email: 'nina@example.com' });
  r = await follow(r);
  const nina = await codeOf('nina@example.com');
  assert.strictEqual(nina && nina.code, `CBC-${next + 1}`, `a new code skips CBC-${next}, which Ruth has`);
  ok(`a new member gets ${nina.code}, skipping CBC-${next}`);
  console.log('\nAll card number checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });

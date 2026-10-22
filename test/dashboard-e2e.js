'use strict';
// The homepage's Prayer Wall button, signing in, and the member dashboard, against a running server.
// Run after test/e2e.js on the same database (it signs in as that test's patron, Ruth).
// Usage: BASE=http://localhost:3100 node test/dashboard-e2e.js
const assert = require('node:assert');
const BASE = process.env.BASE || 'http://localhost:3100';
const jar = {};
async function go(p, opts = {}) {
  const res = await fetch(BASE + p, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) jar[k] = v; else delete jar[k]; }
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}
const csrf = (h) => (/name="csrf-token" content="([^"]+)"/.exec(h) || [])[1];
const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });

(async () => {
  // the homepage: a Prayer Wall button in the header and in the phone menu, to the member dashboard
  let r = await go('/site');
  const links = r.body.match(/href="[^"]*\/checkin\/home"[^>]*>Prayer/g) || [];
  assert.ok(links.length >= 3, 'header button, phone pill and menu: ' + links.length);
  console.log('ok   the homepage has the Prayer Wall button');
  assert.match(r.body, /<a class="btn btn-ghost btn-sm" href="\/site\/library">Library<\/a>/, 'a Library button in the header');
  assert.match(r.body, /<a class="nav-pill nav-library" href="\/site\/library" aria-label="Library">/, 'and on phones');
  assert.doesNotMatch(r.body, /href="https:\/\/admin\.cbcwinfield\.org\/"/, 'no link goes to the old library address');
  assert.strictEqual((r.body.match(/href="\/site\/library"/g) || []).length, 5, 'header button, phone button, menu, phone menu and footer');
  console.log('ok   the header has a Library button, to /library');

  // cbcwinfield.org/library opens the library, page and search included
  // (fetch can't set the Host header, so a plain request, as a browser on cbcwinfield.org would send)
  const raw = (p, host) => new Promise((ok, bad) => {
    const u = new URL(BASE + p);
    require('node:http').get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: host ? { Host: host } : {} }, (res) => { res.resume(); ok({ status: res.statusCode, location: res.headers.location || null }); }).on('error', bad);
  });
  let x = await raw('/site/library');
  assert.strictEqual(x.status, 302); assert.match(x.location, /^https?:\/\/[^/]+\/$/);
  const app = x.location.replace(/\/$/, '');
  assert.deepStrictEqual(await raw('/library', 'cbcwinfield.org'), { status: 302, location: `${app}/` });
  assert.deepStrictEqual(await raw('/library/', 'www.cbcwinfield.org'), { status: 302, location: `${app}/` });
  assert.deepStrictEqual(await raw('/library/books/12/checkout?from=site', 'cbcwinfield.org'), { status: 302, location: `${app}/books/12/checkout?from=site` });
  assert.deepStrictEqual(await raw('/library/catalog?audience=Children&q=noah', 'cbcwinfield.org'), { status: 302, location: `${app}/catalog?audience=Children&q=noah` });
  assert.strictEqual((await raw('/libraryx', 'cbcwinfield.org')).status, 404);
  console.log('ok   cbcwinfield.org/library opens the library (and /library/... the same page there)');

  // signed out, the dashboard asks to sign in and comes back to it
  r = await go('/checkin/home');
  assert.match(r.body, /Join your church family in prayer/);
  assert.match(r.body, /name="next" value="\/checkin\/home"/);
  r = await go('/login', form({ _csrf: csrf(r.body), email: 'ruth@example.com', password: 'ruthpass1', next: '/checkin/home' }));
  assert.strictEqual(r.location, '/checkin/home');
  console.log('ok   signing in from it lands on the dashboard');

  // the dashboard: options above the Prayer Wall, Give to the church's giving page
  r = await go('/checkin/home');
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /class="dash-tile dash-prayer" href="\/checkin\/prayer" aria-current="page"/);
  assert.match(r.body, /class="dash-tile dash-give is-gold" href="https:\/\/secure\.myvanco\.com\/YGQD\/home"[^>]*target="_blank"/);
  for (const t of ['Inbox', 'My family', 'Library', 'Watch']) assert.ok(r.body.includes(`<span class="dash-label">${t}`), t);
  assert.match(r.body, /<h1>Prayer Wall<\/h1>/, 'the wall is open underneath');
  assert.match(r.body, /How can we pray for you, Ruth\?/);
  r = await go('/checkin/prayer');
  assert.match(r.body, /class="dash-tile dash-give/, 'the options are on the wall too');
  console.log('ok   the dashboard shows the options with the Prayer Wall open');

  // signing in with no destination also lands on the dashboard
  await go('/logout', form({ _csrf: csrf(r.body) }));
  r = await go('/login');
  r = await go('/login', form({ _csrf: csrf(r.body), email: 'ruth@example.com', password: 'ruthpass1' }));
  assert.ok(['/checkin/home', '/admin'].includes(r.location), r.location); // /admin if an earlier test made Ruth staff
  console.log('ok   a plain sign-in goes to the dashboard (' + r.location + ')');
  console.log('\nAll dashboard checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
// Bringing back the old library's italics by itself, from the old website's shop listing (a stand-in site here,
// built from the old export and changed the way WordPress changes text as it shows it: curly quotes, "…",
// paragraphs). Run after test/e2e.js and test/categories-e2e.js on the same database, with the server running.
// Usage: BASE=http://localhost:3100 DATABASE_URL=postgresql://... PG_SHIM=1 node test/italics-restore-e2e.js
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { parseCsv } = require('../src/lib/csv');

const BASE = process.env.BASE || 'http://localhost:3100';
const ok = (m) => console.log('ok  ', m);

// The old site, as WordPress would show it.
const rows = parseCsv(fs.readFileSync(path.join(__dirname, 'fixtures/old-library-sample.csv'), 'utf8'));
const head = rows[0];
const col = (r, name) => r[head.indexOf(name)] || '';
const texturize = (s) => s.replace(/(\w)'(\w)/g, '$1’$2').replace(/'/g, '’').replace(/"([^"<>]*)"/g, '“$1”').replace(/\.\.\./g, '…').replace(/ -- /g, ' – ');
const autop = (s) => s.replace(/\\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => (/^<(h\d|ul|ol|p|div)/.test(p) ? p : `<p>${p.replace(/\n/g, '<br />\n')}</p>`)).join('\n');
const products = rows.slice(1).filter((r) => col(r, 'Title')).map((r) => ({
  id: Number(col(r, 'ean_isbn13')), name: col(r, 'Title').replace(/&/g, '&#038;'),
  description: texturize(autop(col(r, 'description'))), short_description: texturize(autop(col(r, 'Short description'))),
}));
const PER = 30; // smaller pages than asked for, to walk through several
const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/wp-json/wc/store/v1/products') { res.writeHead(404); return res.end('not found'); }
  const page = Number(u.searchParams.get('page')) || 1;
  res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'X-WP-Total': products.length, 'X-WP-TotalPages': Math.ceil(products.length / PER) });
  res.end(JSON.stringify(products.slice((page - 1) * PER, page * PER)));
});

(async () => {
  await new Promise((r) => site.listen(3199, r));
  process.env.OLD_SITE_URL = 'http://localhost:3199';
  const db = require('../src/db');
  const { restoreItalics, KEY } = require('../src/italics-restore');

  // the books as the first import left them: no stars; one description edited since
  await db.query("UPDATE books SET description = replace(description, '*', ''), short_description = replace(short_description, '*', '') WHERE legacy_id IS NOT NULL");
  await db.query("UPDATE books SET description = description || ' Edited since.' WHERE title = 'Marley & Me'");
  await db.query('DELETE FROM settings WHERE key = $1', [KEY]);
  const before = new Map((await db.many('SELECT id, title, description, short_description FROM books WHERE legacy_id IS NOT NULL')).map((b) => [b.id, b]));

  const r = await restoreItalics({ force: true });
  assert.ok(r.done_at, JSON.stringify(r));
  assert.strictEqual(r.read, products.length, 'read every page');
  assert.ok(r.restored >= 20, `restored ${r.restored}`);
  assert.strictEqual(r.edited, 1);
  const rich = require('../src/lib/richtext');
  const after = await db.many('SELECT id, title, description, short_description FROM books WHERE legacy_id IS NOT NULL');
  let changed = 0;
  for (const b of after) {
    const was = before.get(b.id);
    for (const k of ['description', 'short_description']) {
      if (b[k] !== was[k]) { changed++; assert.strictEqual(rich.plain(b[k]), was[k], `only stars were added to ${b.title}`); }
    }
  }
  assert.ok(changed >= r.restored);
  const blotch = after.find((b) => b.title === 'Blotch');
  assert.match(blotch.description, /A parable for today's children, \*Blotch\* helps kids/, 'straight apostrophe kept, italics back');
  assert.doesNotMatch(after.find((b) => b.title === 'Marley & Me').description, /\*/);
  ok(`brought back the italics in ${r.restored} books from the old site (curly quotes and all), left the edited one alone`);

  // once is enough
  const again = await restoreItalics();
  assert.strictEqual(again.done_at, r.done_at);
  ok('it runs once');

  // the Import page says so
  const jar = {};
  const go = async (p, opts = {}) => {
    const res = await fetch(BASE + p, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) jar[k] = v; }
    return res.text();
  };
  const login = await go('/login');
  const csrf = /name="csrf-token" content="([^"]+)"/.exec(login)[1];
  await go('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, email: 'librarian@example.com', password: 'testpass123' }) });
  const page = await go('/admin/books/import');
  assert.match(page, new RegExp(`Italics from the old library:</strong> on .*were brought back in ${r.restored} books’ descriptions, from localhost:3199\\. 1 description had been edited here since`));
  ok('the Import page shows what was done');

  // an old site that can't be reached: noted, tried again later
  process.env.OLD_SITE_URL = 'http://localhost:3198';
  await db.query('DELETE FROM settings WHERE key = $1', [KEY]);
  const fail = await restoreItalics({ force: true });
  assert.ok(!fail.done_at && fail.tries === 1 && fail.error, JSON.stringify(fail));
  assert.strictEqual((await restoreItalics()).tries, 1, 'not again right away');
  assert.match(await go('/admin/books/import'), /tried to read the old descriptions from localhost:3198/);
  ok('when the old site can’t be reached, it says so and waits to try again');
  await db.query('DELETE FROM settings WHERE key = $1', [KEY]);

  site.close();
  console.log('\nAll italics checks passed.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

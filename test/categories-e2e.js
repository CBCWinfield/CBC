'use strict';
// Several categories per book, suggested categories, and the librarian's sign-off, against a running server.
// Run after test/e2e.js on the same database (it uses that test's librarian and patron).
// Usage: BASE=http://localhost:3100 node test/categories-e2e.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE || 'http://localhost:3100';

class Browser {
  constructor() { this.cookies = {}; }
  async go(p, opts = {}) {
    const res = await fetch(BASE + p, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) this.cookies[k] = v; else delete this.cookies[k]; }
    return { status: res.status, location: res.headers.get('location'), body: await res.text() };
  }
  csrf(html) { return (/name="csrf-token" content="([^"]+)"/.exec(html) || [])[1]; }
  async get(p) { const r = await this.go(p); this.lastCsrf = this.csrf(r.body) || this.lastCsrf; return r; }
  async post(p, data) {
    if (!this.lastCsrf) await this.get('/');
    const body = new URLSearchParams({ _csrf: this.lastCsrf });
    for (const [k, v] of Object.entries(data)) for (const x of [].concat(v)) body.append(k, x);
    return this.go(p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  }
  async json(p, data) {
    if (!this.lastCsrf) await this.get('/');
    const r = await this.go(p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.lastCsrf, Accept: 'application/json' }, body: JSON.stringify(data) });
    return { status: r.status, data: JSON.parse(r.body) };
  }
  async follow(r) { while (r.location) r = await this.get(r.location); return r; }
}
const idOf = (r) => Number((/\/admin\/books\/(\d+)\/edit/.exec(r.location || '') || [])[1]);
const ok = (m) => console.log('ok  ', m);

(async () => {
  const lib = new Browser();
  await lib.get('/login');
  let r = await lib.post('/login', { email: 'librarian@example.com', password: 'testpass123' });
  assert.strictEqual(r.location, '/admin');

  // 1. The old library's export keeps every category a book was in, already signed off.
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures/old-library-sample.csv'), 'utf8');
  await lib.get('/admin/books/import');
  r = await lib.post('/admin/books/import', { csv });
  assert.match(r.body, /added/);
  r = await lib.get('/admin/books?q=Rekindled');
  assert.match(r.body, /1800&#39;s American West|1800's American West/);
  assert.match(r.body, /<b>Historical Fiction<\/b>/);
  assert.match(r.body, /<b>Romance<\/b>/);
  assert.doesNotMatch(r.body, /Not signed off/, 'imported categories count as signed off');
  ok('import keeps all of a book’s categories, signed off');

  // 2. The catalog finds a book under each of its categories.
  for (const sub of ['Romance', 'Historical Fiction', '1800\'s American West']) {
    r = await lib.get(`/catalog?category=${encodeURIComponent('Christian Fiction')}&subcategory=${encodeURIComponent(sub)}`);
    assert.match(r.body, /Rekindled/, `Rekindled is under ${sub}`);
  }
  const rek = (/\/admin\/books\/(\d+)\/edit/.exec((await lib.get('/admin/books?q=Rekindled')).body) || [])[1];
  r = await lib.get('/books/' + rek);
  assert.match(r.body, /Subjects/);
  ok('the catalog lists it under each one, and its page shows them all');

  // 3. Suggestions: a new book by a writer the library already has.
  let s = await lib.json('/admin/books/suggest-categories', { title: 'Of Love and Life', author: 'Tamera Alexander', format: 'Paperback', description: 'A romance in the old West.' });
  assert.strictEqual(s.status, 200);
  const sp = s.data.suggestions.map((x) => x.path);
  assert.ok(sp.includes('Christian Fiction › Historical Fiction') && sp.includes('Christian Fiction › Romance'), JSON.stringify(sp));
  assert.ok(s.data.suggestions[0].reasons.some((x) => /Same writer, Tamera Alexander/.test(x)), 'says why');
  assert.ok(s.data.suggestions.every((x) => ['strong', 'likely', 'maybe'].includes(x.strength)));
  s = await lib.json('/admin/books/suggest-categories', { title: 'The Toy Box', format: 'DVD' });
  assert.strictEqual(s.data.suggestions[0].path, 'DVD');
  s = await lib.json('/admin/books/suggest-categories', {});
  assert.match(s.data.note, /title/);
  ok('suggestions come from the catalog, with reasons: ' + sp.slice(0, 3).join(' + '));

  // 4. A new book in two categories, the second marked main; not signed off yet, so it's on the list to check.
  r = await lib.post('/admin/books', { title: 'Two Shelves', author: 'Test Writer', copies_total: '1', audience: 'Adults', format: 'Book', category_form: '1',
    'category_paths[]': ['Christian Fiction › Romance', 'Non-Fiction › Biography'], category_main: 'Non-Fiction › Biography' });
  const two = idOf(r); assert.ok(two, 'saved');
  r = await lib.get(`/admin/books/${two}/edit`);
  assert.match(r.body, /data-path="Non-Fiction › Biography">\s*<span class="cat-name"><span class="muted">Non-Fiction › <\/span><b>Biography<\/b> <span class="badge badge-main">Main/, 'Biography is main');
  assert.match(r.body, /data-path="Christian Fiction › Romance"/);
  assert.match(r.body, /Not signed off yet/);
  r = await lib.get('/admin/books?show=review');
  assert.match(r.body, /Two Shelves/);
  assert.match(r.body, /Sign off on all/);
  r = await lib.get('/admin');
  assert.match(r.body, /categories to sign off/);
  ok('a book saved with two categories (main one chosen) waits for sign-off');

  // 5. The librarian signs off from the list.
  r = await lib.post('/admin/books/categories/confirm', { id: String(two), back: '/admin/books?show=review' });
  r = await lib.follow(r);
  assert.match(r.body, /Signed off/);
  assert.doesNotMatch(r.body, /Two Shelves/);
  r = await lib.get(`/admin/books/${two}/edit`);
  assert.match(r.body, /Signed off by Lib Rarian on/);
  ok('signed off from the list');

  // 6. Unchanged categories keep the sign-off; changing them without the tick clears it; with the tick, signs off.
  const base = { title: 'Two Shelves', author: 'Test Writer', copies_total: '1', audience: 'Adults', format: 'Book', active: '1', category_form: '1', categories_confirm_form: '1' };
  r = await lib.post(`/admin/books/${two}`, { ...base, 'category_paths[]': ['Christian Fiction › Romance', 'Non-Fiction › Biography'], category_main: 'Non-Fiction › Biography', categories_confirm: '1' });
  r = await lib.get(`/admin/books/${two}/edit`); assert.match(r.body, /Signed off by Lib Rarian/);
  r = await lib.post(`/admin/books/${two}`, { ...base, 'category_paths[]': ['Christian Fiction › Romance'] });
  r = await lib.get(`/admin/books/${two}/edit`); assert.match(r.body, /Not signed off yet/);
  r = await lib.post(`/admin/books/${two}`, { ...base, 'category_paths[]': ['Christian Fiction › Romance', 'DVD'], category_main: 'DVD', categories_confirm: '1' });
  r = await lib.get(`/admin/books/${two}/edit`); assert.match(r.body, /Signed off by Lib Rarian/); assert.match(r.body, /<b>DVD<\/b> <span class="badge badge-main">/);
  // a new category typed in joins the others
  r = await lib.post(`/admin/books/${two}`, { ...base, 'category_paths[]': ['DVD'], new_category_name: 'Westerns', new_category_parent: 'DVD' });
  r = await lib.get(`/admin/books/${two}/edit`); assert.match(r.body, /data-path="DVD › Westerns"/); assert.match(r.body, /data-path="DVD"/);
  // none ticked: uncategorized
  r = await lib.post(`/admin/books/${two}`, { ...base });
  r = await lib.get(`/admin/books/${two}/edit`); assert.match(r.body, /None yet/);
  r = await lib.get('/admin/books?show=uncategorized'); assert.match(r.body, /Two Shelves/);
  ok('sign-off follows changes; a typed-in category is added; none ticked is uncategorized');

  // 7. An assistant's changes wait for the librarian, and an assistant can't sign off.
  r = await lib.post('/admin/staff/promote', { who: 'ruth@example.com', role: 'assistant' });
  const asst = new Browser();
  await asst.get('/login');
  r = await asst.post('/login', { email: 'ruth@example.com', password: 'ruthpass1' });
  r = await asst.post(`/admin/books/${two}`, { ...base, categories_confirm: '1', 'category_paths[]': ['Christian Fiction › Romance'] });
  r = await lib.get(`/admin/books/${two}/edit`); assert.match(r.body, /Not signed off yet/, 'an assistant can’t sign off');
  r = await asst.get(`/admin/books/${two}/edit`); assert.match(r.body, /The librarian signs off on categories/); assert.doesNotMatch(r.body, /name="categories_confirm"/);
  r = await asst.post('/admin/books/categories/confirm', { id: String(two) });
  assert.notStrictEqual(r.status, 200);
  r = await lib.get(`/admin/books/${two}/edit`); assert.match(r.body, /Not signed off yet/);
  // a signed-off book an assistant changes goes back on the list
  r = await lib.post('/admin/books/categories/confirm', { id: String(two) });
  r = await asst.post(`/admin/books/${two}`, { ...base, 'category_paths[]': ['Christian Fiction › Romance', 'DVD'] });
  r = await lib.get('/admin/books?show=review'); assert.match(r.body, /Two Shelves/);
  ok('an assistant’s changes wait for the librarian');

  // 8. The export lists every category; a simple list with "A; B" gives two.
  r = await lib.get('/admin/books/export.csv');
  assert.match(r.body, /Christian Fiction > Romance, DVD/);
  r = await lib.post('/admin/books/import', { csv: 'title,author,category\n"Semicolon Test","A. Writer","Children\'s Books; Bible Stories"\n' });
  r = await lib.get('/admin/books?q=Semicolon');
  assert.match(r.body, /<b>Children&#39;s Books<\/b>|<b>Children's Books<\/b>/); assert.match(r.body, /<b>Bible Stories<\/b>/);
  ok('the export keeps them all; a list can give several');

  console.log('\nAll category checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });

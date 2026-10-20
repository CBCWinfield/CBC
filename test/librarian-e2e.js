'use strict';
// The librarian's requests: italics in descriptions, a book for several groups (adults and teens), and bringing back
// the old library's italics. Run after test/e2e.js and test/categories-e2e.js on the same database.
// Usage: BASE=http://localhost:3100 DATABASE_URL=postgresql://... node test/librarian-e2e.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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
const sql = (q) => execFileSync('psql', [process.env.DATABASE_URL, '-At', '-c', q], { encoding: 'utf8' }).trim();
const boxes = (body) => [...body.matchAll(/<input type="checkbox" name="audiences\[\]" value="(\w+)"( checked)?>/g)].filter((m) => m[2]).map((m) => m[1]);

(async () => {
  const lib = new Browser();
  await lib.get('/login');
  let r = await lib.post('/login', { email: 'librarian@example.com', password: 'testpass123' });
  assert.strictEqual(r.location, '/admin');

  // 1. A book for adults and teens, with a title in italics in its description.
  const base = { title: 'Walking With Pilgrims', author: 'Test Writer', copies_total: '1', format: 'Book', active: '1', audience_form: '1',
    short_description: 'A companion to *The Pilgrim’s Progress*',
    description: 'A guide to reading *The Pilgrim’s Progress* with your family.\n\n**For groups:** questions for each chapter. Costs 5 * 3 nothing.' };
  r = await lib.post('/admin/books', { ...base, 'audiences[]': ['Adults', 'Youth'] });
  const id = idOf(r); assert.ok(id, 'saved');
  r = await lib.get(`/admin/books/${id}/edit`);
  assert.deepStrictEqual(boxes(r.body), ['Adults', 'Youth']);
  assert.match(r.body, /data-fmt-for="b-description"/);
  assert.match(r.body, /aria-label="Italic"/);
  r = await lib.get(`/books/${id}`);
  assert.match(r.body, /<dt>For<\/dt><dd>Adults, Teens<\/dd>/);
  assert.match(r.body, /<p>A guide to reading <em>The Pilgrim’s Progress<\/em> with your family\.<\/p>/);
  assert.match(r.body, /<strong>For groups:<\/strong>/);
  assert.match(r.body, /Costs 5 \* 3 nothing/);
  assert.match(r.body, /<p class="short-desc">A companion to <em>The Pilgrim’s Progress<\/em><\/p>/);
  const meta = (/<meta name="description" content="([^"]*)"/.exec(r.body) || [])[1] || (/property="og:description" content="([^"]*)"/.exec(r.body) || [])[1];
  assert.ok(meta && !meta.includes('*The') && !meta.includes('**') && meta.includes('The Pilgrim’s Progress'), meta);
  ok('a book for adults and teens, with italics and bold in its description');

  // 2. It's on both groups' shelves, not the children's.
  for (const [aud, yes] of [['Adults', true], ['Youth', true], ['Children', false]]) {
    r = await lib.get(`/catalog?audience=${aud}&q=Pilgrims`);
    assert.strictEqual(/Walking With Pilgrims/.test(r.body), yes, aud);
  }
  r = await lib.json('/api/ask', { q: 'books for teens about pilgrims' });
  assert.ok(r.data.books.some((b) => b.title === 'Walking With Pilgrims'), JSON.stringify(r.data));
  ok('the catalog and Ask find it under adults and under teens');

  // 3. Everyone stands alone; all three groups is everyone; a save without the boxes keeps them.
  r = await lib.post(`/admin/books/${id}`, { ...base, 'audiences[]': ['Everyone', 'Adults'] });
  assert.deepStrictEqual(boxes((await lib.get(`/admin/books/${id}/edit`)).body), ['Everyone']);
  r = await lib.post(`/admin/books/${id}`, { ...base, 'audiences[]': ['Adults', 'Youth', 'Children'] });
  assert.deepStrictEqual(boxes((await lib.get(`/admin/books/${id}/edit`)).body), ['Everyone']);
  r = await lib.post(`/admin/books/${id}`, { ...base, 'audiences[]': ['Youth', 'Children'] });
  const { audience_form, ...noBoxes } = base;
  r = await lib.post(`/admin/books/${id}`, noBoxes);
  assert.deepStrictEqual(boxes((await lib.get(`/admin/books/${id}/edit`)).body), ['Youth', 'Children']);
  r = await lib.post(`/admin/books/${id}`, base); // the form with every box unticked
  assert.deepStrictEqual(boxes((await lib.get(`/admin/books/${id}/edit`)).body), ['Everyone']);
  assert.strictEqual(sql(`SELECT audience || ' ' || array_to_string(audiences, ',') FROM books WHERE id = ${id}`), 'Everyone Everyone');
  ok('Everyone stands alone; all three is everyone; leaving the boxes off keeps them');

  // 4. A list can give several: "Adults; Teens".
  const run = Date.now();
  r = await lib.post('/admin/books/import', { csv: `title,author,audience\n"Two Groups ${run}","A. Writer","Adults; Teens"\n"Old Style ${run}","B. Writer",Youth\n` });
  assert.strictEqual(sql(`SELECT array_to_string(audiences, ',') FROM books WHERE title = 'Two Groups ${run}'`), 'Adults,Youth');
  assert.strictEqual(sql(`SELECT array_to_string(audiences, ',') || ' ' || audience FROM books WHERE title = 'Old Style ${run}'`), 'Youth Youth');
  ok('a list with "Adults; Teens" gives both');

  // 5. The suggester takes the groups too.
  const s = await lib.json('/admin/books/suggest-categories', { title: 'Of Love and Life', author: 'Tamera Alexander', audiences: ['Adults', 'Youth'] });
  assert.strictEqual(s.status, 200);
  ok('category suggestions accept several groups');

  // 6. The old library's italics: the import now keeps them, and the old file can bring them back where they were lost.
  const blotch = sql("SELECT id FROM books WHERE title = 'Blotch' LIMIT 1");
  // (imported by this version, it has its stars already; by the one before, not)
  console.log('     Blotch imported with its italics:', /\*Blotch\*/.test(sql(`SELECT description FROM books WHERE id = ${blotch}`)));
  // as the first import left them: no stars
  sql("UPDATE books SET description = replace(description, '*', '') WHERE legacy_id IS NOT NULL AND description LIKE '%*%' AND title <> 'Marley & Me'");
  sql("UPDATE books SET description = replace(description, '*', '') || ' Edited since.' WHERE title = 'Marley & Me'");
  const lost = Number(sql("SELECT count(*) FROM books WHERE legacy_id IS NOT NULL AND description LIKE '%*%'"));
  assert.strictEqual(lost, 0);
  const before = sql("SELECT md5(string_agg(title || coalesce(author,'') || array_to_string(categories,',') || coalesce(tags,''), '|' ORDER BY id)) FROM books");
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures/old-library-sample.csv'), 'utf8');
  r = await lib.post('/admin/books/import', { csv, formatting_only: '1' });
  assert.match(r.body, /Brought back the italics and bold in (\d+) book/);
  const n = Number(/Brought back the italics and bold in (\d+)/.exec(r.body)[1]);
  assert.ok(n >= 10, `restored ${n}`);
  assert.match(r.body, /1 description was edited here since the first import/);
  assert.match(sql(`SELECT description FROM books WHERE id = ${blotch}`), /^Can \*Blotch\* find|\*Blotch\* is/m);
  assert.doesNotMatch(sql("SELECT description FROM books WHERE title = 'Marley & Me'"), /\*/, 'an edited description is left alone');
  assert.strictEqual(sql("SELECT md5(string_agg(title || coalesce(author,'') || array_to_string(categories,',') || coalesce(tags,''), '|' ORDER BY id)) FROM books"), before, 'nothing else changed');
  r = await lib.get(`/books/${blotch}`);
  assert.match(r.body, /<em>Blotch<\/em>/);
  // the export writes them back as HTML
  r = await lib.get('/admin/books/export.csv');
  assert.match(r.body, /<em>Blotch<\/em>/);
  ok(`the old export brought back the italics in ${n} books, leaving edited ones and everything else alone`);

  console.log('\nAll librarian checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });

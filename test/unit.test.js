'use strict';
// Unit tests: run with `npm test` (no database needed).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const t = require('../src/lib/time');
const { buildSlots } = require('../src/lib/slots');
const { parseCsvObjects } = require('../src/lib/csv');
const { encrypt } = require('../src/lib/push');
const { html, raw } = require('../src/lib/html');
const { validIsbn } = require('../src/lib/isbn');

// settings.js pulls in the database module, so stub it before loading the Ask engine.
require.cache[require.resolve('../src/db')] = { exports: {} };
const { ask } = require('../src/lib/ask');
const { DEFAULTS } = require('../src/settings');

test('Chicago wall time converts to UTC across daylight saving', () => {
  assert.strictEqual(t.zoned(2026, 7, 1, 9, 0).toISOString(), '2026-07-01T14:00:00.000Z'); // CDT
  assert.strictEqual(t.zoned(2026, 12, 1, 9, 0).toISOString(), '2026-12-01T15:00:00.000Z'); // CST
  assert.strictEqual(t.weekdayOfKey('2026-10-05'), 1); // Monday
});

test('pickup slots: Mon–Thu, 9–1, 15 minutes, capacity respected', () => {
  const now = new Date('2026-10-04T15:00:00Z'); // Sunday morning in Kansas
  const iso = t.zoned(2026, 10, 5, 9, 0).toISOString();
  const days = buildSlots({ ...DEFAULTS, booking_window_days: 7 }, now, new Map([[iso, 2]]), new Set());
  assert.deepStrictEqual(days.map((d) => d.key), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
  assert.strictEqual(days[0].slots.length, 16);
  assert.strictEqual(days[0].slots[0].label, '9:00 AM');
  assert.strictEqual(days[0].slots[0].open, false);
  assert.strictEqual(days[0].slots.at(-1).label, '12:45 PM');
  const mine = buildSlots({ ...DEFAULTS, booking_window_days: 7 }, now, new Map([[iso, 2]]), new Set([iso]));
  assert.strictEqual(mine[0].slots[0].open, true, 'your own slot stays open for more books');
  const closed = buildSlots({ ...DEFAULTS, booking_window_days: 7, closed_dates: ['2026-10-06'] }, now);
  assert.ok(!closed.some((d) => d.key === '2026-10-06'));
});

test('CSV parser handles quotes, commas and newlines', () => {
  const rows = parseCsvObjects('title,author\n"Hello, World","A ""B"""\n"Multi\nline",C\n');
  assert.deepStrictEqual(rows, [{ title: 'Hello, World', author: 'A "B"' }, { title: 'Multi\nline', author: 'C' }]);
});

test('web push payload decrypts with the browser keys (RFC 8291)', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const body = encrypt('{"title":"hi"}', ua.getPublicKey().toString('base64url'), auth.toString('base64url'));
  const salt = body.subarray(0, 16);
  const keyLen = body[20];
  const asPublic = body.subarray(21, 21 + keyLen);
  const ct = body.subarray(21 + keyLen);
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const shared = ua.computeSecret(asPublic);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.strictEqual(plain.subarray(0, -1).toString(), '{"title":"hi"}');
  assert.strictEqual(plain.at(-1), 2);
});

test('templates escape user text', () => {
  assert.strictEqual(html`<p>${'<script>'}</p>`.toString(), '<p>&lt;script&gt;</p>');
  assert.strictEqual(html`<p>${raw('<b>ok</b>')}</p>`.toString(), '<p><b>ok</b></p>');
});

test('ISBN check digits', () => {
  assert.strictEqual(validIsbn('978-0-06-065292-0'), '9780060652920');
  assert.strictEqual(validIsbn('0060652926'), '0060652926');
  assert.strictEqual(validIsbn('9780060652921'), null);
});

// ---- Ask engine against the sample catalog ----
const books = parseCsvObjects(fs.readFileSync(path.join(__dirname, 'fixtures/sample-books.csv'), 'utf8'))
  .map((b, i) => ({ ...b, id: i + 1, copies_total: Number(b.copies), available: Number(b.copies), active: true }));
const titles = (q) => ask(q, books, DEFAULTS).books.map((b) => b.title);

test('Ask: topics, authors, typos, audiences and library questions', () => {
  assert.strictEqual(titles('books about grief')[0], 'A Grief Observed');
  assert.ok(titles('help with worry').includes('Anxious for Nothing'));
  assert.ok(titles('lewsi').some((x) => /Mere Christianity|Screwtape/.test(x)), 'typo in author still finds Lewis');
  assert.ok(titles('by c.s. lewis').every((x) => books.find((b) => b.title === x).author === 'C. S. Lewis'));
  assert.ok(titles('something for teens').includes('Do Hard Things'));
  assert.ok(titles('kids bible stories').includes('The Jesus Storybook Bible'));
  assert.deepStrictEqual(titles('marriage'), ['The Five Love Languages']);
  assert.match(ask('when can I pick up books?', books, DEFAULTS).answer, /Monday–Thursday, 9 AM–1 PM/);
  const keep = ask('how long can I keep a book', books, DEFAULTS);
  assert.match(keep.answer, /14 days/);
  assert.strictEqual(keep.books.length, 0);
  assert.match(ask('zzzz qqqq', books, DEFAULTS).answer, /couldn't find/);
});

// ---- Old library (WooCommerce) export ----
const woo = require('../src/lib/woo');
const oldCsv = fs.readFileSync(path.join(__dirname, 'fixtures/old-library-sample.csv'), 'utf8');

test('old library export: detected, mapped and round-tripped', () => {
  assert.ok(woo.isWooExport(oldCsv));
  assert.ok(!woo.isWooExport('title,author\nA,B\n'));
  const { books: rows } = woo.parseWoo(oldCsv);
  assert.strictEqual(rows.length, 40);
  const blotch = rows.find((b) => b.title === 'Blotch');
  assert.strictEqual(blotch.author, 'Andy Addis');
  assert.strictEqual(blotch.format, 'Hardback');
  assert.strictEqual(blotch.audience, 'Children');
  assert.strictEqual(blotch.publisher, 'B&H Publishing Group');
  assert.strictEqual(blotch.published_year, 2016);
  assert.strictEqual(blotch.call_number, null, 'Excel-mangled number is dropped');
  assert.match(blotch.cover_source_url, /blotch-front-cover\.jpg$/);
  assert.strictEqual(blotch.short_description, 'A Tale of Forgiveness and Grace');
  assert.ok(!/<|\[embedyt|\\n/.test(blotch.description), 'HTML, shortcodes and \\n are cleaned out');
  const princess = rows.find((b) => b.title === 'Blue Princess Takes The Stage');
  assert.strictEqual(princess.category, 'Junior');
  assert.strictEqual(princess.subcategory, 'Junior Fiction');
  assert.strictEqual(princess.series, 'Perfectly Princess');
  assert.strictEqual(princess.call_number, '6871');
  assert.strictEqual(princess.details.Illustrator, 'Charlotte Alder');
  // Export, then import the export: same books come back.
  const out = woo.toWooCsv(rows.map((b, i) => ({ ...b, id: i + 1, available: 1 })), 'https://example.org');
  const again = woo.parseWoo(out).books;
  assert.strictEqual(again.length, 40);
  assert.deepStrictEqual(again.map((b) => [b.legacy_id, b.title, b.author, b.call_number, b.format, b.series]),
    rows.map((b) => [b.legacy_id, b.title, b.author, b.call_number, b.format, b.series]));
});

// ---- Search-as-you-type suggestions ----
const { suggest } = require('../src/lib/suggest');
test('suggestions: titles first, writers, library numbers, typing in progress', () => {
  const idx = books.map((b) => ({ ...b, call_number: String(1000 + b.id), active: true }));
  const s1 = suggest('scre', idx);
  assert.strictEqual(s1.books[0].title, 'The Screwtape Letters', 'ignores the leading "The"');
  const s2 = suggest('c s lew', idx);
  assert.ok(s2.books.length >= 3 && s2.books.every((b) => b.author === 'C. S. Lewis'));
  assert.strictEqual(s2.writers[0].name, 'C. S. Lewis');
  assert.strictEqual(suggest('1004', idx).books[0].id, 4, 'library number goes straight to the book');
  assert.ok(suggest('devot', idx).categories.some((c) => c.category === 'Devotional'));
  assert.strictEqual(suggest('x', idx).books.length, 0, 'waits for two letters');
});

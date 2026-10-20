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

test('check-in: Easter dates, allergy detection, greeting paragraphs, privacy defaults', () => {
  const A = require('../src/checkin/automations');
  assert.strictEqual(A.easterKey(2026), '2026-04-05');
  assert.strictEqual(A.easterKey(2027), '2027-03-28');
  assert.strictEqual(A.easterKey(2030), '2030-04-21');
  const allergens = require('../src/checkin/allergens');
  assert.deepStrictEqual(allergens.detect('Peanuts and tree nuts, bee stings'), ['peanut', 'treenut', 'bee']);
  assert.deepStrictEqual(allergens.detect('none'), []);
  const paras = A.paragraphs('Hi {first_name},\n\nWelcome <b>!', { first_name: 'Dana <x>' });
  assert.deepStrictEqual(paras, ['Hi Dana &lt;x&gt;,', 'Welcome &lt;b&gt;!']);
  const P = require('../src/checkin/prefs');
  assert.strictEqual(P.of({ prefs: {} }).directory, true);
  assert.strictEqual(P.of({ prefs: {} }).show_phone, false);
  assert.strictEqual(P.wants({ prefs: { email_checkin: false } }, 'email_checkin'), false);
  assert.strictEqual(P.wants({ prefs: {}, notify_email: false }, 'email_messages'), false);
});

test('automatic check-out reads service times', () => {
  require.cache[require.resolve('../src/db')] = { exports: {} };
  const { parseTime } = require('../src/checkin/autocheckout');
  assert.deepStrictEqual(parseTime('9:30 AM'), [9, 30]);
  assert.deepStrictEqual(parseTime('6:00 PM'), [18, 0]);
  assert.deepStrictEqual(parseTime('12 PM'), [12, 0]);
  assert.deepStrictEqual(parseTime('12:15 am'), [0, 15]);
  assert.strictEqual(parseTime('soon'), null);
});

test('YouTube feed parsing for the sermon carousel', () => {
  const yt = require('../src/lib/youtube');
  const xml = require('fs').readFileSync(require('path').join(__dirname, 'fixtures/youtube-feed.xml'), 'utf8');
  const v = yt.parse(xml);
  assert.strictEqual(v.length, 15);
  assert.strictEqual(v[0].id, 'vid00000000');
  assert.strictEqual(v[0].title, 'Faith That Endures | James 1:2-12');
  assert.ok(!Number.isNaN(new Date(v[1].published).getTime()));
  assert.strictEqual(yt.parse('<feed><entry><yt:videoId>bad id!</yt:videoId></entry></feed>').length, 0, 'ignores malformed ids');
});

test('homepage banner follows the church calendar (Central time)', () => {
  const { byCalendar, seasonFor } = require('../src/site/season');
  const at = (iso) => byCalendar(new Date(iso));
  assert.strictEqual(at('2026-10-27T04:30:00Z'), 'wheat'); // still Oct 26, 11:30 PM in Kansas
  assert.strictEqual(at('2026-10-27T05:00:00Z'), 'fall'); // midnight Oct 27 in Kansas
  assert.strictEqual(at('2026-11-27T18:00:00Z'), 'fall');
  assert.strictEqual(at('2026-11-28T18:00:00Z'), 'winter');
  assert.strictEqual(at('2026-12-01T18:00:00Z'), 'christmas');
  assert.strictEqual(at('2026-12-31T18:00:00Z'), 'christmas');
  assert.strictEqual(at('2027-01-01T18:00:00Z'), 'winter');
  assert.strictEqual(at('2027-03-14T18:00:00Z'), 'winter');
  assert.strictEqual(at('2027-03-15T18:00:00Z'), 'easter');
  assert.strictEqual(at('2027-05-01T18:00:00Z'), 'easter');
  assert.strictEqual(at('2027-05-02T18:00:00Z'), 'wheat');
  assert.strictEqual(seasonFor({ season: 'Easter' }, {}, new Date('2026-07-01')), 'easter'); // preview link
  assert.strictEqual(seasonFor({}, { SITE_SEASON: 'wheat' }, new Date('2026-12-10T18:00:00Z')), 'wheat'); // pinned
  assert.strictEqual(seasonFor({ season: 'bogus' }, {}, new Date('2026-12-10T18:00:00Z')), 'christmas'); // unset = calendar
});

test('partner logos: homepage discovery prefers the header logo, and tiles suit the artwork', () => {
  const PL = require('../src/site/partner-logos');
  const page = `<meta property="og:image" content="/photo.jpg"><link rel="apple-touch-icon" href="/touch.png">
    <header><img class="custom-logo" src="data:image/gif;base64,R0lG" data-src="/wp-content/uploads/logo.svg"></header>
    <img src="/hero.jpg" alt="Hero"><img srcset="/logo-1x.png 1x, /logo-2x.png 2x" alt="Our logo">`;
  assert.deepStrictEqual(PL.findLogos(page, 'https://www.example.org/'),
    ['https://www.example.org/wp-content/uploads/logo.svg', 'https://www.example.org/logo-2x.png', 'https://www.example.org/touch.png']);
  const px = (pixels) => Buffer.from(pixels.flat());
  const clear = [0, 0, 0, 0];
  assert.strictEqual(PL.toneOf(px([[255, 255, 255, 255], [250, 250, 250, 255], clear, clear]), 4).tone, 'light'); // white artwork: dark tile
  assert.strictEqual(PL.toneOf(px([[20, 40, 90, 255], [20, 40, 90, 255], clear, clear]), 4).tone, 'dark'); // navy artwork: white tile
  assert.strictEqual(PL.toneOf(px(Array(30).fill([240, 236, 220, 255])), 4).tone, 'solid'); // its own background
  const CT = require('../src/site/content');
  assert.ok(Object.keys(PL.SOURCES).every((k) => CT.FAMILY.some((f) => f.key === k) || CT.OUTREACH.some((o) => o.key === k)));
  assert.ok([...CT.FAMILY, ...CT.OUTREACH].every((x) => PL.SOURCES[x.key]), 'every partner has a logo source');
});

test('Ministries page lists every partner, with a logo or its name until the logo arrives', () => {
  const V = require('../src/site/views');
  const C = require('../src/site/content');
  const logos = (key) => (key === 'namb' ? { v: 'abc123', tone: 'light', bg: null, width: 320, height: 62 } : null);
  const out = String(V.ministries({ base: '/site', logos }).body);
  for (const f of [...C.FAMILY, ...C.OUTREACH]) assert.ok(out.includes(`href="${f.url}"`), f.name);
  assert.ok(out.includes('<span class="fam-logo on-dark wide"><img src="/site/partner-logos/namb.png?v=abc123"'));
  assert.ok(out.includes('<span class="fam-logo fam-word" aria-hidden="true">International Mission Board</span>'));
  assert.strictEqual((out.match(/class="card fam-card"/g) || []).length, C.FAMILY.length);
  assert.strictEqual((out.match(/class="card out-row"/g) || []).length, C.OUTREACH.length);
  for (const o of C.OUTREACH) assert.ok(out.includes(`<h3>${o.name}<span>`), o.name);
});

test('categories: the old library\'s import is rebuilt into every category from the tags it kept', () => {
  const woo = require('../src/lib/woo');
  const cats = require('../src/lib/cats');
  const { rebuild, vocabulary } = require('../src/category-backfill');
  const { books } = woo.parseWoo(fs.readFileSync(path.join(__dirname, 'fixtures/old-library-sample.csv'), 'utf8'));
  // as the database held them before: only the main (most specific) category, plus the tags the import wrote
  const rows = books.map((b, i) => ({ id: i + 1, legacy_id: b.legacy_id || String(i + 1), title: b.title, categories: b.categories.slice(0, 1), tags: b.tags }));
  const voc = vocabulary(rows);
  const exact = rows.filter((r) => cats.sameSet(rebuild(r, voc).paths, books[r.id - 1].categories)).length;
  assert.ok(exact >= 39, `${exact} of 40 rebuilt exactly`);
  const rek = rows.find((r) => r.title === 'Rekindled');
  assert.deepStrictEqual(rebuild(rek, voc).paths, ['Christian Fiction › 1800\'s American West', 'Christian Fiction › Historical Fiction', 'Christian Fiction › Romance']);
  // a free-form tag on one book never becomes a category
  assert.deepStrictEqual(rebuild({ ...rek, tags: '1800\'s american west, widows' }, voc).paths, ['Christian Fiction › 1800\'s American West']);
  // a shared name ("Mystery") counts only under the book's own subject
  const sub = rebuild({ legacy_id: 'x', categories: ['Youth › Mystery'], tags: 'mystery' }, voc).paths;
  assert.deepStrictEqual(sub, ['Youth › Mystery']);
});

test('categories: suggestions come from the catalog, with reasons', () => {
  const woo = require('../src/lib/woo');
  const S = require('../src/lib/catsuggest');
  const { books } = woo.parseWoo(fs.readFileSync(path.join(__dirname, 'fixtures/old-library-sample.csv'), 'utf8'));
  books.forEach((b, i) => (b.id = i + 1));
  const model = S.build(books);
  const r = S.suggest(model, { title: 'A New Novel', author: 'Tamera Alexander', format: 'Paperback' });
  const paths = r.filter((x) => x.strength !== 'maybe').map((x) => x.path);
  assert.ok(paths.includes('Christian Fiction › Historical Fiction') && paths.includes('Christian Fiction › Romance'), JSON.stringify(paths));
  assert.ok(r[0].reasons.some((x) => /Same writer, Tamera Alexander/.test(x)));
  assert.strictEqual(S.suggest(model, { title: 'The Toy Box', format: 'DVD' })[0].path, 'DVD');
  assert.deepStrictEqual(S.suggest(model, { title: 'zzqx' }), []);
});

test('every page shows its own picture when shared or previewed', async () => {
  const V = require('../src/site/views');
  const Share = require('../src/share');
  const page = (key, extra = {}) => String(V.layout({ title: 'T', desc: 'd', page: key, body: '', head: { title: 'x' }, path: `/${key}`, ...extra }));
  const out = page('sermons', { shareTitle: 'Sermons from Central Baptist Church' });
  assert.ok(out.includes(`<meta property="og:image" content="https://cbcwinfield.org/img/share/sermons.png?v=`));
  assert.ok(out.includes('<meta property="og:url" content="https://cbcwinfield.org/sermons">'));
  assert.ok(out.includes('<meta property="og:title" content="Sermons from Central Baptist Church">'));
  assert.ok(out.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(page('nope').includes('/img/share/home.png'), 'other pages use the homepage picture');
  for (const k of Object.keys(Share.PICTURES)) assert.ok(fs.statSync(path.join(__dirname, `../public/img/share/${k}.png`)).size > 50000, k);
  // a library book: its own picture when it has a cover, the library's when it doesn't
  assert.match(Share.bookPicture({ id: 7, title: 'B', has_cover: false }).image, /library\.png/);
  if (Share.hasSharp()) {
    assert.match(Share.bookPicture({ id: 7, title: 'B', has_cover: true, updated_at: new Date(0) }).image, /^\/share\/book\/7\.jpg\?v=0$/);
    const sharp = require('sharp');
    const cover = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#1f3a6b' } }).jpeg().toBuffer();
    const img = await Share.bookImage({ id: 7, updated_at: new Date(0) }, cover);
    const meta = await sharp(img).metadata();
    assert.deepStrictEqual([meta.width, meta.height, meta.format], [1200, 630, 'jpeg']);
  }
  assert.strictEqual(Share.origin({ headers: { host: 'admin.cbcwinfield.org' } }), 'https://admin.cbcwinfield.org');
  assert.strictEqual(Share.origin({ headers: { host: 'localhost:3100' } }), 'http://localhost:3100');
});

// ---------- Librarian's requests: italics, several audiences, a better ISBN lookup ----------
const rich = require('../src/lib/richtext');
const AUD = require('../src/lib/audience');
const isbnLib = require('../src/lib/isbn');

test('descriptions: *italic* and **bold** show as such, safely', () => {
  assert.strictEqual(String(rich.inline('Read *The Shack* & **pray**.')), 'Read <em>The Shack</em> &amp; <strong>pray</strong>.');
  assert.strictEqual(String(rich.inline('*<script>*')), '<em>&lt;script&gt;</em>');
  assert.strictEqual(String(rich.inline('5 * 3 * 2, and * a bullet')), '5 * 3 * 2, and * a bullet');
  assert.strictEqual(String(rich.inline('***Both*** and **bold *inner* bold**')), '<strong><em>Both</em></strong> and <strong>bold <em>inner</em> bold</strong>');
  assert.strictEqual(String(rich.inline('(*Title*), *Title*’s')), '(<em>Title</em>), <em>Title</em>’s');
  assert.strictEqual(rich.plain('A *b* **c** ***d***'), 'A b c d');
  assert.deepStrictEqual(rich.paragraphs('One *a*\nline two\n\nTwo').map(String), ['<p>One <em>a</em><br>line two</p>', '<p>Two</p>']);
  assert.strictEqual(rich.fromHtml('<em>Blotch</em> he <i class="fa"></i>said <em><strong>Join</strong></em> <em>The Toy </em>re'), '*Blotch* he said ***Join*** *The Toy* re');
  assert.strictEqual(rich.toHtml('*A* and **B**'), '<em>A</em> and <strong>B</strong>');
});

test('the old library import keeps italics, and plain() matches what it used to keep', () => {
  const { cleanDescription } = require('../src/lib/woo');
  if (!cleanDescription) return;
  const out = cleanDescription('<p><em>Blotch</em> is a dragon.</p><p>He <strong>roars</strong>.</p>');
  assert.strictEqual(out, '*Blotch* is a dragon.\n\nHe **roars**.');
  assert.strictEqual(rich.plain(out), 'Blotch is a dragon.\n\nHe roars.');
});

test('audiences: several groups, Everyone alone, words people type', () => {
  assert.deepStrictEqual(AUD.normalize(['Youth', 'Adults']), ['Adults', 'Youth']);
  assert.deepStrictEqual(AUD.normalize('adults and teens'), ['Adults', 'Youth']);
  assert.deepStrictEqual(AUD.normalize('Adults; Teens; Kids'), ['Everyone']);
  assert.deepStrictEqual(AUD.normalize(['Everyone', 'Adults']), ['Everyone']);
  assert.deepStrictEqual(AUD.normalize('young adult'), ['Youth']);
  assert.deepStrictEqual(AUD.normalize('nonsense'), []);
  assert.deepStrictEqual(AUD.of({ audience: 'Children', audiences: [] }), ['Children']);
  assert.strictEqual(AUD.label(['Adults', 'Youth']), 'Adults, Teens');
  assert.ok(AUD.suits({ audiences: ['Everyone'] }, 'Youth'));
  assert.ok(!AUD.suits({ audiences: ['Adults'] }, 'Youth'));
});

test('ISBN lookup: Google Books and Open Library together, tidied', async () => {
  const OL = {
    'ISBN:9780764201035': { title: 'REKINDLED (Fountain Creek Chronicles, Book 1)', authors: [{ name: 'Alexander, Tamera' }], publishers: [{ name: 'Bethany House Publishers, a division of Baker' }],
      publish_date: 'March 1, 2006', number_of_pages: 400, subjects: [{ name: 'Christian fiction' }, { name: 'Fiction, christian, romance' }, { name: 'Colorado, fiction' }, { name: 'Large type books' }], cover: { large: 'x' } },
  };
  const GB = { items: [{ id: 'abc', volumeInfo: { title: 'Rekindled', authors: ['Tamera Alexander'], publisher: 'Bethany House', publishedDate: '2006-03-01', pageCount: 416,
    industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780764201035' }], categories: ['Fiction / Christian / Historical'], imageLinks: { thumbnail: 'http://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api' } } }] };
  const FULL = { id: 'abc', volumeInfo: { title: 'Rekindled', description: '<p>In <i>Rekindled</i>, Kathryn&#39;s husband&nbsp;returns.</p><p><b>Book one</b></p>', categories: ['Fiction / Christian / Historical', 'Fiction / Romance / Western'] } };
  const routes = (map) => async (url) => { for (const [k, v] of Object.entries(map)) if (url.includes(k)) return typeof v === 'function' ? v() : v; return null; };

  let r = await isbnLib.lookup('978-0-7642-0103-5', { get: routes({ 'api/books': OL, 'isbn/9780764201035.json': {}, 'volumes?q=isbn': GB, 'volumes/abc': FULL }) });
  assert.strictEqual(r.title, 'Rekindled');
  assert.strictEqual(r.series, 'Fountain Creek Chronicles');
  assert.strictEqual(r.author, 'Tamera Alexander');
  assert.strictEqual(r.publisher, 'Bethany House');
  assert.strictEqual(r.published_year, 2006);
  assert.strictEqual(r.pages, 400, 'this edition’s pages, from Open Library');
  assert.strictEqual(r.description, "In *Rekindled*, Kathryn's husband returns.\n\n**Book one**");
  assert.deepStrictEqual(r.audiences, []);
  assert.ok(r.subjects.includes('Historical') && r.subjects.includes('Christian fiction'));
  assert.ok(!/large type|fiction, christian/.test(r.tags), r.tags);
  assert.strictEqual(r.cover_url, 'https://covers.openlibrary.org/b/isbn/9780764201035-L.jpg');
  assert.strictEqual(r.sources, 'Google Books and Open Library');

  // Open Library hasn't heard of it: Google alone, with its cover; a children's book
  r = await isbnLib.lookup('9780310708254', { get: routes({ 'volumes?q=isbn': { items: [{ id: 'k', volumeInfo: { title: 'The Jesus Storybook Bible', subtitle: 'Every Story Whispers His Name',
    authors: ['Sally Lloyd-Jones'], publishedDate: '2007', pageCount: 351, categories: ['Juvenile Nonfiction / Religious / Christian / Bible Stories'],
    industryIdentifiers: [{ type: 'ISBN_10', identifier: '0310708257' }], imageLinks: { thumbnail: 'http://books.google.com/books/content?id=k&img=1&zoom=1&edge=curl' } } }] } }) });
  assert.strictEqual(r.title, 'The Jesus Storybook Bible');
  assert.strictEqual(r.subtitle, 'Every Story Whispers His Name');
  assert.deepStrictEqual(r.audiences, ['Children']);
  assert.strictEqual(r.cover_url, 'https://books.google.com/books/content?id=k&img=1&zoom=1');
  assert.strictEqual(r.sources, 'Google Books');

  // Google is down: Open Library alone, its one-line title split
  r = await isbnLib.lookup('9780310247456', { get: routes({ 'api/books': { 'ISBN:9780310247456': { title: 'BOUNDARIES: WHEN TO SAY YES, HOW TO SAY NO TO TAKE CONTROL OF YOUR LIFE', authors: [{ name: 'Henry Cloud' }, { name: 'John Townsend' }], subjects: [{ name: 'Young adult fiction' }] } },
    'volumes?q=isbn': () => { throw new Error('quota'); } }) });
  assert.strictEqual(r.title, 'Boundaries');
  assert.strictEqual(r.subtitle, 'When to Say Yes, How to Say No to Take Control of Your Life');
  assert.strictEqual(r.author, 'Henry Cloud, John Townsend');
  assert.deepStrictEqual(r.audiences, ['Youth']);

  // a Google result for a different book is ignored
  r = await isbnLib.lookup('9780310247456', { get: routes({ 'volumes?q=isbn': { items: [{ id: 'z', volumeInfo: { title: 'Wrong', industryIdentifiers: [{ identifier: '9781111111111' }] } }, { id: 'y', volumeInfo: { title: 'Also wrong' } }] } }) });
  assert.match(r.error, /No book was found/);
  assert.match((await isbnLib.lookup('12345')).error, /doesn’t look right/);
});

'use strict';
// Suggests categories for a book from the library's own catalog, so the suggestions are always categories the
// library already uses. Nothing is sent anywhere. Each suggestion says why, for the librarian to check:
//   - the same series, or the same writer, is usually filed the same way;
//   - books with similar words (title, subtitle, tags, description) and where they are filed;
//   - a category's own name in the book's title, tags or subjects ("Marriage", "Grief", "Mystery");
//   - the format and the publisher, when the library files them one way (DVDs, Love Inspired novels);
//   - the subjects found by the ISBN lookup.
// build(rows) makes the model from books.forSuggest(); suggest(model, book) returns
//   [{ path, strength: 'strong' | 'likely' | 'maybe', score, reasons: [text] }], best first.

const cats = require('./cats');

const STOP = new Set(('a an and are as at be been but by for from has have he her his how i in into is it its me my no not of on or our she so ' +
  'than that the their them then there these they this to too up us was we were what when where which who why will with you your book books ' +
  'story stories new one two all also more most can each every just like only other over own same some such very about after again any because ' +
  'before being both did does doing down during few further here him himself itself let made make many may might must nor off once out shall ' +
  'should through under until upon while whom would yet edition volume vol part series novel guide complete revised updated read reading').split(' '));
// Words in category names too general to match on their own.
const GENERIC = new Set(['fiction', 'non', 'nonfiction', 'general', 'other', 'misc', 'miscellaneous', 'books', 'book', 'adult', 'adults', 'christian',
  'collection', 'resources', 'resource', 'materials', 'items', 'media', 'library', 'documents', 'junior', 'kids', 'youth', 'teen', 'teens', 'children']);
const SPECIAL_FORMATS = new Set(['DVD', 'Blu-ray', 'CD', 'Audiobook', 'Board Book', 'Large Print', 'Workbook', 'Pamphlet']);

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stem = (w) => (w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
function words(s) { return norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem); }
const nameKey = (s) => norm(s).replace(/\b(jr|sr|dr|rev|ii|iii)\b/g, '').replace(/\s+/g, ' ').trim();
const authorsOf = (s) => String(s || '').split(/,|;|&|\band\b/).map(nameKey).filter((x) => x.length > 2);
const seriesKey = (s) => norm(String(s || '').replace(/#?\s*\d+\s*$/, '')).replace(/\b(series|the|book)\b/g, ' ').replace(/\s+/g, ' ').trim();
const leaf = (p) => p.split(cats.SEP).pop();
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

function addCount(map, key, path) {
  if (!key) return;
  let m = map.get(key); if (!m) map.set(key, (m = { n: 0, paths: new Map() }));
  m.n++; m.paths.set(path, (m.paths.get(path) || 0) + 1);
}

function textOf(b, subjects) {
  const f = [[b.title, 3], [b.subtitle, 2], [b.series, 2], [b.tags, 2], [b.short_description, 1], [b.description, 1], [(subjects || []).join(' '), 2]];
  const tf = new Map();
  for (const [s, w] of f) for (const t of words(s)) tf.set(t, (tf.get(t) || 0) + w);
  return tf;
}

function build(rows) {
  const docs = [], df = new Map();
  const byAuthor = new Map(), bySeries = new Map(), byPublisher = new Map(), byFormat = new Map(), byAudience = new Map();
  const pathCount = new Map();
  for (const b of rows) {
    const paths = cats.leavesOnly(cats.cleanPaths(b.categories || []));
    if (!paths.length) continue;
    const tf = textOf(b);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.push({ id: b.id, title: b.title, paths, tf });
    for (const p of paths) {
      pathCount.set(p, (pathCount.get(p) || 0) + 1);
      for (const a of authorsOf(b.author)) addCount(byAuthor, a, p);
      addCount(bySeries, seriesKey(b.series), p);
      addCount(byPublisher, norm(b.publisher), p);
      addCount(byFormat, b.format, p);
      addCount(byAudience, b.audience, p);
    }
  }
  // per-book counts for authors and series (a book in two categories counts once in n)
  const fixN = (map, keyOf) => { for (const m of map.values()) m.books = 0; for (const b of rows) { if (!(b.categories || []).length) continue; for (const k of keyOf(b)) { const m = map.get(k); if (m) m.books++; } } };
  fixN(byAuthor, (b) => [...new Set(authorsOf(b.author))]);
  fixN(bySeries, (b) => [seriesKey(b.series)].filter(Boolean));
  fixN(byPublisher, (b) => [norm(b.publisher)].filter(Boolean));
  fixN(byFormat, (b) => [b.format].filter(Boolean));
  fixN(byAudience, (b) => [b.audience].filter(Boolean));

  const N = docs.length;
  const idf = (t) => Math.log(1 + N / (1 + (df.get(t) || 0)));
  const postings = new Map();
  for (const d of docs) {
    let len = 0; const vec = new Map();
    for (const [t, c] of d.tf) { const w = (1 + Math.log(c)) * idf(t); vec.set(t, w); len += w * w; }
    len = Math.sqrt(len) || 1;
    for (const [t, w] of vec) { let l = postings.get(t); if (!l) postings.set(t, (l = [])); l.push([d, w / len]); }
    delete d.tf;
  }
  // every path in use and its parents, with the words of its own name
  const allPaths = new Set();
  for (const p of pathCount.keys()) { const parts = p.split(cats.SEP); for (let i = 1; i <= parts.length; i++) allPaths.add(parts.slice(0, i).join(cats.SEP)); }
  const names = [...allPaths].map((p) => ({ path: p, words: words(leaf(p)).filter((w) => !GENERIC.has(w)) })).filter((x) => x.words.length);
  for (const x of names) x.alike = names.filter((y) => y.words.join(' ') === x.words.join(' ')).length;
  return { N, idf, postings, byAuthor, bySeries, byPublisher, byFormat, byAudience, pathCount, allPaths, names };
}

// For a book that's already in the catalog, pass { exclude: its id, saved: its saved row } so it doesn't vote for itself.
function suggest(model, book, { exclude, saved } = {}) {
  if (!model || !model.N) return [];
  const own = saved ? cats.leavesOnly(cats.cleanPaths(saved.categories || [])) : [];
  const S = new Map(); // path -> { score, reasons: [[weight, text]] }
  const add = (path, score, reason) => {
    if (!(score > 0)) return;
    let s = S.get(path); if (!s) S.set(path, (s = { score: 0, reasons: [] }));
    s.score += score; if (reason) s.reasons.push([score, reason]);
  };
  // the share of a group's books filed under each path (without this book itself, when it's saved)
  const shares = (m, mine) => {
    const less = own.length && mine ? 1 : 0, n = (m.books || m.n) - less;
    if (n <= 0) return [];
    return [...m.paths.entries()].map(([p, c]) => [p, (c - (less && own.includes(p) ? 1 : 0)) / n]).filter(([, sh]) => sh > 0);
  };
  const savedAuthors = new Set(saved ? authorsOf(saved.author) : []);

  // the same series
  const sk = seriesKey(book.series), ser = sk && model.bySeries.get(sk);
  const serMine = saved && seriesKey(saved.series) === sk;
  if (ser && ser.books - (own.length && serMine ? 1 : 0) > 0) {
    for (const [p, sh] of shares(ser, serMine)) add(p, 3 * sh, `Same series, ${book.series.trim()}: ${pct(sh)} of it is in “${leaf(p)}”`);
  }
  // the same writer: the more of their books, the surer
  for (const a of [...new Set(authorsOf(book.author))].slice(0, 3)) {
    const m = model.byAuthor.get(a); if (!m) continue;
    const mine = savedAuthors.has(a), n = m.books - (own.length && mine ? 1 : 0); if (n < 1) continue;
    const sure = Math.min(1, 0.35 + n / 6);
    const name = String(book.author).split(/,|;|&/).map((x) => x.trim()).find((x) => nameKey(x) === a) || a;
    for (const [p, sh] of shares(m, mine)) if (sh >= 0.15) add(p, 2.5 * sh * sure, `Same writer, ${name}: ${n === 1 ? 'their other book is' : `${pct(sh)} of their ${n} books are`} in “${leaf(p)}”`);
  }
  // similar books
  const tf = textOf(book, book.subjects);
  const qv = new Map(); let ql = 0;
  for (const [t, c] of tf) { if (!model.postings.has(t)) continue; const w = (1 + Math.log(c)) * model.idf(t); qv.set(t, w); ql += w * w; }
  ql = Math.sqrt(ql) || 1;
  const sim = new Map();
  for (const [t, w] of qv) for (const [d, dw] of model.postings.get(t)) { if (exclude != null && d.id === exclude) continue; sim.set(d, (sim.get(d) || 0) + (w / ql) * dw); }
  const near = [...sim.entries()].filter(([, s]) => s >= 0.08).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const total = near.reduce((n, [, s]) => n + s, 0);
  if (near.length >= 2 && total > 0) {
    const votes = new Map();
    for (const [d, s] of near) for (const p of d.paths) { const v = votes.get(p) || { s: 0, titles: [] }; v.s += s / d.paths.length; if (!v.titles.includes(d.title)) v.titles.push(d.title); votes.set(p, v); }
    const strength = Math.min(1, near[0][1] / 0.35); // how alike the closest books really are
    for (const [p, v] of votes) {
      const sh = v.s / total; if (sh < 0.12) continue;
      add(p, 2.2 * sh * (0.5 + 0.5 * strength), `Similar ${v.titles.length === 1 ? 'book' : 'books'} in “${leaf(p)}”: ${v.titles.slice(0, 2).map((x) => `“${x}”`).join(', ')}`);
    }
  }
  // a category's own name in the book's words
  const strong = new Set([...words([book.title, book.subtitle, book.series, book.tags, (book.subjects || []).join(' ')].filter(Boolean).join(' '))]);
  const weak = new Set(words([book.short_description, book.description].filter(Boolean).join(' ')));
  // (a name used under several subjects, like "Mystery", counts less on each)
  for (const { path, words: ws, alike } of model.names) {
    if (ws.every((w) => strong.has(w))) add(path, 1.5 / alike, `Its title, tags or subjects say “${leaf(path)}”`);
    else if (ws.every((w) => weak.has(w) || strong.has(w))) add(path, 0.6 / alike, `The description mentions “${leaf(path)}”`);
  }
  // the format and the publisher, when the library files them one way
  const fm = book.format && model.byFormat.get(book.format);
  if (fm && fm.books >= 3) for (const [p, sh] of shares(fm, saved && saved.format === book.format)) if (sh >= (SPECIAL_FORMATS.has(book.format) ? 0.4 : 0.85)) add(p, 1.6 * sh, `${pct(sh)} of the library’s ${book.format}s are in “${leaf(p)}”`);
  const pm = book.publisher && model.byPublisher.get(norm(book.publisher));
  if (pm && pm.books >= 3) for (const [p, sh] of shares(pm, saved && norm(saved.publisher) === norm(book.publisher))) if (sh >= 0.5) add(p, 1.2 * sh, `${pct(sh)} of the library’s ${book.publisher} books are in “${leaf(p)}”`);
  // who it's for: only to lean toward children's or teens' shelves
  const am = (book.audience === 'Children' || book.audience === 'Youth') && model.byAudience.get(book.audience);
  if (am && am.books >= 5) for (const [p, sh] of shares(am, saved && saved.audience === book.audience)) if (sh >= 0.25) add(p, 0.6 * sh, null);

  // Group by subject, then the best specific shelf inside each.
  const tops = new Map();
  for (const [p, s] of S) { const t = cats.top(p); const g = tops.get(t) || { score: 0, kids: [] }; g.score += s.score; g.kids.push([p, s]); tops.set(t, g); }
  const ranked = [...tops.entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length) return [];
  const best = ranked[0][1].score, out = [];
  for (const [t, g] of ranked.slice(0, 3)) {
    if (g.score < Math.max(0.5, best * 0.3)) break;
    // the most specific path that holds most of the subject's weight
    const sub = (path) => g.kids.filter(([p]) => p === path || p.startsWith(path + cats.SEP)).reduce((n, [, s]) => n + s.score, 0);
    const kidsOf = (path) => [...new Set(g.kids.map(([p]) => p).filter((p) => p.startsWith(path + cats.SEP)).map((p) => p.split(cats.SEP).slice(0, path.split(cats.SEP).length + 1).join(cats.SEP)))];
    const picks = [];
    // Go down to the specific shelves while they carry the weight; shelves nearly as strong as the best one come too
    // (a book can be in Historical Fiction and Romance).
    const walk = (path) => {
      const kids = kidsOf(path).map((k) => [k, sub(k)]).sort((a, b) => b[1] - a[1]);
      const here = sub(path);
      if (kids.length && kids[0][1] >= here * 0.3) {
        const go = kids.filter(([, w], i) => i === 0 || (w >= kids[0][1] * 0.6 && w >= 0.8)).slice(0, 3);
        go.forEach(([k]) => walk(k));
      } else picks.push(path);
    };
    walk(t);
    for (const p of picks) {
      if (!model.allPaths.has(p)) continue;
      const reasons = g.kids.filter(([q]) => q === p || q.startsWith(p + cats.SEP) || p.startsWith(q + cats.SEP)).flatMap(([, s]) => s.reasons)
        .sort((a, b) => b[0] - a[0]).map(([, r]) => r).filter((r, i, a) => a.indexOf(r) === i).slice(0, 3);
      const score = p === t ? g.score : sub(p) + 0.25 * (g.score - sub(p));
      out.push({ path: p, score: Math.round(score * 100) / 100, reasons });
    }
  }
  out.sort((a, b) => b.score - a.score);
  const head = out.length ? out[0].score : 0;
  return out.slice(0, 5).map((s, i) => ({ ...s,
    strength: i === 0 ? (s.score >= 1.2 ? 'strong' : s.score >= 0.8 ? 'likely' : 'maybe')
      : s.score >= 2 && s.score >= head * 0.6 ? 'strong' : s.score >= 1 && s.score >= head * 0.45 && i < 3 ? 'likely' : 'maybe' }));
}

module.exports = { build, suggest, words, authorsOf, seriesKey };

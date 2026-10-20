'use strict';
// Once, after books could have several categories (migration 18): give the books from the old library every
// category they had there, and suggest categories for the old books that have none.
//
// 1. The old library's import kept one category per book (the most specific), but it also wrote the name of each
//    of the book's other categories into its tags ("historical fiction, romance"). Those names are matched back
//    to the library's own categories, so "Christian Fiction › 1800's American West" with the tags "historical
//    fiction, romance" gets "Christian Fiction › Historical Fiction" and "Christian Fiction › Romance" back. These
//    were the old library's own categories, so they stay signed off.
// 2. Old books with no category get the suggester's confident picks (lib/catsuggest), not signed off, so the
//    librarian sees them under Books > Show: Categories to sign off.
// Only books nobody has changed since are touched (one category, signed off by the old library, or none), and
// each book is done once (category_backfill), so nothing a librarian removes later comes back.
const cats = require('./lib/cats');
const catSuggest = require('./lib/catsuggest');

// What the catalog knows: every category part's paths (lower-case name → paths ending in it, below the top level),
// its spelling, and how many old books carry each tag.
function vocabulary(rows) {
  const parts = new Map(), spelled = new Map(), tagCount = new Map();
  for (const b of rows) {
    for (const p of cats.pathsOf(b)) {
      const bits = p.split(cats.SEP);
      for (let i = 2; i <= bits.length; i++) {
        const name = bits[i - 1], k = name.toLowerCase(), path = bits.slice(0, i).join(cats.SEP);
        if (!parts.has(k)) parts.set(k, new Set());
        parts.get(k).add(path); if (!spelled.has(k)) spelled.set(k, name);
      }
    }
    if (b.legacy_id) for (const t of new Set(tagsOf(b))) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  }
  return { parts, spelled, tagCount };
}
const tagsOf = (b) => String(b.tags || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const UPPER = new Set(['ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'ww', 'wwi', 'wwii', 'usa', 'uk', 'dvd', 'dvds', 'cd', 'cds', 'kjv', 'niv', 'esv', 'nkjv', 'nasb', 'vbs']);
const titleCase = (s) => s.split(' ').map((w, i) => (UPPER.has(w) ? w.toUpperCase() : i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

// The book's categories rebuilt from its main one and its tags.
//   → { paths, guessed: [names placed beside the main one because no book here is filed under them yet] }
function rebuild(book, voc) {
  const own = cats.pathsOf(book);
  if (!own.length) return { paths: own, guessed: [] };
  const main = own[0], mainBits = main.split(cats.SEP), mainTop = mainBits[0];
  const mine = new Set(mainBits.slice(1).map((x) => x.toLowerCase()));
  const add = [], guessed = [];
  for (const tag of tagsOf(book)) {
    if (mine.has(tag)) continue; // part of the main category itself
    const known = voc.parts.get(tag);
    if (known) {
      const ps = [...known], here = ps.filter((p) => cats.top(p).toLowerCase() === mainTop.toLowerCase());
      // a name used in several places ("Mystery") counts only under the book's own subject
      const pick = ps.length === 1 ? ps[0] : here.length === 1 ? here[0] : null;
      if (pick) add.push(pick);
    } else if ((voc.tagCount.get(tag) || 0) >= 2 && tag.length <= 60 && !/[0-9]{4}/.test(tag)) {
      // no book is filed there yet (it was always a second category): beside the main one, under the same subject
      add.push(`${mainTop}${cats.SEP}${titleCase(tag)}`); guessed.push(titleCase(tag));
    }
  }
  const list = cats.leavesOnly(cats.cleanPaths([main, ...own.slice(1), ...add]));
  // the main one first (or the more specific shelf that replaced it)
  const under = (p) => p.toLowerCase() === main.toLowerCase() || p.toLowerCase().startsWith(main.toLowerCase() + cats.SEP);
  return { paths: [...list.filter(under), ...list.filter((p) => !under(p))], guessed: guessed.filter((g) => list.some((p) => p.endsWith(cats.SEP + g))) };
}

async function backfillCategories() {
  const db = require('./db'); // here, so rebuild() can be tested without a database
  const done = new Set((await db.many('SELECT book_id FROM category_backfill')).map((r) => r.book_id));
  const rows = (await db.many(`SELECT id, title, subtitle, author, series, tags, short_description, left(description, 1500) AS description, publisher,
    format, audience, category, subcategory, categories, categories_ok_at, categories_ok_by FROM books
    WHERE legacy_id IS NOT NULL AND (categories = '{}' OR (cardinality(categories) = 1 AND categories_ok_at IS NOT NULL AND categories_ok_by IS NULL))`))
    .filter((b) => !done.has(b.id));
  if (!rows.length) return { restored: 0, toCheck: 0, suggested: 0 };
  const voc = vocabulary(await db.many('SELECT legacy_id, tags, category, subcategory, categories FROM books'));
  let restored = 0, guessedBooks = 0, suggested = 0, model = null;
  for (const b of rows) {
    let kind = 'checked';
    if (b.categories && b.categories.length) {
      const { paths, guessed } = rebuild(b, voc);
      if (!cats.sameList(paths, b.categories)) {
        const main = cats.primary(paths);
        // a category placed by guess waits for the librarian's sign-off; the rest were the old library's own
        await db.query(`UPDATE books SET categories = $2::text[], category = $3, subcategory = $4,
          categories_ok_at = CASE WHEN $5::boolean THEN NULL ELSE categories_ok_at END WHERE id = $1`, [b.id, paths, main.category, main.subcategory, guessed.length > 0]);
        restored++; if (guessed.length) guessedBooks++; kind = guessed.length ? 'restored, to check' : 'restored';
      }
    } else {
      if (!model) model = catSuggest.build(await db.many(`SELECT b.id, b.title, b.subtitle, b.author, b.series, b.tags, b.short_description,
        left(b.description, 1500) AS description, b.publisher, b.format, b.audience, b.audiences, b.categories FROM books b WHERE b.categories <> '{}'`));
      const picks = catSuggest.suggest(model, b).filter((s) => s.strength !== 'maybe').map((s) => s.path).slice(0, 3);
      if (picks.length) {
        const main = cats.primary(picks);
        await db.query('UPDATE books SET categories = $2::text[], category = $3, subcategory = $4, categories_ok_at = NULL, categories_ok_by = NULL WHERE id = $1',
          [b.id, picks, main.category, main.subcategory]);
        suggested++; kind = 'suggested';
      } else kind = 'none';
    }
    await db.query('INSERT INTO category_backfill (book_id, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING', [b.id, kind]);
  }
  if (restored || suggested) console.log(`Categories: gave ${restored} old-library books back all their categories (${guessedBooks} to check); suggested categories for ${suggested} that had none.`);
  return { restored, toCheck: guessedBooks, suggested };
}

module.exports = { backfillCategories, rebuild, vocabulary };

'use strict';
// Search-as-you-type suggestions: the best few books, writers and categories
// for what's been typed so far. Runs in memory over a small cached index.

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const prepared = new WeakMap();
function prep(b) {
  let p = prepared.get(b);
  if (!p) {
    const title = norm(b.title);
    p = {
      title,
      titleNoArticle: title.replace(/^(the|a|an) /, ''),
      titleWords: title.split(' '),
      authorWords: norm(b.author).split(' ').filter(Boolean),
      series: norm(b.series),
      sku: norm(b.call_number).replace(/ /g, ''),
      subtitle: norm(b.subtitle),
      all: [title, norm(b.subtitle), norm(b.author), norm(b.series), norm(b.call_number)].join(' ').split(' ').filter(Boolean),
    };
    prepared.set(b, p);
  }
  return p;
}

function scoreBook(b, q, tokens) {
  const p = prep(b);
  const compact = q.replace(/ /g, '');
  if (p.sku && p.sku === compact) return 1000;
  // Every typed word must start some word of the title, writer, series or library number.
  if (!tokens.every((t) => p.all.some((w) => w.startsWith(t)))) {
    return p.title.includes(q) ? 150 : p.sku && p.sku.startsWith(compact) && compact.length >= 2 ? 400 : 0;
  }
  let s = 100;
  if (p.title === q || p.titleNoArticle === q) s = 900;
  else if (p.title.startsWith(q) || p.titleNoArticle.startsWith(q)) s = 700;
  else if (tokens.every((t) => p.titleWords.some((w) => w.startsWith(t)))) s = 500;
  else if (tokens.every((t) => p.authorWords.some((w) => w.startsWith(t)))) s = 350;
  else if (p.series && tokens.every((t) => p.series.split(' ').some((w) => w.startsWith(t)))) s = 300;
  if (p.sku && compact.length >= 2 && p.sku.startsWith(compact)) s = Math.max(s, 400);
  return s - Math.min(p.title.length, 80) / 100 + (b.available > 0 ? 0.5 : 0);
}

function suggest(rawQuery, books, { includeHidden = false, limit = 8 } = {}) {
  const q = norm(rawQuery).slice(0, 80);
  if (q.length < 2 && !/^\d$/.test(q)) return { books: [], writers: [], categories: [] };
  const tokens = q.split(' ');
  const scored = [];
  for (const b of books) {
    if (!includeHidden && b.active === false) continue;
    const s = scoreBook(b, q, tokens);
    if (s > 0) scored.push([s, b]);
  }
  scored.sort((a, b) => b[0] - a[0]);

  // Writers whose names match what's typed (each name counted once).
  const writerCounts = new Map();
  for (const b of books) {
    if (!includeHidden && b.active === false) continue;
    for (const name of String(b.author || '').split(',').map((x) => x.trim()).filter(Boolean)) {
      const words = norm(name).split(' ');
      if (tokens.every((t) => words.some((w) => w.startsWith(t)))) writerCounts.set(name, (writerCounts.get(name) || 0) + 1);
    }
  }
  const writers = [...writerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => ({ name, n }));

  // Categories and sub-categories whose names match.
  const catCounts = new Map();
  for (const b of books) {
    if (!b.category || (!includeHidden && b.active === false)) continue;
    const parts = [b.category, ...(b.subcategory ? b.subcategory.split(' › ') : [])];
    for (let i = 0; i < parts.length; i++) {
      const words = norm(parts[i]).split(' ');
      if (tokens.every((t) => words.some((w) => w.startsWith(t)))) {
        const key = JSON.stringify([b.category, i ? parts.slice(1, 2)[0] : '']);
        catCounts.set(key, (catCounts.get(key) || 0) + 1);
      }
    }
  }
  const categories = [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([key, n]) => { const [category, sub] = JSON.parse(key); return { category, subcategory: sub, label: sub ? `${category} › ${sub}` : category, n }; });

  return { books: scored.slice(0, limit).map(([, b]) => b), writers, categories, total: scored.length };
}

module.exports = { suggest, norm };

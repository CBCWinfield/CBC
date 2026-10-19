'use strict';
// A book's categories are paths like "Christian Fiction › Historical Fiction › WW II".
// A book can have several. The first is its main one (kept in books.category / books.subcategory too).

const SEP = ' › ';
const MAX = 12;

// "Christian Fiction > Mystery", "Christian Fiction›Mystery" → "Christian Fiction › Mystery"
function cleanPath(p) {
  return String(p == null ? '' : p).split(/›|>/).map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean).join(SEP).slice(0, 300);
}

// Tidy a list: cleaned, no repeats (ignoring case), at most MAX. The order is kept (the first is the main one).
function cleanPaths(list) {
  const out = [], seen = new Set();
  for (const raw of Array.isArray(list) ? list : [list]) {
    const p = cleanPath(raw);
    if (!p || /^uncategori[sz]ed$/i.test(p) || seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase()); out.push(p);
    if (out.length >= MAX) break;
  }
  return out;
}

// Drop a path when a more specific one under it is also chosen ("Christian Fiction" when "Christian Fiction › Mystery" is there).
function leavesOnly(paths) {
  return paths.filter((p) => !paths.some((q) => q !== p && q.toLowerCase().startsWith(p.toLowerCase() + SEP)));
}

const top = (p) => String(p).split(SEP)[0];
const rest = (p) => { const i = String(p).indexOf(SEP); return i < 0 ? null : String(p).slice(i + SEP.length); };

// { category, subcategory } for the main (first) path
function primary(paths) {
  const p = paths && paths[0];
  return p ? { category: top(p), subcategory: rest(p) } : { category: null, subcategory: null };
}

// Every path of a book row (books saved before categories existed only have category/subcategory).
function pathsOf(b) {
  if (!b) return [];
  if (Array.isArray(b.categories) && b.categories.length) return b.categories;
  return b.category ? [[b.category, b.subcategory].filter(Boolean).join(SEP)] : [];
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x.toLowerCase() === String(b[i]).toLowerCase());
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.some((y) => String(y).toLowerCase() === x.toLowerCase()));

module.exports = { SEP, MAX, cleanPath, cleanPaths, leavesOnly, top, rest, primary, pathsOf, sameList, sameSet };

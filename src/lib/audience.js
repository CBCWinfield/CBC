'use strict';
// Who a book is for. A book can suit more than one group ("Adults" and "Teens"); "Everyone" means all ages.
// Kept in books.audiences (a list); books.audience holds the first of them, for anything that wants one.

const GROUPS = ['Adults', 'Youth', 'Children'];
const ALL = ['Everyone', ...GROUPS];
const LABEL = { Everyone: 'Everyone', Adults: 'Adults', Youth: 'Teens', Children: 'Children' };
const FORM_LABEL = { Everyone: 'Everyone (all ages)', Adults: 'Adults', Youth: 'Teens (Central Teens)', Children: 'Children (Central Kids)' };

// "teens", "Young adult", "kids" → the group's name, or null.
function match(s) {
  const x = String(s || '').trim();
  if (!x) return null;
  const exact = ALL.find((a) => a.toLowerCase() === x.toLowerCase());
  if (exact) return exact;
  if (/^(all( ages)?|any|family|everybody)$/i.test(x)) return 'Everyone';
  if (/child|kid|junior|juvenile|preschool|toddler|board book/i.test(x)) return 'Children';
  if (/teen|youth|young adult|\bya\b|student/i.test(x)) return 'Youth';
  if (/adult|grown|men|women/i.test(x)) return 'Adults';
  return null;
}

// A list (or "Adults; Teens", "adults and teens") → the groups, in order. All three is Everyone.
function normalize(list) {
  const parts = [].concat(list == null ? [] : list).flatMap((x) => String(x).split(/\s*[;,/&+|]\s*|\s+and\s+/i));
  const set = new Set(parts.map(match).filter(Boolean));
  if (set.has('Everyone') || GROUPS.every((a) => set.has(a))) return ['Everyone'];
  return GROUPS.filter((a) => set.has(a));
}

// A book's groups (older rows may only have the one).
function of(book) {
  if (!book) return [];
  if (Array.isArray(book.audiences) && book.audiences.length) return normalize(book.audiences);
  return normalize(book.audience);
}

const primary = (list) => normalize(list)[0] || null;
const label = (list) => normalize(list).map((a) => LABEL[a]).join(', ');
// Is the book for this group? (A book for everyone is for each group too.)
const suits = (book, group) => { const l = of(book); return l.includes(group) || l.includes('Everyone'); };

module.exports = { GROUPS, ALL, LABEL, FORM_LABEL, match, normalize, of, primary, label, suits };

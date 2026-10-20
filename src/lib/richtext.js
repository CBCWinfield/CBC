'use strict';
// Italics and bold in book descriptions, kept as plain text the way a typist would: *italic* and **bold**.
// The book screen's I and B buttons (and Ctrl+I / Ctrl+B) put the stars in; the book page shows real italics.
// public/js/app.js has the same rules for the preview under the description box; keep the two alike.
const { esc, raw } = require('./html');

// A run starts and ends with a letter or mark (not a space), so "5 * 3" or a "* " bullet stays as it is.
const BOTH = /\*\*\*([^\s*](?:[^*]*?[^\s*])?)\*\*\*/g;
const BOLD = /\*\*([^\s*](?:(?:[^*]|\*(?!\*))*?[^\s*])?)\*\*/g;
const ITAL = /(^|[^\w*])\*([^\s*](?:[^*]*?[^\s*])?)\*(?![\w*])/g;

// One line or paragraph → safe HTML with <em> and <strong>.
function inline(text) {
  const h = esc(String(text == null ? '' : text))
    .replace(BOTH, '<strong><em>$1</em></strong>')
    .replace(BOLD, '<strong>$1</strong>')
    .replace(ITAL, '$1<em>$2</em>');
  return raw(h);
}

// A description → paragraphs (a blank line between them), with single line breaks kept.
function paragraphs(text) {
  return String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => raw(`<p>${p.split('\n').map((l) => inline(l).toString()).join('<br>')}</p>`));
}

// The words alone, for link previews and search.
function plain(text) {
  return String(text == null ? '' : text).replace(BOTH, '$1').replace(BOLD, '$1').replace(ITAL, '$1$2');
}

// HTML from another system (the old library, a publisher's description) → this markup, other tags dropped by the caller.
function fromHtml(s) {
  let out = String(s || '');
  const wrap = (mark) => (m, tag, inner) => {
    const text = inner.replace(/<[^>]+>/g, '');
    if (!text.trim()) return inner;
    const lead = /^\s*/.exec(inner)[0], tail = /\s*$/.exec(inner)[0];
    return `${lead}${mark}${inner.trim()}${mark}${tail}`;
  };
  // innermost first, so <em><strong>x</strong></em> becomes ***x***
  for (let i = 0; i < 3; i++) {
    out = out.replace(/<(strong|b)\b[^>]*>((?:(?!<\/?(?:strong|b)\b)[\s\S])*?)<\/\1\s*>/gi, wrap('**'));
    out = out.replace(/<(em|i|cite)\b[^>]*>((?:(?!<\/?(?:em|i|cite)\b)[\s\S])*?)<\/\1\s*>/gi, wrap('*'));
  }
  return out;
}

// This markup → HTML tags, for the export in the old library's format (its descriptions are HTML).
function toHtml(text) {
  return String(text == null ? '' : text).replace(BOTH, '<strong><em>$1</em></strong>').replace(BOLD, '<strong>$1</strong>').replace(ITAL, '$1<em>$2</em>');
}

// ---------- putting another copy's italics into this text ----------
// The old website's copy of a description has its italics; the copy here lost them. When the two say the same
// thing (ignoring curly vs straight quotes, dashes, "…", and spacing, which WordPress changes as it shows a page),
// carryMarks(here, theirs) gives this text with the stars added in the same places, and nothing else changed.
// Anything else (the words differ, or this text already has some italics) gives null.
const QUOTE1 = /[‘’‚‛′`´]/, QUOTE2 = /[“”„‟″]/, DASH = /[-‐‑‒–—―−]/, SPACE = /[\s  -   　]/, SKIP = /[​‌‍­﻿]/;
const MARK = /[-]/; // bold open, bold close, italic open, italic close
function canon(s, events) {
  const out = [];
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (MARK.test(ch)) { if (events) events.push({ at: out.length, mark: ch }); i++; continue; }
    if (SKIP.test(ch)) { i++; continue; }
    if (SPACE.test(ch)) {
      let j = i; while (j < s.length && (SPACE.test(s[j]) || SKIP.test(s[j]))) j++;
      if (out.length && j < s.length) out.push({ c: ' ', start: i, end: j });
      i = j; continue;
    }
    if (ch === '…') { for (let k = 0; k < 3; k++) out.push({ c: '.', start: i, end: i + 1 }); i++; continue; }
    if (DASH.test(ch)) { let j = i + 1; while (j < s.length && DASH.test(s[j])) j++; out.push({ c: '-', start: i, end: j }); i = j; continue; }
    out.push({ c: QUOTE1.test(ch) ? "'" : QUOTE2.test(ch) ? '"' : ch === '×' ? 'x' : ch, start: i, end: i + 1 });
    i++;
  }
  return out;
}
const tagsOf = (s) => (String(inline(s)).match(/<\/?(em|strong)>/g) || []).join('');
function carryMarks(here, theirs) {
  const cur = String(here || ''), fmt = String(theirs || '');
  if (!cur || !fmt || tagsOf(cur)) return null;
  const marked = fmt.replace(BOTH, '$1').replace(BOLD, '$1').replace(ITAL, '$1$2');
  const events = [];
  const a = canon(marked, events), b = canon(cur);
  if (!events.length || a.length !== b.length || a.some((x, k) => x.c !== b[k].c)) return null;
  // an opening mark goes before its first letter here, a closing one right after its last
  const ins = events.map((e, n) => {
    const close = e.mark === '' || e.mark === '';
    const pos = close ? (e.at > 0 ? b[e.at - 1].end : 0) : (e.at < b.length ? b[e.at].start : cur.length);
    return { pos, n, text: e.mark === '' || e.mark === '' ? '**' : '*' };
  }).sort((p, q) => p.pos - q.pos || p.n - q.n);
  let out = '', last = 0;
  for (const x of ins) { out += cur.slice(last, x.pos) + x.text; last = x.pos; }
  out += cur.slice(last);
  // only stars were added, and they show just as the other copy does
  return plain(out) === cur && tagsOf(out) === tagsOf(fmt) ? out : null;
}

module.exports = { inline, paragraphs, plain, fromHtml, toHtml, carryMarks };

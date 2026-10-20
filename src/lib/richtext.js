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

module.exports = { inline, paragraphs, plain, fromHtml, toHtml };

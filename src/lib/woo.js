'use strict';
// Reads and writes the old library's WooCommerce product export, so the
// existing catalog moves over as-is and can be exported back in the same shape.
const { parseCsv } = require('./csv');

// Columns exactly as the old system exports them.
const WOO_HEADER = ['ean_isbn13', 'Type', 'SKU', 'Title', 'Published', 'Is featured?', 'Visibility in catalog', 'Short description', 'description',
  'Date sale price starts', 'Date sale price ends', 'Tax status', 'Tax class', 'In stock?', 'Stock', 'Low stock amount', 'Backorders allowed?',
  'Sold individually?', 'Weight (oz)', 'Length (in)', 'Width (in)', 'Height (in)', 'Allow customer reviews?', 'Purchase note', 'Sale price',
  'Regular price', 'Categories', 'Tags', 'Shipping class', 'Images', 'Download limit', 'Download expiry days', 'Parent', 'Grouped products',
  'Upsells', 'Cross-sells', 'External URL', 'Button text', 'creators', 'Attribute 1 value(s)', 'Attribute 2 name', 'Attribute 2 value(s)',
  'Attribute 3 name', 'Attribute 3 value(s)', 'Attribute 4 name', 'Attribute 4 value(s)', 'Attribute 5 name', 'Attribute 5 value(s)'];

function isWooExport(text) {
  const firstLine = String(text || '').replace(/^﻿/, '').split(/\r?\n/, 1)[0].toLowerCase();
  return firstLine.includes('categories') && firstLine.includes('images') && (firstLine.includes('attribute 1 value') || firstLine.includes('visibility in catalog'));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// WordPress HTML description -> plain paragraphs.
function cleanDescription(html) {
  let s = String(html || '');
  s = s.replace(/\\n/g, '\n').replace(/\\r/g, '');
  s = s.replace(/\[embedyt\][\s\S]*?\[\/embedyt\]/gi, '').replace(/\[\/?[a-z_][^\]]*\]/gi, '');
  s = s.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n').replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

// WooCommerce writes a comma inside a value as "\,".
const tidy = (s) => decodeEntities(String(s || '')).replace(/\\,/g, ',').replace(/\s+/g, ' ').trim();

const FORMAT_MAP = {
  paperback: 'Paperback', hardback: 'Hardback', hardcover: 'Hardback', 'board book': 'Board Book', workbook: 'Workbook',
  dvd: 'DVD', 'blu-ray': 'Blu-ray', cd: 'CD', pdf: 'Other', pamphlet: 'Pamphlet', 'leather covered': 'Hardback', 'large print': 'Large Print', audiobook: 'Audiobook',
};
function mapFormat(value, categories) {
  const first = String(value || '').split(',')[0].trim().toLowerCase();
  if (FORMAT_MAP[first]) return FORMAT_MAP[first];
  if (first) return first.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
  if (categories.some((c) => /^dvd/i.test(c))) return 'DVD';
  if (categories.some((c) => /^cds?\b/i.test(c))) return 'CD';
  return 'Book';
}

function audienceFor(paths, details) {
  const all = paths.join(' | ');
  if (/^(junior|children'?s books|children\/youth)/im.test(paths.join('\n')) || /children'?s (drama|superhero|games|instruction)|board books|kindergarten/i.test(all) || details['Reading Level']) return 'Children';
  if (/(^|\| )(youth|young adult)|teenager/i.test(all)) return 'Youth';
  if (/^(dvd|cds?|songbooks)/im.test(paths.join('\n'))) return 'Everyone';
  return 'Adults';
}

const AUTHOR_KEYS = ['Writer', 'Author', 'Authors', 'Writers', 'Artist', 'Editors', 'Editor'];
const DETAIL_KEYS = ['Illustrator', 'Editors', 'Editor', 'Artist', 'Book read by', 'Running Time', 'Rated', 'Reading Level', 'Actor, Actress', 'Release Date'];

function rowToBook(cols, idx) {
  const get = (name) => (idx[name] != null ? String(cols[idx[name]] || '') : '');
  // Attribute pairs: "creators"/"Attribute 1 value(s)", then "Attribute N name"/"Attribute N value(s)".
  const attrs = {};
  const start = idx.creators;
  if (start != null) {
    for (let i = start; i + 1 < cols.length; i += 2) {
      const name = tidy(cols[i]);
      const value = tidy(cols[i + 1]);
      if (name && value && !(name in attrs)) attrs[name] = value;
    }
  }
  const paths = get('Categories').split(',').map((c) => tidy(c)).filter(Boolean);
  // Use the most specific category path: "Christian Fiction > Historical Fiction > WW II".
  const best = [...paths].sort((a, b) => b.split('>').length - a.split('>').length)[0] || '';
  const parts = best.split('>').map((x) => x.trim()).filter(Boolean);
  const category = parts[0] && parts[0] !== 'Uncategorized' ? parts[0] : null;
  const subcategory = parts.length > 1 ? parts.slice(1).join(' › ') : null;
  const leafTags = paths.flatMap((p) => p.split('>').slice(1).map((x) => x.trim().toLowerCase())).filter(Boolean);
  const tags = [...new Set([...leafTags, ...get('Tags').split(',').map((x) => tidy(x).toLowerCase()).filter(Boolean)])].join(', ');

  const details = {};
  for (const k of DETAIL_KEYS) if (attrs[k]) details[k] = attrs[k];
  const author = AUTHOR_KEYS.map((k) => attrs[k]).find(Boolean) || null;
  const yearText = attrs['Publication Date'] || attrs['Release Date'] || '';
  const year = (yearText.match(/\b(1[5-9]\d\d|20\d\d)\b/) || [])[1];
  const pages = parseInt(attrs['Number of Pages'], 10);
  const stock = parseInt(get('Stock'), 10);

  const short = cleanDescription(get('Short description')).replace(/\s*\n+\s*/g, ' ');
  const description = cleanDescription(get('description'));

  const images = get('Images').split(',').map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
  return {
    legacy_id: tidy(get('ean_isbn13')) || null,
    call_number: /e\+/i.test(get('SKU')) ? null : tidy(get('SKU')) || null, // Excel mangled a few numbers into 9.78E+11
    title: tidy(get('Title')),
    author,
    category,
    subcategory,
    audience: audienceFor(paths, details),
    format: mapFormat(attrs.Format, paths),
    description: description || null,
    short_description: short || null,
    tags: tags || null,
    publisher: attrs.Publisher || null,
    published_year: year ? Number(year) : null,
    pages: Number.isFinite(pages) && pages > 0 ? pages : null,
    series: attrs.Series || null,
    copies_total: Number.isFinite(stock) && stock > 0 ? Math.min(stock, 999) : 1,
    active: get('Published').trim() !== '-1',
    details: Object.keys(details).length ? details : null,
    cover_source_url: images[0] || null,
  };
}

function parseWoo(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { books: [], skipped: [] };
  const header = rows[0].map((h) => h.trim());
  const idx = {};
  header.forEach((h, i) => { if (!(h in idx)) idx[h] = i; });
  const books = [];
  const skipped = [];
  rows.slice(1).forEach((cols, i) => {
    const b = rowToBook(cols, idx);
    if (!b.title) skipped.push({ row: i + 2, reason: `no title (old ID ${b.legacy_id || '?'})` });
    else books.push(b);
  });
  return { books, skipped };
}

// ---------- Export back to the old format ----------
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toWooCsv(books, baseUrl) {
  const lines = [WOO_HEADER.join(',')];
  for (const b of books) {
    const cat = [b.category, ...(b.subcategory ? b.subcategory.split('›').map((x) => x.trim()) : [])].filter(Boolean).join(' > ');
    const image = b.cover_source_url || (b.has_cover ? `${baseUrl}/covers/${b.id}` : '');
    const desc = (b.description || '').split(/\n{2,}/).map((p) => p.replace(/\n/g, '<br>')).join('\n\n');
    const row = {
      ean_isbn13: b.legacy_id || `new-${b.id}`,
      Type: 'simple',
      SKU: b.call_number || '',
      Title: b.title,
      Published: b.active ? 1 : -1,
      'Is featured?': 0,
      'Visibility in catalog': 'visible',
      'Short description': b.short_description || '',
      description: desc,
      'Tax status': 'taxable',
      'In stock?': b.available > 0 ? 1 : 'backorder',
      Stock: b.copies_total,
      'Backorders allowed?': 'notify',
      'Sold individually?': 0,
      'Allow customer reviews?': 1,
      'Regular price': 0,
      Categories: cat || 'Uncategorized',
      Tags: '',
      'Shipping class': 'Library Books',
      Images: image,
      creators: b.author ? 'Writer' : '',
      'Attribute 1 value(s)': b.author || '',
      'Attribute 2 name': 'Format',
      'Attribute 2 value(s)': b.format || '',
      'Attribute 3 name': b.publisher ? 'Publisher' : '',
      'Attribute 3 value(s)': b.publisher || '',
      'Attribute 4 name': b.published_year ? 'Publication Date' : '',
      'Attribute 4 value(s)': b.published_year || '',
      'Attribute 5 name': b.series ? 'Series' : '',
      'Attribute 5 value(s)': b.series || '',
    };
    lines.push(WOO_HEADER.map((h) => csvCell(row[h])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { isWooExport, parseWoo, cleanDescription, toWooCsv, WOO_HEADER };

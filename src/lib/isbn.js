'use strict';
// Book lookup by ISBN: Open Library and Google Books together (both free; GOOGLE_BOOKS_KEY is optional and only
// raises Google's daily limit). Used only by staff when adding books; it is not part of the Ask bar.
const rich = require('./richtext');

const UA = 'CBC-Library/1.0 (church lending library)';
const clean = (s) => String(s || '').replace(/[^0-9Xx]/g, '').toUpperCase();

function validIsbn(raw) {
  const s = clean(raw);
  if (s.length === 10) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
    return sum % 11 === 0 ? s : null;
  }
  if (s.length === 13 && /^\d+$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    return sum % 10 === 0 ? s : null;
  }
  return null;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  return res.json();
}

const CATEGORY_RULES = [
  [/commentar/i, 'Commentary'],
  [/devotion/i, 'Devotional'],
  [/prayer/i, 'Prayer'],
  [/grief|bereave|consolation|death/i, 'Grief & Comfort'],
  [/marriage|married|husband|wife/i, 'Marriage & Family'],
  [/parent|child rearing|families/i, 'Parenting'],
  [/prophec|eschatolog|revelation/i, 'Prophecy'],
  [/apologetic/i, 'Apologetics'],
  [/missions|missionar/i, 'Missions'],
  [/church history|reformation/i, 'Church History'],
  [/biograph/i, 'Biography'],
  [/hymn|worship|music/i, 'Music & Worship'],
  [/theolog|doctrin/i, 'Theology'],
  [/juvenile/i, 'Children'],
  [/young adult|teenager/i, 'Youth'],
  [/fiction/i, 'Fiction'],
  [/bible.*(study|criticism|introduction)/i, 'Bible Study'],
  [/^bibles?$|bible\. english/i, 'Bibles'],
  [/christian life|spiritual life|christianity/i, 'Christian Living'],
];

function guessCategory(subjects) {
  for (const [re, cat] of CATEGORY_RULES) if (subjects.some((s) => re.test(s))) return cat;
  return '';
}

// ---------- the two sources ----------
// Open Library: the record for this exact edition (pages, year), its subjects, and usually a good cover.
async function fromOpenLibrary(isbn, get) {
  const data = await get(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const d = data && data[`ISBN:${isbn}`];
  if (!d) return null;
  let description = '';
  try {
    const ed = await get(`https://openlibrary.org/isbn/${isbn}.json`);
    description = textOf(ed && ed.description);
    if (!description && ed && ed.works && ed.works[0]) {
      const work = await get(`https://openlibrary.org${ed.works[0].key}.json`);
      description = textOf(work && work.description);
    }
  } catch { /* description is optional */ }
  description = description.replace(/\(\[source\]\[\d+\]\)|\[source\]\[\d+\]|\n\s*\[\d+\]: .*$/gm, '').replace(/-{3,}[\s\S]*$/, '').trim();
  return {
    title: d.title || '',
    subtitle: d.subtitle || '',
    authors: (d.authors || []).map((a) => a.name).filter(Boolean),
    publisher: ((d.publishers || [])[0] || {}).name || '',
    year: yearOf(d.publish_date),
    pages: Number(d.number_of_pages) || Number((String(d.pagination || '').match(/(\d{2,5})\s*p/) || [])[1]) || null,
    description,
    subjects: (d.subjects || []).map((x) => x.name || x).filter(Boolean),
    cover: d.cover ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg` : '',
  };
}
const textOf = (x) => (typeof x === 'string' ? x : x && x.value ? String(x.value) : '');
const yearOf = (s) => { const y = (String(s || '').match(/\b(1[5-9]\d\d|20\d\d)\b/) || [])[1]; return y ? Number(y) : null; };

// Google Books: usually the cleanest title, writers and publisher, and the publisher's description with its italics.
async function fromGoogle(isbn, get) {
  const key = process.env.GOOGLE_BOOKS_KEY ? `&key=${encodeURIComponent(process.env.GOOGLE_BOOKS_KEY)}` : '';
  const list = await get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=5${key}`);
  const items = (list && list.items) || [];
  const want = new Set([isbn, to13(isbn), to10(isbn)].filter(Boolean));
  const ids = (it) => ((it.volumeInfo && it.volumeInfo.industryIdentifiers) || []).map((x) => clean(x.identifier));
  const item = items.find((it) => ids(it).some((x) => want.has(x))) || (items.length === 1 && !ids(items[0]).length ? items[0] : null);
  if (!item) return null;
  let v = item.volumeInfo || {};
  // the volume itself has the description with its formatting, and fuller subjects
  try {
    const full = item.id && await get(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(item.id)}${key ? `?${key.slice(1)}` : ''}`);
    if (full && full.volumeInfo && full.volumeInfo.title) v = { ...v, ...full.volumeInfo };
  } catch { /* the list's copy will do */ }
  const img = v.imageLinks || {};
  const cover = (img.thumbnail || img.smallThumbnail || '').replace(/^http:/, 'https:').replace(/&edge=curl/, '');
  return {
    title: v.title || '',
    subtitle: v.subtitle || '',
    authors: (v.authors || []).filter(Boolean),
    publisher: v.publisher || '',
    year: yearOf(v.publishedDate),
    pages: Number(v.printedPageCount) || Number(v.pageCount) || null,
    description: htmlToText(v.description || ''),
    categories: (v.categories || []).filter(Boolean),
    mature: v.maturityRating === 'MATURE',
    cover: /^https:\/\/books\.google(usercontent)?\.com\//.test(cover) ? cover : '',
  };
}

// A description written in HTML → plain text, keeping italics and bold as *stars* (lib/richtext.js).
function htmlToText(h) {
  let s = rich.fromHtml(String(h || ''));
  s = s.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/li>/gi, '\n').replace(/<\/(p|div|h[1-6]|blockquote|ul|ol)>/gi, '\n\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&[a-z]+;/gi, ' ');
  return s.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const to13 = (s) => {
  if (s.length !== 10) return s.length === 13 ? s : null;
  const core = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + ((10 - (sum % 10)) % 10);
};
const to10 = (s) => {
  if (s.length !== 13 || !s.startsWith('978')) return s.length === 10 ? s : null;
  const core = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const c = (11 - (sum % 11)) % 11;
  return core + (c === 10 ? 'X' : String(c));
};

// ---------- tidying what comes back ----------
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or', 'the', 'to', 'with']);
function titleCase(s) {
  return s.toLowerCase().split(/(\s+)/).map((w, i, all) => {
    if (/^\s+$/.test(w)) return w;
    const first = i === 0, last = i === all.length - 1;
    return !first && !last && SMALL.has(w) ? w : w.replace(/^([("'“‘]?)(\p{L})/u, (m, p, c) => p + c.toUpperCase());
  }).join('');
}
// Shouting or all lower case → Title Case; "The Shack:" → "The Shack"
function tidyTitle(s) {
  let t = String(s || '').replace(/\s+/g, ' ').replace(/\s*[/:;,.]\s*$/, '').trim();
  if (t.length > 3 && /\p{L}/u.test(t) && (t === t.toUpperCase() || t === t.toLowerCase())) t = titleCase(t);
  return t;
}
// "Rekindled (Fountain Creek Chronicles, Book 1)" → title "Rekindled", series "Fountain Creek Chronicles"
function splitSeries(title) {
  const m = /^(.+?)\s*[([]\s*([^()[\]]+?)(?:,|\s)\s*(?:book|bk\.?|vol\.?|volume|no\.?|#|number)\s*(\d+|[ivx]+|one|two|three|four|five|six|seven|eight|nine|ten)\s*[)\]]\s*$/i.exec(title);
  if (m) return { title: m[1].trim(), series: m[2].replace(/[,:]\s*$/, '').replace(/\s+series$/i, '').trim(), number: m[3] };
  const n = /^(.+?)\s*[([]\s*([^()[\]]+?\b(?:series|trilogy|chronicles|saga|collection))\s*[)\]]\s*$/i.exec(title);
  if (n) return { title: n[1].trim(), series: n[2].trim() };
  return { title };
}
// "Lucado, Max" → "Max Lucado"; drop "by" and repeats
function tidyAuthors(list) {
  const out = [];
  for (let a of list) {
    a = String(a || '').replace(/^\s*by\s+/i, '').replace(/\s*\((author|editor|illustrator|ed\.?)\)\s*$/i, '').replace(/\s+/g, ' ').trim();
    const m = /^([^,]+),\s*([^,]+)$/.exec(a);
    if (m && !/\b(jr|sr|ii|iii|iv|phd|md|dd)\.?$/i.test(m[2])) a = `${m[2]} ${m[1]}`;
    if (a && a === a.toUpperCase() && a.length > 3) a = titleCase(a);
    if (a && !out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a);
  }
  return out;
}
const tidyPublisher = (p) => String(p || '').replace(/\s*[,;].*$/, '').replace(/\s+/g, ' ').trim();

const NOT_TAGS = /accessible|protected|lending|in library|overdrive|nyt:|^\d|large type|reading level|^(fiction|nonfiction|non-fiction|general|religion|christianity|english|american|literature|juvenile (fiction|nonfiction|literature)|young adult (fiction|nonfiction)|fiction in english|novels?)$/i;
function audiencesFrom(gb, subjects) {
  // Google's subjects are the publishers' own (BISAC); Open Library's are a mix, so they count only without Google's
  const list = gb && gb.categories && gb.categories.length ? gb.categories : subjects;
  if (list.some((s) => /young adult/i.test(s))) return ['Youth'];
  if (list.some((s) => /juvenile|children'?s (stories|literature|books)|picture books|board books/i.test(s))) return ['Children'];
  return [];
}

async function lookup(raw, { get = getJson } = {}) {
  const isbn = validIsbn(raw);
  if (!isbn) return { error: 'That ISBN doesn’t look right. It should be 10 or 13 digits.' };
  const safe = (p) => p.catch(() => null);
  const [ol, gb] = await Promise.all([safe(fromOpenLibrary(isbn, get)), safe(fromGoogle(isbn, get))]);
  if (!ol && !gb) return { error: 'No book was found for that ISBN. You can type the details in yourself.' };
  const pick = (...xs) => xs.find((x) => x != null && String(x).trim() !== '') ?? '';

  // the title from Google when it has one (cleaner), else Open Library's; a series in brackets moves to Series
  let title = tidyTitle(pick(gb && gb.title, ol && ol.title));
  let subtitle = tidyTitle(gb && gb.title ? gb.subtitle : ol && ol.subtitle);
  if (!subtitle) {
    // "Boundaries: When to Say Yes, How to Say No" in one line
    const at = title.indexOf(': ');
    if (at > 2 && at < title.length - 4) { subtitle = tidyTitle(title.slice(at + 2)); title = tidyTitle(title.slice(0, at)); }
  }
  const sp = splitSeries(title);
  title = sp.title;
  // Google often leaves the series off the title while Open Library has it in brackets
  let series = sp.series || (ol && ol.title ? splitSeries(tidyTitle(ol.title)).series : '') || '';
  if (!series && subtitle) {
    const s2 = splitSeries(`x (${subtitle.replace(/^\(|\)$/g, '')})`);
    if (s2.series) { series = s2.series; subtitle = ''; }
    else if (/^(book|volume)\s+\w+\s+(of|in)\s+the\s+/i.test(subtitle)) { series = subtitle.replace(/^(book|volume)\s+\w+\s+(of|in)\s+(the\s+)?/i, '').replace(/\s+series$/i, ''); subtitle = ''; }
  }

  const authors = tidyAuthors(gb && gb.authors.length ? gb.authors : ol ? ol.authors : []);
  const subjects = [...new Set([...(gb ? gb.categories.flatMap((c) => c.split(/\s*\/\s*/)) : []), ...(ol ? ol.subjects : [])]
    .map((x) => String(x).trim()).filter((x) => x && !/^general$/i.test(x)))];
  const olDesc = ol ? ol.description : '';
  const gbDesc = gb ? gb.description : '';
  // the publisher's description unless it's only a line and Open Library has a real one
  const description = (gbDesc && !(gbDesc.length < 80 && olDesc.length > 200) ? gbDesc : olDesc || gbDesc).slice(0, 4000);
  const audiences = audiencesFrom(gb, ol ? ol.subjects : []);
  const tags = [...new Set(subjects.filter((x) => x.length < 30 && !/,/.test(x) && !NOT_TAGS.test(x)).map((x) => x.toLowerCase()))].slice(0, 6).join(', ');

  return {
    isbn,
    title,
    subtitle,
    series,
    author: authors.join(', '),
    publisher: tidyPublisher(pick(gb && gb.publisher, ol && ol.publisher)),
    // this exact edition's year and pages, from Open Library's record of it when there is one
    published_year: pick(ol && ol.year, gb && gb.year),
    pages: pick(ol && ol.pages, gb && gb.pages),
    description,
    category: guessCategory(subjects),
    // all of them, for the category suggestions on the book screen
    subjects: subjects.filter((x) => !/accessible|protected|lending|in library|overdrive|nyt:|^\d/i.test(x)).slice(0, 30),
    audiences,
    audience: audiences[0] || '',
    tags,
    cover_url: pick(ol && ol.cover, gb && gb.cover),
    sources: [gb && 'Google Books', ol && 'Open Library'].filter(Boolean).join(' and '),
  };
}

// Download a cover image. Only from Open Library, Google Books, or the church's old website.
const IMAGE_HOSTS = ['covers.openlibrary.org', 'books.google.com', 'books.googleusercontent.com', 'www.cbcwinfield.com', 'cbcwinfield.com'];
async function fetchCover(url, { maxBytes = 3 * 1024 * 1024 } = {}) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !IMAGE_HOSTS.includes(u.hostname.toLowerCase())) return null;
  if (u.hostname === 'covers.openlibrary.org' && !u.searchParams.has('default')) u.searchParams.set('default', 'false');
  const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  // Busy or broken server: throw so the cover finder tries again later. Missing image: give up.
  if (res.status === 429 || res.status >= 500) throw new Error(`server busy (${res.status})`);
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|jpg|png|webp|gif)$/.test(type)) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 800 || buf.length > maxBytes) return null;
  return { data: buf, type: type === 'image/jpg' ? 'image/jpeg' : type };
}

// Find a cover by title and author when there's no ISBN or old cover photo.
async function searchCover(title, author) {
  const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const q = new URLSearchParams({ title: String(title).slice(0, 120), limit: '8', fields: 'title,author_name,cover_i' });
  if (author) q.set('author', String(author).split(',')[0].slice(0, 80));
  let data = await getJson(`https://openlibrary.org/search.json?${q}`);
  if ((!data || !data.docs || !data.docs.length) && author) {
    q.delete('author');
    data = await getJson(`https://openlibrary.org/search.json?${q}`);
  }
  const want = words(title);
  const last = words(author).pop();
  for (const d of (data && data.docs) || []) {
    if (!d.cover_i) continue;
    const got = new Set(words(d.title));
    const overlap = want.filter((w) => got.has(w)).length / Math.max(1, want.length);
    const authorOk = !last || (d.author_name || []).some((a) => a.toLowerCase().includes(last));
    if (overlap >= 0.75 && authorOk) return `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`;
  }
  return null;
}

module.exports = { lookup, fetchCover, searchCover, validIsbn, htmlToText, splitSeries, tidyAuthors, tidyTitle };

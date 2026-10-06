'use strict';
// Book lookup by ISBN using Open Library (free, no account needed).
// Used only by staff when adding books; it is not part of the Ask bar.

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

async function lookup(raw) {
  const isbn = validIsbn(raw);
  if (!isbn) return { error: 'That ISBN doesn’t look right. It should be 10 or 13 digits.' };
  const data = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const d = data && data[`ISBN:${isbn}`];
  if (!d) return { error: 'No book was found for that ISBN. You can type the details in yourself.' };

  let description = '';
  try {
    const ed = await getJson(`https://openlibrary.org/isbn/${isbn}.json`);
    const desc = ed && ed.description;
    description = typeof desc === 'string' ? desc : desc && desc.value ? desc.value : '';
    if (!description && ed && ed.works && ed.works[0]) {
      const work = await getJson(`https://openlibrary.org${ed.works[0].key}.json`);
      const wd = work && work.description;
      description = typeof wd === 'string' ? wd : wd && wd.value ? wd.value : '';
    }
  } catch { /* description is optional */ }
  description = description.replace(/\(\[source\]\[\d+\]\)|\[source\]\[\d+\]|\n\s*\[\d+\]: .*$/gm, '').replace(/-{3,}[\s\S]*$/, '').trim().slice(0, 4000);

  const subjects = (d.subjects || []).map((s) => s.name || s).filter(Boolean);
  const year = (String(d.publish_date || '').match(/\d{4}/) || [])[0];
  const juvenile = subjects.some((s) => /juvenile/i.test(s));
  const youth = subjects.some((s) => /young adult/i.test(s));
  return {
    isbn,
    title: d.title || '',
    subtitle: d.subtitle || '',
    author: (d.authors || []).map((a) => a.name).join(', '),
    publisher: (d.publishers || []).map((p) => p.name).join(', '),
    published_year: year ? Number(year) : '',
    pages: d.number_of_pages || '',
    description,
    category: guessCategory(subjects),
    audience: juvenile ? 'Children' : youth ? 'Youth' : '',
    tags: [...new Set(subjects.filter((s) => s.length < 30 && !/accessible|protected|lending|in library|overdrive/i.test(s)).map((s) => s.toLowerCase()))].slice(0, 6).join(', '),
    cover_url: d.cover ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg` : '',
  };
}

// Download a cover image. Only from Open Library or the church's old website.
const IMAGE_HOSTS = ['covers.openlibrary.org', 'www.cbcwinfield.com', 'cbcwinfield.com'];
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

module.exports = { lookup, fetchCover, searchCover, validIsbn };

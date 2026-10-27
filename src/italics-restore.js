'use strict';
// One-time restore of the italics and bold the first import dropped from descriptions, read from the old site's
// WooCommerce Store API (or data/old-library-export.csv). Only descriptions that still match the old copy get stars.
// The result is kept in settings (key italics_restore); a failed read is retried at start-up (at most every 6 hours, 10 times).
const fs = require('fs');
const path = require('path');
const woo = require('./lib/woo');
const rich = require('./lib/richtext');

const KEY = 'italics_restore';
const FILE = path.join(__dirname, '..', 'data', 'old-library-export.csv');
const UA = 'CBC-Library/1.0 (church lending library; bringing back description formatting)';
const MAX_TRIES = 10;
const RETRY_MS = 6 * 3600 * 1000;

// The old website's address: OLD_SITE_URL, else where the old books' cover photos came from.
async function oldSite(db) {
  if (process.env.OLD_SITE_URL) return process.env.OLD_SITE_URL.replace(/\/+$/, '');
  const rows = await db.many("SELECT cover_source_url FROM books WHERE legacy_id IS NOT NULL AND cover_source_url LIKE 'http%' LIMIT 300");
  const seen = new Map();
  for (const r of rows) {
    try { const u = new URL(r.cover_source_url); if (/(^|\.)cbcwinfield\.com$/i.test(u.hostname)) seen.set(u.origin, (seen.get(u.origin) || 0) + 1); } catch { /* skip */ }
  }
  const best = [...seen].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0].replace(/^http:/, 'https:') : 'https://cbcwinfield.com';
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (res.status === 429 || res.status >= 500) throw new Error(`the old site is busy (${res.status})`);
  if (!res.ok) return null;
  if (!/json/i.test(res.headers.get('content-type') || '')) return null;
  return { data: await res.json(), pages: Number(res.headers.get('x-wp-totalpages')) || 0 };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Every product on the old site: { id, title, description, short_description } with *stars* for italics.
async function fromWebsite(origin) {
  const ways = [
    (p) => `${origin}/wp-json/wc/store/v1/products?per_page=100&page=${p}`,
    (p) => `${origin}/wp-json/wc/store/products?per_page=100&page=${p}`,
    (p) => `${origin}/?rest_route=/wc/store/v1/products&per_page=100&page=${p}`,
    (p) => `${origin}/wp-json/wp/v2/product?per_page=100&page=${p}&_fields=id,title,content,excerpt`,
  ];
  let problem = null;
  for (const url of ways) {
    let first;
    try { first = await getJson(url(1)); } catch (e) { problem = e; continue; }
    if (!first || !Array.isArray(first.data) || !first.data.length) continue;
    const items = [...first.data];
    for (let p = 2; p <= 80; p++) {
      if (first.pages ? p > first.pages : items.length < (p - 1) * 100) break;
      await wait(250);
      let page = null;
      for (let tries = 0; tries < 3 && !page; tries++) {
        try { page = await getJson(url(p)); } catch (e) { if (tries === 2) throw e; await wait(3000); }
      }
      if (!page || !Array.isArray(page.data) || !page.data.length) break;
      items.push(...page.data);
    }
    return items.map((x) => ({
      id: String(x.id),
      title: woo.cleanDescription(x.name || (x.title && x.title.rendered) || ''),
      description: woo.cleanDescription(x.description || (x.content && x.content.rendered) || ''),
      short_description: woo.cleanDescription(x.short_description || (x.excerpt && x.excerpt.rendered) || '').replace(/\s*\n+\s*/g, ' '),
    }));
  }
  throw problem || new Error(`the old site (${origin}) has no shop listing to read`);
}

function fromFile() {
  const { books } = woo.parseWoo(fs.readFileSync(FILE, 'utf8'));
  return books.map((b) => ({ id: String(b.legacy_id || ''), title: b.title, description: b.description || '', short_description: b.short_description || '' }));
}

// "Marley & Me" and "Marley &amp; Me", "Pilgrim’s" and "Pilgrim's" are the same title
const titleKey = (t) => rich.plain(String(t || '')).toLowerCase().replace(/[‘’`´']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const sameTitle = (a, b) => titleKey(a) === titleKey(b);
const formatted = (s) => /<(em|strong)>/.test(String(rich.inline(s || '')));

// Put the old copies' italics into the books here. → { restored, edited, matched }
async function apply(db, old) {
  const here = await db.many('SELECT id, legacy_id, title, description, short_description FROM books WHERE legacy_id IS NOT NULL');
  const byId = new Map(here.map((b) => [String(b.legacy_id), b]));
  const byTitle = new Map();
  for (const b of here) { const k = titleKey(b.title); byTitle.set(k, byTitle.has(k) ? null : b); } // two books with one title: neither
  let restored = 0, edited = 0, matched = 0;
  for (const o of old) {
    let cur = byId.get(o.id);
    if (!cur || !sameTitle(cur.title, o.title)) cur = byTitle.get(titleKey(o.title)) || null;
    if (!cur) continue;
    matched++;
    const sets = {};
    for (const k of ['description', 'short_description']) {
      if (!formatted(o[k])) continue; // nothing to bring back
      const out = rich.carryMarks(cur[k], o[k]);
      if (out) sets[k] = out; else if (cur[k] && !formatted(cur[k])) edited++;
    }
    if (!Object.keys(sets).length) continue;
    await db.query('UPDATE books SET description = COALESCE($2, description), short_description = COALESCE($3, short_description), updated_at = now() WHERE id = $1',
      [cur.id, sets.description || null, sets.short_description || null]);
    restored++;
  }
  return { restored, edited, matched };
}

async function state(db) {
  const row = await db.one('SELECT value FROM settings WHERE key = $1', [KEY]);
  return (row && row.value) || null;
}
async function save(db, value) {
  await db.query('INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [KEY, JSON.stringify(value)]);
}

async function restoreItalics({ force = false } = {}) {
  if (process.env.DISABLE_ITALICS_RESTORE && !force) return null;
  const db = require('./db'); // here, so the rest can be tested without a database
  const was = (await state(db)) || {};
  if (!force && (was.done_at || (was.tries || 0) >= MAX_TRIES || (was.last_try_at && Date.now() - new Date(was.last_try_at).getTime() < RETRY_MS))) return was;
  if (!(await db.one('SELECT count(*)::int AS n FROM books WHERE legacy_id IS NOT NULL')).n) return null; // nothing imported yet
  let old, source;
  try {
    if (fs.existsSync(FILE)) { old = fromFile(); source = 'the old library export file'; } else { source = await oldSite(db); old = await fromWebsite(source); }
  } catch (e) {
    const next = { tries: (was.tries || 0) + 1, last_try_at: new Date().toISOString(), error: String(e.message || e).slice(0, 200), source };
    await save(db, next);
    console.log(`Italics: couldn't read the old descriptions (${next.error}); will try again later (${next.tries} of ${MAX_TRIES}).`);
    return next;
  }
  const r = await apply(db, old);
  const done = { done_at: new Date().toISOString(), source, read: old.length, ...r, tries: (was.tries || 0) + 1 };
  await save(db, done);
  console.log(`Italics: brought back the italics and bold in ${r.restored} descriptions from ${source} (${r.matched} of ${old.length} books matched; ${r.edited} edited here since, left alone).`);
  return done;
}

module.exports = { restoreItalics, apply, fromWebsite, KEY, state };

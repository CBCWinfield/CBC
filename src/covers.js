'use strict';
// Background cover finder. Works through books marked "pending":
//   1. download the photo from the old library site (cover_source_url), then
//   2. if there is none, or it fails, search Open Library by title and author.
// Photos are shrunk to about 400×600 so 3,000+ covers fit easily in the database.
const db = require('./db');
const { fetchCover, searchCover } = require('./lib/isbn');

let sharp = null;
try { sharp = require('sharp'); } catch { /* optional: covers are stored at original size without it */ }

const DELAY_MS = Number(process.env.COVER_DELAY_MS || 400);
const MAX_ATTEMPTS = 3;
const state = { running: false, wake: false, done: 0, failed: 0, startedAt: null, lastTitle: null, lastError: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shrink(img) {
  if (!sharp) return img.data.length <= 1024 * 1024 ? img : null;
  try {
    const data = await sharp(img.data, { failOn: 'none' }).rotate()
      .resize({ width: 400, height: 600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    return { data, type: 'image/jpeg' };
  } catch {
    return null;
  }
}

async function processOne(book) {
  await db.query('UPDATE books SET cover_attempts = cover_attempts + 1 WHERE id = $1', [book.id]);
  let img = null;
  let note = '';
  if (book.cover_source_url) {
    try { img = await fetchCover(book.cover_source_url); } catch (e) { note = `old site: ${e.message}`; }
    if (!img && !note) note = 'old site photo missing';
  }
  let fromSearch = false;
  if (!img) {
    try {
      const found = await searchCover(book.title, book.author);
      if (found) { img = await fetchCover(found); fromSearch = Boolean(img); }
    } catch (e) { note = `${note ? note + '; ' : ''}search: ${e.message}`; }
  }
  const small = img && await shrink(img);
  if (small) {
    await db.query(`UPDATE books SET cover_image = $2, cover_type = $3, cover_status = 'done', cover_note = $4, updated_at = now() WHERE id = $1`,
      [book.id, small.data, small.type, fromSearch ? 'found by title search' : 'copied from old site']);
    state.done++;
  } else {
    const retry = book.cover_attempts + 1 < MAX_ATTEMPTS && /:/.test(note); // network errors get another try later
    await db.query(`UPDATE books SET cover_status = $2, cover_note = $3 WHERE id = $1`,
      [book.id, retry ? 'pending' : 'failed', note || 'no cover found']);
    if (!retry) state.failed++;
  }
  state.lastTitle = book.title;
}

async function run() {
  if (state.running) { state.wake = true; return; }
  state.running = true;
  state.startedAt = new Date();
  try {
    for (;;) {
      const book = await db.one(`SELECT id, title, author, cover_source_url, cover_attempts FROM books
        WHERE cover_status = 'pending' ORDER BY cover_attempts, id LIMIT 1`);
      if (!book) break;
      if (book.cover_attempts > 0) await sleep(Number(process.env.COVER_RETRY_WAIT_MS || 60000)); // give a busy site a minute
      try {
        await processOne(book);
      } catch (err) {
        state.lastError = err.message;
        await db.query("UPDATE books SET cover_status = 'failed', cover_note = $2 WHERE id = $1", [book.id, err.message.slice(0, 200)]).catch(() => {});
      }
      await sleep(DELAY_MS);
    }
  } finally {
    state.running = false;
    if (state.wake) { state.wake = false; setImmediate(() => run().catch(() => {})); }
  }
}

// Queue every active book that still has no cover (skips ones already tried 3 times).
async function queueMissing({ retryFailed = true } = {}) {
  const r = await db.query(`UPDATE books SET cover_status = 'pending'
    WHERE cover_image IS NULL AND active AND cover_status <> 'pending'
      AND (cover_status = 'none' OR ($1 AND cover_status = 'failed' AND cover_attempts < 6)) RETURNING id`, [retryFailed]);
  kick();
  return r.rows.length;
}

async function queueBook(id) {
  await db.query("UPDATE books SET cover_status = 'pending', cover_attempts = 0 WHERE id = $1", [id]);
  kick();
}

function kick() {
  if (process.env.DISABLE_COVERS === '1') return;
  run().catch((err) => { state.lastError = err.message; console.error('Cover finder stopped:', err.message); });
}

async function status() {
  const row = await db.one(`SELECT
      count(*) FILTER (WHERE active)::int AS total,
      count(*) FILTER (WHERE active AND cover_image IS NOT NULL)::int AS with_cover,
      count(*) FILTER (WHERE active AND cover_status = 'pending')::int AS pending,
      count(*) FILTER (WHERE active AND cover_status = 'failed')::int AS failed,
      COALESCE(sum(octet_length(cover_image)), 0)::bigint AS bytes
    FROM books`);
  return { ...row, bytes: Number(row.bytes), running: state.running, lastTitle: state.lastTitle, resizing: Boolean(sharp) };
}

module.exports = { run, kick, queueMissing, queueBook, status, start: () => setTimeout(kick, 5000).unref() };

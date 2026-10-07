'use strict';
// Researched bestseller and award badges (data/notable-books.json, each with a source), applied once per book.
// Only the badge fields change. Books the librarian already badged are left alone, and a badge someone removes
// later is never re-added, because each applied entry is remembered in notable_seed_applied.
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function applyNotableSeed() {
  let list;
  try { list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'notable-books.json'), 'utf8')); } catch { return 0; }
  const done = new Set((await db.many('SELECT legacy_id FROM notable_seed_applied')).map((r) => r.legacy_id));
  let applied = 0;
  for (const b of list) {
    if (!b.legacy_id || done.has(b.legacy_id)) continue;
    const r = await db.one(`UPDATE books SET notable = true, notable_kind = $2, notable_note = COALESCE(NULLIF($3, ''), notable_note)
      WHERE legacy_id = $1 AND notable = false RETURNING id`, [b.legacy_id, b.kind, b.note || '']);
    // Remember it only once the book exists here, so books imported later still get their badge.
    const exists = r || await db.one('SELECT id FROM books WHERE legacy_id = $1', [b.legacy_id]);
    if (exists) await db.query('INSERT INTO notable_seed_applied (legacy_id, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING', [b.legacy_id, b.kind]);
    if (r) applied++;
  }
  if (applied) console.log(`Added bestseller/award badges to ${applied} books.`);
  return applied;
}

module.exports = { applyNotableSeed };

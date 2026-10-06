'use strict';
// Starter content: the Teens & Kids Ministry Manual as a required policy.
// Each version is applied once per database (remembered in settings). A newer version
// updates the existing manual in place, or adds it if it isn't there.
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');

const TITLE = 'Teens & Kids Ministry Manual';
const VERSION = 5;
const KEY = `seeded_ministry_manual_v${VERSION}`;

async function seedPolicies() {
  if (await db.one('SELECT 1 AS x FROM settings WHERE key = $1', [KEY])) return;
  const dir = path.join(__dirname, 'seed');
  const body = fs.readFileSync(path.join(dir, 'ministry-manual.txt'), 'utf8');
  const pdf = fs.readFileSync(path.join(dir, `ministry-manual-v${VERSION}.pdf`));
  const description = `Policies & Standard Operating Procedures for everyone serving in Central Kids and Central Teens (version ${VERSION}).`;
  const filename = `Central_Baptist_Teens_and_Kids_Ministry_Manual_v${VERSION}.pdf`;
  const existing = await db.one('SELECT id FROM policies WHERE title = $1 ORDER BY id LIMIT 1', [TITLE]);
  if (existing) {
    await db.query(`UPDATE policies SET description = $2, body = $3, filename = $4, mime = 'application/pdf', data = $5, size = $6, updated_at = now() WHERE id = $1`,
      [existing.id, description, body, filename, pdf, pdf.length]);
    console.log(`Updated the ${TITLE} to version ${VERSION}.`);
  } else if (!(await db.one(`SELECT 1 AS x FROM settings WHERE key LIKE 'seeded_ministry_manual_v%'`))) {
    // Only add it if an admin never had it (a deliberately deleted manual stays deleted).
    const admin = await db.one(`SELECT id FROM users WHERE checkin_role = 'admin' ORDER BY id LIMIT 1`);
    await db.query(`INSERT INTO policies (title, description, body, filename, mime, data, size, audience, requires_ack, created_by)
      VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, 'team', true, $7)`, [TITLE, description, body, filename, pdf, pdf.length, admin ? admin.id : null]);
    console.log(`Added the ${TITLE} to Policies.`);
  }
  await db.query(`INSERT INTO settings (key, value) VALUES ($1, 'true'::jsonb) ON CONFLICT (key) DO NOTHING`, [KEY]);
}

module.exports = { seedPolicies };

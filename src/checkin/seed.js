'use strict';
// One-time starter content: the Teens & Kids Ministry Manual as a required policy.
// Runs once per database (remembered in settings), so deleting or editing it later sticks.
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');

const MANUAL_KEY = 'seeded_ministry_manual_v4';

async function seedPolicies() {
  const done = await db.one('SELECT 1 AS x FROM settings WHERE key = $1', [MANUAL_KEY]);
  if (done) return;
  const dir = path.join(__dirname, 'seed');
  const body = fs.readFileSync(path.join(dir, 'ministry-manual.txt'), 'utf8');
  const pdf = fs.readFileSync(path.join(dir, 'ministry-manual-v4.pdf'));
  const admin = await db.one(`SELECT id FROM users WHERE checkin_role = 'admin' ORDER BY id LIMIT 1`);
  await db.query(`INSERT INTO policies (title, description, body, filename, mime, data, size, audience, requires_ack, created_by)
    VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, 'team', true, $7)`,
  ['Teens & Kids Ministry Manual', 'Policies & Standard Operating Procedures for everyone serving in Central Kids and Central Teens (version 4).',
    body, 'Central_Baptist_Teens_and_Kids_Ministry_Manual_v4.pdf', pdf, pdf.length, admin ? admin.id : null]);
  await db.query(`INSERT INTO settings (key, value) VALUES ($1, 'true'::jsonb) ON CONFLICT (key) DO NOTHING`, [MANUAL_KEY]);
  console.log('Added the Teens & Kids Ministry Manual to Policies.');
}

module.exports = { seedPolicies };

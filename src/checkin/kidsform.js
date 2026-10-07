'use strict';
// Sends parents the family sign-up / permission form (a family invite link) when they ask for a bus ride
// or plan a visit with kids. At most one every 3 days per email address.
const db = require('../db');
const security = require('../lib/security');
const { url } = require('../notify');
const N = require('./notify');

async function sendKidsForm({ email, name }) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return false;
  const recent = await db.one(`SELECT id FROM family_invites WHERE email = $1 AND created_at > now() - interval '3 days'`, [email]);
  if (recent) return false;
  const tok = security.token(24);
  await db.query(`INSERT INTO family_invites (email, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 days')`, [email, security.sha256(tok)]);
  N.kidsForm({ email, name, link: url(`/checkin/join/${tok}`) });
  return true;
}

module.exports = { sendKidsForm };

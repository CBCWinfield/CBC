'use strict';
// Check-in data access, roles and small helpers.
const crypto = require('node:crypto');
const db = require('../db');
const t = require('../lib/time');

const RANK = { volunteer: 1, leader: 2, coadmin: 3, admin: 4 };
const ROLE_LABEL = { admin: 'Primary admin', coadmin: 'Co-admin', leader: 'Ministry leader', volunteer: 'Volunteer' };
const rank = (user) => (user && user.checkin_role ? RANK[user.checkin_role] || 0 : 0);
const can = (user, role) => rank(user) >= RANK[role];

// Security codes avoid look-alike characters (0/O, 1/I, 5/S, 8/B, 2/Z).
const CODE_CHARS = 'ACDEFGHJKLMNPQRTUVWXY34679';
function newCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
}

function ageOn(birthdate, when = new Date()) {
  if (!birthdate) return null;
  const b = birthdate instanceof Date ? t.dateKey(birthdate) : String(birthdate).slice(0, 10);
  const [by, bm, bd] = b.split('-').map(Number);
  const { year, month, day } = t.parts(when);
  let age = year - by;
  if (month < bm || (month === bm && day < bd)) age--;
  return age;
}
function ageLabel(birthdate) {
  const a = ageOn(birthdate);
  if (a == null) return '';
  if (a < 1) {
    const b = String(birthdate instanceof Date ? t.dateKey(birthdate) : birthdate).slice(0, 10);
    const [by, bm] = b.split('-').map(Number);
    const { year, month } = t.parts(new Date());
    const months = Math.max(0, (year - by) * 12 + (month - bm));
    return `${months} mo`;
  }
  return `${a} yr${a === 1 ? '' : 's'}`;
}
// Class used on rosters and name tags: Nursery (babies), Toddlers, Kids, Teens, Adults.
const CLASSES = ['Nursery', 'Toddlers', 'Kids', 'Teens'];
function groupFor(person) {
  if (person.kind === 'adult') return 'Adults';
  if (person.class_override && CLASSES.includes(person.class_override)) return person.class_override;
  const a = ageOn(person.birthdate);
  if (a == null) return 'Kids';
  if (a < 2) return 'Nursery';
  if (a <= 4) return 'Toddlers';
  if (a <= 11) return 'Kids';
  if (a <= 18) return 'Teens';
  return 'Adults';
}
const GROUP_ORDER = ['Nursery', 'Toddlers', 'Kids', 'Teens', 'Adults'];

const displayName = (p) => `${p.preferred_name || p.first_name} ${p.last_name}`;

// Default event for the day and time: Sunday School before 10:30 on Sundays, Children's Church
// from 10:30, and Wednesday Night Service on Wednesdays. Other days: none (the volunteer chooses).
function defaultEventName(now = new Date()) {
  const p = t.parts(now);
  if (p.weekday === 7) return p.hour * 60 + p.minute < 10 * 60 + 30 ? 'Sunday School' : "Children's Church";
  if (p.weekday === 3) return 'Wednesday Night Service';
  return null;
}

async function eventFor(name, dateKey, userId) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!clean) return null;
  // Use the saved spelling of a name if there is one; starting an archived event brings it back.
  const saved = await saveEventName(clean, userId);
  const evName = saved ? saved.name : clean;
  const found = await db.one('SELECT * FROM events WHERE lower(name) = lower($1) AND event_date = $2', [evName, dateKey]);
  if (found) return found;
  return db.one('INSERT INTO events (name, event_date, created_by) VALUES ($1, $2, $3) ON CONFLICT (name, event_date) DO UPDATE SET name = EXCLUDED.name RETURNING *', [evName, dateKey, userId || null]);
}

async function saveEventName(name, userId) {
  const existing = await db.one('SELECT * FROM event_names WHERE lower(name) = lower($1)', [name]);
  if (existing) {
    if (existing.archived) await db.query('UPDATE event_names SET archived = false, archived_at = NULL WHERE id = $1', [existing.id]);
    return existing;
  }
  return db.one('INSERT INTO event_names (name, created_by) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *', [name, userId || null]);
}

// The three regular services: always offered, can't be archived.
const BUILT_IN_EVENTS = ['Sunday School', "Children's Church", 'Wednesday Night Service'];

// Event names used before, most used first (for the event picker). Archived names are left out.
const knownEventNames = async () => (await db.many(
  `SELECT n.name, (SELECT count(*) FROM events e WHERE lower(e.name) = lower(n.name))::int AS used
     FROM event_names n WHERE NOT n.archived ORDER BY used DESC, n.name LIMIT 30`,
)).map((r) => r.name);

const familyPeople = (familyId) => db.many(
  `SELECT * FROM people WHERE family_id = $1 AND active ORDER BY kind, is_primary DESC, birthdate NULLS LAST, first_name`, [familyId],
);

async function familyFull(id) {
  const family = await db.one('SELECT * FROM families WHERE id = $1', [id]);
  if (!family) return null;
  const [people, contacts, pickups, waivers] = await Promise.all([
    familyPeople(id),
    db.many('SELECT * FROM emergency_contacts WHERE family_id = $1 ORDER BY id', [id]),
    db.many('SELECT * FROM authorized_pickups WHERE family_id = $1 ORDER BY not_allowed, id', [id]),
    db.many('SELECT id, kind, version, signer_name, signer_relationship, signed_at, children FROM waivers WHERE family_id = $1 ORDER BY signed_at DESC', [id]),
  ]);
  return { family, people, adults: people.filter((p) => p.kind === 'adult'), kids: people.filter((p) => p.kind === 'child'), contacts, pickups, waivers };
}

// Which required agreements are signed (latest version) for this family.
function agreementStatus(waivers, AGREEMENTS) {
  const out = {};
  for (const [kind, a] of Object.entries(AGREEMENTS)) {
    const w = waivers.find((x) => x.kind === kind && x.version === a.version);
    out[kind] = w || null;
  }
  return out;
}

// Search families by family name, any member's name, phone or email.
async function searchFamilies(q, limit = 12) {
  const term = String(q || '').trim();
  if (!term) {
    return db.many(`SELECT f.*, (SELECT string_agg(p.first_name, ', ' ORDER BY p.kind, p.birthdate NULLS LAST) FROM people p WHERE p.family_id = f.id AND p.active) AS members
      FROM families f WHERE f.status <> 'archived' ORDER BY f.updated_at DESC LIMIT ${Number(limit)}`);
  }
  const digits = term.replace(/\D/g, '');
  const like = `%${term}%`;
  const prefix = `${term}%`;
  return db.many(`SELECT f.*, (SELECT string_agg(p.first_name, ', ' ORDER BY p.kind, p.birthdate NULLS LAST) FROM people p WHERE p.family_id = f.id AND p.active) AS members,
      (CASE WHEN f.name ILIKE $2 THEN 3 WHEN EXISTS (SELECT 1 FROM people p WHERE p.family_id = f.id AND (p.last_name ILIKE $2 OR p.first_name ILIKE $2)) THEN 2 ELSE 1 END) AS score
    FROM families f
    WHERE f.status <> 'archived' AND (
      f.name ILIKE $1
      OR EXISTS (SELECT 1 FROM people p WHERE p.family_id = f.id AND p.active AND (
        (p.first_name || ' ' || p.last_name) ILIKE $1 OR p.preferred_name ILIKE $1 OR p.email ILIKE $1
        OR ($3 <> '' AND length($3) >= 4 AND regexp_replace(COALESCE(p.phone, ''), '\\D', '', 'g') LIKE '%' || $3 || '%')))
      OR ($3 <> '' AND length($3) >= 4 AND regexp_replace(COALESCE(f.home_phone, ''), '\\D', '', 'g') LIKE '%' || $3 || '%')
    )
    ORDER BY score DESC, f.name LIMIT ${Number(limit)}`, [like, prefix, digits]);
}

async function audit(user, action, { familyId = null, personId = null, detail = null } = {}) {
  await db.query('INSERT INTO checkin_audit (user_id, action, family_id, person_id, detail) VALUES ($1, $2, $3, $4, $5)',
    [user ? user.id : null, action, familyId, personId, detail ? String(detail).slice(0, 500) : null]).catch(() => {});
}

// The family a parent account belongs to (first match).
const familyForUser = (userId) => db.one(
  `SELECT f.* FROM families f JOIN people p ON p.family_id = f.id WHERE p.user_id = $1 AND p.active ORDER BY f.id LIMIT 1`, [userId],
);

module.exports = {
  RANK, ROLE_LABEL, rank, can, newCode, ageOn, ageLabel, groupFor, GROUP_ORDER, CLASSES, displayName,
  defaultEventName, eventFor, saveEventName, BUILT_IN_EVENTS, knownEventNames, familyPeople, familyFull, agreementStatus, searchFamilies, audit, familyForUser,
};

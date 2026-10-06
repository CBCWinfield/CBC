'use strict';
// Central Check-In: routes for the check-in station, families, parents and reports.
const crypto = require('node:crypto');
const db = require('../db');
const security = require('../lib/security');
const { HttpError } = require('../lib/http');
const t = require('../lib/time');
const { users } = require('../models');
const push = require('../lib/push');
const { url } = require('../notify');
const D = require('./data');
const V = require('./views');
const N = require('./notify');
const { AGREEMENTS } = require('./agreements');
const allergens = require('./allergens');
const assist = require('./assist');
const A = require('./automations');
const social = require('./social');
const safety = require('./safety');
const community = require('./community');
const prayer = require('./prayer');
const { intParam, clean, safeNext } = require('../routes/guards');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const today = () => t.dateKey(new Date());
const nameCase = (s) => clean(s, 80).replace(/\s+/g, ' ');
const dateOrNull = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : null);
const yes = (v) => v === '1' || v === 'on' || v === true;

// ---------------------------------------------------------------- guards
function needLogin(req, res) {
  if (req.user) return false;
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || req.path)}`);
  return true;
}
const needRole = (role) => async (req, res, next) => {
  if (needLogin(req, res)) return;
  if (req.user.checkinLocked) {
    security.flash(req, 'error', 'Finish your training and policy reading first. Your check-in account unlocks as soon as everything is checked off.');
    return res.redirect('/checkin/training');
  }
  if (!D.can(req.user, role)) throw new HttpError(403, role === 'volunteer' ? 'This page is for the check-in team. Ask the church office to add you.' : 'You need a higher check-in role for this page.');
  await next();
};

function render(req, res, body, opts = {}) {
  res.send(V.layout({ body, user: req.user, csrf: res.locals.csrf, flash: security.takeFlash(req), event: req.ciEvent, unread: req.ciUnread || 0, prayerNew: req.ciPrayerNew || 0, ...opts }).toString());
}

// Current event for this device (kept in the session, only valid today).
async function currentEvent(req) {
  const auto = D.defaultEventName();
  if (req.session.ciEvent) {
    const e = await db.one('SELECT * FROM events WHERE id = $1', [req.session.ciEvent]);
    // Keep the device's chosen event for today, unless it was an automatic one that the clock has moved past
    // (Sunday School -> Children's Church at 10:30).
    const wasAuto = e && ['Sunday School', "Children's Church", 'Wednesday Night Service'].includes(e.name);
    if (e && String(e.event_date).slice(0, 10) === today() && !(wasAuto && auto && e.name !== auto && !req.session.ciEventPinned)) return e;
  }
  const name = auto;
  if (!name) return null;
  const e = await D.eventFor(name, today(), req.user && req.user.id);
  req.session.ciEvent = e.id;
  return e;
}

async function eventById(id) {
  const e = await db.one('SELECT * FROM events WHERE id = $1', [Number(id) || 0]);
  if (!e) throw new HttpError(404, 'That event was not found.');
  return e;
}

// A pickup code not already used by another family at this event.
async function codeFor(eventId, familyId, c = db) {
  const existing = await c.one('SELECT security_code FROM attendance WHERE event_id = $1 AND family_id = $2 LIMIT 1', [eventId, familyId]);
  if (existing) return existing.security_code;
  for (let i = 0; i < 20; i++) {
    const code = D.newCode();
    const taken = await c.one('SELECT 1 AS x FROM attendance WHERE event_id = $1 AND security_code = $2 LIMIT 1', [eventId, code]);
    if (!taken) return code;
  }
  throw new Error('Could not make a pickup code');
}

// Name tags go into the print queue. The device marked as the printer prints them
// right away; any other device just queues them for the printer laptop.
async function queueTags(req, res, { event, familyId, kids, includeParent = true, back = '/checkin', message }) {
  if (!kids.length) { if (message) security.flash(req, 'ok', message); return res.redirect(back); }
  const job = await db.one(`INSERT INTO print_jobs (event_id, family_id, people, include_parent, summary, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [event.id, familyId, kids.map((k) => k.id).join(','), includeParent, kids.map((k) => k.preferred_name || k.first_name).join(', '), req.user.id]);
  if (req.cookies.ci_printer === '1') {
    if (message) security.flash(req, 'ok', message);
    return res.redirect(`/checkin/print?jobs=${job.id}&return=${encodeURIComponent(back)}`);
  }
  security.flash(req, 'ok', `${message ? `${message} ` : ''}Name tags sent to the printer.`);
  return res.redirect(back);
}

async function checkout(rows, by, to, event) {
  if (!rows.length) return;
  const ids = rows.map((r) => r.id);
  await db.query('UPDATE attendance SET checked_out_at = now(), checked_out_by = $2, checked_out_to = $3 WHERE id = ANY($1::int[]) AND checked_out_at IS NULL', [ids, by, to || null]);
  const byFamily = new Map();
  for (const r of rows) if (r.kind === 'child') (byFamily.get(r.family_id) || byFamily.set(r.family_id, []).get(r.family_id)).push(r);
  for (const [familyId, kids] of byFamily) N.checkedOut({ familyId, kids, event, at: new Date(), to });
}

const ROSTER_SQL = `SELECT a.*, p.first_name, p.last_name, p.preferred_name, p.kind, p.birthdate, p.grade, p.allergies, p.medical_notes,
  p.medications, p.special_needs, p.custody_alert, p.custody_notes, p.class_override, p.is_guest, p.phone AS person_phone, p.guest_note, p.photo_at, f.name AS family_name
  FROM attendance a JOIN people p ON p.id = a.person_id JOIN families f ON f.id = a.family_id`;

// ---------------------------------------------------------------- the family's own login
async function myFamily(req) {
  return req.user ? D.familyForUser(req.user.id) : null;
}

async function linkUserToFamily(user, familyId) {
  const match = await db.one(`SELECT id FROM people WHERE family_id = $1 AND kind = 'adult' AND user_id IS NULL AND lower(email) = lower($2) LIMIT 1`, [familyId, user.email]);
  if (match) {
    await db.query('UPDATE people SET user_id = $2 WHERE id = $1', [match.id, user.id]);
  } else {
    const hasPrimary = await db.one(`SELECT 1 AS x FROM people WHERE family_id = $1 AND kind = 'adult' AND is_primary LIMIT 1`, [familyId]);
    await db.query(`INSERT INTO people (family_id, kind, first_name, last_name, email, phone, user_id, is_primary, relationship, contact_method)
      VALUES ($1, 'adult', $2, $3, $4, $5, $6, $7, 'Parent', 'app')`, [familyId, user.first_name, user.last_name, user.email, user.phone || null, user.id, !hasPrimary]);
  }
}

async function newFamilyFor(user) {
  const f = await db.one(`INSERT INTO families (name, status, created_by) VALUES ($1, 'new', $2) RETURNING *`, [`The ${user.last_name} Family`, user.id]);
  await linkUserToFamily(user, f.id);
  return f;
}

module.exports = (app) => {
  // Everything under /checkin uses the check-in look.
  app.use(async (req, res, next) => {
    req.originalUrl = req.url;
    // New team members are locked (treated like a family account) until training is done.
    if (req.user && req.user.checkin_role && req.path.startsWith('/checkin') && await safety.isLocked(req.user)) {
      req.user = { ...req.user, realRole: req.user.checkin_role, checkin_role: null, checkinLocked: true };
    }
    // Unread message count for the Inbox badge on check-in pages.
    if (req.user && req.method === 'GET' && req.path.startsWith('/checkin') && !req.path.startsWith('/checkin/api/')) {
      req.ciUnread = await social.unreadCount(req.user.id).catch(() => 0);
      req.ciPrayerNew = await prayer.newCount(req.user).catch(() => 0);
    }
    await next();
  });

  // ---------------------------------------------------------------- station
  app.get('/checkin', async (req, res) => {
    if (needLogin(req, res)) return;
    if (req.user.checkinLocked) return res.redirect('/checkin/training');
    if (!D.can(req.user, 'volunteer')) return res.redirect('/checkin/family');
    const event = req.query.change ? null : await currentEvent(req);
    req.ciEvent = event;
    if (!event) {
      const names = await D.knownEventNames();
      return render(req, res, V.eventPicker({ csrf: res.locals.csrf, names, suggested: D.defaultEventName(), current: null }), { title: 'Choose event', tab: 'station' });
    }
    const counts = await db.one(`SELECT count(*) FILTER (WHERE p.kind = 'child')::int AS kids, count(*) FILTER (WHERE p.kind = 'adult')::int AS adults
      FROM attendance a JOIN people p ON p.id = a.person_id WHERE a.event_id = $1 AND a.checked_out_at IS NULL`, [event.id]);
    const recent = await db.many(`SELECT f.*, (SELECT string_agg(p.first_name, ', ' ORDER BY p.kind, p.birthdate NULLS LAST) FROM people p WHERE p.family_id = f.id AND p.active) AS members,
        (SELECT count(*)::int FROM attendance a WHERE a.family_id = f.id AND a.event_id = $1 AND a.checked_out_at IS NULL) AS checked,
        (SELECT max(a.checked_in_at) FROM attendance a WHERE a.family_id = f.id) AS last_seen
      FROM families f WHERE f.status <> 'archived' ORDER BY last_seen DESC NULLS LAST, f.updated_at DESC LIMIT 12`, [event.id]);
    render(req, res, V.station({ csrf: res.locals.csrf, event, recent, counts }), { title: 'Check in', tab: 'station' });
  });

  app.post('/checkin/event', needRole('volunteer'), async (req, res) => {
    const e = await D.eventFor(req.body.name, today(), req.user.id);
    if (!e) { security.flash(req, 'error', 'Give the event a name.'); return res.redirect('/checkin?change=1'); }
    req.session.ciEvent = e.id;
    req.session.ciEventPinned = e.name !== D.defaultEventName(); // a hand-picked event stays put
    security.flash(req, 'ok', `Checking in for ${e.name}.`);
    res.redirect('/checkin');
  });

  // Live family search for the station.
  app.get('/checkin/api/families', needRole('volunteer'), async (req, res) => {
    const rows = await D.searchFamilies(clean(req.query.q, 80), 10);
    const eventId = req.session.ciEvent || 0;
    const checked = rows.length ? await db.many(`SELECT family_id, count(*)::int AS n FROM attendance WHERE event_id = $1 AND checked_out_at IS NULL AND family_id = ANY($2::int[]) GROUP BY family_id`, [eventId, rows.map((r) => r.id)]) : [];
    const cmap = new Map(checked.map((c) => [c.family_id, c.n]));
    res.setHeader('Cache-Control', 'no-store');
    res.json(rows.map((f) => ({ id: f.id, name: f.name, members: f.members || '', status: f.status, checked: cmap.get(f.id) || 0 })));
  });

  app.get('/checkin/f/:id', needRole('volunteer'), async (req, res) => {
    const event = await currentEvent(req);
    if (!event) return res.redirect('/checkin?change=1');
    req.ciEvent = event;
    const full = await D.familyFull(intParam(req.params.id));
    if (!full) throw new HttpError(404, 'That family was not found.');
    const attendance = await db.many('SELECT * FROM attendance WHERE event_id = $1 AND family_id = $2', [event.id, full.family.id]);
    D.audit(req.user, 'open_family', { familyId: full.family.id });
    render(req, res, V.familyCheckin({ csrf: res.locals.csrf, user: req.user, full, event, attendance }), { title: full.family.name, tab: 'station' });
  });

  app.post('/checkin/f/:id', needRole('volunteer'), async (req, res) => {
    const familyId = intParam(req.params.id);
    const event = await eventById(req.body.event_id);
    const ids = [].concat(req.body.people || []).map(Number).filter(Boolean);
    if (!ids.length) {
      security.flash(req, 'error', 'Tick at least one person to check in.');
      return res.redirect(`/checkin/f/${familyId}`);
    }
    const people = await db.many('SELECT * FROM people WHERE family_id = $1 AND id = ANY($2::int[]) AND active', [familyId, ids]);
    const created = await db.tx(async (c) => {
      const code = await codeFor(event.id, familyId, c);
      const out = [];
      for (const p of people) {
        const row = await c.one(`INSERT INTO attendance (event_id, person_id, family_id, security_code, checked_in_by) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (event_id, person_id) DO UPDATE SET checked_out_at = NULL, checked_out_by = NULL, checked_out_to = NULL, checked_in_at = now(), checked_in_by = EXCLUDED.checked_in_by
          RETURNING id`, [event.id, p.id, familyId, code, req.user.id]);
        out.push({ ...p, attendance_id: row.id });
      }
      return { code, people: out };
    });
    await db.query('UPDATE families SET updated_at = now(), status = CASE WHEN status = $2 THEN $2 ELSE status END WHERE id = $1', [familyId, 'new']);
    const kids = created.people.filter((p) => p.kind === 'child');
    N.checkedIn({ familyId, kids, event, at: new Date() });
    const names = created.people.map((p) => p.preferred_name || p.first_name).join(', ');
    await queueTags(req, res, { event, familyId, kids, message: `${names} checked in.${kids.length ? ` Pickup code ${created.code}.` : ''}`, back: req.body.back && safeNext(req.body.back) ? req.body.back : '/checkin' });
  });

  // One tap from the family list: whole family, today's service, tags printed.
  app.post('/checkin/quick/:id', needRole('volunteer'), async (req, res) => {
    const familyId = intParam(req.params.id);
    const event = await currentEvent(req);
    if (!event) { security.flash(req, 'error', 'Choose what you’re checking in for first.'); return res.redirect('/checkin?change=1'); }
    const people = await db.many(`SELECT p.* FROM people p WHERE p.family_id = $1 AND p.active
      AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.event_id = $2 AND a.person_id = p.id AND a.checked_out_at IS NULL)`, [familyId, event.id]);
    if (!people.length) { security.flash(req, 'ok', 'Everyone in that family is already checked in.'); return res.redirect(req.body.back && safeNext(req.body.back) ? req.body.back : '/checkin/families'); }
    const code = await db.tx(async (c) => {
      const cd = await codeFor(event.id, familyId, c);
      for (const p of people) {
        await c.query(`INSERT INTO attendance (event_id, person_id, family_id, security_code, checked_in_by) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (event_id, person_id) DO UPDATE SET checked_out_at = NULL, checked_out_by = NULL, checked_out_to = NULL, checked_in_at = now(), checked_in_by = EXCLUDED.checked_in_by`,
        [event.id, p.id, familyId, cd, req.user.id]);
      }
      return cd;
    });
    const kids = people.filter((p) => p.kind === 'child');
    N.checkedIn({ familyId, kids, event, at: new Date() });
    const fam = await db.one('SELECT name FROM families WHERE id = $1', [familyId]);
    await queueTags(req, res, { event, familyId, kids, back: req.body.back && safeNext(req.body.back) ? req.body.back : '/checkin/families',
      message: `${fam.name}: ${people.length} checked in for ${event.name}.${kids.length ? ` Pickup code ${code}.` : ''}` });
  });

  // ---------------------------------------------------------------- add a family right at the desk
  app.get('/checkin/new', needRole('volunteer'), async (req, res) => {
    req.ciEvent = await currentEvent(req);
    render(req, res, V.newFamilyFlow({ csrf: res.locals.csrf, name: clean(req.query.name, 80) }), { title: 'New family', tab: 'station' });
  });

  app.post('/checkin/new', needRole('volunteer'), async (req, res) => {
    const b = req.body;
    const v = { first_name: nameCase(b.first_name), last_name: nameCase(b.last_name), phone: clean(b.phone, 40), email: clean(b.email, 200).toLowerCase(), relationship: clean(b.relationship, 40) || 'Parent' };
    const error = !v.first_name || !v.last_name ? 'Enter the parent’s first and last name.' : !v.phone ? 'Enter a phone number so we can reach the parent.'
      : v.email && !EMAIL_RE.test(v.email) ? 'That email doesn’t look right.' : null;
    if (error) return render(req, res, V.newFamilyFlow({ csrf: res.locals.csrf, error, v: { ...b } }), { title: 'New family', tab: 'station' });
    const fam = await db.one(`INSERT INTO families (name, status, created_by) VALUES ($1, 'new', $2) RETURNING id`, [clean(b.family_name, 120) || `The ${v.last_name} Family`, req.user.id]);
    await savePerson(fam.id, 'adult', { ...v, email: v.email || null, contact_method: 'app', is_primary: true });
    if (clean(b.ec_name, 120) && clean(b.ec_phone, 40)) {
      await db.query('INSERT INTO emergency_contacts (family_id, name, relationship, phone) VALUES ($1, $2, $3, $4)', [fam.id, clean(b.ec_name, 120), clean(b.ec_relationship, 60) || null, clean(b.ec_phone, 40)]);
    }
    if (yes(b.send_invite) && v.email && !(await users.byEmail(v.email))) {
      const tok = security.token(24);
      await db.query(`INSERT INTO family_invites (family_id, email, token_hash, expires_at, created_by) VALUES ($1, $2, $3, now() + interval '30 days', $4)`, [fam.id, v.email, security.sha256(tok), req.user.id]);
      N.invite({ email: v.email, link: url(`/checkin/join/${tok}`), familyName: clean(b.family_name, 120), invitedBy: `${req.user.first_name} ${req.user.last_name}` });
    }
    D.audit(req.user, 'create_family', { familyId: fam.id });
    res.redirect(`/checkin/new/${fam.id}/kids`);
  });

  app.get('/checkin/new/:id/kids', needRole('volunteer'), async (req, res) => {
    const full = await D.familyFull(intParam(req.params.id));
    if (!full) throw new HttpError(404, 'That family was not found.');
    req.ciEvent = await currentEvent(req);
    render(req, res, V.newKidsFlow({ user: req.user, csrf: res.locals.csrf, full }), { title: full.family.name, tab: 'station' });
  });

  app.post('/checkin/new/:id/kids', needRole('volunteer'), async (req, res) => {
    const id = intParam(req.params.id);
    const full = await D.familyFull(id);
    if (!full) throw new HttpError(404, 'That family was not found.');
    const b = req.body;
    const v = {
      first_name: nameCase(b.first_name), last_name: nameCase(b.last_name), birthdate: dateOrNull(b.birthdate),
      class_override: D.CLASSES.includes(b.class_override) ? b.class_override : null,
      allergies: clean(b.allergies, 500) || null, medical_notes: clean(b.medical_notes, 500) || null,
    };
    if (!v.first_name || !v.last_name || (!v.birthdate && !v.class_override)) {
      return render(req, res, V.newKidsFlow({ user: req.user, csrf: res.locals.csrf, full, error: 'Enter the child’s name and either a birthday or a class.' }), { title: full.family.name, tab: 'station' });
    }
    await savePerson(id, 'child', v);
    res.redirect(`/checkin/new/${id}/kids`);
  });

  // ---------------------------------------------------------------- quick guest (no parent present)
  app.get('/checkin/guest', needRole('volunteer'), async (req, res) => {
    req.ciEvent = await currentEvent(req);
    render(req, res, V.guestPage({ csrf: res.locals.csrf, name: clean(req.query.name, 60) }), { title: 'Guest check-in', tab: 'station' });
  });

  app.post('/checkin/guest', needRole('volunteer'), async (req, res) => {
    const event = await currentEvent(req);
    if (!event) return res.redirect('/checkin?change=1');
    req.ciEvent = event;
    const b = req.body;
    const hostId = Number(b.host_family_id) || 0;
    const host = hostId ? await db.one('SELECT id, name FROM families WHERE id = $1', [hostId]) : null;
    const v = {
      first_name: nameCase(b.first_name), last_name: nameCase(b.last_name) || '', phone: clean(b.phone, 40),
      class_override: D.CLASSES.includes(b.class_override) ? b.class_override : null, allergies: clean(b.allergies, 500) || null,
    };
    const error = !v.first_name ? 'Enter the child’s first name.' : !v.class_override ? 'Choose a class.' : !v.phone ? 'Enter a parent or guardian’s phone number.'
      : !host && !yes(b.on_own) ? 'Choose the family they came with, or tick “They came on their own”.' : null;
    if (error) return render(req, res, V.guestPage({ csrf: res.locals.csrf, error, v: { ...b, host_name: host && host.name } }), { title: 'Guest check-in', tab: 'station' });
    let familyId;
    if (host) familyId = host.id;
    else familyId = (await db.one(`INSERT INTO families (name, status, created_by) VALUES ($1, 'new', $2) RETURNING id`, [`Guest: ${v.first_name} ${v.last_name}`.trim(), req.user.id])).id;
    const personId = await savePerson(familyId, 'child', { ...v, last_name: v.last_name || (host ? 'Guest' : '(guest)'), is_guest: true, guest_note: host ? `Came with ${host.name}. Guardian phone ${v.phone}` : `Came on their own. Guardian phone ${v.phone}` });
    const created = await db.tx(async (c) => {
      const code = await codeFor(event.id, familyId, c);
      await c.query(`INSERT INTO attendance (event_id, person_id, family_id, security_code, checked_in_by) VALUES ($1, $2, $3, $4, $5)`, [event.id, personId, familyId, code, req.user.id]);
      return code;
    });
    D.audit(req.user, 'guest_checkin', { familyId, personId });
    await queueTags(req, res, { event, familyId, kids: [{ id: personId, first_name: v.first_name }], includeParent: !host,
      message: `${v.first_name} checked in as a guest${host ? ` with ${host.name}` : ''}. Pickup code ${created}.` });
  });

  // ---------------------------------------------------------------- name tags
  app.get('/checkin/print', needRole('volunteer'), async (req, res) => {
    const ids = String(req.query.jobs || '').split(',').map(Number).filter(Boolean).slice(0, 50);
    if (!ids.length) throw new HttpError(404, 'Nothing to print.');
    const jobs = await db.many('SELECT * FROM print_jobs WHERE id = ANY($1::int[]) ORDER BY id', [ids]);
    const labels = [];
    const when = (at) => `${t.fmtDate(at)} · ${t.fmtTime(at)}`;
    for (const job of jobs) {
      const event = await eventById(job.event_id);
      const people = job.people.split(',').map(Number).filter(Boolean);
      const kids = (await db.many(`${ROSTER_SQL} WHERE a.event_id = $1 AND a.family_id = $2 AND a.person_id = ANY($3::int[])`, [job.event_id, job.family_id, people]))
        .filter((r) => r.kind === 'child');
      for (const k of kids) {
        labels.push({
          kind: 'child', first: k.preferred_name || k.first_name, cls: D.groupFor(k),
          allergies: k.allergies ? allergens.detect(k.allergies) : [], allergyText: k.allergies || '',
          medical: Boolean(k.medical_notes || k.medications), code: k.security_code, when: when(k.checked_in_at),
        });
      }
      if (job.include_parent && kids.length) {
        labels.push({ kind: 'parent', family: kids[0].family_name, kids: kids.map((k) => k.preferred_name || k.first_name).join(', '), code: kids[0].security_code, when: `${event.name} · ${when(kids[0].checked_in_at)}` });
      }
    }
    await db.query(`UPDATE print_jobs SET status = 'printed', printed_at = now(), printed_by = $2 WHERE id = ANY($1::int[]) AND status <> 'cancelled'`, [ids, req.user.id]);
    if (!labels.length) throw new HttpError(404, 'Those name tags are no longer checked in.');
    const back = req.query.return && safeNext(req.query.return) ? req.query.return : '/checkin';
    res.send(V.labelsPage({ labels, returnTo: back, embed: req.query.embed === '1' }).toString());
  });

  // Test tags: check the printer, paper and colors without checking anyone in.
  app.get('/checkin/print/test', needRole('volunteer'), async (req, res) => {
    const at = new Date();
    const when = `${t.fmtDate(at)} · ${t.fmtTime(at)}`;
    const labels = [
      { kind: 'child', first: 'Test', cls: 'Kids', allergies: ['peanut', 'milk'], allergyText: 'Peanuts, milk (sample)', medical: true, code: 'TEST', when },
      { kind: 'parent', family: 'Test print', kids: 'This is a sample pickup tag', code: 'TEST', when: `Test print · ${when}` },
    ];
    if (req.query.one === '1') labels.pop();
    D.audit(req.user, 'test_print');
    res.send(V.labelsPage({ labels, returnTo: safeNext(req.query.return) || '/checkin/print-queue', embed: req.query.embed === '1' }).toString());
  });

  // Reprint from the roster (goes through the queue like any other print).
  app.post('/checkin/reprint', needRole('volunteer'), async (req, res) => {
    const event = await eventById(req.body.event_id);
    const familyId = Number(req.body.family_id) || 0;
    const kids = await db.many(`SELECT p.* FROM people p JOIN attendance a ON a.person_id = p.id AND a.event_id = $1 WHERE p.id = ANY($2::int[]) AND p.family_id = $3`,
      [event.id, String(req.body.people || '').split(',').map(Number).filter(Boolean), familyId]);
    await queueTags(req, res, { event, familyId, kids, includeParent: req.body.parent === '1', back: '/checkin/roster', message: 'Reprinting.' });
  });

  // ---------------------------------------------------------------- print queue
  app.get('/checkin/print-queue', needRole('volunteer'), async (req, res) => {
    req.ciEvent = await currentEvent(req);
    const jobs = await db.many(`SELECT j.*, f.name AS family_name, e.name AS event_name, u.first_name AS by_name FROM print_jobs j
      JOIN families f ON f.id = j.family_id JOIN events e ON e.id = j.event_id LEFT JOIN users u ON u.id = j.created_by
      WHERE j.created_at > now() - interval '18 hours' ORDER BY (j.status = 'queued') DESC, j.created_at DESC LIMIT 120`);
    render(req, res, V.printQueue({ csrf: res.locals.csrf, jobs, isPrinter: req.cookies.ci_printer === '1' }), { title: 'Printing', tab: 'print' });
  });

  app.get('/checkin/api/print-jobs', needRole('volunteer'), async (req, res) => {
    const jobs = await db.many(`SELECT j.id, j.summary, f.name AS family_name, j.created_at FROM print_jobs j JOIN families f ON f.id = j.family_id
      WHERE j.status = 'queued' AND j.created_at > now() - interval '18 hours' ORDER BY j.id LIMIT 20`);
    res.setHeader('Cache-Control', 'no-store');
    res.json(jobs.map((j) => ({ id: j.id, family: j.family_name, kids: j.summary, at: t.fmtTime(j.created_at) })));
  });

  app.post('/checkin/print-jobs/:id/cancel', needRole('volunteer'), async (req, res) => {
    await db.query(`UPDATE print_jobs SET status = 'cancelled' WHERE id = $1 AND status = 'queued'`, [intParam(req.params.id)]);
    res.redirect('/checkin/print-queue');
  });

  // ---------------------------------------------------------------- roster
  app.get('/checkin/roster', needRole('volunteer'), async (req, res) => {
    const event = await currentEvent(req);
    if (!event) return res.redirect('/checkin?change=1');
    req.ciEvent = event;
    const show = req.query.show === 'all' ? 'all' : 'here';
    const rows = await db.many(`${ROSTER_SQL} WHERE a.event_id = $1 ${show === 'all' ? '' : 'AND a.checked_out_at IS NULL'} ORDER BY p.kind DESC, p.first_name`, [event.id]);
    render(req, res, V.roster({ csrf: res.locals.csrf, user: req.user, event, rows, q: clean(req.query.q, 60), show }), { title: 'Checked in', tab: 'roster' });
  });

  app.post('/checkin/attendance/:id/out', needRole('volunteer'), async (req, res) => {
    const row = await db.one(`${ROSTER_SQL} WHERE a.id = $1`, [intParam(req.params.id)]);
    if (row) {
      await checkout([row], req.user.id, null, await eventById(row.event_id));
      security.flash(req, 'ok', `${row.preferred_name || row.first_name} checked out.`);
    }
    res.redirect('/checkin/roster');
  });

  app.post('/checkin/attendance/:id/remove', needRole('volunteer'), async (req, res) => {
    const row = await db.one('DELETE FROM attendance WHERE id = $1 RETURNING person_id', [intParam(req.params.id)]);
    if (row) { D.audit(req.user, 'remove_attendance', { personId: row.person_id }); security.flash(req, 'ok', 'Removed from tonight’s list.'); }
    res.redirect('/checkin/roster');
  });

  app.post('/checkin/checkout-all', needRole('volunteer'), async (req, res) => {
    const event = await eventById(req.body.event_id);
    // Kids and the parents who checked in with them all go out together.
    const rows = await db.many(`${ROSTER_SQL} WHERE a.event_id = $1 AND a.checked_out_at IS NULL`, [event.id]);
    await checkout(rows, req.user.id, 'Check out all', event);
    const kids = rows.filter((r) => r.kind === 'child').length;
    const adults = rows.length - kids;
    security.flash(req, 'ok', `${kids} ${kids === 1 ? 'child' : 'children'}${adults ? ` and ${adults} ${adults === 1 ? 'adult' : 'adults'}` : ''} checked out.`);
    res.redirect('/checkin/roster');
  });

  // ---------------------------------------------------------------- pickup (scan)
  async function scanMatch(event, codeRaw) {
    const code = String(codeRaw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-4);
    if (code.length !== 4) return { error: 'Enter the 4-character code from the pickup tag.' };
    const rows = await db.many(`${ROSTER_SQL} WHERE a.event_id = $1 AND a.security_code = $2 AND p.kind = 'child' ORDER BY p.first_name`, [event.id, code]);
    if (!rows.length) return { error: `No children are checked in with code ${code} for ${event.name}. Check the code, or the event at the top.` };
    const full = await D.familyFull(rows[0].family_id);
    return {
      match: {
        code, rows, family: full.family, kids: full.kids, adults: full.adults,
        allowed: full.pickups.filter((p) => !p.not_allowed), blocked: full.pickups.filter((p) => p.not_allowed),
      },
    };
  }

  app.get('/checkin/scan', needRole('volunteer'), async (req, res) => {
    const event = await currentEvent(req);
    if (!event) return res.redirect('/checkin?change=1');
    req.ciEvent = event;
    const r = req.query.code ? await scanMatch(event, req.query.code) : {};
    render(req, res, V.scanPage({ csrf: res.locals.csrf, user: req.user, event, code: req.query.code, ...r }), { title: 'Pick up', tab: 'scan' });
  });

  app.post('/checkin/scan', needRole('volunteer'), async (req, res) => {
    const event = await eventById(req.body.event_id);
    req.ciEvent = event;
    const r = await scanMatch(event, req.body.code);
    if (r.match) D.audit(req.user, 'scan_pickup', { familyId: r.match.family.id, detail: r.match.code });
    render(req, res, V.scanPage({ csrf: res.locals.csrf, user: req.user, event, code: req.body.code, ...r }), { title: 'Pick up', tab: 'scan' });
  });

  app.post('/checkin/release', needRole('volunteer'), async (req, res) => {
    const event = await eventById(req.body.event_id);
    const ids = [].concat(req.body.attendance || []).map(Number).filter(Boolean);
    const rows = ids.length ? await db.many(`${ROSTER_SQL} WHERE a.id = ANY($1::int[]) AND a.event_id = $2 AND a.checked_out_at IS NULL`, [ids, event.id]) : [];
    await checkout(rows, req.user.id, clean(req.body.to, 120) || 'Approved by a leader', event);
    // When a family's last child goes home, their parents are checked out too.
    for (const familyId of new Set(rows.map((r) => r.family_id))) {
      const kidsLeft = await db.one(`SELECT count(*)::int AS n FROM attendance a JOIN people p ON p.id = a.person_id WHERE a.event_id = $1 AND a.family_id = $2 AND a.checked_out_at IS NULL AND p.kind = 'child'`, [event.id, familyId]);
      if (!kidsLeft.n) await db.query(`UPDATE attendance a SET checked_out_at = now(), checked_out_by = $3, checked_out_to = 'With their children' FROM people p WHERE p.id = a.person_id AND p.kind = 'adult' AND a.event_id = $1 AND a.family_id = $2 AND a.checked_out_at IS NULL`, [event.id, familyId, req.user.id]);
    }
    security.flash(req, rows.length ? 'ok' : 'error', rows.length ? `Released ${rows.map((r) => r.preferred_name || r.first_name).join(', ')}.` : 'No children were selected.');
    res.redirect('/checkin/scan');
  });

  // ---------------------------------------------------------------- families (staff)
  app.get('/checkin/families', needRole('volunteer'), async (req, res) => {
    const q = clean(req.query.q, 80);
    const rows = await D.searchFamilies(q, q ? 40 : 60);
    req.ciEvent = await currentEvent(req);
    if (req.ciEvent && rows.length) {
      const checked = await db.many(`SELECT family_id, count(*)::int AS n FROM attendance WHERE event_id = $1 AND checked_out_at IS NULL AND family_id = ANY($2::int[]) GROUP BY family_id`, [req.ciEvent.id, rows.map((r) => r.id)]);
      const cmap = new Map(checked.map((c) => [c.family_id, c.n]));
      for (const r of rows) r.checked = cmap.get(r.id) || 0;
    }
    render(req, res, V.familiesPage({ csrf: res.locals.csrf, rows, q, user: req.user, event: req.ciEvent }), { title: 'Families', tab: 'families' });
  });

  app.get('/checkin/families/new', needRole('volunteer'), async (req, res) => res.redirect('/checkin/new'));

  function personValues(b, kind) {
    const v = {
      first_name: nameCase(b.first_name), last_name: nameCase(b.last_name), preferred_name: clean(b.preferred_name, 40) || null,
      birthdate: dateOrNull(b.birthdate),
    };
    if (kind === 'adult') {
      Object.assign(v, {
        relationship: clean(b.relationship, 40) || null, email: clean(b.email, 200).toLowerCase() || null, phone: clean(b.phone, 40) || null,
        contact_method: ['app', 'email', 'phone'].includes(b.contact_method) ? b.contact_method : 'app', is_primary: yes(b.is_primary),
        anniversary: dateOrNull(b.anniversary),
      });
    } else {
      Object.assign(v, {
        grade: clean(b.grade, 20) || null, gender: clean(b.gender, 10) || null,
        allergies: clean(b.allergies, 500) || null, medical_notes: clean(b.medical_notes, 500) || null, medications: clean(b.medications, 500) || null,
        special_needs: clean(b.special_needs, 800) || null, custody_alert: yes(b.custody_alert), custody_notes: yes(b.custody_alert) ? clean(b.custody_notes, 800) || null : null,
      });
    }
    return v;
  }

  async function savePerson(familyId, kind, v, id = null) {
    const cols = Object.keys(v);
    if (id) {
      await db.query(`UPDATE people SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...cols.map((c) => v[c])]);
      return id;
    }
    const row = await db.one(`INSERT INTO people (family_id, kind, ${cols.join(', ')}) VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`,
      [familyId, kind, ...cols.map((c) => v[c])]);
    return row.id;
  }

  app.post('/checkin/families', needRole('leader'), async (req, res) => {
    const v = personValues(req.body, 'adult');
    if (!v.first_name || !v.last_name) { security.flash(req, 'error', 'First and last name are required.'); return res.redirect('/checkin/families/new'); }
    const fam = await db.one(`INSERT INTO families (name, created_by) VALUES ($1, $2) RETURNING id`, [clean(req.body.family_name, 120) || `The ${v.last_name} Family`, req.user.id]);
    await savePerson(fam.id, 'adult', { ...v, is_primary: true });
    D.audit(req.user, 'create_family', { familyId: fam.id });
    security.flash(req, 'ok', 'Family created. Add the kids below, or email them a sign-up link.');
    res.redirect(`/checkin/families/${fam.id}`);
  });

  app.get('/checkin/families/:id', needRole('leader'), async (req, res) => {
    const full = await D.familyFull(intParam(req.params.id));
    if (!full) throw new HttpError(404, 'That family was not found.');
    const invites = await db.many('SELECT email, created_at, used_at FROM family_invites WHERE family_id = $1 ORDER BY created_at DESC LIMIT 5', [full.family.id]);
    D.audit(req.user, 'view_family', { familyId: full.family.id });
    req.ciEvent = await currentEvent(req);
    render(req, res, V.familyAdmin({ csrf: res.locals.csrf, user: req.user, full, invites }), { title: full.family.name, tab: 'families' });
  });

  app.post('/checkin/families/:id', needRole('leader'), async (req, res) => {
    const id = intParam(req.params.id);
    const b = req.body;
    await db.query(`UPDATE families SET name = $2, address = $3, city = $4, state = $5, zip = $6, home_phone = $7, staff_notes = $8, status = CASE WHEN status = 'new' THEN 'active' ELSE status END, updated_at = now() WHERE id = $1`,
      [id, clean(b.name, 120) || 'Family', clean(b.address, 200) || null, clean(b.city, 80) || null, clean(b.state, 20) || null, clean(b.zip, 20) || null, clean(b.home_phone, 40) || null, clean(b.staff_notes, 1000) || null]);
    security.flash(req, 'ok', 'Family details saved.');
    res.redirect(`/checkin/families/${id}`);
  });

  app.get('/checkin/families/:id/people/new', needRole('leader'), async (req, res) => {
    const family = await db.one('SELECT * FROM families WHERE id = $1', [intParam(req.params.id)]);
    if (!family) throw new HttpError(404, 'That family was not found.');
    const kind = req.query.kind === 'adult' ? 'adult' : 'child';
    const anyAdult = await db.one(`SELECT last_name FROM people WHERE family_id = $1 AND kind = 'adult' LIMIT 1`, [family.id]);
    render(req, res, V.personPage({ csrf: res.locals.csrf, user: req.user, family, person: { kind, last_name: anyAdult ? anyAdult.last_name : '' }, isNew: true }), { title: 'Add person', tab: 'families' });
  });

  app.post('/checkin/families/:id/people', needRole('leader'), async (req, res) => {
    const familyId = intParam(req.params.id);
    const kind = req.body.kind === 'adult' ? 'adult' : 'child';
    const v = personValues(req.body, kind);
    if (!v.first_name || !v.last_name) { security.flash(req, 'error', 'First and last name are required.'); return res.redirect(`/checkin/families/${familyId}/people/new?kind=${kind}`); }
    await savePerson(familyId, kind, v);
    D.audit(req.user, 'add_person', { familyId });
    security.flash(req, 'ok', `${v.first_name} added.`);
    res.redirect(`/checkin/families/${familyId}`);
  });

  app.get('/checkin/people/:id', needRole('leader'), async (req, res) => {
    const person = await db.one('SELECT * FROM people WHERE id = $1', [intParam(req.params.id)]);
    if (!person) throw new HttpError(404, 'That person was not found.');
    const family = await db.one('SELECT * FROM families WHERE id = $1', [person.family_id]);
    D.audit(req.user, 'view_person', { familyId: family.id, personId: person.id });
    render(req, res, V.personPage({ csrf: res.locals.csrf, user: req.user, family, person, isNew: false, back: safeNext(req.query.back) || null }), { title: D.displayName(person), tab: 'families' });
  });

  app.post('/checkin/people/:id', needRole('leader'), async (req, res) => {
    const person = await db.one('SELECT * FROM people WHERE id = $1', [intParam(req.params.id)]);
    if (!person) throw new HttpError(404, 'That person was not found.');
    const v = personValues(req.body, person.kind);
    if (!v.first_name || !v.last_name) { security.flash(req, 'error', 'First and last name are required.'); return res.redirect(`/checkin/people/${person.id}`); }
    await savePerson(person.family_id, person.kind, v, person.id);
    D.audit(req.user, 'edit_person', { familyId: person.family_id, personId: person.id });
    security.flash(req, 'ok', 'Saved.');
    res.redirect(safeNext(req.body.back) || `/checkin/families/${person.family_id}`);
  });

  // ---- Photos (one per person). The check-in team can add them at the desk; parents for their own family.
  async function canSeePerson(req, person) {
    if (!req.user || !person) return false;
    if (D.can(req.user, 'volunteer')) return true;
    const fam = await D.familyForUser(req.user.id);
    return Boolean(fam && fam.id === person.family_id);
  }

  app.get('/checkin/people/:id/photo', async (req, res) => {
    const person = await db.one('SELECT id, family_id, photo_at FROM people WHERE id = $1', [intParam(req.params.id)]);
    if (!(await canSeePerson(req, person))) throw new HttpError(404, 'Photo not found.');
    const ph = await db.one('SELECT data, content_type FROM person_photos WHERE person_id = $1', [person.id]);
    if (!ph) throw new HttpError(404, 'Photo not found.');
    res.setHeader('Content-Type', ph.content_type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(ph.data);
  });

  app.post('/checkin/people/:id/photo', async (req, res) => {
    if (needLogin(req, res)) return;
    const person = await db.one('SELECT id, family_id, first_name FROM people WHERE id = $1', [intParam(req.params.id)]);
    if (!(await canSeePerson(req, person))) throw new HttpError(404, 'That person was not found.');
    const back = safeNext(req.body.back) || (D.can(req.user, 'leader') ? `/checkin/families/${person.family_id}` : '/checkin/family');
    if (req.body.remove === '1') {
      await db.query('DELETE FROM person_photos WHERE person_id = $1', [person.id]);
      await db.query('UPDATE people SET photo_at = NULL WHERE id = $1', [person.id]);
      security.flash(req, 'ok', `Photo of ${person.first_name} removed.`);
      return res.redirect(back);
    }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.photo_data || ''));
    const buf = m ? Buffer.from(m[2], 'base64') : null;
    if (!buf || !buf.length || buf.length > 3 * 1024 * 1024) {
      security.flash(req, 'error', 'That photo couldn’t be used. Try a JPG or PNG under 3 MB.');
      return res.redirect(back);
    }
    await db.query(`INSERT INTO person_photos (person_id, data, content_type) VALUES ($1, $2, $3)
      ON CONFLICT (person_id) DO UPDATE SET data = EXCLUDED.data, content_type = EXCLUDED.content_type, updated_at = now()`, [person.id, buf, m[1]]);
    await db.query('UPDATE people SET photo_at = now() WHERE id = $1', [person.id]);
    D.audit(req.user, 'photo', { familyId: person.family_id, personId: person.id });
    security.flash(req, 'ok', `Photo of ${person.first_name} saved.`);
    res.redirect(back);
  });

  app.post('/checkin/people/:id/remove', needRole('leader'), async (req, res) => {
    const p = await db.one('UPDATE people SET active = false, updated_at = now() WHERE id = $1 RETURNING family_id, first_name', [intParam(req.params.id)]);
    if (!p) throw new HttpError(404, 'That person was not found.');
    D.audit(req.user, 'remove_person', { familyId: p.family_id, personId: Number(req.params.id) });
    security.flash(req, 'ok', `${p.first_name} removed from the family.`);
    res.redirect(`/checkin/families/${p.family_id}`);
  });

  app.post('/checkin/families/:id/contacts', needRole('leader'), async (req, res) => {
    const id = intParam(req.params.id);
    if (clean(req.body.name, 120) && clean(req.body.phone, 40)) {
      await db.query('INSERT INTO emergency_contacts (family_id, name, relationship, phone) VALUES ($1, $2, $3, $4)', [id, clean(req.body.name, 120), clean(req.body.relationship, 60) || null, clean(req.body.phone, 40)]);
    }
    res.redirect(`/checkin/families/${id}`);
  });
  app.post('/checkin/contacts/:id/delete', needRole('leader'), async (req, res) => {
    const r = await db.one('DELETE FROM emergency_contacts WHERE id = $1 RETURNING family_id', [intParam(req.params.id)]);
    res.redirect(r ? `/checkin/families/${r.family_id}` : '/checkin/families');
  });
  app.post('/checkin/families/:id/pickups', needRole('leader'), async (req, res) => {
    const id = intParam(req.params.id);
    if (clean(req.body.name, 120)) {
      await db.query('INSERT INTO authorized_pickups (family_id, name, relationship, phone, not_allowed, notes) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, clean(req.body.name, 120), clean(req.body.relationship, 60) || null, clean(req.body.phone, 40) || null, yes(req.body.not_allowed), clean(req.body.notes, 500) || null]);
      D.audit(req.user, yes(req.body.not_allowed) ? 'add_blocked_pickup' : 'add_pickup', { familyId: id });
    }
    res.redirect(`/checkin/families/${id}`);
  });
  app.post('/checkin/pickups/:id/delete', needRole('leader'), async (req, res) => {
    const r = await db.one('DELETE FROM authorized_pickups WHERE id = $1 RETURNING family_id', [intParam(req.params.id)]);
    if (r) D.audit(req.user, 'remove_pickup', { familyId: r.family_id });
    res.redirect(r ? `/checkin/families/${r.family_id}` : '/checkin/families');
  });

  app.get('/checkin/families/:id/agreements', needRole('leader'), async (req, res) => {
    const family = await db.one('SELECT * FROM families WHERE id = $1', [intParam(req.params.id)]);
    if (!family) throw new HttpError(404, 'That family was not found.');
    const rows = await db.many('SELECT * FROM waivers WHERE family_id = $1 ORDER BY signed_at DESC', [family.id]);
    const { html } = require('../lib/html');
    render(req, res, html`<p class="crumb"><a href="/checkin/families/${family.id}">${family.name}</a></p><h1>Signed agreements</h1>
      ${rows.map((w) => html`<section class="box"><h2 class="box-head">${(AGREEMENTS[w.kind] || {}).title || w.kind} · version ${w.version}</h2><div class="box-body">
        <p class="small"><strong>Signed by ${w.signer_name}</strong> (${w.signer_relationship || 'parent'}) on ${t.fmtDateYear(w.signed_at)} at ${t.fmtTime(w.signed_at)}${w.children ? ` for ${w.children}` : ''}. Record ${w.text_hash.slice(0, 12)}.</p>
        <div class="ci-agreement-text">${w.text_snapshot.split(/\n\n/).map((p) => html`<p>${p}</p>`)}</div></div></section>`)}`, { title: 'Signed agreements', tab: 'families' });
  });

  // ---------------------------------------------------------------- invites and joining
  app.get('/checkin/invite', needRole('leader'), async (req, res) => {
    render(req, res, V.invitePage({ csrf: res.locals.csrf }), { title: 'Email a sign-up link', tab: 'families' });
  });

  app.post('/checkin/invite', needRole('leader'), security.rateLimit('ci-invite', { max: 60, windowMs: 3600000 }), async (req, res) => {
    const email = clean(req.body.email, 200).toLowerCase();
    const familyId = Number(req.body.family_id) || null;
    if (!EMAIL_RE.test(email)) { security.flash(req, 'error', 'Enter a valid email address.'); return res.redirect(familyId ? `/checkin/families/${familyId}` : '/checkin/invite'); }
    const tok = security.token(24);
    await db.query(`INSERT INTO family_invites (family_id, email, token_hash, expires_at, created_by) VALUES ($1, $2, $3, now() + interval '30 days', $4)`, [familyId, email, security.sha256(tok), req.user.id]);
    const family = familyId ? await db.one('SELECT name FROM families WHERE id = $1', [familyId]) : null;
    N.invite({ email, link: url(`/checkin/join/${tok}`), familyName: family && family.name, invitedBy: `${req.user.first_name} ${req.user.last_name}` });
    security.flash(req, 'ok', `Sign-up link sent to ${email}. It works for 30 days.`);
    res.redirect(familyId ? `/checkin/families/${familyId}` : '/checkin/invite');
  });

  const findInvite = (tok) => db.one('SELECT * FROM family_invites WHERE token_hash = $1 AND expires_at > now()', [security.sha256(String(tok))]);

  app.get('/checkin/join/:token', async (req, res) => {
    const inv = await findInvite(req.params.token);
    if (!inv) return render(req, res, V.joinPage({ csrf: res.locals.csrf, invite: req.params.token, error: 'This link has expired. Ask the church office for a new one.' }), { title: 'Join', bare: true });
    render(req, res, V.joinPage({ csrf: res.locals.csrf, invite: req.params.token, email: inv.email, loggedIn: req.user && `${req.user.first_name} ${req.user.last_name}` }), { title: 'Join', bare: true });
  });

  app.post('/checkin/join/:token', security.rateLimit('ci-join', { max: 20, windowMs: 3600000 }), async (req, res) => {
    const inv = await findInvite(req.params.token);
    if (!inv) return res.redirect(`/checkin/join/${encodeURIComponent(req.params.token)}`);
    let user = req.user;
    if (!user) {
      const email = clean(req.body.email, 200).toLowerCase();
      const first = nameCase(req.body.first_name);
      const last = nameCase(req.body.last_name);
      const pw = String(req.body.password || '');
      const error = !first || !last ? 'Enter your first and last name.' : !EMAIL_RE.test(email) ? 'Enter a valid email address.' : pw.length < 8 ? 'Use at least 8 characters for your password.'
        : await users.byEmail(email) ? 'That email already has an account. Log in first, then open this link again.' : null;
      if (error) return render(req, res, V.joinPage({ csrf: res.locals.csrf, invite: req.params.token, email, error }), { title: 'Join', bare: true });
      const code = await users.nextCode();
      const row = await db.one(`INSERT INTO users (email, password_hash, first_name, last_name, status, library_code, approved_at) VALUES ($1, $2, $3, $4, 'approved', $5, now()) RETURNING id`,
        [email, await security.hashPassword(pw), first, last, code]);
      user = await users.get(row.id);
      await req.regenerateSession();
      req.session.userId = user.id;
      A.welcome(user, { link: '/checkin/family' });
    }
    let familyId = inv.family_id;
    const existing = await D.familyForUser(user.id);
    if (existing) familyId = existing.id;
    else if (familyId) await linkUserToFamily(user, familyId);
    else familyId = (await newFamilyFor(user)).id;
    await db.query('UPDATE family_invites SET used_at = COALESCE(used_at, now()), family_id = COALESCE(family_id, $2) WHERE id = $1', [inv.id, familyId]);
    res.redirect('/checkin/welcome/family');
  });

  // ---------------------------------------------------------------- parent onboarding
  const STEP_KEYS = V.STEPS.map(([k]) => k);
  async function parentFamily(req, res) {
    if (needLogin(req, res)) return null;
    let fam = await myFamily(req);
    if (!fam) fam = await newFamilyFor(req.user);
    return D.familyFull(fam.id);
  }

  app.get('/checkin/welcome/:step', async (req, res) => {
    const step = req.params.step;
    if (!STEP_KEYS.includes(step)) throw new HttpError(404, 'Not found.');
    const full = await parentFamily(req, res);
    if (!full) return;
    render(req, res, V.wizard({ step, csrf: res.locals.csrf, user: req.user, full }), { title: 'Set up your family', tab: 'family' });
  });

  const nextStep = (step) => `/checkin/welcome/${STEP_KEYS[STEP_KEYS.indexOf(step) + 1] || 'agreements'}`;

  app.post('/checkin/welcome/family', async (req, res) => {
    const full = await parentFamily(req, res);
    if (!full) return;
    const b = req.body;
    const fid = full.family.id;
    await db.query('UPDATE families SET name = $2, address = $3, city = $4, state = $5, zip = $6, updated_at = now() WHERE id = $1',
      [fid, clean(b.family_name, 120) || full.family.name, clean(b.address, 200) || null, clean(b.city, 80) || null, clean(b.state, 20) || null, clean(b.zip, 20) || null]);
    const me = full.adults.find((a) => a.user_id === req.user.id);
    if (me) {
      await db.query('UPDATE people SET relationship = $2, phone = $3, contact_method = $4, birthdate = $5, email = COALESCE(email, $6), anniversary = $7, updated_at = now() WHERE id = $1',
        [me.id, clean(b.relationship, 40) || 'Parent', clean(b.phone, 40) || null, ['app', 'email', 'phone'].includes(b.contact_method) ? b.contact_method : 'app', dateOrNull(b.birthdate), req.user.email, dateOrNull(b.anniversary)]);
      // A spouse in the family shares the anniversary unless they've set their own.
      if (dateOrNull(b.anniversary)) await db.query(`UPDATE people SET anniversary = $2 WHERE family_id = $1 AND kind = 'adult' AND id <> $3 AND anniversary IS NULL AND relationship IN ('Mother', 'Father', 'Parent', 'Stepparent')`, [fid, dateOrNull(b.anniversary), me.id]);
    }
    const ofirst = nameCase(b.other_first_name);
    if (ofirst) {
      const other = { first_name: ofirst, last_name: nameCase(b.other_last_name) || req.user.last_name, relationship: clean(b.other_relationship, 40) || 'Parent', email: clean(b.other_email, 200).toLowerCase() || null, phone: clean(b.other_phone, 40) || null };
      const otherId = Number(b.other_id) || 0;
      const owned = otherId ? full.adults.find((a) => a.id === otherId && a.user_id !== req.user.id) : null;
      if (owned) await savePerson(fid, 'adult', other, owned.id);
      else {
        await savePerson(fid, 'adult', { ...other, contact_method: 'app', is_primary: false });
        if (other.email && EMAIL_RE.test(other.email) && !(await users.byEmail(other.email))) {
          const tok = security.token(24);
          await db.query(`INSERT INTO family_invites (family_id, email, token_hash, expires_at, created_by) VALUES ($1, $2, $3, now() + interval '30 days', $4)`, [fid, other.email, security.sha256(tok), req.user.id]);
          N.invite({ email: other.email, link: url(`/checkin/join/${tok}`), familyName: clean(b.family_name, 120), invitedBy: `${req.user.first_name} ${req.user.last_name}` });
        }
      }
    }
    res.redirect(nextStep('family'));
  });

  app.post('/checkin/welcome/kids', async (req, res) => {
    const full = await parentFamily(req, res);
    if (!full) return;
    const b = req.body;
    const v = { first_name: nameCase(b.first_name), last_name: nameCase(b.last_name), preferred_name: clean(b.preferred_name, 40) || null, birthdate: dateOrNull(b.birthdate), grade: clean(b.grade, 20) || null, gender: clean(b.gender, 10) || null };
    if (!v.first_name || !v.last_name || !v.birthdate) {
      return render(req, res, V.wizard({ step: 'kids', csrf: res.locals.csrf, user: req.user, full, error: 'Enter each child’s first name, last name and birthday.' }), { title: 'Set up your family', tab: 'family' });
    }
    await savePerson(full.family.id, 'child', v);
    security.flash(req, 'ok', `${v.first_name} added. Add another child, or continue.`);
    res.redirect('/checkin/welcome/kids');
  });

  app.post('/checkin/welcome/health', async (req, res) => {
    const full = await parentFamily(req, res);
    if (!full) return;
    for (const k of full.kids) {
      const g = (f) => clean(req.body[`${f}_${k.id}`], 800) || null;
      // Parents can add a custody alert, but only a ministry leader can remove one.
      const custody = yes(req.body[`custody_${k.id}`]) || k.custody_alert;
      const notes = g('custody_notes') || k.custody_notes || null;
      await db.query(`UPDATE people SET allergies = $2, medical_notes = $3, medications = $4, special_needs = $5, custody_alert = $6, custody_notes = $7, updated_at = now() WHERE id = $1 AND family_id = $8`,
        [k.id, g('allergies'), g('medical_notes'), g('medications'), g('special_needs'), custody, custody ? notes : null, full.family.id]);
      if (custody && !k.custody_alert) D.audit(req.user, 'parent_added_custody_alert', { familyId: full.family.id, personId: k.id });
    }
    res.redirect(nextStep('health'));
  });

  app.post('/checkin/welcome/contacts', async (req, res) => {
    const full = await parentFamily(req, res);
    if (!full) return;
    const fid = full.family.id;
    const b = req.body;
    for (let i = 0; i < 2; i++) {
      const id = Number(b[`ec_id_${i}`]) || 0;
      const name = clean(b[`ec_name_${i}`], 120);
      const phone = clean(b[`ec_phone_${i}`], 40);
      if (id && !name) await db.query('DELETE FROM emergency_contacts WHERE id = $1 AND family_id = $2', [id, fid]);
      else if (id) await db.query('UPDATE emergency_contacts SET name = $3, relationship = $4, phone = $5 WHERE id = $1 AND family_id = $2', [id, fid, name, clean(b[`ec_rel_${i}`], 60) || null, phone]);
      else if (name && phone) await db.query('INSERT INTO emergency_contacts (family_id, name, relationship, phone) VALUES ($1, $2, $3, $4)', [fid, name, clean(b[`ec_rel_${i}`], 60) || null, phone]);
    }
    for (let i = 0; i < 3; i++) {
      const id = Number(b[`pu_id_${i}`]) || 0;
      const name = clean(b[`pu_name_${i}`], 120);
      if (id && !name) await db.query('DELETE FROM authorized_pickups WHERE id = $1 AND family_id = $2 AND NOT not_allowed', [id, fid]);
      else if (id) await db.query('UPDATE authorized_pickups SET name = $3, relationship = $4, phone = $5 WHERE id = $1 AND family_id = $2 AND NOT not_allowed', [id, fid, name, clean(b[`pu_rel_${i}`], 60) || null, clean(b[`pu_phone_${i}`], 40) || null]);
      else if (name) await db.query('INSERT INTO authorized_pickups (family_id, name, relationship, phone) VALUES ($1, $2, $3, $4)', [fid, name, clean(b[`pu_rel_${i}`], 60) || null, clean(b[`pu_phone_${i}`], 40) || null]);
    }
    res.redirect(nextStep('contacts'));
  });

  app.post('/checkin/welcome/agreements', async (req, res) => {
    const full = await parentFamily(req, res);
    if (!full) return;
    const b = req.body;
    const signature = clean(b.signature, 120);
    const missing = Object.entries(AGREEMENTS).filter(([k, a]) => a.required && !yes(b[`agree_${k}`]));
    if (!signature || signature.split(' ').length < 2 || missing.length) {
      return render(req, res, V.wizard({ step: 'agreements', csrf: res.locals.csrf, user: req.user, full, error: missing.length ? `Please agree to: ${missing.map(([, a]) => a.title).join(', ')}.` : 'Type your full name (first and last) to sign.' }), { title: 'Permission forms', tab: 'family' });
    }
    const children = full.kids.map((k) => `${k.first_name} ${k.last_name}`).join(', ');
    let signedAny = false;
    for (const [kind, a] of Object.entries(AGREEMENTS)) {
      if (!yes(b[`agree_${kind}`])) continue;
      const already = full.waivers.find((w) => w.kind === kind && w.version === a.version);
      if (already) continue;
      const hash = crypto.createHash('sha256').update(`${kind}|${a.version}|${a.text}|${signature}|${children}|${new Date().toISOString()}`).digest('hex');
      await db.query(`INSERT INTO waivers (family_id, kind, version, children, signer_name, signer_relationship, signer_user_id, ip, user_agent, text_snapshot, text_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [full.family.id, kind, a.version, children || null, signature, clean(b.signer_relationship, 40) || 'Parent', req.user.id, req.ip, clean(req.headers['user-agent'], 300), a.text, hash]);
      signedAny = true;
    }
    // Photo consent on each child follows the photo release answer.
    await db.query(`UPDATE people SET photo_consent = $2 WHERE family_id = $1 AND kind = 'child'`, [full.family.id, yes(b.agree_photo)]);
    if (signedAny) N.welcome({ user: req.user, familyName: full.family.name });
    security.flash(req, 'ok', 'Thank you! Your family is all set for check-in.');
    res.redirect('/checkin/family');
  });

  app.get('/checkin/family', async (req, res) => {
    if (needLogin(req, res)) return;
    const fam = await myFamily(req);
    if (!fam) {
      if (D.can(req.user, 'volunteer') && !req.query.setup) return res.redirect('/checkin');
      return res.redirect('/checkin/welcome/family');
    }
    const full = await D.familyFull(fam.id);
    const recent = await db.many(`SELECT a.*, p.first_name, e.name AS event_name FROM attendance a JOIN people p ON p.id = a.person_id JOIN events e ON e.id = a.event_id
      WHERE a.family_id = $1 AND p.kind = 'child' ORDER BY a.checked_in_at DESC LIMIT 10`, [fam.id]);
    render(req, res, V.familyHome({ csrf: res.locals.csrf, user: req.user, full, recent, pushEnabled: push.enabled() }), { title: 'My family', tab: 'family' });
  });

  // Anyone with an account can start a family without an invite.
  app.get('/checkin/register', async (req, res) => {
    if (!req.user) return res.redirect('/apply?next=/checkin/family');
    res.redirect('/checkin/welcome/family');
  });

  // ---------------------------------------------------------------- team
  app.get('/checkin/staff', needRole('coadmin'), async (req, res) => {
    const staff = await db.many(`SELECT id, first_name, last_name, email, checkin_role FROM users WHERE checkin_role IS NOT NULL
      ORDER BY CASE checkin_role WHEN 'admin' THEN 0 WHEN 'coadmin' THEN 1 WHEN 'leader' THEN 2 ELSE 3 END, last_name`);
    render(req, res, V.staffPage({ csrf: res.locals.csrf, user: req.user, staff }), { title: 'Team', tab: 'staff' });
  });

  const roleAllowed = (actor, role) => role && D.RANK[role] && (D.can(actor, 'admin') || D.RANK[role] < D.RANK.coadmin);

  app.post('/checkin/staff', needRole('coadmin'), async (req, res) => {
    const u = await users.byEmail(clean(req.body.email, 200));
    if (!u) { security.flash(req, 'error', 'No account has that email. Use “Create a new account”.'); return res.redirect('/checkin/staff'); }
    if (!roleAllowed(req.user, req.body.role)) throw new HttpError(403, 'You can’t give that role.');
    const wasStaff = Boolean(u.checkin_role);
    await db.query('UPDATE users SET checkin_role = $2 WHERE id = $1', [u.id, req.body.role]);
    D.audit(req.user, 'set_role', { detail: `${u.email} -> ${req.body.role}` });
    if (!wasStaff) N.staffWelcome({ email: u.email, firstName: u.first_name, role: D.ROLE_LABEL[req.body.role], link: url('/checkin'), invitedBy: `${req.user.first_name} ${req.user.last_name}`, isNew: false });
    security.flash(req, 'ok', `${u.first_name} ${u.last_name} is now a ${D.ROLE_LABEL[req.body.role].toLowerCase()}.`);
    res.redirect('/checkin/staff');
  });

  app.post('/checkin/staff/create', needRole('coadmin'), async (req, res) => {
    const email = clean(req.body.email, 200).toLowerCase();
    if (!roleAllowed(req.user, req.body.role)) throw new HttpError(403, 'You can’t give that role.');
    if (!EMAIL_RE.test(email) || !nameCase(req.body.first_name) || !nameCase(req.body.last_name)) { security.flash(req, 'error', 'Name and a valid email are required.'); return res.redirect('/checkin/staff'); }
    if (await users.byEmail(email)) { security.flash(req, 'error', 'That email already has an account. Use “Add someone who already has an account”.'); return res.redirect('/checkin/staff'); }
    const temp = security.tempPassword();
    const tok = security.token(24);
    await db.query(`INSERT INTO users (email, password_hash, first_name, last_name, status, library_code, approved_at, checkin_role, reset_token_hash, reset_expires) VALUES ($1, $2, $3, $4, 'approved', $5, now(), $6, $7, now() + interval '7 days')`,
      [email, await security.hashPassword(temp), nameCase(req.body.first_name), nameCase(req.body.last_name), await users.nextCode(), req.body.role, security.sha256(tok)]);
    // Email them a link to set their own password (the temporary one is shown as a backup).
    N.staffWelcome({ email, firstName: nameCase(req.body.first_name), role: D.ROLE_LABEL[req.body.role], link: url(`/reset/${tok}`), invitedBy: `${req.user.first_name} ${req.user.last_name}`, isNew: true });
    D.audit(req.user, 'create_staff', { detail: `${email} -> ${req.body.role}` });
    const staff = await db.many(`SELECT id, first_name, last_name, email, checkin_role FROM users WHERE checkin_role IS NOT NULL ORDER BY last_name`);
    render(req, res, V.staffPage({ csrf: res.locals.csrf, user: req.user, staff, tempPassword: temp, created: `${nameCase(req.body.first_name)} ${nameCase(req.body.last_name)}` }), { title: 'Team', tab: 'staff' });
  });

  app.post('/checkin/staff/:id', needRole('coadmin'), async (req, res) => {
    const id = intParam(req.params.id);
    const target = await users.get(id);
    if (!target || id === req.user.id) throw new HttpError(400, 'You can’t change your own role.');
    if (D.RANK[target.checkin_role] >= D.RANK.coadmin && !D.can(req.user, 'admin')) throw new HttpError(403, 'Only the primary admin can change co-admins.');
    const role = req.body.role || null;
    if (role && !roleAllowed(req.user, role)) throw new HttpError(403, 'You can’t give that role.');
    if (target.checkin_role === 'admin' && role !== 'admin') {
      const n = (await db.one(`SELECT count(*)::int AS n FROM users WHERE checkin_role = 'admin'`)).n;
      if (n <= 1) throw new HttpError(400, 'There must always be at least one primary admin.');
    }
    await db.query('UPDATE users SET checkin_role = $2 WHERE id = $1', [id, role]);
    D.audit(req.user, 'set_role', { detail: `${target.email} -> ${role || 'none'}` });
    security.flash(req, 'ok', role ? `${target.first_name} is now a ${D.ROLE_LABEL[role].toLowerCase()}.` : `${target.first_name} was removed from the team.`);
    res.redirect('/checkin/staff');
  });

  // ---------------------------------------------------------------- reports
  async function reportData(q) {
    const to = dateOrNull(q.to) || today();
    const from = dateOrNull(q.from) || t.addDaysKey(to, -365);
    const filter = clean(q.event, 80);
    const params = [from, to];
    let where = 'e.event_date BETWEEN $1 AND $2';
    if (filter) { params.push(filter); where += ` AND e.name = $${params.length}`; }
    const weekly = await db.many(`SELECT e.id, e.name, e.event_date::text AS event_date,
        count(*) FILTER (WHERE p.kind = 'child')::int AS kids, count(*) FILTER (WHERE p.kind = 'adult')::int AS adults, count(a.id)::int AS total
      FROM events e LEFT JOIN attendance a ON a.event_id = e.id LEFT JOIN people p ON p.id = a.person_id
      WHERE ${where} GROUP BY e.id HAVING count(a.id) > 0 ORDER BY e.event_date DESC, e.name`, params);
    const roll = (key) => {
      const m = new Map();
      for (const w of weekly) {
        const k = key(w);
        const r = m.get(k) || { key: k, services: 0, kids: 0, adults: 0, total: 0 };
        r.services++; r.kids += w.kids; r.adults += w.adults; r.total += w.total;
        m.set(k, r);
      }
      return [...m.values()].map((r) => ({ ...r, avg_kids: +(r.kids / r.services).toFixed(1), avg_adults: +(r.adults / r.services).toFixed(1), avg_total: +(r.total / r.services).toFixed(1) }));
    };
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthly = roll((w) => w.event_date.slice(0, 7)).sort((a, b) => b.key.localeCompare(a.key))
      .map((r) => ({ ...r, label: `${MONTHS[Number(r.key.slice(5, 7)) - 1]} ${r.key.slice(0, 4)}` }));
    const uniq = await db.many(`SELECT extract(year FROM e.event_date)::int AS year, count(DISTINCT a.person_id)::int AS n FROM attendance a JOIN events e ON e.id = a.event_id WHERE ${where} GROUP BY 1`, params);
    const umap = new Map(uniq.map((u) => [u.year, u.n]));
    const yearly = roll((w) => Number(w.event_date.slice(0, 4))).sort((a, b) => b.key - a.key).map((r) => ({ ...r, year: r.key, unique_people: umap.get(r.key) || 0 }));
    const kidRows = await db.many(`SELECT a.person_id, p.birthdate::text AS birthdate, p.kind FROM attendance a JOIN people p ON p.id = a.person_id JOIN events e ON e.id = a.event_id WHERE ${where} AND p.kind = 'child'`, params);
    const groups = new Map();
    for (const r of kidRows) {
      const g = D.groupFor(r);
      const x = groups.get(g) || { group: g, n: 0, set: new Set() };
      x.n++; x.set.add(r.person_id); groups.set(g, x);
    }
    const byGroup = D.GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({ group: g, n: groups.get(g).n, people: groups.get(g).set.size }));
    const firstTimers = (await db.one(`SELECT count(*)::int AS n FROM (SELECT a.person_id, min(e.event_date) AS first FROM attendance a JOIN events e ON e.id = a.event_id GROUP BY a.person_id) x WHERE x.first BETWEEN $1 AND $2`, [from, to])).n;
    return { filter, from, to, weekly, monthly, yearly, byGroup, firstTimers, names: await D.knownEventNames() };
  }

  app.get('/checkin/reports', needRole('coadmin'), async (req, res) => {
    const data = await reportData(req.query);
    req.ciEvent = await currentEvent(req);
    render(req, res, V.reportsPage(data), { title: 'Reports', tab: 'reports' });
  });

  // ---------------------------------------------------------------- Ask + HELP
  app.post('/checkin/api/ask', security.rateLimit('ci-ask', { max: 60, windowMs: 60000 }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.user) return res.json({ answer: 'Log in first, then ask away.', items: [], topics: [] });
    const event = D.can(req.user, 'volunteer') ? await currentEvent(req) : null;
    res.json(await assist.ask(clean(req.body.q, 200), req.user, event));
  });

  app.get('/checkin/api/help', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(assist.topicsFor(req.user).filter((tp) => !tp.page || !/\/(events|staff|reports|automations|broadcast)/.test(tp.page) || D.can(req.user, /staff|reports|automations|broadcast/.test(tp.page) ? 'coadmin' : 'leader'))
      .map((tp) => ({ id: tp.id, title: tp.title, steps: tp.steps, keys: tp.keys, url: tp.page && !/\/f$/.test(tp.page) ? tp.page : null, tour: tp.tour || null })));
  });

  // ---------------------------------------------------------------- events
  app.get('/checkin/events', needRole('leader'), async (req, res) => {
    req.ciEvent = await currentEvent(req);
    const names = await db.many(`SELECT n.*,
        (SELECT count(*) FROM events e WHERE lower(e.name) = lower(n.name))::int AS times,
        (SELECT max(e.event_date)::text FROM events e WHERE lower(e.name) = lower(n.name)) AS last_date,
        (SELECT count(*) FROM attendance a JOIN events e ON e.id = a.event_id WHERE lower(e.name) = lower(n.name))::int AS checkins
      FROM event_names n ORDER BY n.archived, n.name`);
    const recent = await db.many(`SELECT e.id, e.name, e.event_date::text AS event_date, count(a.id)::int AS total,
        count(*) FILTER (WHERE p.kind = 'child')::int AS kids
      FROM events e LEFT JOIN attendance a ON a.event_id = e.id LEFT JOIN people p ON p.id = a.person_id
      GROUP BY e.id ORDER BY e.event_date DESC, e.name LIMIT 25`);
    render(req, res, V.eventsPage({ csrf: res.locals.csrf, user: req.user, names, recent, builtIn: D.BUILT_IN_EVENTS, current: req.ciEvent }), { title: 'Events', tab: 'events' });
  });

  app.post('/checkin/events', needRole('leader'), async (req, res) => {
    const name = clean(req.body.name, 80).replace(/\s+/g, ' ');
    if (!name) { security.flash(req, 'error', 'Give the event a name.'); return res.redirect('/checkin/events'); }
    const before = await db.one('SELECT archived FROM event_names WHERE lower(name) = lower($1)', [name]);
    await D.saveEventName(name, req.user.id);
    if (clean(req.body.notes, 300)) await db.query('UPDATE event_names SET notes = $2 WHERE lower(name) = lower($1)', [name, clean(req.body.notes, 300)]);
    D.audit(req.user, 'event_add', { detail: name });
    security.flash(req, 'ok', before ? (before.archived ? `${name} is back on the list.` : `${name} is already on the list.`) : `${name} added. It now shows as a choice on the check-in screen.`);
    res.redirect('/checkin/events');
  });

  const eventName = async (id) => {
    const n = await db.one('SELECT * FROM event_names WHERE id = $1', [id]);
    if (!n) throw new HttpError(404, 'That event was not found.');
    return n;
  };

  app.post('/checkin/events/:id/archive', needRole('leader'), async (req, res) => {
    const n = await eventName(intParam(req.params.id));
    if (D.BUILT_IN_EVENTS.includes(n.name)) { security.flash(req, 'error', `${n.name} is a regular service and stays on the list.`); return res.redirect('/checkin/events'); }
    await db.query('UPDATE event_names SET archived = true, archived_at = now() WHERE id = $1', [n.id]);
    D.audit(req.user, 'event_archive', { detail: n.name });
    security.flash(req, 'ok', `${n.name} archived. Its attendance stays in Reports.`);
    res.redirect('/checkin/events');
  });

  app.post('/checkin/events/:id/restore', needRole('leader'), async (req, res) => {
    const n = await eventName(intParam(req.params.id));
    await db.query('UPDATE event_names SET archived = false, archived_at = NULL WHERE id = $1', [n.id]);
    security.flash(req, 'ok', `${n.name} is back on the check-in screen.`);
    res.redirect('/checkin/events');
  });

  app.post('/checkin/events/:id/rename', needRole('coadmin'), async (req, res) => {
    const n = await eventName(intParam(req.params.id));
    const name = clean(req.body.name, 80).replace(/\s+/g, ' ');
    if (!name || D.BUILT_IN_EVENTS.includes(n.name)) { security.flash(req, 'error', name ? 'The regular services keep their names.' : 'Give the event a name.'); return res.redirect('/checkin/events'); }
    const clash = await db.one('SELECT id FROM event_names WHERE lower(name) = lower($1) AND id <> $2', [name, n.id]);
    if (clash) { security.flash(req, 'error', `There is already an event called ${name}.`); return res.redirect('/checkin/events'); }
    await db.tx(async (c) => {
      await c.query('UPDATE event_names SET name = $2 WHERE id = $1', [n.id, name]);
      // Past dates follow the new name so reports stay together (skip a date that already has the new name).
      await c.query(`UPDATE events e SET name = $2 WHERE lower(e.name) = lower($1)
        AND NOT EXISTS (SELECT 1 FROM events x WHERE x.name = $2 AND x.event_date = e.event_date)`, [n.name, name]);
    });
    D.audit(req.user, 'event_rename', { detail: `${n.name} -> ${name}` });
    security.flash(req, 'ok', `Renamed to ${name}.`);
    res.redirect('/checkin/events');
  });

  // Remove a single date that was started by mistake (only when no one was checked in).
  app.post('/checkin/events/day/:id/delete', needRole('leader'), async (req, res) => {
    const id = intParam(req.params.id);
    const used = await db.one('SELECT count(*)::int AS n FROM attendance WHERE event_id = $1', [id]);
    if (used.n) { security.flash(req, 'error', 'People were checked in to that event, so it stays. Archive the event name instead.'); return res.redirect('/checkin/events'); }
    await db.query('DELETE FROM events WHERE id = $1', [id]);
    if (req.session.ciEvent === id) { req.session.ciEvent = null; req.session.ciEventPinned = false; }
    security.flash(req, 'ok', 'Removed.');
    res.redirect('/checkin/events');
  });

  app.get('/checkin/reports.csv', needRole('coadmin'), async (req, res) => {
    const { weekly } = await reportData(req.query);
    const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = ['Date,Event,Kids,Adults,Total', ...weekly.map((w) => [w.event_date, w.name, w.kids, w.adults, w.total].map(cell).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="central-attendance-${today()}.csv"`);
    res.send('﻿' + lines.join('\r\n') + '\r\n');
  });

  // ---------------------------------------------------------------- policies
  const POLICY_TYPES = {
    pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain',
  };

  app.get('/checkin/policies', async (req, res) => {
    if (needLogin(req, res)) return;
    const staff = D.isTeam(req.user);
    const rows = await db.many(`SELECT id, title, description, filename, mime, size, audience, requires_ack, updated_at, (body IS NOT NULL AND body <> '') AS has_body FROM policies
      ${staff ? '' : "WHERE audience = 'everyone'"} ORDER BY title`);
    const acks = new Set((await db.many('SELECT policy_id FROM policy_acks WHERE user_id = $1', [req.user.id])).map((r) => r.policy_id));
    const ackReport = {};
    if (D.can(req.user, 'coadmin')) {
      const team = await db.many(`SELECT id, first_name, last_name FROM users WHERE checkin_role IS NOT NULL`);
      const all = await db.many('SELECT policy_id, user_id FROM policy_acks');
      for (const p of rows.filter((x) => x.requires_ack)) {
        const done = new Set(all.filter((a) => a.policy_id === p.id).map((a) => a.user_id));
        ackReport[p.id] = { total: team.length, done: team.filter((u) => done.has(u.id)), missing: team.filter((u) => !done.has(u.id)).map((u) => `${u.first_name} ${u.last_name}`) };
      }
    }
    req.ciEvent = D.can(req.user, 'volunteer') ? await currentEvent(req) : null;
    render(req, res, V.policiesPage({ csrf: res.locals.csrf, user: req.user, rows, acks, ackReport }), { title: 'Policies', tab: 'policies' });
  });

  app.post('/checkin/policies', needRole('coadmin'), async (req, res) => {
    const title = clean(req.body.title, 160);
    let file = null;
    if (req.body.file_data) {
      const m = /^data:([^;,]*);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.file_data));
      const name = clean(req.body.file_name, 160).replace(/[^\w .()-]/g, '_') || 'policy';
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (!m || !POLICY_TYPES[ext]) { security.flash(req, 'error', 'Choose a PDF, Word document, picture or text file.'); return res.redirect('/checkin/policies'); }
      const data = Buffer.from(m[2], 'base64');
      if (data.length > 15 * 1024 * 1024) { security.flash(req, 'error', 'That file is over 15 MB.'); return res.redirect('/checkin/policies'); }
      file = { name, mime: POLICY_TYPES[ext], data };
    }
    const body = String(req.body.body || '').replace(/\r/g, '').trim().slice(0, 100000);
    if (!title) { security.flash(req, 'error', 'Give the policy a title.'); return res.redirect('/checkin/policies'); }
    if (!file && !body) { security.flash(req, 'error', 'Attach a file or type the policy text.'); return res.redirect('/checkin/policies'); }
    await db.query(`INSERT INTO policies (title, description, filename, mime, data, size, audience, requires_ack, created_by, body) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [title, clean(req.body.description, 300) || null, file && file.name, file && file.mime, file && file.data, file ? file.data.length : null,
        req.body.audience === 'everyone' ? 'everyone' : 'team', yes(req.body.requires_ack), req.user.id, body || null]);
    security.flash(req, 'ok', `Added “${title}”.`);
    res.redirect('/checkin/policies');
  });

  app.get('/checkin/policies/:id/file', async (req, res) => {
    if (needLogin(req, res)) return;
    const p = await db.one('SELECT * FROM policies WHERE id = $1', [intParam(req.params.id)]);
    if (!p || !p.data || (p.audience !== 'everyone' && !D.isTeam(req.user))) throw new HttpError(404, 'That document was not found.');
    res.setHeader('Content-Type', p.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${/pdf|image|text/.test(p.mime) ? 'inline' : 'attachment'}; filename="${p.filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(p.data);
  });

  app.post('/checkin/policies/:id/ack', async (req, res) => {
    if (needLogin(req, res)) return;
    if (req.body.confirm !== '1') { security.flash(req, 'error', 'Tick the box to confirm you read it.'); return res.redirect(`/checkin/policies/${intParam(req.params.id)}`); }
    await db.query('INSERT INTO policy_acks (policy_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [intParam(req.params.id), req.user.id]);
    security.flash(req, 'ok', 'Thank you. Marked as read.');
    res.redirect(req.user.checkinLocked ? '/checkin/training' : '/checkin/policies');
  });

  app.post('/checkin/policies/:id/delete', needRole('coadmin'), async (req, res) => {
    await db.query('DELETE FROM policies WHERE id = $1', [intParam(req.params.id)]);
    security.flash(req, 'ok', 'Policy deleted.');
    res.redirect('/checkin/policies');
  });

  // ---------------------------------------------------------------- serving calendar
  const SERVICE_DEFAULTS = { 3: [['Wednesday Night Service', '6:00 PM']], 7: [['Sunday School', '9:30 AM'], ["Children's Church", '10:45 AM']] };

  async function ensureMonth(year, month) {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const rows = [];
    for (let k = first; k.slice(0, 7) === first.slice(0, 7); k = t.addDaysKey(k, 1)) {
      for (const [name, time] of SERVICE_DEFAULTS[t.weekdayOfKey(k)] || []) rows.push([k, name, time]);
    }
    for (const [d, name, time] of rows) {
      await db.query('INSERT INTO serve_services (service_date, name, start_time) VALUES ($1, $2, $3) ON CONFLICT (service_date, name) DO NOTHING', [d, name, time]);
    }
  }

  app.get('/checkin/serve', needRole('volunteer'), async (req, res) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.month || '')) || /^(\d{4})-(\d{2})/.exec(today());
    const year = Number(m[1]);
    const month = Number(m[2]);
    await ensureMonth(year, month);
    const first = `${m[1]}-${m[2]}-01`;
    // Build a Sunday-first grid covering the month.
    let start = first;
    while (t.weekdayOfKey(start) !== 7) start = t.addDaysKey(start, -1);
    const weeks = [];
    let k = start;
    do {
      const week = [];
      for (let i = 0; i < 7; i++) { week.push({ key: k, n: Number(k.slice(8)), inMonth: k.slice(0, 7) === first.slice(0, 7) }); k = t.addDaysKey(k, 1); }
      weeks.push(week);
    } while (k.slice(0, 7) === first.slice(0, 7));
    const last = t.addDaysKey(k, -1);
    const services = await db.many(`SELECT s.*, s.service_date::text AS service_date,
        COALESCE((SELECT array_agg(DISTINCT area) FROM serve_slots x WHERE x.service_id = s.id), '{}') AS areas
      FROM serve_services s WHERE s.service_date BETWEEN $1 AND $2 ORDER BY s.service_date, s.start_time NULLS LAST, s.name`, [start, last]);
    for (const sv of services) { sv.areas = Array.isArray(sv.areas) ? sv.areas : String(sv.areas || '').replace(/[{}"]/g, '').split(',').filter(Boolean); sv.filled = sv.areas.length; }
    const mine = await db.many(`SELECT s.name, s.service_date::text AS service_date, x.area FROM serve_slots x JOIN serve_services s ON s.id = x.service_id
      WHERE x.user_id = $1 AND s.service_date >= $2 AND NOT s.cancelled ORDER BY s.service_date LIMIT 6`, [req.user.id, today()]);
    const prevD = new Date(Date.UTC(year, month - 2, 1));
    const nextD = new Date(Date.UTC(year, month, 1));
    const key = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 15)));
    req.ciEvent = await currentEvent(req);
    render(req, res, V.servingMonth({ csrf: res.locals.csrf, user: req.user, month: first.slice(0, 7), weeks, services, mine, prev: key(prevD), next: key(nextD), label }), { title: 'Serving calendar', tab: 'serve' });
  });

  app.get('/checkin/serve/import', needRole('coadmin'), async (req, res) => {
    render(req, res, V.servingImport({ csrf: res.locals.csrf }), { title: 'Import serving schedule', tab: 'serve' });
  });

  app.get('/checkin/serve/template.csv', needRole('coadmin'), async (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="serving-schedule-template.csv"');
    res.send('date,service,area,name,email\r\n2026-10-11,Sunday School,Nursery,Mary Smith,mary@example.com\r\n2026-10-11,Children\'s Church,Kids,John Doe,\r\n2026-10-14,Wednesday Night Service,Teens,Pastor Dave,\r\n');
  });

  app.post('/checkin/serve/import', needRole('coadmin'), async (req, res) => {
    const { parseCsvObjects } = require('../lib/csv');
    const rows = parseCsvObjects(String(req.body.csv || ''));
    const result = { added: 0, skipped: [] };
    const areas = new Map(V.AREAS.map((a) => [a.toLowerCase(), a]));
    for (let i = 0; i < rows.length && i < 3000; i++) {
      const r = rows[i];
      let date = String(r.date || '').trim();
      const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(date);
      if (us) date = `${us[3].length === 2 ? `20${us[3]}` : us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
      const area = areas.get(String(r.area || '').trim().toLowerCase()) || (/infant|baby|babies/i.test(r.area || '') ? 'Nursery' : /toddler|preschool/i.test(r.area || '') ? 'Toddlers' : /teen|youth/i.test(r.area || '') ? 'Teens' : /kid|child/i.test(r.area || '') ? 'Kids' : /adult/i.test(r.area || '') ? 'Adults' : null);
      const name = clean(r.name, 120);
      const service = clean(r.service, 80);
      if (!dateOrNull(date)) { result.skipped.push({ row: i + 2, reason: `date “${r.date}” isn't a date` }); continue; }
      if (!area) { result.skipped.push({ row: i + 2, reason: `area “${r.area}” should be Nursery, Toddlers, Kids, Teens or Adults` }); continue; }
      if (!name || !service) { result.skipped.push({ row: i + 2, reason: 'missing service or name' }); continue; }
      const sv = await db.one(`INSERT INTO serve_services (service_date, name) VALUES ($1, $2) ON CONFLICT (service_date, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [date, service]);
      const email = clean(r.email, 200).toLowerCase();
      const u = email ? await users.byEmail(email) : null;
      const dup = await db.one('SELECT id FROM serve_slots WHERE service_id = $1 AND area = $2 AND lower(name) = lower($3)', [sv.id, area, name]);
      if (dup) { result.skipped.push({ row: i + 2, reason: `${name} is already on ${area}` }); continue; }
      await db.query('INSERT INTO serve_slots (service_id, area, user_id, name, email, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [sv.id, area, u ? u.id : null, name, email || null, req.user.id]);
      result.added++;
    }
    render(req, res, V.servingImport({ csrf: res.locals.csrf, result }), { title: 'Import serving schedule', tab: 'serve' });
  });

  app.post('/checkin/serve/add', needRole('coadmin'), async (req, res) => {
    const date = dateOrNull(req.body.date);
    const name = clean(req.body.name, 80);
    if (!date || !name) { security.flash(req, 'error', 'Enter a date and a name.'); return res.redirect('/checkin/serve'); }
    const sv = await db.one(`INSERT INTO serve_services (service_date, name, start_time) VALUES ($1, $2, $3) ON CONFLICT (service_date, name) DO UPDATE SET cancelled = false, start_time = COALESCE(EXCLUDED.start_time, serve_services.start_time) RETURNING id`,
      [date, name, clean(req.body.start_time, 20) || null]);
    res.redirect(`/checkin/serve/${sv.id}`);
  });

  async function serviceById(id) {
    const sv = await db.one('SELECT *, service_date::text AS service_date FROM serve_services WHERE id = $1', [id]);
    if (!sv) throw new HttpError(404, 'That service was not found.');
    return sv;
  }

  app.get('/checkin/serve/:id', needRole('volunteer'), async (req, res) => {
    const service = await serviceById(intParam(req.params.id));
    const slots = await db.many('SELECT * FROM serve_slots WHERE service_id = $1 ORDER BY id', [service.id]);
    const team = D.can(req.user, 'coadmin') ? await db.many('SELECT first_name, last_name FROM users WHERE checkin_role IS NOT NULL ORDER BY first_name') : [];
    req.ciEvent = await currentEvent(req);
    render(req, res, V.servingDay({ csrf: res.locals.csrf, user: req.user, service, slots, team }), { title: service.name, tab: 'serve' });
  });

  app.post('/checkin/serve/:id', needRole('coadmin'), async (req, res) => {
    const id = intParam(req.params.id);
    await db.query('UPDATE serve_services SET start_time = $2, cancelled = $3 WHERE id = $1', [id, clean(req.body.start_time, 20) || null, yes(req.body.cancelled)]);
    security.flash(req, 'ok', 'Saved.');
    res.redirect(`/checkin/serve/${id}`);
  });

  app.post('/checkin/serve/:id/join', needRole('volunteer'), async (req, res) => {
    const service = await serviceById(intParam(req.params.id));
    const area = V.AREAS.includes(req.body.area) ? req.body.area : null;
    if (area && !service.cancelled) {
      const dup = await db.one('SELECT id FROM serve_slots WHERE service_id = $1 AND area = $2 AND user_id = $3', [service.id, area, req.user.id]);
      if (!dup) await db.query('INSERT INTO serve_slots (service_id, area, user_id, name, email, created_by) VALUES ($1, $2, $3, $4, $5, $3)', [service.id, area, req.user.id, `${req.user.first_name} ${req.user.last_name}`, req.user.email]);
      security.flash(req, 'ok', `Thank you! You're serving in ${area}.`);
    }
    res.redirect(`/checkin/serve/${service.id}`);
  });

  app.post('/checkin/serve/:id/assign', needRole('coadmin'), async (req, res) => {
    const service = await serviceById(intParam(req.params.id));
    const area = V.AREAS.includes(req.body.area) ? req.body.area : null;
    const who = clean(req.body.who, 120);
    if (area && who) {
      const u = await db.one(`SELECT id, email, first_name, last_name FROM users WHERE lower(first_name || ' ' || last_name) = lower($1) OR lower(email) = lower($1) LIMIT 1`, [who]);
      await db.query('INSERT INTO serve_slots (service_id, area, user_id, name, email, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [service.id, area, u ? u.id : null, u ? `${u.first_name} ${u.last_name}` : who, u ? u.email : null, req.user.id]);
    }
    res.redirect(`/checkin/serve/${service.id}`);
  });

  app.post('/checkin/serve/slots/:id/delete', needRole('volunteer'), async (req, res) => {
    const slot = await db.one('SELECT * FROM serve_slots WHERE id = $1', [intParam(req.params.id)]);
    if (!slot) throw new HttpError(404, 'Not found.');
    if (slot.user_id !== req.user.id && !D.can(req.user, 'coadmin')) throw new HttpError(403, 'You can only remove yourself.');
    await db.query('DELETE FROM serve_slots WHERE id = $1', [slot.id]);
    res.redirect(`/checkin/serve/${slot.service_id}`);
  });

  // ---------------------------------------------------------------- install help
  app.get('/checkin/install', async (req, res) => {
    render(req, res, V.installPage(), { title: 'Add to your device', tab: 'family' });
  });

  // Inbox, Settings and Automations.
  social.routes(app, { render, needLogin, needRole, currentEvent });
  // Training, required policies, incident reports and the admin dashboard.
  safety.routes(app, { render, needLogin, needRole, currentEvent });
  // Group messages.
  community.routes(app, { render, needLogin, needRole, currentEvent });
  // The Prayer Wall.
  prayer.routes(app, { render, needLogin, currentEvent });
};

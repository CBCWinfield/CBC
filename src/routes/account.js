'use strict';
const db = require('../db');
const security = require('../lib/security');
const { HttpError } = require('../lib/http');
const { checkouts } = require('../models');
const V = require('../views/account');
const notify = require('../notify');
const push = require('../lib/push');
const { requireUser, intParam, clean } = require('./guards');

module.exports = (app) => {
  app.get('/my', requireUser, async (req, res) => {
    const items = await checkouts.forUser(req.user.id);
    res.render(V.myLibrary({ user: req.user, items, s: req.settings, csrf: res.locals.csrf, pushEnabled: push.enabled() }), { title: 'My Library', current: 'my' });
  });

  app.post('/my/preferences', requireUser, async (req, res) => {
    await db.query('UPDATE users SET notify_email = $2 WHERE id = $1', [req.user.id, req.body.notify_email === '1']);
    security.flash(req, 'ok', 'Reminder settings saved.');
    res.redirect('/my');
  });

  app.post('/my/details', requireUser, async (req, res) => {
    const v = ['phone', 'address', 'city', 'state', 'zip'].map((k) => clean(req.body[k], 120) || null);
    await db.query('UPDATE users SET phone = $2, address = $3, city = $4, state = $5, zip = $6 WHERE id = $1', [req.user.id, ...v]);
    security.flash(req, 'ok', 'Your details are saved.');
    res.redirect('/my');
  });

  app.post('/my/password', requireUser, security.rateLimit('pwchange', { max: 10, windowMs: 3600000 }), async (req, res) => {
    const row = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!await security.verifyPassword(String(req.body.current || ''), row.password_hash)) {
      security.flash(req, 'error', 'Your current password isn’t right. Nothing was changed.');
      return res.redirect('/my');
    }
    const pw = String(req.body.password || '');
    if (pw.length < 8) {
      security.flash(req, 'error', 'Your new password needs at least 8 characters.');
      return res.redirect('/my');
    }
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await security.hashPassword(pw)]);
    security.flash(req, 'ok', 'Password changed.');
    res.redirect('/my');
  });

  app.post('/my/checkouts/:id/cancel', requireUser, async (req, res) => {
    const c = await db.one("UPDATE checkouts SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Cancelled by patron' WHERE id = $1 AND user_id = $2 AND status = 'reserved' RETURNING id", [intParam(req.params.id), req.user.id]);
    security.flash(req, c ? 'ok' : 'error', c ? 'Hold cancelled.' : 'That hold couldn’t be cancelled. It may already be picked up.');
    res.redirect('/my');
  });

  app.get('/my/pickup/:id/calendar.ics', requireUser, async (req, res) => {
    const c = await checkouts.get(intParam(req.params.id));
    if (!c || c.user_id !== req.user.id || c.status !== 'reserved') throw new HttpError(404, 'That pickup wasn’t found.');
    const same = await db.many(`SELECT c.*, b.title FROM checkouts c JOIN books b ON b.id = c.book_id WHERE c.user_id = $1 AND c.status = 'reserved' AND c.pickup_at = $2`, [req.user.id, c.pickup_at]);
    const file = notify.calendarFile(same.map((x) => ({ ...x, library_code: req.user.library_code })), req.settings);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="library-pickup.ics"');
    res.send(file.content);
  });

  // ---- Phone / browser notifications ----
  app.get('/api/push/key', requireUser, async (req, res) => res.json({ key: push.enabled() ? push.publicKey() : null }));

  app.post('/api/push/subscribe', requireUser, async (req, res) => {
    const sub = req.body || {};
    const endpoint = clean(sub.endpoint, 1000);
    const keys = sub.keys || {};
    if (!/^https:\/\//.test(endpoint) || !keys.p256dh || !keys.auth) throw new HttpError(400, 'Invalid subscription.');
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [req.user.id, endpoint, clean(keys.p256dh, 200), clean(keys.auth, 100)],
    );
    await notify.pushTo([req.user.id], { title: 'Notifications are on', body: 'You’ll get library reminders here.', url: '/my' });
    res.json({ ok: true });
  });

  app.post('/api/push/unsubscribe', requireUser, async (req, res) => {
    await db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [req.user.id, clean(req.body.endpoint, 1000)]);
    res.json({ ok: true });
  });
};

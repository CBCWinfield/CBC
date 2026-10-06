'use strict';
// Background reminders, checked every 15 minutes while the app is running.
// Messages only go out between 8 AM and 8 PM library time.
const db = require('./db');
const notify = require('./notify');
const t = require('./lib/time');
const { users } = require('./models');

async function run(now = new Date()) {
  const hour = t.parts(now).hour;
  if (hour < 8 || hour >= 20) return { skipped: 'quiet hours' };
  const sent = { pickup: 0, dueSoon: 0, overdue: 0 };

  // 1. Pickup reminders: reservations whose pickup is tomorrow (library time).
  const tomorrow = t.addDaysKey(t.dateKey(now), 1);
  const { year, month, day } = t.parseKey(tomorrow);
  const from = t.zoned(year, month, day, 0, 0);
  const to = t.zoned(...Object.values(t.parseKey(t.addDaysKey(tomorrow, 1))), 0, 0);
  const pickups = await db.many(
    `SELECT c.*, b.title FROM checkouts c JOIN books b ON b.id = c.book_id
     WHERE c.status = 'reserved' AND NOT c.pickup_reminder_sent AND c.pickup_at >= $1 AND c.pickup_at < $2
     ORDER BY c.user_id, c.pickup_at`, [from, to]);
  const byUser = new Map();
  for (const c of pickups) (byUser.get(c.user_id) || byUser.set(c.user_id, []).get(c.user_id)).push(c);
  for (const [userId, items] of byUser) {
    const user = await users.get(userId);
    await db.query('UPDATE checkouts SET pickup_reminder_sent = true WHERE id = ANY($1::int[])', [items.map((c) => c.id)]);
    await notify.pickupReminder(user, items);
    sent.pickup++;
  }

  // 2. Due soon: due within the next 2 days.
  const dueSoon = await db.many(
    `SELECT c.*, b.title FROM checkouts c JOIN books b ON b.id = c.book_id
     WHERE c.status = 'checked_out' AND NOT c.due_reminder_sent AND c.due_at > $1 AND c.due_at <= $1::timestamptz + interval '2 days'`, [now]);
  for (const co of dueSoon) {
    await db.query('UPDATE checkouts SET due_reminder_sent = true WHERE id = $1', [co.id]);
    await notify.dueSoon(await users.get(co.user_id), co);
    sent.dueSoon++;
  }

  // 3. Overdue: once when it becomes overdue, then weekly.
  const overdue = await db.many(
    `SELECT c.*, b.title FROM checkouts c JOIN books b ON b.id = c.book_id
     WHERE c.status = 'checked_out' AND c.due_at < $1
       AND (c.last_overdue_notice_at IS NULL OR c.last_overdue_notice_at < $1::timestamptz - interval '7 days')`, [now]);
  for (const co of overdue) {
    await db.query('UPDATE checkouts SET last_overdue_notice_at = $2 WHERE id = $1', [co.id, now]);
    await notify.overdue(await users.get(co.user_id), co);
    sent.overdue++;
  }

  // Housekeeping: expired sessions.
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  return sent;
}

function start() {
  const tick = () => run().catch((err) => console.error('Reminder run failed:', err.message));
  setTimeout(tick, 30 * 1000).unref();
  setInterval(tick, 15 * 60 * 1000).unref();
}

module.exports = { run, start };

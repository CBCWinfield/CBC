'use strict';
// Anyone still checked in 6 hours after their service started is checked out automatically,
// so forgotten check-outs don't pile up on the roster or skew "here now" counts.
const db = require('../db');
const t = require('../lib/time');

const HOURS = 6;
const DEFAULT_START = { 'Sunday School': '9:30 AM', "Children's Church": '10:45 AM', 'Wednesday Night Service': '6:00 PM' };

// "6:00 PM" -> [18, 0]
function parseTime(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]?\.?$/.exec(String(s || '').trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/p/i.test(m[3])) h += 12;
  return [h, Number(m[2] || 0)];
}

// When the event started: the serving calendar's time, the usual service time, or the first check-in.
async function startOf(event) {
  const date = String(event.event_date).slice(0, 10);
  const svc = await db.one('SELECT start_time FROM serve_services WHERE service_date = $1 AND lower(name) = lower($2)', [date, event.name]);
  const hm = parseTime(svc && svc.start_time) || parseTime(DEFAULT_START[event.name]);
  if (hm) return t.zoned(...date.split('-').map(Number), hm[0], hm[1]);
  const first = await db.one('SELECT min(checked_in_at) AS at FROM attendance WHERE event_id = $1', [event.id]);
  return first && first.at ? new Date(first.at) : null;
}

async function run(now = new Date()) {
  const events = await db.many(`SELECT DISTINCT e.* FROM events e JOIN attendance a ON a.event_id = e.id WHERE a.checked_out_at IS NULL`);
  let total = 0;
  for (const e of events) {
    const start = await startOf(e);
    if (!start || now.getTime() < start.getTime() + HOURS * 3600000) continue;
    const r = await db.many(`UPDATE attendance SET checked_out_at = now(), checked_out_to = 'Automatic check-out (${HOURS} hours after start)'
      WHERE event_id = $1 AND checked_out_at IS NULL RETURNING id`, [e.id]);
    total += r.length;
  }
  return total;
}

function start() {
  const tick = () => run().then((n) => { if (n) console.log(`Automatic check-out: ${n}`); }).catch((err) => console.error('Automatic check-out failed:', err.message));
  setTimeout(tick, 45 * 1000).unref();
  setInterval(tick, 15 * 60 * 1000).unref();
}

module.exports = { run, start, parseTime, startOf, HOURS };

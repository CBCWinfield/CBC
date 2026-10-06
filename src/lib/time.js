'use strict';
// Time-zone aware helpers using only Intl. All library times are in the
// library's local time zone (America/Chicago by default).

const TZ = process.env.LIBRARY_TIMEZONE || 'America/Chicago';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});
const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function parts(date) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(date)) p[type] = value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    weekday: WD[p.weekday], // ISO: Mon=1 ... Sun=7
  };
}

// Offset (ms) between local wall time and UTC at instant ts.
function offsetAt(ts) {
  const p = parts(new Date(ts));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

// Convert a local wall-clock time to a Date.
function zoned(year, month, day, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ts = guess - offsetAt(guess);
  ts = guess - offsetAt(ts);
  return new Date(ts);
}

const pad = (n) => String(n).padStart(2, '0');
function dateKey(date) {
  const p = parts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m, day: d };
}
function addDaysKey(key, n) {
  const { year, month, day } = parseKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function weekdayOfKey(key) {
  const { year, month, day } = parseKey(key);
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return wd === 0 ? 7 : wd;
}
// Whole local days between two instants (b - a), by calendar date.
function daysBetween(a, b) {
  const ka = parseKey(dateKey(a)), kb = parseKey(dateKey(b));
  return Math.round((Date.UTC(kb.year, kb.month - 1, kb.day) - Date.UTC(ka.year, ka.month - 1, ka.day)) / 86400000);
}
// End of the local day N days after the given date (due dates end at 11:59 PM).
function endOfLocalDay(date, plusDays = 0) {
  const key = addDaysKey(dateKey(date), plusDays);
  const { year, month, day } = parseKey(key);
  return new Date(zoned(year, month, day, 23, 59).getTime() + 59000);
}

const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts });
const F = {
  date: fmt({ weekday: 'short', month: 'short', day: 'numeric' }),
  dateYear: fmt({ month: 'short', day: 'numeric', year: 'numeric' }),
  long: fmt({ weekday: 'long', month: 'long', day: 'numeric' }),
  time: fmt({ hour: 'numeric', minute: '2-digit' }),
};
const toDate = (d) => (d instanceof Date ? d : new Date(d));
const fmtDate = (d) => (d ? F.date.format(toDate(d)) : '');
const fmtDateYear = (d) => (d ? F.dateYear.format(toDate(d)) : '');
const fmtLong = (d) => (d ? F.long.format(toDate(d)) : '');
const fmtTime = (d) => (d ? F.time.format(toDate(d)) : '');
const fmtDateTime = (d) => (d ? `${fmtDate(d)} at ${fmtTime(d)}` : '');

// "09:30" -> {h, m}
function hm(s) {
  const [h, m] = String(s || '0:0').split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}
function fmtHm(s) {
  const { h, m } = hm(s);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${pad(m)} ${ap}` : `${h12} ${ap}`;
}

module.exports = {
  TZ, parts, zoned, dateKey, parseKey, addDaysKey, weekdayOfKey, daysBetween, endOfLocalDay,
  fmtDate, fmtDateYear, fmtLong, fmtTime, fmtDateTime, hm, fmtHm, pad,
};

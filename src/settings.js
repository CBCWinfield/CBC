'use strict';
// Library-wide settings. Defaults live here; the librarian's changes are stored
// in the settings table and cached in memory.
const db = require('./db');

const DEFAULTS = {
  library_name: 'Central Baptist Church Public Christian Library',
  short_name: 'CBC Library',
  church_name: 'Central Baptist Church',
  welcome_message: 'Borrow Christian books, Bibles, devotionals and family reading at no cost. Apply for a free library account, reserve books online, and pick them up during library hours.',
  library_address: '904 Wheat Rd, Winfield, KS 67156',
  contact_phone: '(620) 221-2980',
  contact_email: 'centralbaptistchurchcalendar@gmail.com',
  checkout_days: 14,
  max_books: 3,
  max_extensions: 1,
  auto_approve: false,
  pickup_days: [1, 2, 3, 4], // ISO weekdays: Mon=1 … Sun=7
  pickup_start: '09:00',
  pickup_end: '13:00',
  slot_minutes: 15,
  slot_capacity: 2,
  booking_window_days: 14,
  min_lead_minutes: 60,
  closed_dates: [],
  missed_pickup_days: 3,
};

let cache = null;

async function load() {
  const rows = await db.many('SELECT key, value FROM settings');
  const stored = {};
  for (const r of rows) stored[r.key] = r.value;
  cache = { ...DEFAULTS, ...stored };
  return cache;
}

async function get() {
  return cache || load();
}

async function set(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in DEFAULTS)) continue;
    await db.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, JSON.stringify(value)],
    );
  }
  return load();
}

const DAY_NAMES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };
const SHORT_DAYS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

// "Monday–Thursday" for a run of consecutive days, otherwise "Mon, Wed, Fri".
function describeDays(days) {
  const d = [...days].map(Number).sort((a, b) => a - b);
  if (!d.length) return 'no days set';
  if (d.length === 1) return DAY_NAMES[d[0]];
  const consecutive = d.every((v, i) => i === 0 || v === d[i - 1] + 1);
  if (consecutive && d.length > 2) return `${DAY_NAMES[d[0]]}–${DAY_NAMES[d[d.length - 1]]}`;
  return d.map((x) => SHORT_DAYS[x]).join(', ');
}

module.exports = { DEFAULTS, get, set, load, describeDays, DAY_NAMES, SHORT_DAYS };

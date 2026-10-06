'use strict';
// Pickup slot generation (e.g. Mon–Thu, 9 AM–1 PM, every 15 minutes).
const t = require('./time');

// taken: Map(isoString -> number of different patrons already booked)
// mine:  Set(isoString) of slots this patron has already booked
function buildSlots(settings, now = new Date(), taken = new Map(), mine = new Set()) {
  const days = [];
  const start = t.hm(settings.pickup_start);
  const end = t.hm(settings.pickup_end);
  const step = Math.max(5, Number(settings.slot_minutes) || 15);
  const capacity = Math.max(1, Number(settings.slot_capacity) || 1);
  const pickupDays = (settings.pickup_days || []).map(Number);
  const closed = new Set(settings.closed_dates || []);
  const earliest = now.getTime() + (Number(settings.min_lead_minutes) || 0) * 60000;
  const todayKey = t.dateKey(now);

  for (let i = 0; i <= Number(settings.booking_window_days || 14); i++) {
    const key = t.addDaysKey(todayKey, i);
    if (!pickupDays.includes(t.weekdayOfKey(key)) || closed.has(key)) continue;
    const { year, month, day } = t.parseKey(key);
    const slots = [];
    for (let m = start.h * 60 + start.m; m + step <= end.h * 60 + end.m; m += step) {
      const at = t.zoned(year, month, day, Math.floor(m / 60), m % 60);
      if (at.getTime() < earliest) continue;
      const iso = at.toISOString();
      const isMine = mine.has(iso);
      const remaining = capacity - (taken.get(iso) || 0);
      slots.push({ iso, label: t.fmtTime(at), remaining: Math.max(0, remaining), mine: isMine, open: isMine || remaining > 0 });
    }
    if (slots.length) days.push({ key, label: t.fmtLong(t.zoned(year, month, day, 12)), slots });
  }
  return days;
}

function findSlot(days, iso) {
  for (const d of days) for (const s of d.slots) if (s.iso === iso) return s;
  return null;
}

module.exports = { buildSlots, findSlot };

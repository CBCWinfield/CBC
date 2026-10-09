'use strict';
// Which homepage banner shows, by the calendar (Central time):
//   Oct 27 – Nov 27   fall       leaves falling
//   Nov 28 – Nov 30   winter     snow
//   December          christmas  snow, and the Christmas story plays in place of the cross
//   Jan 1 – Mar 14    winter     snow
//   Mar 15 – May 1    easter     the wheat, and the crucifixion and resurrection play in place of the cross
//   May 2 – Oct 26    wheat      the swaying wheat field
// SITE_SEASON can pin one (wheat, fall, winter, christmas, easter); "auto" or unset follows the calendar.
// Anyone can preview a banner with ?season=fall (or winter, christmas, easter, wheat).

const SEASONS = ['wheat', 'fall', 'winter', 'christmas', 'easter'];

function byCalendar(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const m = Number(parts.find((p) => p.type === 'month').value);
  const d = Number(parts.find((p) => p.type === 'day').value);
  const md = m * 100 + d;
  if (md >= 1027 && md <= 1127) return 'fall';
  if (md >= 1128 && md <= 1130) return 'winter';
  if (m === 12) return 'christmas';
  if (md <= 314) return 'winter';
  if (md >= 315 && md <= 501) return 'easter';
  return 'wheat';
}

function seasonFor(query = {}, env = process.env, now = new Date()) {
  const asked = String(query.season || '').toLowerCase();
  if (SEASONS.includes(asked)) return asked;
  const set = String(env.SITE_SEASON || 'auto').toLowerCase();
  if (SEASONS.includes(set)) return set;
  return byCalendar(now);
}

module.exports = { SEASONS, byCalendar, seasonFor };

'use strict';
// Which homepage banner shows (fall, winter, christmas, easter, wheat), by the Central-time calendar in README.md.
// SITE_SEASON pins one ("auto" or unset follows the calendar); ?season=<name> previews one.

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

// How the Christmas and Easter stories are shown: in an arched window where the cross stands ("window"),
// or across the green banner as a landscape of hills ("pano"). SITE_STORY_STYLE picks; ?story= previews.
const STYLES = ['window', 'pano'];
function styleFor(query = {}, env = process.env) {
  const asked = String(query.story || '').toLowerCase();
  if (STYLES.includes(asked)) return asked;
  const set = String(env.SITE_STORY_STYLE || '').toLowerCase();
  return STYLES.includes(set) ? set : 'window';
}

module.exports = { SEASONS, byCalendar, seasonFor, styleFor };

'use strict';
// Each person's notification and privacy settings. Stored as JSON on users.prefs;
// anything not saved yet uses these defaults.
const db = require('../db');

const NOTIFY = [
  { key: 'email_checkin', label: 'Email me when my children are checked in', group: 'Check-in', def: true },
  { key: 'push_checkin', label: 'App notification when my children are checked in', group: 'Check-in', def: true },
  { key: 'email_pickup', label: 'Email me when my children are picked up', group: 'Check-in', def: true },
  { key: 'push_pickup', label: 'App notification when my children are picked up', group: 'Check-in', def: true },
  { key: 'email_messages', label: 'Email me about new messages I haven’t read', group: 'Inbox', def: true },
  { key: 'push_messages', label: 'App notification for new messages', group: 'Inbox', def: true },
  { key: 'push_prayer', label: 'App notification when someone prays for or comments on my prayer request', group: 'Prayer wall', def: true },
  { key: 'email_greetings', label: 'Birthday, anniversary, Christmas and Easter greetings from the church', group: 'Church', def: true },
  { key: 'email_library', label: 'Library emails: pickup times, due dates and reminders', group: 'Church', def: true },
];

const PRIVACY = [
  { key: 'directory', label: 'List me in the church directory so families can find me and message me', def: true },
  { key: 'show_phone', label: 'Show my phone number to other families in the directory', def: false },
  { key: 'show_email', label: 'Show my email address to other families in the directory', def: false },
  { key: 'show_kids', label: 'Show my children’s first names next to my name in the directory', def: false },
];

const MESSAGES_FROM = [['everyone', 'Anyone at church'], ['team', 'Only the church team (staff and volunteers)']];

const DEFAULTS = Object.fromEntries([...NOTIFY, ...PRIVACY].map((x) => [x.key, x.def]).concat([['messages_from', 'everyone']]));

function parse(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') { try { return JSON.parse(raw) || {}; } catch { return {}; } }
  return raw;
}

// Settings for a user row (or a bare prefs value).
function of(userOrPrefs) {
  const raw = userOrPrefs && Object.prototype.hasOwnProperty.call(userOrPrefs, 'prefs') ? userOrPrefs.prefs : userOrPrefs;
  return { ...DEFAULTS, ...parse(raw) };
}

const wants = (user, key) => {
  if (!user) return false;
  if (key.startsWith('email_') && user.notify_email === false) return false; // the library's older on/off switch
  return of(user)[key] !== false;
};

async function save(userId, values) {
  const clean = {};
  for (const x of [...NOTIFY, ...PRIVACY]) clean[x.key] = Boolean(values[x.key]);
  clean.messages_from = MESSAGES_FROM.some(([k]) => k === values.messages_from) ? values.messages_from : 'everyone';
  await db.query('UPDATE users SET prefs = $2::jsonb, notify_email = $3 WHERE id = $1', [userId, JSON.stringify(clean), Object.entries(clean).some(([k, v]) => k.startsWith('email_') && v)]);
  return clean;
}

module.exports = { NOTIFY, PRIVACY, MESSAGES_FROM, DEFAULTS, of, wants, save };

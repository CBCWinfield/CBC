'use strict';
// Check-in emails and app notifications to parents and guardians.
const db = require('../db');
const mailer = require('../lib/mailer');
const { pushTo, url } = require('../notify');
const { esc } = require('../lib/html');
const t = require('../lib/time');

const prefs = require('./prefs');
const A = require('./automations');

const CHURCH = 'Central Baptist Church';
const FOOTER = A.FOOTER;

const safe = (fn) => async (...args) => {
  try { await fn(...args); } catch (err) { console.error('Check-in notice failed:', err.message); }
};

// Adults in the family who should hear about their kids (have an email or an app login).
const guardians = (familyId) => db.many(
  `SELECT p.*, u.notify_email, u.prefs FROM people p LEFT JOIN users u ON u.id = p.user_id
   WHERE p.family_id = $1 AND p.kind = 'adult' AND p.active ORDER BY p.is_primary DESC, p.id`, [familyId],
);

const list = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// Emails the parents who want this kind of notice; returns the app users who want the push version.
async function emailGuardians(familyId, msg, kind) {
  const adults = await guardians(familyId);
  const to = [...new Set(adults.filter((a) => a.email && (!a.user_id ? true : prefs.wants(a, `email_${kind}`))).map((a) => a.email))];
  if (to.length) await mailer.send({ to, libraryName: CHURCH, footer: FOOTER, ...msg });
  return adults.filter((a) => a.user_id && prefs.of(a)[`push_${kind}`] !== false).map((a) => a.user_id);
}

module.exports = {
  checkedIn: safe(async ({ familyId, kids, event, at }) => {
    if (!kids.length || !(await A.enabled('checkin_notice'))) return;
    const names = kids.map((k) => k.preferred_name || k.first_name);
    const when = t.fmtTime(at);
    const userIds = await emailGuardians(familyId, {
      subject: `${list(names)} checked in at Central Baptist Church`,
      heading: `${list(names)} ${names.length > 1 ? 'are' : 'is'} checked in`,
      paragraphs: [
        `${esc(list(names))} checked in to <strong>${esc(event.name)}</strong> at ${CHURCH} at ${esc(when)}.`,
        'Keep your pickup tag. You’ll need it to pick up at the end of the service.',
      ],
      button: { label: 'Open the check-in app', url: url('/checkin/family') },
    }, 'checkin');
    await pushTo(userIds, { title: 'Checked in at Central', body: `${list(names)} checked in to ${event.name} at ${when}.`, url: '/checkin/family' });
  }),

  checkedOut: safe(async ({ familyId, kids, event, at, to }) => {
    if (!kids.length || !(await A.enabled('pickup_notice'))) return;
    const names = kids.map((k) => k.preferred_name || k.first_name);
    const userIds = await emailGuardians(familyId, {
      subject: `${list(names)} picked up from Central Baptist Church`,
      heading: `${list(names)} ${names.length > 1 ? 'have' : 'has'} been picked up`,
      paragraphs: [`${esc(list(names))} checked out of <strong>${esc(event.name)}</strong> at ${esc(t.fmtTime(at))}${to ? ` with ${esc(to)}` : ''}.`],
    }, 'pickup');
    await pushTo(userIds, { title: 'Picked up', body: `${list(names)} checked out of ${event.name}.`, url: '/checkin/family' });
  }),

  invite: safe(async ({ email, link, familyName, invitedBy }) => {
    await mailer.send({
      to: email,
      libraryName: CHURCH,
      footer: FOOTER,
      subject: 'Set up your family for check-in at Central Baptist Church',
      heading: 'Welcome to Central',
      paragraphs: [
        `${invitedBy ? esc(invitedBy) + ' invited you' : 'You’re invited'} to set up ${familyName ? `the ${esc(familyName)}` : 'your family'} for check-in at ${CHURCH}.`,
        'It takes about five minutes: add your children, their allergies or medical needs, emergency contacts and who may pick them up, then sign the Central Kids and Central Teens permission forms.',
        'After that, checking in on Sunday or Wednesday takes just a few seconds, and you’ll get a message when your kids are checked in.',
      ],
      button: { label: 'Set up my family', url: link },
    });
  }),

  welcome: safe(async ({ user, familyName }) => {
    await mailer.send({
      to: user.email,
      libraryName: CHURCH,
      footer: FOOTER,
      subject: 'Your family is set up for check-in',
      heading: `Thank you, ${user.first_name}`,
      paragraphs: [
        `${esc(familyName)} is ready for check-in at ${CHURCH}.`,
        'Add the Central app to your phone’s home screen to get check-in notices and messages from the children’s ministry.',
      ],
      button: { label: 'Open my family', url: url('/checkin/family') },
    });
  }),
};

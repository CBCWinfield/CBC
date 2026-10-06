'use strict';
// Every notice the library sends: emails (Resend), calendar files and
// optional phone/browser notifications (Web Push).
const db = require('./db');
const mailer = require('./lib/mailer');
const push = require('./lib/push');
const ics = require('./lib/ics');
const settingsStore = require('./settings');
const { users, fullName } = require('./models');
const t = require('./lib/time');
const { esc } = require('./lib/html');

const BASE_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const url = (p) => BASE_URL + p;

async function pushTo(userIds, message) {
  if (!push.enabled() || !userIds.length) return;
  const subs = await db.many('SELECT * FROM push_subscriptions WHERE user_id = ANY($1::int[])', [userIds]);
  await Promise.all(subs.map(async (s) => {
    const r = await push.sendPush(s, message);
    if (r === 'gone') await db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
  }));
}

async function email(user, msg) {
  const s = await settingsStore.get();
  if (!user || !user.email || user.notify_email === false) return;
  const contact = [s.contact_phone, s.contact_email].filter(Boolean).map(esc).join(' · ');
  await mailer.send({
    to: user.email,
    libraryName: s.library_name,
    footer: `${esc(s.library_name)}${s.library_address ? '<br>' + esc(s.library_address) : ''}${contact ? '<br>' + contact : ''}`,
    ...msg,
  });
}

async function staffAlert({ subject, heading, paragraphs, button, push: pushMsg, roles = ['librarian'] }) {
  const s = await settingsStore.get();
  const to = await users.staffEmails(roles);
  if (to.length) {
    await mailer.send({ to, subject, heading, paragraphs, button, libraryName: s.library_name });
  }
  if (pushMsg) await pushTo(await users.staffIds(roles), pushMsg);
}

function calendarFile(checkouts, s) {
  const first = checkouts[0];
  const titles = checkouts.map((c) => `• ${c.title}`).join('\n');
  return {
    filename: 'library-pickup.ics',
    content: ics.pickupEvent({
      uid: `pickup-${first.user_id}-${new Date(first.pickup_at).getTime()}`,
      start: first.pickup_at,
      minutes: Number(s.slot_minutes) || 15,
      title: `Pick up library books (${s.short_name})`,
      description: `Books to pick up:\n${titles}\n\nBring your library code: ${first.library_code || ''}`,
      location: s.library_address || s.church_name,
      host: new URL(BASE_URL).hostname,
    }),
  };
}

const safe = (fn) => async (...args) => {
  try { await fn(...args); } catch (err) { console.error('Notification failed:', err.message); }
};

module.exports = {
  BASE_URL,
  url,
  calendarFile,
  pushTo,

  applicationReceived: safe(async (user) => {
    const s = await settingsStore.get();
    await email(user, {
      subject: 'We received your library application',
      heading: `Thank you, ${user.first_name}`,
      paragraphs: [
        `Your application for the ${esc(s.library_name)} has been received.`,
        'The librarian will review it soon. You will get another email with your library code once you are approved.',
      ],
    });
    await staffAlert({
      subject: `New library application: ${fullName(user)}`,
      heading: 'New library application',
      paragraphs: [
        `<strong>${esc(fullName(user))}</strong> (${esc(user.email)}) applied for a library account.`,
        user.about ? `They wrote: “${esc(user.about)}”` : '',
      ],
      button: { label: 'Review applications', url: url('/admin/applications') },
      push: { title: 'New library application', body: `${fullName(user)} applied for an account.`, url: '/admin/applications' },
    });
  }),

  approved: safe(async (user) => {
    const s = await settingsStore.get();
    await email(user, {
      subject: `You're approved. Your library code is ${user.library_code}`,
      heading: 'Welcome to the library',
      paragraphs: [
        `Hi ${esc(user.first_name)}, your library account is approved.`,
        `Your library code is <strong style="font-size:20px;letter-spacing:1px">${esc(user.library_code)}</strong>. You'll enter it each time you check out a book. It's also on your My Library page.`,
        `Books are picked up ${esc(settingsStore.describeDays(s.pickup_days))}, ${t.fmtHm(s.pickup_start)}–${t.fmtHm(s.pickup_end)}. You can keep them for ${s.checkout_days} days.`,
      ],
      button: { label: 'Browse the catalog', url: url('/catalog') },
    });
    await pushTo([user.id], { title: 'You’re approved', body: `Your library code is ${user.library_code}.`, url: '/my' });
  }),

  denied: safe(async (user) => {
    const s = await settingsStore.get();
    await email(user, {
      subject: 'About your library application',
      heading: `Hi ${user.first_name}`,
      paragraphs: [
        `Thank you for your interest in the ${esc(s.library_name)}. We weren't able to approve your application at this time.`,
        'If you have questions, please contact the church office.',
      ],
    });
  }),

  paused: safe(async (user) => {
    await email(user, {
      subject: 'Your library account is paused',
      heading: `Hi ${user.first_name}`,
      paragraphs: ['Your library account has been paused, so new checkouts are turned off for now. Books you already have are still listed on your My Library page.', 'Please contact the librarian with any questions.'],
    });
  }),

  reserved: safe(async (user, items) => {
    const s = await settingsStore.get();
    const when = t.fmtLong(items[0].pickup_at) + ' at ' + t.fmtTime(items[0].pickup_at);
    const list = items.map((c) => `“${esc(c.title)}”`).join(', ');
    await email(user, {
      subject: `Pickup confirmed for ${t.fmtDate(items[0].pickup_at)} at ${t.fmtTime(items[0].pickup_at)}`,
      heading: 'Your books are on hold',
      paragraphs: [
        `We're holding ${list} for you.`,
        `<strong>Pickup:</strong> ${esc(when)}${s.library_address ? `<br><strong>Where:</strong> ${esc(s.library_address)}` : ''}`,
        `Bring your library code: <strong>${esc(user.library_code)}</strong>. The calendar file attached adds this to your phone's calendar.`,
        `If you don't pick up within ${s.missed_pickup_days} days, the hold may be released for someone else.`,
      ],
      button: { label: 'View My Library', url: url('/my') },
      attachments: [calendarFile(items.map((c) => ({ ...c, user_id: user.id, library_code: user.library_code })), s)],
    });
    await staffAlert({
      roles: ['librarian', 'assistant'],
      subject: `New pickup: ${fullName(user)}, ${t.fmtDateTime(items[0].pickup_at)}`,
      heading: 'New book reservation',
      paragraphs: [`<strong>${esc(fullName(user))}</strong> reserved ${list} for pickup ${esc(when)}.`],
      button: { label: 'See pickups', url: url('/admin/checkouts') },
      push: { title: 'New pickup scheduled', body: `${fullName(user)} · ${t.fmtDateTime(items[0].pickup_at)}`, url: '/admin/checkouts' },
    });
  }),

  pickupReminder: safe(async (user, items) => {
    const list = items.map((c) => `“${esc(c.title)}”`).join(', ');
    const when = `${t.fmtLong(items[0].pickup_at)} at ${t.fmtTime(items[0].pickup_at)}`;
    await email(user, {
      subject: `Reminder: pick up your books ${t.fmtDate(items[0].pickup_at)} at ${t.fmtTime(items[0].pickup_at)}`,
      heading: 'Your pickup is coming up',
      paragraphs: [`${list} ${items.length > 1 ? 'are' : 'is'} waiting for you.`, `<strong>Pickup:</strong> ${esc(when)}`, `Bring your library code: <strong>${esc(user.library_code)}</strong>`],
      button: { label: 'View My Library', url: url('/my') },
    });
    await pushTo([user.id], { title: 'Pickup tomorrow', body: `${items.length} book${items.length > 1 ? 's' : ''} · ${t.fmtTime(items[0].pickup_at)}`, url: '/my' });
  }),

  pickedUp: safe(async (user, co) => {
    await email(user, {
      subject: `“${co.title}” is due ${t.fmtDate(co.due_at)}`,
      heading: 'Enjoy your book',
      paragraphs: [`You checked out “${esc(co.title)}”.`, `<strong>Due:</strong> ${esc(t.fmtLong(co.due_at))}`],
      button: { label: 'View My Library', url: url('/my') },
    });
  }),

  dueSoon: safe(async (user, co) => {
    await email(user, {
      subject: `“${co.title}” is due ${t.fmtDate(co.due_at)}`,
      heading: 'A book is due soon',
      paragraphs: [`“${esc(co.title)}” is due back <strong>${esc(t.fmtLong(co.due_at))}</strong>.`, 'Need more time? Reply to this email or ask the librarian about an extension.'],
      button: { label: 'View My Library', url: url('/my') },
    });
    await pushTo([user.id], { title: 'Book due soon', body: `“${co.title}” is due ${t.fmtDate(co.due_at)}.`, url: '/my' });
  }),

  overdue: safe(async (user, co) => {
    const days = t.daysBetween(co.due_at, new Date());
    await email(user, {
      subject: `“${co.title}” is overdue`,
      heading: 'A book is overdue',
      paragraphs: [`“${esc(co.title)}” was due ${esc(t.fmtLong(co.due_at))} (${days} day${days === 1 ? '' : 's'} ago).`, 'Please bring it back during library hours, or contact the librarian if you need more time.'],
      button: { label: 'View My Library', url: url('/my') },
    });
    await pushTo([user.id], { title: 'Book overdue', body: `“${co.title}” was due ${t.fmtDate(co.due_at)}.`, url: '/my' });
  }),

  cancelledByLibrary: safe(async (user, co, reason) => {
    await email(user, {
      subject: `Your hold on “${co.title}” was cancelled`,
      heading: 'A hold was cancelled',
      paragraphs: [`The librarian cancelled your hold on “${esc(co.title)}”.`, reason ? `Note: ${esc(reason)}` : '', 'You can reserve it again from the catalog.'],
      button: { label: 'Browse the catalog', url: url('/catalog') },
    });
  }),

  passwordReset: safe(async (user, link) => {
    await email({ ...user, notify_email: true }, {
      subject: 'Reset your library password',
      heading: 'Reset your password',
      paragraphs: ['Someone asked to reset the password for your library account. If that was you, use the button below. The link works for 1 hour.', 'If you didn’t ask for this, you can ignore this email.'],
      button: { label: 'Choose a new password', url: link },
    });
  }),
};

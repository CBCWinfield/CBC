'use strict';
// Every morning the site checks itself (src/lib/site-check.js) and emails the people below when a page or a
// sermon video is broken, so nobody has to find out from a visitor. No outside service is involved.
//   SITE_CHECK_EMAIL  who gets the email (comma-separated); defaults to ADMIN_EMAIL
//   SITE_URL          the public address to check; defaults to https://www.cbcwinfield.org
//   DISABLE_SITE_CHECK=1 turns it off
const t = require('./lib/time');
const mailer = require('./lib/mailer');
const { check } = require('./lib/site-check');
const { logOnce } = require('./checkin/automations');

const BASE = process.env.SITE_URL || 'https://www.cbcwinfield.org';
const HOUR = 7; // after 7 AM church time, once a day
let last = null; // the latest result, for the admin page and /healthz/site-check

const recipients = () => String(process.env.SITE_CHECK_EMAIL || process.env.ADMIN_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);

async function run({ force = false, now = new Date() } = {}) {
  if (!force) {
    if (t.parts(now).hour < HOUR) return null;
    if (!(await logOnce('site_check', t.dateKey(now)))) return null; // already ran today
  }
  let r = await check(BASE);
  if (r.problems.length) { // ask again in 10 minutes: a deploy or a slow wake-up is not a broken site
    await new Promise((res) => setTimeout(res, 10 * 60 * 1000));
    r = await check(BASE);
  }
  last = r;
  if (r.problems.length) {
    console.error(`Site check: ${r.problems.length} problem(s)\n- ` + r.problems.join('\n- '));
    await mailer.send({
      to: recipients(),
      subject: `Website problem: ${r.problems.length === 1 ? 'something' : r.problems.length + ' things'} on cbcwinfield.org ${r.problems.length === 1 ? 'is' : 'are'} broken`,
      heading: 'The website check found a problem',
      paragraphs: [
        `This morning’s check of ${r.base} (${r.pages} pages, ${r.videos} sermon videos) found:`,
        ...r.problems.map((p) => '• ' + p),
        'Visitors may be seeing this right now. Once it is fixed, tomorrow’s check will confirm it.',
      ],
      button: { label: 'Open the website', url: r.base },
    });
  } else {
    console.log(`Site check: all good (${r.pages} pages, ${r.videos} sermon videos).`);
  }
  return r;
}

function start() {
  const tick = () => run().catch((err) => console.error('Site check failed to run:', err.message));
  setTimeout(tick, 2 * 60 * 1000).unref();
  setInterval(tick, 30 * 60 * 1000).unref();
}

module.exports = { run, start, last: () => last, recipients };

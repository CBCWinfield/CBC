'use strict';
// The church website. Pages live under /site; on cbcwinfield.org they answer at the root.
const db = require('../db');
const security = require('../lib/security');
const mailer = require('../lib/mailer');
const { esc } = require('../lib/html');
const { pushTo } = require('../notify');
const { users } = require('../models');
const { clean } = require('../routes/guards');
const yt = require('../lib/youtube');
const V = require('./views');
const C = require('./content');
const { seasonFor, styleFor } = require('./season');

const SITE_HOSTS = (process.env.SITE_HOSTS || 'cbcwinfield.org,www.cbcwinfield.org').split(',').map((h) => h.trim().toLowerCase());
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const baseFor = (req) => (SITE_HOSTS.includes(String(req.headers.host || '').split(':')[0].toLowerCase()) ? '' : '/site');

function show(req, res, page, view, { title, desc, status = 200 } = {}) {
  res.status(status);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(V.layout({ title, desc, page, body: view.body, head: view.head, base: baseFor(req), season: seasonFor(req.query), storyStyle: styleFor(req.query) }).toString());
}

async function saveInquiry(kind, v, { to } = {}) {
  const row = await db.one(`INSERT INTO site_inquiries (kind, name, email, phone, topic, message) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [kind, v.name, v.email, v.phone || null, v.topic || null, v.message || null]);
  const label = kind === 'serve' ? `Volunteer: ${v.topic || 'anywhere'}` : kind === 'ride' ? 'Bus ride request' : v.topic || 'Website message';
  try {
    await mailer.send({
      to: to || C.CHURCH.email, libraryName: 'Central Baptist Church website', subject: `${label} from ${v.name}`, heading: label,
      paragraphs: [
        `<strong>${esc(v.name)}</strong>${v.email ? `<br><a href="mailto:${esc(v.email)}">${esc(v.email)}</a>` : ''}${v.phone ? `<br>${esc(v.phone)}` : ''}`,
        v.message ? esc(v.message).replace(/\n/g, '<br>') : '',
        'Reply to this email to answer them directly.',
      ],
      button: { label: 'See all website messages', url: `${C.CHURCH.app}/checkin/inquiries` },
    });
  } catch (err) { console.error('Website message email failed:', err.message); }
  const admins = await users.checkinAdmins();
  if (admins.length) pushTo(admins.map((a) => a.id), { title: label, body: `${v.name}: ${(v.message || v.email).slice(0, 120)}`, url: '/checkin/inquiries' }).catch(() => {});
  return row;
}

function readForm(b) {
  return { name: clean(b.name, 120), email: clean(b.email, 200).toLowerCase(), phone: clean(b.phone, 40), topic: clean(b.topic, 120), message: clean(b.message, 3000) };
}

module.exports = (app) => {
  const page = (path, key, render, meta) => app.get(`/site${path}`, async (req, res) => show(req, res, key, await render(req, res), meta));

  page('', 'home', async (req) => V.home({ latest: (await yt.recent())[0], base: baseFor(req) }));
  page('/visit', 'visit', (req, res) => V.visit({ csrf: res.locals.csrf, base: baseFor(req), sent: req.query.sent === '1' }), { title: 'Plan your visit', desc: 'Service times, directions, and what to expect for your kids on your first Sunday at Central Baptist Church in Winfield, Kansas.' });
  page('/about', 'about', (req) => V.about({ base: baseFor(req) }), { title: 'About', desc: 'Central Baptist Church is a Southern Baptist congregation in Winfield, Kansas, celebrating 75 years of God’s faithfulness.' });
  page('/ministries', 'ministries', (req) => V.ministries({ base: baseFor(req) }), { title: 'Ministries', desc: 'Central Kids, Central Teens, adult Bible studies, and missions at Central Baptist Church in Winfield, Kansas.' });
  page('/sermons', 'sermons', async () => V.sermons({ videos: await yt.recent() }), { title: 'Sermons', desc: 'Watch the latest sermons from Central Baptist Church in Winfield, Kansas.' });
  page('/events', 'events', async (req) => { const A = require('../announce'); const [reel, slides] = await Promise.all([A.latestReel(), A.list()]); return V.events({ base: baseFor(req), reel, slides, longDate: A.longDate, keyOf: A.keyOf }); }, { title: 'Events & announcements', desc: 'This week’s announcements and upcoming events at Central Baptist Church in Winfield, Kansas.' });
  page('/staff', 'staff', () => V.staff(), { title: 'Staff & leaders' });
  page('/give', 'give', (req) => V.give({ base: baseFor(req) }), { title: 'Give', desc: 'Give online to Central Baptist Church in Winfield, Kansas, through our secure giving partner Vanco.' });
  page('/connect', 'connect', (req, res) => V.connect({ csrf: res.locals.csrf, base: baseFor(req), sent: req.query.sent === '1', topic: clean(req.query.topic, 120) }), { title: 'Connect' });
  page('/serve', 'serve', (req, res) => V.serve({ csrf: res.locals.csrf, base: baseFor(req), sent: req.query.sent === '1' }), { title: 'Serve' });
  page('/partners', 'partners', () => V.partners(), { title: 'Our partners' });
  // Old Wix addresses, so existing links and search results still land somewhere useful.
  const OLD = { '/blank': '/about', '/blank-1': '/sermons', '/blank-2': '/give', '/blank-3': '/ministries', '/blank-4': '/connect', '/blank-4-1': '/connect', '/blank-5': '/staff', '/blank-6': '/serve', '/blank-7': null, '/event-list': '/events', '/home-1-1-1': '/', '/groups': '/connect', '/my-groups': '/connect' };
  for (const [from, to] of Object.entries(OLD)) {
    app.get(`/site${from}`, async (req, res) => res.redirect(to === null ? `${C.CHURCH.app}/checkin/prayer` : `${baseFor(req)}${to}` || '/'));
  }
  // "Add to calendar"
  app.get('/site/events/:file', async (req, res) => {
    const e = C.EVENTS.find((x) => `${x.key}.ics` === req.params.file);
    if (!e) return show(req, res, '404', V.notFound({ base: baseFor(req) }), { title: 'Page not found', status: 404 });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="central-${e.key}.ics"`);
    res.send(V.ics(e));
  });
  app.get('/site/event-details/:slug', async (req, res) => res.redirect(`${baseFor(req)}/events`));

  app.post('/site/connect', security.rateLimit('site-connect', { max: 10, windowMs: 3600000 }), async (req, res) => {
    const base = baseFor(req);
    if (req.body.website) return res.redirect(`${base}/connect?sent=1`); // bots fill the hidden field
    const v = readForm(req.body);
    const visiting = v.topic === 'Planning a visit';
    const error = !v.name ? 'Please tell us your name.' : !EMAIL_RE.test(v.email) ? 'Please enter a valid email address so we can reply.' : !visiting && !v.message ? 'Please write a message.' : null;
    if (error) return show(req, res, visiting ? 'visit' : 'connect', visiting ? V.visit({ csrf: res.locals.csrf, base }) : V.connect({ csrf: res.locals.csrf, base, values: v, error }), { title: 'Connect', status: 422 });
    await saveInquiry(visiting ? 'visit' : 'connect', { ...v, message: [v.message, visiting && req.body.kids === '1' ? 'Bringing kids.' : ''].filter(Boolean).join('\n') });
    if (visiting && req.body.kids === '1') require('../checkin/kidsform').sendKidsForm({ email: v.email, name: v.name }).catch((e) => console.error('Kids form email failed:', e.message));
    res.redirect(`${base}${visiting ? '/visit' : '/connect'}?sent=1`);
  });

  app.post('/site/serve', security.rateLimit('site-serve', { max: 10, windowMs: 3600000 }), async (req, res) => {
    const base = baseFor(req);
    if (req.body.website) return res.redirect(`${base}/serve?sent=1`);
    const v = readForm(req.body);
    if (!C.SERVE_AREAS.includes(v.topic)) v.topic = 'Wherever I’m needed';
    const error = !v.name ? 'Please tell us your name.' : !EMAIL_RE.test(v.email) ? 'Please enter a valid email address.' : null;
    if (error) return show(req, res, 'serve', V.serve({ csrf: res.locals.csrf, base, values: v, error }), { title: 'Serve', status: 422 });
    await saveInquiry('serve', v);
    res.redirect(`${base}/serve?sent=1`);
  });

  // Bus ministry ride requests (emailed to the bus ministry address).
  page('/ride', 'ministries', (req, res) => V.ride({ csrf: res.locals.csrf, base: baseFor(req), sent: req.query.sent === '1' }), { title: 'Request a ride', desc: 'Ride the Central Baptist Church bus on Wednesday nights. Request a pickup anywhere in Cowley County, Kansas.' });
  app.post('/site/ride', security.rateLimit('site-ride', { max: 10, windowMs: 3600000 }), async (req, res) => {
    const base = baseFor(req);
    if (req.body.website) return res.redirect(`${base}/ride?sent=1`);
    const v = { ...readForm(req.body), address: clean(req.body.address, 200), town: clean(req.body.town, 80), riders: clean(req.body.riders, 600) };
    const CC = require('../lib/contact-check');
    const error = !v.name ? 'Please tell us your name.' : CC.phoneProblem(v.phone) || await CC.emailProblem(v.email) || (!v.address ? 'Please tell us where to pick you up.'
      : !v.riders ? 'Please tell us who needs a ride.' : null);
    if (!error) v.phone = CC.cleanPhone(v.phone);
    if (error) return show(req, res, 'ministries', V.ride({ csrf: res.locals.csrf, base, values: v, error }), { title: 'Request a ride', status: 422 });
    await saveInquiry('ride', {
      name: v.name, email: v.email, phone: v.phone, topic: 'Bus ride request',
      message: `Pickup address: ${v.address}${v.town ? `, ${v.town}` : ''}\nRiders: ${v.riders}${v.message ? `\n\nNotes: ${v.message}` : ''}`,
    }, { to: C.CHURCH.rideEmail });
    require('../checkin/kidsform').sendKidsForm({ email: v.email, name: v.name }).catch((e) => console.error('Kids form email failed:', e.message));
    res.redirect(`${base}/ride?sent=1`);
  });

  // Anything else on the church domain: a friendly not-found page.
  app.get('/site/:rest', async (req, res) => show(req, res, '404', V.notFound({ base: baseFor(req) }), { title: 'Page not found', status: 404 }));
};

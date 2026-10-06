'use strict';
const db = require('../db');
const security = require('../lib/security');
const { HttpError } = require('../lib/http');
const { books, users, checkouts } = require('../models');
const V = require('../views/public');
const notify = require('../notify');
const { ask } = require('../lib/ask');
const { suggest } = require('../lib/suggest');
const { SORTS } = require('../models');
const { buildSlots, findSlot } = require('../lib/slots');
const { requireUser, safeNext, intParam, clean } = require('./guards');

const PAGE = 24;
const CATALOG_SORTS = ['title', 'title_desc', 'writer', 'writer_desc', 'newest', 'published', 'available', 'sku'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Normalise a typed library code: "cbc 1042", "1042", "CBC-1042" -> "CBC-1042"
function normalCode(v) {
  const digits = String(v || '').replace(/[^0-9]/g, '');
  return digits ? `CBC-${Number(digits)}` : '';
}

async function approve(user) {
  const code = user.library_code || await users.nextCode();
  await db.query("UPDATE users SET status = 'approved', library_code = $2, approved_at = COALESCE(approved_at, now()) WHERE id = $1", [user.id, code]);
  return users.get(user.id);
}

// Can this user check this book out right now? Returns a reason when not.
async function checkoutBlock(user, book, s) {
  if (!user) return { reason: 'login' };
  if (user.status === 'pending') return { reason: 'Your application is waiting for approval. You can check out books once the librarian approves it.' };
  if (user.status === 'paused') return { reason: 'Your account is paused, so checkouts are turned off. Please contact the librarian.' };
  if (user.status !== 'approved') return { reason: 'Your account can’t check out books. Please contact the church office.' };
  if (!book.active || book.copies_total === 0) return { reason: 'This item isn’t available for checkout.' };
  const mine = await db.one(`SELECT * FROM checkouts WHERE user_id = $1 AND book_id = $2 AND status IN ('reserved','checked_out')`, [user.id, book.id]);
  if (mine) return { mine };
  if (book.available <= 0) return { reason: 'All copies are checked out right now. Check back soon.' };
  const count = await users.activeCount(user.id);
  if (count >= s.max_books) return { reason: `You have ${count} books on hold or checked out, which is the limit of ${s.max_books}. Return one to check out another.` };
  return null;
}

module.exports = (app) => {
  app.get('/', async (req, res) => {
    const [recent, counts, categories] = await Promise.all([books.recent(16), books.count(), books.categories()]);
    res.render(V.landing({ s: req.settings, recent, counts, categories, user: req.user }), { current: 'home' });
  });

  app.get('/catalog', async (req, res) => {
    const q = clean(req.query.q, 200);
    const filters = {
      q, category: clean(req.query.category, 100), subcategory: clean(req.query.subcategory, 150), audience: clean(req.query.audience, 30),
      format: clean(req.query.format, 40), available: req.query.available === '1',
    };
    const sort = CATALOG_SORTS.includes(req.query.sort) ? req.query.sort : 'title';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const { rows, total } = await books.list(filters, { limit: PAGE, offset: (page - 1) * PAGE, sort });
    const params = new URLSearchParams(Object.entries({ ...filters, available: filters.available ? '1' : '', sort: sort === 'title' ? '' : sort }).filter(([, v]) => v));
    res.render(V.catalog({
      ...filters, rows, total, page, pages: Math.ceil(total / PAGE),
      categories: await books.categories(), base: `/catalog?${params}`, formats: await books.formats(),
      subcategories: filters.category ? await books.subcategories(filters.category) : [],
      sort, sorts: CATALOG_SORTS.map((k) => [k, SORTS[k].label]),
    }), { title: 'Catalog', current: 'catalog' });
  });

  app.get('/books/:id', async (req, res) => {
    const book = await books.get(intParam(req.params.id));
    if (!book || (!book.active && (!req.user || req.user.role === 'patron'))) throw new HttpError(404, 'That book isn’t in the catalog.');
    const block = await checkoutBlock(req.user, book, req.settings);
    const reason = !req.user
      ? 'Log in or apply for a free library account to check out books.'
      : block && block.reason;
    res.render(V.bookPage({ book, user: req.user, s: req.settings, myActive: block && block.mine, canCheckout: !block, reason }), {
      title: book.title, current: 'catalog', description: book.description ? book.description.slice(0, 160) : undefined,
    });
  });

  app.get('/covers/:id', async (req, res) => {
    const row = await db.one('SELECT cover_image, cover_type FROM books WHERE id = $1', [intParam(req.params.id)]);
    if (!row || !row.cover_image) throw new HttpError(404, 'No cover.');
    res.setHeader('Content-Type', row.cover_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.send(row.cover_image);
  });

  // ---- Checkout with pickup scheduling ----
  async function slotDays(user, s) {
    const [taken, mine] = await Promise.all([checkouts.takenSlots(), checkouts.userSlots(user.id)]);
    return buildSlots(s, new Date(), taken, mine);
  }

  app.get('/books/:id/checkout', requireUser, async (req, res) => {
    const book = await books.get(intParam(req.params.id));
    if (!book) throw new HttpError(404, 'That book isn’t in the catalog.');
    const block = await checkoutBlock(req.user, book, req.settings);
    if (block) {
      security.flash(req, block.mine ? 'ok' : 'error', block.mine ? 'You already have this book. See My Library for details.' : block.reason);
      return res.redirect(block.mine ? '/my' : `/books/${book.id}`);
    }
    const days = await slotDays(req.user, req.settings);
    res.render(V.checkoutPage({ book, days, user: req.user, csrf: res.locals.csrf, s: req.settings }), { title: `Check out ${book.title}` });
  });

  app.post('/books/:id/checkout', requireUser, security.rateLimit('checkout', { max: 30, windowMs: 3600000 }), async (req, res) => {
    const s = req.settings;
    const user = req.user;
    const book = await books.get(intParam(req.params.id));
    if (!book) throw new HttpError(404, 'That book isn’t in the catalog.');
    const block = await checkoutBlock(user, book, s);
    if (block) {
      security.flash(req, 'error', block.mine ? 'You already have this book.' : block.reason);
      return res.redirect(`/books/${book.id}`);
    }
    const values = { pickup_at: clean(req.body.pickup_at, 40), library_code: clean(req.body.library_code, 30) };
    const days = await slotDays(user, s);
    const again = (error) => res.status(422).render(V.checkoutPage({ book, days, user, csrf: res.locals.csrf, s, error, values }), { title: `Check out ${book.title}` });

    if (!values.library_code || normalCode(values.library_code) !== user.library_code) {
      return again('That library code doesn’t match your account. Check your approval email or My Library page.');
    }
    const slot = findSlot(days, values.pickup_at);
    if (!slot) return again('Please choose one of the pickup times shown.');
    if (!slot.open) return again('That pickup time just filled up. Please choose another.');

    let reserved;
    try {
      reserved = await db.tx(async (c) => {
        await c.query('SELECT id FROM books WHERE id = $1 FOR UPDATE', [book.id]);
        const live = await c.one(`SELECT b.copies_total - (SELECT count(*) FROM checkouts WHERE book_id = b.id AND status IN ('reserved','checked_out'))::int AS available FROM books b WHERE b.id = $1`, [book.id]);
        if (!live || live.available <= 0) throw new HttpError(409, 'Someone just reserved the last copy. Please try another book.');
        const inSlot = await c.one(`SELECT count(DISTINCT user_id)::int AS n, bool_or(user_id = $2) AS mine FROM checkouts WHERE status = 'reserved' AND pickup_at = $1`, [values.pickup_at, user.id]);
        if (!inSlot.mine && inSlot.n >= s.slot_capacity) throw new HttpError(409, 'That pickup time just filled up. Please choose another.');
        return c.one(`INSERT INTO checkouts (book_id, user_id, status, pickup_at) VALUES ($1, $2, 'reserved', $3) RETURNING *`, [book.id, user.id, values.pickup_at]);
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) return again(err.message);
      throw err;
    }

    const sameVisit = await db.many(`SELECT c.*, b.title FROM checkouts c JOIN books b ON b.id = c.book_id
      WHERE c.user_id = $1 AND c.status = 'reserved' AND c.pickup_at = $2 ORDER BY c.id`, [user.id, reserved.pickup_at]);
    notify.reserved(user, sameVisit);
    security.flash(req, 'ok', `“${book.title}” is on hold for you. We emailed your pickup details.`);
    res.redirect('/my');
  });

  // ---- Apply / register ----
  app.get('/apply', async (req, res) => {
    if (req.user) return res.redirect('/my');
    res.render(V.applyPage({ csrf: res.locals.csrf, s: req.settings }), { title: 'Apply', current: 'apply' });
  });

  app.post('/apply', security.rateLimit('apply', { max: 8, windowMs: 3600000 }), async (req, res) => {
    if (req.body.website) return res.redirect('/'); // honeypot: bots fill hidden fields
    const fields = ['first_name', 'last_name', 'email', 'phone', 'address', 'city', 'state', 'zip'];
    const v = {};
    for (const f of fields) v[f] = clean(req.body[f], 120);
    v.about = clean(req.body.about, 600);
    v.email = v.email.toLowerCase();
    const errors = {};
    for (const f of fields) if (!v[f]) errors[f] = 'Please fill this in.';
    if (v.email && !EMAIL_RE.test(v.email)) errors.email = 'Enter a valid email address, like name@example.com.';
    const pw = String(req.body.password || '');
    if (pw.length < 8) errors.password = 'Use at least 8 characters.';
    else if (pw !== req.body.password2) errors.password2 = 'The two passwords don’t match.';
    if (!errors.email && await users.byEmail(v.email)) errors.email = 'That email already has an account. Log in instead, or use “Forgot your password?”';
    if (Object.keys(errors).length) {
      return res.status(422).render(V.applyPage({ csrf: res.locals.csrf, values: v, errors, s: req.settings }), { title: 'Apply', current: 'apply' });
    }
    let user = await db.one(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone, address, city, state, zip, about)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [v.email, await security.hashPassword(pw), v.first_name, v.last_name, v.phone, v.address, v.city, v.state, v.zip, v.about || null],
    );
    user = await users.get(user.id);
    if (req.settings.auto_approve) {
      user = await approve(user);
      notify.approved(user);
    } else {
      notify.applicationReceived(user);
    }
    require('../checkin/automations').welcome(user, { link: '/my' });
    await req.regenerateSession();
    req.session.userId = user.id;
    req.user = user;
    res.render(V.applied({ user, s: req.settings }), { title: 'Application sent' });
  });

  // ---- Log in / out ----
  app.get('/login', async (req, res) => {
    if (req.user) return res.redirect(safeNext(req.query.next) || '/my');
    res.render(V.loginPage({ csrf: res.locals.csrf, next: safeNext(req.query.next) || '' }), { title: 'Log in', current: 'login' });
  });

  app.post('/login', security.rateLimit('login', { max: 12, windowMs: 15 * 60000 }), async (req, res) => {
    const email = clean(req.body.email, 200);
    const user = await users.byEmail(email);
    const ok = user && await security.verifyPassword(String(req.body.password || ''), user.password_hash);
    if (!ok) {
      return res.status(401).render(V.loginPage({ csrf: res.locals.csrf, email, error: 'That email and password don’t match. Check them and try again.', next: safeNext(req.body.next) || '' }), { title: 'Log in' });
    }
    await req.regenerateSession();
    req.session.userId = user.id;
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    const dest = safeNext(req.body.next) || (user.role !== 'patron' ? '/admin' : '/my');
    res.redirect(dest);
  });

  app.post('/logout', async (req, res) => {
    await req.destroySession();
    res.redirect('/');
  });

  // ---- Password reset ----
  app.get('/forgot', async (req, res) => res.render(V.forgotPage({ csrf: res.locals.csrf }), { title: 'Reset password' }));

  app.post('/forgot', security.rateLimit('forgot', { max: 5, windowMs: 3600000 }), async (req, res) => {
    const user = await users.byEmail(clean(req.body.email, 200));
    if (user) {
      const tok = security.token(32);
      await db.query("UPDATE users SET reset_token_hash = $2, reset_expires = now() + interval '1 hour' WHERE id = $1", [user.id, security.sha256(tok)]);
      notify.passwordReset(user, notify.url(`/reset/${tok}`));
    }
    res.render(V.forgotPage({ csrf: res.locals.csrf, sent: true }), { title: 'Reset password' });
  });

  const findReset = (tok) => db.one('SELECT id FROM users WHERE reset_token_hash = $1 AND reset_expires > now()', [security.sha256(String(tok))]);

  app.get('/reset/:token', async (req, res) => {
    const u = await findReset(req.params.token);
    if (!u) {
      security.flash(req, 'error', 'That reset link has expired or was already used. Request a new one.');
      return res.redirect('/forgot');
    }
    res.render(V.resetPage({ csrf: res.locals.csrf, token: req.params.token }), { title: 'New password' });
  });

  app.post('/reset/:token', security.rateLimit('reset', { max: 10, windowMs: 3600000 }), async (req, res) => {
    const u = await findReset(req.params.token);
    if (!u) {
      security.flash(req, 'error', 'That reset link has expired or was already used. Request a new one.');
      return res.redirect('/forgot');
    }
    const pw = String(req.body.password || '');
    const err = pw.length < 8 ? 'Use at least 8 characters.' : pw !== req.body.password2 ? 'The two passwords don’t match.' : null;
    if (err) return res.status(422).render(V.resetPage({ csrf: res.locals.csrf, token: req.params.token, error: err }), { title: 'New password' });
    await db.query('UPDATE users SET password_hash = $2, reset_token_hash = NULL, reset_expires = NULL WHERE id = $1', [u.id, await security.hashPassword(pw)]);
    await req.regenerateSession();
    req.session.userId = u.id;
    security.flash(req, 'ok', 'Your password is saved and you’re logged in.');
    const who = await db.one('SELECT checkin_role, role FROM users WHERE id = $1', [u.id]);
    res.redirect(who && who.checkin_role ? '/checkin' : who && who.role !== 'patron' ? '/admin' : '/my');
  });

  // ---- Ask bar (self-contained) ----
  let cache = { at: 0, rows: null };
  let index = { at: 0, rows: null };
  module.exports.clearSearchCache = () => { cache = { at: 0, rows: null }; index = { at: 0, rows: null }; };

  // Search-as-you-type suggestions for the catalog, the Ask bar and the librarian's book list.
  app.get('/api/suggest', security.rateLimit('suggest', { max: 240, windowMs: 60000 }), async (req, res) => {
    if (!index.rows || Date.now() - index.at > 20000) index = { at: Date.now(), rows: await books.searchIndex() };
    const staff = req.user && req.user.role !== 'patron' && req.query.for === 'admin';
    const r = suggest(clean(req.query.q, 100), index.rows, { includeHidden: staff });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      total: r.total || 0,
      books: r.books.map((b) => ({
        id: b.id, title: b.title, author: b.author, sku: b.call_number, format: b.format, available: b.available,
        hidden: b.active === false,
        cover: b.has_cover ? `/covers/${b.id}?v=${new Date(b.updated_at).getTime()}` : null,
        url: staff ? `/admin/books/${b.id}/edit` : `/books/${b.id}`,
      })),
      writers: r.writers.map((w) => ({ ...w, url: `${staff ? '/admin/books' : '/catalog'}?q=${encodeURIComponent(w.name)}` })),
      categories: r.categories.map((c) => ({
        ...c,
        url: staff ? `/admin/books?category=${encodeURIComponent(c.category)}`
          : `/catalog?category=${encodeURIComponent(c.category)}${c.subcategory ? `&subcategory=${encodeURIComponent(c.subcategory)}` : ''}`,
      })),
    });
  });

  app.post('/api/ask', security.rateLimit('ask', { max: 60, windowMs: 60000 }), async (req, res) => {
    if (!cache.rows || Date.now() - cache.at > 30000) cache = { at: Date.now(), rows: await books.all() };
    const result = ask(clean(req.body.q, 300), cache.rows, req.settings);
    res.json({
      answer: result.answer,
      kind: result.kind,
      total: result.total || 0,
      books: result.books.map((b) => ({
        id: b.id, title: b.title, author: b.author, category: b.category, available: b.available,
        copies: b.copies_total, cover: b.has_cover ? `/covers/${b.id}?v=${new Date(b.updated_at).getTime()}` : null,
      })),
    });
  });
};

module.exports.approve = approve;
module.exports.normalCode = normalCode;

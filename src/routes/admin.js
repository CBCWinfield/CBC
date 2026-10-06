'use strict';
const db = require('../db');
const security = require('../lib/security');
const settingsStore = require('../settings');
const { HttpError } = require('../lib/http');
const { books, users, checkouts, fullName } = require('../models');
const A = require('../views/admin');
const notify = require('../notify');
const mailer = require('../lib/mailer');
const push = require('../lib/push');
const isbnLib = require('../lib/isbn');
const { parseCsvObjects } = require('../lib/csv');
const t = require('../lib/time');
const { requireStaff, requireLibrarian, intParam, clean } = require('./guards');
const { approve, normalCode } = require('./public');

const PAGE = 50;
const FORMATS = ['Book', 'Large Print', 'Audiobook', 'DVD'];
const AUDIENCES = ['Everyone', 'Adults', 'Youth', 'Children'];

async function pendingCount() {
  return (await db.one("SELECT count(*)::int AS n FROM users WHERE status = 'pending'")).n;
}

// Render a page inside the librarian shell.
async function page(req, res, current, title, body) {
  const pending = req.user.role === 'librarian' ? await pendingCount() : 0;
  res.render(A.shell({ user: req.user, current, pending, body, title }), { title, current: 'admin', wide: true });
}

const int = (v, { min = 0, max = 1e6, fallback = null } = {}) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

function decodeDataUrl(s) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ''));
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  if (data.length > 2 * 1024 * 1024) return null;
  return { type: m[1], data };
}

function bookValues(body) {
  const v = {
    title: clean(body.title, 300),
    subtitle: clean(body.subtitle, 300) || null,
    author: clean(body.author, 300) || null,
    isbn: (clean(body.isbn, 20).replace(/[^0-9Xx]/g, '').toUpperCase()) || null,
    category: clean(body.category, 80) || null,
    audience: AUDIENCES.includes(body.audience) ? body.audience : 'Everyone',
    format: FORMATS.includes(body.format) ? body.format : 'Book',
    description: clean(body.description, 8000) || null,
    tags: clean(body.tags, 500) || null,
    publisher: clean(body.publisher, 200) || null,
    published_year: int(body.published_year, { min: 1000, max: 2200 }),
    pages: int(body.pages, { min: 1, max: 100000 }),
    copies_total: int(body.copies_total ?? body.copies, { min: 0, max: 999, fallback: 1 }),
    shelf_location: clean(body.shelf_location ?? body.shelf, 80) || null,
  };
  const errors = {};
  if (!v.title) errors.title = 'A title is required.';
  return { v, errors };
}

async function coverFrom(body) {
  const fromUpload = decodeDataUrl(body.cover_data);
  if (fromUpload) return fromUpload;
  if (body.cover_url) {
    try { return await isbnLib.fetchCover(body.cover_url); } catch { return null; }
  }
  return null;
}

module.exports = (app) => {
  // ---------- Today ----------
  app.get('/admin', requireStaff, async (req, res) => {
    const now = new Date();
    const { year, month, day } = t.parseKey(t.dateKey(now));
    const start = t.zoned(year, month, day, 0, 0);
    const end = new Date(t.endOfLocalDay(now).getTime() + 1000);
    const CO = `SELECT c.*, b.title, b.author, b.shelf_location, u.first_name, u.last_name, u.phone, u.library_code
      FROM checkouts c JOIN books b ON b.id = c.book_id JOIN users u ON u.id = c.user_id`;
    const [todays, overdue, counts] = await Promise.all([
      db.many(`${CO} WHERE c.status = 'reserved' AND c.pickup_at >= $1 AND c.pickup_at < $2 ORDER BY c.pickup_at`, [start, end]),
      db.many(`${CO} WHERE c.status = 'checked_out' AND c.due_at < now() ORDER BY c.due_at`),
      db.one(`SELECT (SELECT count(*) FROM books WHERE active)::int AS books,
        (SELECT COALESCE(sum(copies_total),0) FROM books WHERE active)::int AS copies,
        (SELECT count(*) FROM checkouts WHERE status = 'checked_out')::int AS out,
        (SELECT count(*) FROM checkouts WHERE status = 'reserved')::int AS holds,
        (SELECT count(*) FROM users WHERE status = 'approved')::int AS patrons`),
    ]);
    const pending = req.user.role === 'librarian' ? await pendingCount() : 0;
    await page(req, res, 'home', 'Today', A.home({ user: req.user, csrf: res.locals.csrf, todays, overdue, pending, counts, s: req.settings, now }));
  });

  // ---------- Pickups & checkouts ----------
  app.get('/admin/checkouts', requireStaff, async (req, res) => {
    const view = ['pickups', 'out', 'history'].includes(req.query.view) ? req.query.view : 'pickups';
    const rows = view === 'pickups' ? await checkouts.reserved() : view === 'out' ? await checkouts.out() : await checkouts.history();
    await page(req, res, 'checkouts', 'Pickups & checkouts', A.checkoutsPage({ view, rows, csrf: res.locals.csrf, now: new Date() }));
  });

  const back = (req, fallback = '/admin/checkouts') => {
    const ref = req.headers.referer;
    try {
      const u = new URL(ref);
      if (u.host === req.headers.host && u.pathname.startsWith('/admin')) return u.pathname + u.search;
    } catch { /* ignore */ }
    return fallback;
  };

  app.post('/admin/checkouts/:id/pickup', requireStaff, async (req, res) => {
    const due = t.endOfLocalDay(new Date(), Number(req.settings.checkout_days));
    const c = await db.one(`UPDATE checkouts SET status = 'checked_out', picked_up_at = now(), due_at = $2
      WHERE id = $1 AND status = 'reserved' RETURNING *`, [intParam(req.params.id), due]);
    if (c) {
      const full = await checkouts.get(c.id);
      notify.pickedUp(await users.get(c.user_id), full);
      security.flash(req, 'ok', `Checked out “${full.title}” to ${full.first_name} ${full.last_name}. Due ${t.fmtDate(due)}.`);
    } else security.flash(req, 'error', 'That hold was already handled.');
    res.redirect(back(req));
  });

  app.post('/admin/checkouts/:id/return', requireStaff, async (req, res) => {
    const c = await db.one(`UPDATE checkouts SET status = 'returned', returned_at = now() WHERE id = $1 AND status = 'checked_out' RETURNING id`, [intParam(req.params.id)]);
    if (c) {
      const full = await checkouts.get(c.id);
      security.flash(req, 'ok', `“${full.title}” is checked in.${full.shelf_location ? ` It goes on shelf ${full.shelf_location}.` : ''}`);
    } else security.flash(req, 'error', 'That book was already checked in.');
    res.redirect(back(req));
  });

  app.post('/admin/checkouts/:id/cancel', requireStaff, async (req, res) => {
    const c = await db.one(`UPDATE checkouts SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Cancelled by library'
      WHERE id = $1 AND status = 'reserved' RETURNING id, user_id`, [intParam(req.params.id)]);
    if (c) {
      const full = await checkouts.get(c.id);
      notify.cancelledByLibrary(await users.get(c.user_id), full, clean(req.body.reason, 300));
      security.flash(req, 'ok', `Hold on “${full.title}” cancelled. ${full.first_name} was emailed.`);
    } else security.flash(req, 'error', 'That hold was already handled.');
    res.redirect(back(req));
  });

  app.post('/admin/checkouts/:id/extend', requireStaff, async (req, res) => {
    const s = req.settings;
    const c = await checkouts.get(intParam(req.params.id));
    if (!c || c.status !== 'checked_out') {
      security.flash(req, 'error', 'Only checked-out books can be extended.');
    } else if (c.times_extended >= s.max_extensions && req.user.role !== 'librarian') {
      security.flash(req, 'error', `This book has already been extended ${c.times_extended} time${c.times_extended === 1 ? '' : 's'}, the limit. Ask the librarian.`);
    } else {
      const from = new Date(Math.max(new Date(c.due_at).getTime(), Date.now()));
      const due = t.endOfLocalDay(from, Number(s.checkout_days));
      await db.query(`UPDATE checkouts SET due_at = $2, times_extended = times_extended + 1, due_reminder_sent = false, last_overdue_notice_at = NULL WHERE id = $1`, [c.id, due]);
      security.flash(req, 'ok', `“${c.title}” is now due ${t.fmtDate(due)}.`);
    }
    res.redirect(back(req));
  });

  app.get('/admin/checkouts/new', requireStaff, async (req, res) => {
    await page(req, res, 'checkouts', 'Check out at the desk', A.deskCheckout({ csrf: res.locals.csrf, books: await books.all() }));
  });

  app.post('/admin/checkouts/new', requireStaff, async (req, res) => {
    const values = { patron: clean(req.body.patron, 200), book: clean(req.body.book, 400) };
    const fail = async (error) => {
      res.status(422);
      await page(req, res, 'checkouts', 'Check out at the desk', A.deskCheckout({ csrf: res.locals.csrf, books: await books.all(), error, values }));
    };
    const patron = values.patron.includes('@')
      ? await users.byEmail(values.patron)
      : await db.one('SELECT * FROM users WHERE library_code = $1', [normalCode(values.patron)]);
    if (!patron) return fail('No patron has that library code or email.');
    if (patron.status !== 'approved') return fail(`${fullName(patron)}'s account is ${patron.status}, so they can't check out books.`);
    const idMatch = /^#(\d+)/.exec(values.book);
    const book = idMatch ? await books.get(Number(idMatch[1])) : null;
    if (!book) return fail('Choose the book from the list as you type, so the right one is used.');
    if (book.available <= 0) return fail(`All copies of “${book.title}” are checked out or on hold.`);
    const dup = await db.one(`SELECT id FROM checkouts WHERE user_id = $1 AND book_id = $2 AND status IN ('reserved','checked_out')`, [patron.id, book.id]);
    if (dup) return fail(`${patron.first_name} already has “${book.title}” on hold or checked out. Use Pickups & checkouts to mark it picked up.`);
    const due = t.endOfLocalDay(new Date(), Number(req.settings.checkout_days));
    const c = await db.one(`INSERT INTO checkouts (book_id, user_id, status, picked_up_at, due_at) VALUES ($1, $2, 'checked_out', now(), $3) RETURNING id`, [book.id, patron.id, due]);
    notify.pickedUp(patron, await checkouts.get(c.id));
    security.flash(req, 'ok', `Checked out “${book.title}” to ${fullName(patron)}. Due ${t.fmtDate(due)}.`);
    res.redirect('/admin/checkouts/new');
  });

  // ---------- Books ----------
  app.get('/admin/books', requireStaff, async (req, res) => {
    const q = clean(req.query.q, 200);
    const category = clean(req.query.category, 100);
    const pg = Math.max(1, parseInt(req.query.page, 10) || 1);
    const { rows, total } = await books.list({ q, category, includeInactive: true }, { limit: PAGE, offset: (pg - 1) * PAGE, order: 'b.active DESC, b.title' });
    const params = new URLSearchParams(Object.entries({ q, category }).filter(([, v]) => v));
    await page(req, res, 'books', 'Books', A.booksPage({ rows, q, category, total, page: pg, pages: Math.ceil(total / PAGE), base: `/admin/books?${params}`, categories: await books.categories() }));
  });

  app.get('/admin/books/new', requireStaff, async (req, res) => {
    await page(req, res, 'books', 'Add a book', A.bookForm({ csrf: res.locals.csrf, book: { copies_total: 1 }, categories: await books.categories(), isNew: true }));
  });

  app.get('/admin/books/lookup', requireStaff, security.rateLimit('isbn', { max: 60, windowMs: 600000 }), async (req, res) => {
    try {
      const result = await isbnLib.lookup(req.query.isbn);
      if (!result.error && result.isbn) {
        const dup = await db.one('SELECT id, title FROM books WHERE isbn = $1 LIMIT 1', [result.isbn]);
        if (dup) result.duplicate = dup;
      }
      res.json(result);
    } catch {
      res.json({ error: 'The book lookup service didn’t answer. You can type the details in yourself.' });
    }
  });

  app.post('/admin/books', requireStaff, async (req, res) => {
    const { v, errors } = bookValues(req.body);
    if (Object.keys(errors).length) {
      res.status(422);
      return page(req, res, 'books', 'Add a book', A.bookForm({ csrf: res.locals.csrf, book: v, errors, categories: await books.categories(), isNew: true }));
    }
    const cover = await coverFrom(req.body);
    const row = await db.one(`INSERT INTO books (title, subtitle, author, isbn, category, audience, format, description, tags, publisher,
      published_year, pages, copies_total, shelf_location, cover_image, cover_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [v.title, v.subtitle, v.author, v.isbn, v.category, v.audience, v.format, v.description, v.tags, v.publisher,
      v.published_year, v.pages, v.copies_total, v.shelf_location, cover ? cover.data : null, cover ? cover.type : null]);
    security.flash(req, 'ok', `Added “${v.title}”.`);
    res.redirect(req.body.and_new ? '/admin/books/new' : `/admin/books/${row.id}/edit`);
  });

  app.get('/admin/books/:id/edit', requireStaff, async (req, res) => {
    const book = await books.get(intParam(req.params.id));
    if (!book) throw new HttpError(404, 'That book wasn’t found.');
    await page(req, res, 'books', 'Edit book', A.bookForm({ csrf: res.locals.csrf, book, categories: await books.categories(), history: await checkouts.forBook(book.id) }));
  });

  app.post('/admin/books/:id', requireStaff, async (req, res) => {
    const id = intParam(req.params.id);
    const existing = await books.get(id);
    if (!existing) throw new HttpError(404, 'That book wasn’t found.');
    const { v, errors } = bookValues(req.body);
    if (Object.keys(errors).length) {
      res.status(422);
      return page(req, res, 'books', 'Edit book', A.bookForm({ csrf: res.locals.csrf, book: { ...existing, ...v }, errors, categories: await books.categories() }));
    }
    await db.query(`UPDATE books SET title=$2, subtitle=$3, author=$4, isbn=$5, category=$6, audience=$7, format=$8, description=$9, tags=$10,
      publisher=$11, published_year=$12, pages=$13, copies_total=$14, shelf_location=$15, active=$16, updated_at=now() WHERE id=$1`,
    [id, v.title, v.subtitle, v.author, v.isbn, v.category, v.audience, v.format, v.description, v.tags, v.publisher,
      v.published_year, v.pages, v.copies_total, v.shelf_location, req.body.active === '1']);
    const cover = await coverFrom(req.body);
    if (cover) await db.query('UPDATE books SET cover_image = $2, cover_type = $3 WHERE id = $1', [id, cover.data, cover.type]);
    else if (req.body.remove_cover === '1') await db.query('UPDATE books SET cover_image = NULL, cover_type = NULL WHERE id = $1', [id]);
    security.flash(req, 'ok', `Saved “${v.title}”.`);
    res.redirect(`/admin/books/${id}/edit`);
  });

  app.post('/admin/books/:id/delete', requireStaff, async (req, res) => {
    const id = intParam(req.params.id);
    const book = await books.get(id);
    if (!book) throw new HttpError(404, 'That book wasn’t found.');
    if (book.out_count > 0) {
      security.flash(req, 'error', `“${book.title}” is on hold or checked out. Check it in or cancel the hold first.`);
      return res.redirect(`/admin/books/${id}/edit`);
    }
    const used = await db.one('SELECT count(*)::int AS n FROM checkouts WHERE book_id = $1', [id]);
    if (used.n) {
      await db.query('UPDATE books SET active = false, updated_at = now() WHERE id = $1', [id]);
      security.flash(req, 'ok', `“${book.title}” is archived and hidden from the catalog. Its checkout history is kept.`);
    } else {
      await db.query('DELETE FROM books WHERE id = $1', [id]);
      security.flash(req, 'ok', `“${book.title}” was removed.`);
    }
    res.redirect('/admin/books');
  });

  app.get('/admin/books/import', requireStaff, async (req, res) => {
    await page(req, res, 'books', 'Import books', A.importPage({ csrf: res.locals.csrf }));
  });

  app.get('/admin/books/template.csv', requireStaff, async (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="library-books-template.csv"');
    res.send([
      'title,subtitle,author,isbn,category,audience,format,description,tags,publisher,year,pages,copies,shelf',
      '"Mere Christianity",,"C. S. Lewis",9780060652920,Apologetics,Adults,Book,"Lewis explains the core of Christian belief.","faith, reason",HarperOne,1952,227,2,A-4',
      '"The Jesus Storybook Bible","Every Story Whispers His Name","Sally Lloyd-Jones",9780310708254,Children,Children,Book,,"bible stories, kids",Zonderkidz,2007,351,1,Children\'s corner',
    ].join('\r\n') + '\r\n');
  });

  app.post('/admin/books/import', requireStaff, async (req, res) => {
    const rows = parseCsvObjects(req.body.csv || '');
    const result = { added: 0, skipped: [] };
    const skipDup = req.body.skip_duplicates === '1';
    for (let i = 0; i < rows.length && i < 5000; i++) {
      const r = rows[i];
      const { v, errors } = bookValues({ ...r, published_year: r.year || r.published_year, copies_total: r.copies || r.copies_total || 1 });
      if (errors.title) { result.skipped.push({ row: i + 2, reason: 'no title' }); continue; }
      if (r.audience && !AUDIENCES.includes(r.audience)) v.audience = /child|kid/i.test(r.audience) ? 'Children' : /teen|youth/i.test(r.audience) ? 'Youth' : /adult/i.test(r.audience) ? 'Adults' : 'Everyone';
      if (skipDup) {
        const dup = v.isbn
          ? await db.one('SELECT id FROM books WHERE isbn = $1 LIMIT 1', [v.isbn])
          : await db.one('SELECT id FROM books WHERE lower(title) = lower($1) AND lower(COALESCE(author, \'\')) = lower(COALESCE($2, \'\')) LIMIT 1', [v.title, v.author]);
        if (dup) { result.skipped.push({ row: i + 2, reason: `“${v.title}” is already in the catalog` }); continue; }
      }
      await db.query(`INSERT INTO books (title, subtitle, author, isbn, category, audience, format, description, tags, publisher, published_year, pages, copies_total, shelf_location)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [v.title, v.subtitle, v.author, v.isbn, v.category, v.audience, v.format, v.description, v.tags, v.publisher, v.published_year, v.pages, v.copies_total, v.shelf_location]);
      result.added++;
    }
    if (!rows.length) result.skipped.push({ row: 1, reason: 'no rows found. Make sure the first line has the column names.' });
    await page(req, res, 'books', 'Import books', A.importPage({ csrf: res.locals.csrf, result }));
  });

  // ---------- Applications (librarian) ----------
  app.get('/admin/applications', requireLibrarian, async (req, res) => {
    const pending = await db.many("SELECT * FROM users WHERE status = 'pending' ORDER BY created_at");
    const recent = await db.many("SELECT id, first_name, last_name, status FROM users WHERE status IN ('approved','denied') AND role = 'patron' ORDER BY COALESCE(approved_at, created_at) DESC LIMIT 10");
    await page(req, res, 'applications', 'Applications', A.applicationsPage({ csrf: res.locals.csrf, pending, recent, s: req.settings }));
  });

  app.post('/admin/applications/:id/approve', requireLibrarian, async (req, res) => {
    const u = await users.get(intParam(req.params.id));
    if (!u) throw new HttpError(404, 'That person wasn’t found.');
    if (u.status === 'approved') {
      security.flash(req, 'ok', `${fullName(u)} is already approved.`);
    } else {
      const updated = await approve(u);
      notify.approved(updated);
      security.flash(req, 'ok', `Approved ${fullName(u)}. Their library code is ${updated.library_code}, and it was emailed to them.`);
    }
    res.redirect(back(req, '/admin/applications'));
  });

  app.post('/admin/applications/:id/deny', requireLibrarian, async (req, res) => {
    const u = await db.one("UPDATE users SET status = 'denied' WHERE id = $1 AND status = 'pending' AND role = 'patron' RETURNING *", [intParam(req.params.id)]);
    if (u) {
      notify.denied(u);
      security.flash(req, 'ok', `${fullName(u)}'s application was denied.`);
    }
    res.redirect('/admin/applications');
  });

  app.post('/admin/settings/auto-approve', requireLibrarian, async (req, res) => {
    const on = req.body.auto_approve === '1';
    req.settings = await settingsStore.set({ auto_approve: on });
    security.flash(req, 'ok', on ? 'Automatic approval is on. New applicants are approved right away.' : 'Automatic approval is off. You’ll review new applications.');
    res.redirect('/admin/applications');
  });

  // ---------- Patrons ----------
  app.get('/admin/patrons', requireStaff, async (req, res) => {
    const q = clean(req.query.q, 200);
    const status = ['approved', 'pending', 'paused', 'denied'].includes(req.query.status) ? req.query.status : '';
    const where = [];
    const params = [];
    if (status) { params.push(status); where.push(`u.status = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      where.push(`(u.first_name || ' ' || u.last_name ILIKE $${i} OR u.email ILIKE $${i} OR u.phone ILIKE $${i} OR u.library_code ILIKE $${i})`);
    }
    const rows = await db.many(`SELECT u.*, (SELECT count(*) FROM checkouts c WHERE c.user_id = u.id AND c.status IN ('reserved','checked_out'))::int AS active_count
      FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.last_name, u.first_name LIMIT 500`, params);
    const countRows = await db.many('SELECT status, count(*)::int AS n FROM users GROUP BY status');
    const counts = { all: countRows.reduce((a, r) => a + r.n, 0) };
    for (const r of countRows) counts[r.status] = r.n;
    await page(req, res, 'patrons', 'Patrons', A.patronsPage({ rows, q, status, counts }));
  });

  async function patronView(req, res, id, extra = {}) {
    const patron = await users.get(id);
    if (!patron) throw new HttpError(404, 'That person wasn’t found.');
    const items = await checkouts.forUser(id);
    await page(req, res, 'patrons', null, A.patronPage({ user: req.user, patron, items, csrf: res.locals.csrf, now: new Date(), ...extra }));
  }

  app.get('/admin/patrons/:id', requireStaff, async (req, res) => patronView(req, res, intParam(req.params.id)));

  app.post('/admin/patrons/:id', requireLibrarian, async (req, res) => {
    const id = intParam(req.params.id);
    const email = clean(req.body.email, 200).toLowerCase();
    const first = clean(req.body.first_name, 120);
    const last = clean(req.body.last_name, 120);
    if (!first || !last || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      security.flash(req, 'error', 'Name and a valid email are required.');
      return res.redirect(`/admin/patrons/${id}`);
    }
    const clash = await users.byEmail(email);
    if (clash && clash.id !== id) {
      security.flash(req, 'error', 'Another account already uses that email.');
      return res.redirect(`/admin/patrons/${id}`);
    }
    const rest = ['phone', 'address', 'city', 'state', 'zip'].map((k) => clean(req.body[k], 120) || null);
    await db.query('UPDATE users SET first_name=$2, last_name=$3, email=$4, phone=$5, address=$6, city=$7, state=$8, zip=$9 WHERE id=$1', [id, first, last, email, ...rest]);
    security.flash(req, 'ok', 'Details saved.');
    res.redirect(`/admin/patrons/${id}`);
  });

  app.post('/admin/patrons/:id/pause', requireLibrarian, async (req, res) => {
    const id = intParam(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'You can’t pause your own account.');
    const u = await db.one("UPDATE users SET status = 'paused' WHERE id = $1 AND status = 'approved' RETURNING *", [id]);
    if (u) { notify.paused(u); security.flash(req, 'ok', `${fullName(u)}'s account is paused.`); }
    res.redirect(`/admin/patrons/${id}`);
  });

  app.post('/admin/patrons/:id/resume', requireLibrarian, async (req, res) => {
    const id = intParam(req.params.id);
    const u = await db.one("UPDATE users SET status = 'approved' WHERE id = $1 AND status = 'paused' RETURNING *", [id]);
    if (u) security.flash(req, 'ok', `${fullName(u)}'s account is active again.`);
    res.redirect(`/admin/patrons/${id}`);
  });

  app.post('/admin/patrons/:id/reset-password', requireLibrarian, async (req, res) => {
    const id = intParam(req.params.id);
    const temp = security.tempPassword();
    await db.query('UPDATE users SET password_hash = $2, reset_token_hash = NULL, reset_expires = NULL WHERE id = $1', [id, await security.hashPassword(temp)]);
    await db.query("DELETE FROM sessions WHERE data->>'userId' = $1", [String(id)]);
    await patronView(req, res, id, { tempPassword: temp });
  });

  app.post('/admin/patrons/:id/delete', requireLibrarian, async (req, res) => {
    const id = intParam(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'You can’t delete your own account.');
    const u = await users.get(id);
    if (!u) throw new HttpError(404, 'That person wasn’t found.');
    if (await users.activeCount(id)) {
      security.flash(req, 'error', `${fullName(u)} still has books on hold or checked out. Check them in or cancel the holds first.`);
      return res.redirect(`/admin/patrons/${id}`);
    }
    if (u.role === 'librarian') {
      const n = (await db.one("SELECT count(*)::int AS n FROM users WHERE role = 'librarian'")).n;
      if (n <= 1) throw new HttpError(400, 'The library needs at least one librarian.');
    }
    await db.query("DELETE FROM sessions WHERE data->>'userId' = $1", [String(id)]);
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    security.flash(req, 'ok', `${fullName(u)}'s account was deleted.`);
    res.redirect('/admin/patrons');
  });

  // ---------- Staff (librarian) ----------
  const staffList = () => db.many("SELECT * FROM users WHERE role IN ('librarian','assistant') ORDER BY role DESC, last_name");

  app.get('/admin/staff', requireLibrarian, async (req, res) => {
    await page(req, res, 'staff', 'Staff', A.staffPage({ csrf: res.locals.csrf, staff: await staffList(), user: req.user }));
  });

  app.post('/admin/staff/promote', requireLibrarian, async (req, res) => {
    const who = clean(req.body.who, 200);
    const role = req.body.role === 'librarian' ? 'librarian' : 'assistant';
    const u = who.includes('@') ? await users.byEmail(who) : await db.one('SELECT * FROM users WHERE library_code = $1', [normalCode(who)]);
    if (!u) {
      security.flash(req, 'error', 'No account has that email or library code. Use “Create a new staff account” instead.');
      return res.redirect('/admin/staff');
    }
    let updated = u;
    if (u.status !== 'approved') updated = await approve(u);
    await db.query('UPDATE users SET role = $2 WHERE id = $1', [u.id, role]);
    security.flash(req, 'ok', `${fullName(updated)} is now ${role === 'librarian' ? 'a librarian' : 'an assistant'}.`);
    res.redirect('/admin/staff');
  });

  app.post('/admin/staff/create', requireLibrarian, async (req, res) => {
    const first = clean(req.body.first_name, 120);
    const last = clean(req.body.last_name, 120);
    const email = clean(req.body.email, 200).toLowerCase();
    const role = req.body.role === 'librarian' ? 'librarian' : 'assistant';
    if (!first || !last || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      security.flash(req, 'error', 'First name, last name and a valid email are required.');
      return res.redirect('/admin/staff');
    }
    if (await users.byEmail(email)) {
      security.flash(req, 'error', 'That email already has an account. Use “Give an existing patron staff access”.');
      return res.redirect('/admin/staff');
    }
    const temp = security.tempPassword();
    const code = await users.nextCode();
    await db.query(`INSERT INTO users (email, password_hash, first_name, last_name, role, status, library_code, approved_at)
      VALUES ($1,$2,$3,$4,$5,'approved',$6, now())`, [email, await security.hashPassword(temp), first, last, role, code]);
    await page(req, res, 'staff', 'Staff', A.staffPage({ csrf: res.locals.csrf, staff: await staffList(), user: req.user, tempPassword: temp, created: `${first} ${last}` }));
  });

  app.post('/admin/staff/:id/remove', requireLibrarian, async (req, res) => {
    const id = intParam(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'You can’t remove your own staff access.');
    const u = await users.get(id);
    if (u && u.role === 'librarian') {
      const n = (await db.one("SELECT count(*)::int AS n FROM users WHERE role = 'librarian'")).n;
      if (n <= 1) throw new HttpError(400, 'The library needs at least one librarian.');
    }
    if (u) {
      await db.query("UPDATE users SET role = 'patron' WHERE id = $1", [id]);
      security.flash(req, 'ok', `${fullName(u)} no longer has staff access.`);
    }
    res.redirect('/admin/staff');
  });

  // ---------- Settings (librarian) ----------
  app.get('/admin/settings', requireLibrarian, async (req, res) => {
    await page(req, res, 'settings', 'Settings', A.settingsPage({ csrf: res.locals.csrf, s: req.settings, mailOn: mailer.enabled(), pushOn: push.enabled() }));
  });

  app.post('/admin/settings', requireLibrarian, async (req, res) => {
    const b = req.body;
    const time = (v, fb) => (/^\d{2}:\d{2}$/.test(v || '') ? v : fb);
    const today = t.dateKey(new Date());
    const closed = String(b.closed_dates || '').split(/[\s,]+/).map((x) => x.trim())
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= today);
    const days = [].concat(b.pickup_days || []).map(Number).filter((d) => d >= 1 && d <= 7);
    const s = req.settings;
    const next = {
      checkout_days: int(b.checkout_days, { min: 1, max: 365, fallback: s.checkout_days }),
      max_books: int(b.max_books, { min: 1, max: 50, fallback: s.max_books }),
      max_extensions: int(b.max_extensions, { min: 0, max: 10, fallback: s.max_extensions }),
      missed_pickup_days: int(b.missed_pickup_days, { min: 1, max: 30, fallback: s.missed_pickup_days }),
      auto_approve: b.auto_approve === '1',
      pickup_days: days.length ? [...new Set(days)].sort() : s.pickup_days,
      pickup_start: time(b.pickup_start, s.pickup_start),
      pickup_end: time(b.pickup_end, s.pickup_end),
      slot_minutes: int(b.slot_minutes, { min: 5, max: 120, fallback: s.slot_minutes }),
      slot_capacity: int(b.slot_capacity, { min: 1, max: 20, fallback: s.slot_capacity }),
      booking_window_days: int(b.booking_window_days, { min: 1, max: 90, fallback: s.booking_window_days }),
      min_lead_minutes: int(b.min_lead_minutes, { min: 0, max: 2880, fallback: s.min_lead_minutes }),
      closed_dates: [...new Set(closed)].sort(),
      library_name: clean(b.library_name, 150) || s.library_name,
      short_name: clean(b.short_name, 40) || s.short_name,
      church_name: clean(b.church_name, 150) || s.church_name,
      welcome_message: clean(b.welcome_message, 600) || s.welcome_message,
      library_address: clean(b.library_address, 200),
      contact_phone: clean(b.contact_phone, 40),
      contact_email: clean(b.contact_email, 120),
    };
    if (next.pickup_end <= next.pickup_start) {
      security.flash(req, 'error', 'Closing time must be after opening time. Nothing was saved.');
      return res.redirect('/admin/settings');
    }
    if (!days.length) security.flash(req, 'error', 'Pick at least one pickup day. The previous days were kept.');
    req.settings = await settingsStore.set(next);
    security.flash(req, 'ok', 'Settings saved.');
    res.redirect('/admin/settings');
  });
};

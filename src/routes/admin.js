'use strict';
const db = require('../db');
const security = require('../lib/security');
const settingsStore = require('../settings');
const { HttpError } = require('../lib/http');
const { books, users, checkouts, fullName, SORTS } = require('../models');
const A = require('../views/admin');
const P = require('../views/parts');
const notify = require('../notify');
const mailer = require('../lib/mailer');
const push = require('../lib/push');
const isbnLib = require('../lib/isbn');
const covers = require('../covers');
const woo = require('../lib/woo');
const { parseCsvObjects } = require('../lib/csv');
const t = require('../lib/time');
const { requireStaff, requireLibrarian, intParam, clean } = require('./guards');
const publicRoutes = require('./public');
const { approve, normalCode } = publicRoutes;
const refreshSearch = () => publicRoutes.clearSearchCache && publicRoutes.clearSearchCache();

const PAGE = 50;
const FORMATS = ['Book', 'Paperback', 'Hardback', 'Board Book', 'Large Print', 'Workbook', 'Audiobook', 'CD', 'DVD', 'Blu-ray', 'Pamphlet', 'Other'];
const AUDIENCES = ['Everyone', 'Adults', 'Youth', 'Children'];

async function pendingCount() {
  return (await db.one("SELECT count(*)::int AS n FROM users WHERE status = 'pending'")).n;
}

// Render a page inside the librarian shell.
async function page(req, res, current, title, body) {
  const pending = req.user.role === 'librarian' ? await pendingCount() : 0;
  const toConfirm = await checkouts.toConfirmCount();
  res.render(A.shell({ user: req.user, current, pending, toConfirm, body, title }), { title, current: 'admin', wide: true });
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
    audience: AUDIENCES.includes(body.audience) ? body.audience : 'Adults',
    format: clean(body.format, 40) || 'Book',
    description: clean(body.description, 8000) || null,
    tags: clean(body.tags, 500) || null,
    publisher: clean(body.publisher, 200) || null,
    published_year: int(body.published_year, { min: 1000, max: 2200 }),
    pages: int(body.pages, { min: 1, max: 100000 }),
    copies_total: int(body.copies_total ?? body.copies, { min: 0, max: 999, fallback: 1 }),
    shelf_location: clean(body.shelf_location ?? body.shelf, 80) || null,
    call_number: clean(body.call_number, 40) || null,
    series: clean(body.series, 200) || null,
    subcategory: clean(body.subcategory, 200) || null,
    short_description: clean(body.short_description, 500) || null,
  };
  // Category from the checklist ("Christian Fiction › Historical Fiction"), or a new one typed in.
  const newName = clean(body.new_category_name, 80).replace(/[›>]/g, '-');
  const path = newName
    ? [clean(body.new_category_parent, 300), newName].filter(Boolean).join(' › ')
    : body.category_path !== undefined ? clean(body.category_path, 300) : null;
  if (path !== null) {
    const parts = path.split('›').map((x) => x.trim()).filter(Boolean);
    v.category = parts[0] || null;
    v.subcategory = parts.length > 1 ? parts.slice(1).join(' › ') : null;
  }
  // Attributes kept as details (only the ones on the form; others from the old system are left alone).
  const DETAIL_FORM = { detail_illustrator: 'Illustrator', detail_reading_level: 'Reading Level', detail_read_by: 'Book read by', detail_rated: 'Rated', detail_running_time: 'Running Time' };
  if (Object.keys(DETAIL_FORM).some((k) => k in body)) {
    v.detailUpdates = {};
    for (const [field, key] of Object.entries(DETAIL_FORM)) if (field in body) v.detailUpdates[key] = clean(body[field], 120);
  }
  const errors = {};
  if (!v.title) errors.title = 'A title is required.';
  return { v, errors };
}

function mergeDetails(existing, updates) {
  if (!updates) return existing || null;
  const out = { ...(existing || {}) };
  for (const [k, val] of Object.entries(updates)) { if (val) out[k] = val; else delete out[k]; }
  return Object.keys(out).length ? out : null;
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
    const confirm = await checkouts.toConfirm();
    await page(req, res, 'home', 'Today', A.home({ user: req.user, csrf: res.locals.csrf, todays, overdue, pending, counts, s: req.settings, now, confirm }));
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

  // ---- "Confirm this pickup" tasks: the patron's chosen time works, or the librarian sets a new one.
  const sameVisit = async (id) => {
    const c = await db.one("SELECT user_id, pickup_at FROM checkouts WHERE id = $1 AND status = 'reserved'", [id]);
    return c ? db.many("SELECT id FROM checkouts WHERE user_id = $1 AND pickup_at = $2 AND status = 'reserved'", [c.user_id, c.pickup_at]) : [];
  };
  app.post('/admin/checkouts/:id/confirm', requireStaff, async (req, res) => {
    const ids = (await sameVisit(intParam(req.params.id))).map((r) => r.id);
    if (ids.length) await db.query('UPDATE checkouts SET confirmed_at = now(), confirmed_by = $2 WHERE id = ANY($1::int[])', [ids, req.user.id]);
    security.flash(req, 'ok', ids.length ? 'Pickup confirmed.' : 'That hold was already handled.');
    res.redirect(back(req, '/admin'));
  });
  app.post('/admin/checkouts/:id/reschedule', requireStaff, async (req, res) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(req.body.pickup_at || ''));
    if (!m) { security.flash(req, 'error', 'Choose a new pickup date and time.'); return res.redirect(back(req, '/admin')); }
    const when = t.zoned(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
    if (when < new Date()) { security.flash(req, 'error', 'The new pickup time is in the past.'); return res.redirect(back(req, '/admin')); }
    const ids = (await sameVisit(intParam(req.params.id))).map((r) => r.id);
    if (!ids.length) { security.flash(req, 'error', 'That hold was already handled.'); return res.redirect(back(req, '/admin')); }
    await db.query('UPDATE checkouts SET pickup_at = $2, confirmed_at = now(), confirmed_by = $3, pickup_reminder_sent = false WHERE id = ANY($1::int[])', [ids, when, req.user.id]);
    const items = await db.many('SELECT c.*, b.title FROM checkouts c JOIN books b ON b.id = c.book_id WHERE c.id = ANY($1::int[]) ORDER BY c.id', [ids]);
    const patron = await users.get(items[0].user_id);
    notify.rescheduled(patron, items);
    security.flash(req, 'ok', `Pickup moved to ${t.fmtDateTime(when)}. We emailed ${patron.first_name} the new time.`);
    res.redirect(back(req, '/admin'));
  });

  app.post('/admin/checkouts/:id/pickup', requireStaff, async (req, res) => {
    const due = t.endOfLocalDay(new Date(), Number(req.settings.checkout_days));
    const c = await db.one(`UPDATE checkouts SET status = 'checked_out', picked_up_at = now(), due_at = $2, confirmed_at = COALESCE(confirmed_at, now())
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
    const noCover = req.query.nocover === '1';
    const pg = Math.max(1, parseInt(req.query.page, 10) || 1);
    const sort = SORTS[req.query.sort] ? req.query.sort : 'title';
    const { rows, total } = await books.list({ q, category, noCover, includeInactive: true }, { limit: PAGE, offset: (pg - 1) * PAGE, sort });
    const keep = { q, category, nocover: noCover ? '1' : '' };
    const params = new URLSearchParams(Object.entries({ ...keep, sort: sort === 'title' ? '' : sort }).filter(([, v]) => v));
    await page(req, res, 'books', 'Books', A.booksPage({
      rows, q, category, noCover, total, page: pg, pages: Math.ceil(total / PAGE), base: `/admin/books?${params}`,
      sort, sortBase: `/admin/books?${new URLSearchParams(Object.entries(keep).filter(([, v]) => v))}`, sorts: Object.entries(SORTS).map(([k, v]) => [k, v.label]),
      categories: await books.categories(), coverStatus: await covers.status(), csrf: res.locals.csrf,
    }));
  });

  app.get('/admin/books/new', requireStaff, async (req, res) => {
    await page(req, res, 'books', 'Add a book', A.bookForm({ csrf: res.locals.csrf, book: { copies_total: 1 }, categoryPaths: await books.categoryPaths(), isNew: true }));
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
      return page(req, res, 'books', 'Add a book', A.bookForm({ csrf: res.locals.csrf, book: v, errors, categoryPaths: await books.categoryPaths(), isNew: true }));
    }
    const cover = await coverFrom(req.body);
    const details = mergeDetails(null, v.detailUpdates);
    const row = await db.one(`INSERT INTO books (title, subtitle, author, isbn, category, audience, format, description, tags, publisher,
      published_year, pages, copies_total, shelf_location, call_number, series, subcategory, cover_image, cover_type, cover_status,
      short_description, details, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
    [v.title, v.subtitle, v.author, v.isbn, v.category, v.audience, v.format, v.description, v.tags, v.publisher,
      v.published_year, v.pages, v.copies_total, v.shelf_location, v.call_number, v.series, v.subcategory,
      cover ? cover.data : null, cover ? cover.type : null, cover ? 'done' : 'none',
      v.short_description, details ? JSON.stringify(details) : null, req.body.active_present ? req.body.active === '1' : true]);
    refreshSearch();
    security.flash(req, 'ok', `Added “${v.title}”.`);
    res.redirect(req.body.and_new ? '/admin/books/new' : `/admin/books/${row.id}/edit`);
  });

  app.get('/admin/books/:id/edit', requireStaff, async (req, res) => {
    const book = await books.get(intParam(req.params.id));
    if (!book) throw new HttpError(404, 'That book wasn’t found.');
    await page(req, res, 'books', 'Edit book', A.bookForm({ csrf: res.locals.csrf, book, categoryPaths: await books.categoryPaths(), history: await checkouts.forBook(book.id) }));
  });

  // From the book page: set or clear the book's badge (bestseller, award, classic...).
  app.post('/admin/books/:id/notable', requireStaff, async (req, res) => {
    const id = intParam(req.params.id);
    const kind = P.NOTABLE_KINDS.some(([k]) => k === req.body.kind) ? req.body.kind : null;
    const row = await db.one(`UPDATE books SET notable = $2, notable_kind = $3, notable_note = CASE WHEN $2 THEN notable_note ELSE NULL END
      WHERE id = $1 RETURNING title`, [id, !!kind, kind]);
    if (!row) throw new HttpError(404, 'That book wasn’t found.');
    refreshSearch();
    const label = kind && P.NOTABLE_KINDS.find(([k]) => k === kind)[2];
    security.flash(req, 'ok', kind ? `“${row.title}” now shows the “${label}” badge. You can add a short line about it on the edit page.` : `Removed the badge from “${row.title}”.`);
    res.redirect(`/books/${id}`);
  });

  app.post('/admin/books/:id', requireStaff, async (req, res) => {
    const id = intParam(req.params.id);
    const existing = await books.get(id);
    if (!existing) throw new HttpError(404, 'That book wasn’t found.');
    const { v, errors } = bookValues(req.body);
    if (Object.keys(errors).length) {
      res.status(422);
      return page(req, res, 'books', 'Edit book', A.bookForm({ csrf: res.locals.csrf, book: { ...existing, ...v }, errors, categoryPaths: await books.categoryPaths() }));
    }
    const details = mergeDetails(existing.details, v.detailUpdates);
    await db.query(`UPDATE books SET title=$2, subtitle=$3, author=$4, isbn=$5, category=$6, audience=$7, format=$8, description=$9, tags=$10,
      publisher=$11, published_year=$12, pages=$13, copies_total=$14, shelf_location=$15, active=$16, call_number=$17, series=$18, subcategory=$19,
      short_description=$20, details=$21, updated_at=now() WHERE id=$1`,
    [id, v.title, v.subtitle, v.author, v.isbn, v.category, v.audience, v.format, v.description, v.tags, v.publisher,
      v.published_year, v.pages, v.copies_total, v.shelf_location, req.body.active === '1', v.call_number, v.series, v.subcategory,
      v.short_description, details ? JSON.stringify(details) : null]);
    if (req.body.notable_form === '1') {
      const kind = P.NOTABLE_KINDS.some(([k]) => k === req.body.notable_kind) ? req.body.notable_kind : null;
      await db.query('UPDATE books SET notable = $2, notable_kind = $3, notable_note = $4 WHERE id = $1', [id, !!kind, kind, kind ? clean(req.body.notable_note, 200) || null : null]);
    }
    const cover = await coverFrom(req.body);
    if (cover) await db.query("UPDATE books SET cover_image = $2, cover_type = $3, cover_status = 'done', cover_note = 'added by staff' WHERE id = $1", [id, cover.data, cover.type]);
    else if (req.body.remove_cover === '1') await db.query("UPDATE books SET cover_image = NULL, cover_type = NULL, cover_status = 'none' WHERE id = $1", [id]);
    refreshSearch();
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
    refreshSearch();
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
    const text = String(req.body.csv || '');
    const skipDup = req.body.skip_duplicates === '1';
    const result = { added: 0, updated: 0, skipped: [], format: 'simple', coversQueued: 0 };

    if (woo.isWooExport(text)) {
      // The old library system's export: add new books, update ones imported before (matched by old ID).
      result.format = 'old';
      const { books: rows, skipped } = woo.parseWoo(text);
      result.skipped.push(...skipped);
      const existing = new Set((await db.many('SELECT legacy_id FROM books WHERE legacy_id IS NOT NULL')).map((r) => r.legacy_id));
      const COLS = ['legacy_id', 'call_number', 'title', 'author', 'category', 'subcategory', 'audience', 'format', 'description', 'tags',
        'publisher', 'published_year', 'pages', 'series', 'copies_total', 'active', 'details', 'cover_source_url', 'short_description'];
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const params = [];
        const values = chunk.map((b) => {
          const ph = COLS.map((c) => { params.push(c === 'details' ? (b.details ? JSON.stringify(b.details) : null) : b[c]); return `$${params.length}`; });
          return `(${ph.join(',')}, 'pending')`;
        });
        await db.query(`INSERT INTO books (${COLS.join(', ')}, cover_status) VALUES ${values.join(',\n')}
          ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET
            call_number = EXCLUDED.call_number, title = EXCLUDED.title, author = EXCLUDED.author, category = EXCLUDED.category,
            subcategory = EXCLUDED.subcategory, audience = EXCLUDED.audience, format = EXCLUDED.format, description = EXCLUDED.description,
            tags = EXCLUDED.tags, publisher = EXCLUDED.publisher, published_year = EXCLUDED.published_year, pages = EXCLUDED.pages,
            series = EXCLUDED.series, copies_total = EXCLUDED.copies_total, active = EXCLUDED.active, details = EXCLUDED.details,
            cover_source_url = EXCLUDED.cover_source_url, short_description = EXCLUDED.short_description,
            cover_status = CASE WHEN books.cover_image IS NULL THEN 'pending' ELSE books.cover_status END,
            updated_at = now()`, params);
        for (const b of chunk) { if (existing.has(b.legacy_id)) result.updated++; else result.added++; }
      }
    refreshSearch();
      result.coversQueued = (await db.one("SELECT count(*)::int AS n FROM books WHERE cover_status = 'pending'")).n;
      covers.kick();
    } else {
      const rows = parseCsvObjects(text);
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
        await db.query(`INSERT INTO books (title, subtitle, author, isbn, category, audience, format, description, tags, publisher, published_year, pages,
          copies_total, shelf_location, call_number, series, subcategory, cover_status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'none')`,
        [v.title, v.subtitle, v.author, v.isbn, v.category, v.audience, v.format, v.description, v.tags, v.publisher, v.published_year, v.pages,
          v.copies_total, v.shelf_location, v.call_number, v.series, v.subcategory]);
        result.added++;
      }
      if (!rows.length) result.skipped.push({ row: 1, reason: 'no rows found. Make sure the first line has the column names.' });
    }
    await page(req, res, 'books', 'Import books', A.importPage({ csrf: res.locals.csrf, result }));
  });

  // Download the whole catalog in the old library system's format.
  app.get('/admin/books/export.csv', requireStaff, async (req, res) => {
    const rows = await db.many(`SELECT ${require('../models').BOOK_COLS} FROM ${require('../models').BOOK_FROM} ORDER BY b.title`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cbc-library-export-${t.dateKey(new Date())}.csv"`);
    res.send('\uFEFF' + woo.toWooCsv(rows, notify.BASE_URL));
  });

  // ---------- Covers ----------
  app.get('/admin/covers/status', requireStaff, async (req, res) => res.json(await covers.status()));

  app.post('/admin/covers/find-missing', requireStaff, async (req, res) => {
    const n = await covers.queueMissing();
    security.flash(req, 'ok', n ? `Looking for covers for ${n} book${n === 1 ? '' : 's'}. This runs in the background; you can keep working.` : 'Every book that can have a cover already has one or is being looked up.');
    res.redirect('/admin/books');
  });

  app.post('/admin/books/:id/find-cover', requireStaff, async (req, res) => {
    const id = intParam(req.params.id);
    await covers.queueBook(id);
    security.flash(req, 'ok', 'Looking for a cover now. Refresh this page in a few seconds.');
    res.redirect(`/admin/books/${id}/edit`);
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
    await page(req, res, 'patrons', 'Patrons', A.patronsPage({ rows, q, status, counts, csrf: res.locals.csrf, user: req.user }));
  });

  // Add a patron directly (no application needed). They get an email with their code and a set-password link.
  app.post('/admin/patrons/new', requireLibrarian, async (req, res) => {
    const first = clean(req.body.first_name, 120);
    const last = clean(req.body.last_name, 120);
    const email = clean(req.body.email, 200).toLowerCase();
    if (!first || !last || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      security.flash(req, 'error', 'First name, last name and a valid email are required.');
      return res.redirect('/admin/patrons');
    }
    if (await users.byEmail(email)) {
      security.flash(req, 'error', 'That email already has an account.');
      return res.redirect('/admin/patrons');
    }
    const tok = security.token(24);
    const row = await db.one(`INSERT INTO users (email, password_hash, first_name, last_name, phone, role, status, library_code, approved_at, reset_token_hash, reset_expires)
      VALUES ($1, $2, $3, $4, $5, 'patron', 'approved', $6, now(), $7, now() + interval '7 days') RETURNING id`,
    [email, await security.hashPassword(security.tempPassword()), first, last, clean(req.body.phone, 40) || null, await users.nextCode(), security.sha256(tok)]);
    const u = await users.get(row.id);
    notify.accountCreated(u, { link: notify.url(`/reset/${tok}`), role: 'patron', addedBy: fullName(req.user) });
    security.flash(req, 'ok', `Added ${fullName(u)} (library code ${u.library_code}). We emailed them their code and a link to set their password.`);
    res.redirect(`/admin/patrons/${u.id}`);
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
    if (u) { notify.resumed(u); security.flash(req, 'ok', `${fullName(u)}'s account is active again. We emailed them.`); }
    res.redirect(`/admin/patrons/${id}`);
  });

  app.post('/admin/patrons/:id/reset-password', requireLibrarian, async (req, res) => {
    const id = intParam(req.params.id);
    const temp = security.tempPassword();
    const tok = security.token(24);
    await db.query("UPDATE users SET password_hash = $2, reset_token_hash = $3, reset_expires = now() + interval '7 days' WHERE id = $1", [id, await security.hashPassword(temp), security.sha256(tok)]);
    await db.query("DELETE FROM sessions WHERE data->>'userId' = $1", [String(id)]);
    notify.passwordSetByStaff(await users.get(id), notify.url(`/reset/${tok}`));
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
    if (u.role !== role) notify.staffRole(updated, role);
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
    const tok = security.token(24);
    const row = await db.one(`INSERT INTO users (email, password_hash, first_name, last_name, role, status, library_code, approved_at, reset_token_hash, reset_expires)
      VALUES ($1,$2,$3,$4,$5,'approved',$6, now(), $7, now() + interval '7 days') RETURNING id`, [email, await security.hashPassword(temp), first, last, role, code, security.sha256(tok)]);
    notify.accountCreated(await users.get(row.id), { link: notify.url(`/reset/${tok}`), role, addedBy: fullName(req.user) });
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

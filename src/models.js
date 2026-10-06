'use strict';
// Shared queries for books, patrons and checkouts.
const db = require('./db');

const BOOK_COLS = `b.id, b.title, b.subtitle, b.author, b.isbn, b.category, b.audience, b.format, b.description,
  b.tags, b.publisher, b.published_year, b.pages, b.copies_total, b.shelf_location, b.active,
  b.created_at, b.updated_at, (b.cover_image IS NOT NULL) AS has_cover,
  GREATEST(b.copies_total - COALESCE(a.n, 0), 0)::int AS available, COALESCE(a.n, 0)::int AS out_count`;
const BOOK_FROM = `books b LEFT JOIN (
  SELECT book_id, count(*) AS n FROM checkouts WHERE status IN ('reserved','checked_out') GROUP BY book_id
) a ON a.book_id = b.id`;

const ACTIVE = `status IN ('reserved','checked_out')`;

function bookFilters({ q, category, audience, format, available, includeInactive } = {}) {
  const where = [];
  const params = [];
  if (!includeInactive) where.push('b.active');
  if (q) {
    params.push(`%${q.trim()}%`);
    const i = params.length;
    where.push(`(b.title ILIKE $${i} OR b.subtitle ILIKE $${i} OR b.author ILIKE $${i} OR b.isbn ILIKE $${i} OR b.tags ILIKE $${i} OR b.category ILIKE $${i} OR b.description ILIKE $${i})`);
  }
  if (category) { params.push(category); where.push(`b.category = $${params.length}`); }
  if (audience) { params.push(audience); where.push(`b.audience = $${params.length}`); }
  if (format) { params.push(format); where.push(`b.format = $${params.length}`); }
  if (available) where.push('b.copies_total - COALESCE(a.n, 0) > 0');
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const books = {
  async list(filters = {}, { limit = 60, offset = 0, order = 'b.title' } = {}) {
    const { where, params } = bookFilters(filters);
    const rows = await db.many(`SELECT ${BOOK_COLS} FROM ${BOOK_FROM} ${where} ORDER BY ${order} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params);
    const count = await db.one(`SELECT count(*)::int AS n FROM ${BOOK_FROM} ${where}`, params);
    return { rows, total: count.n };
  },
  all: () => db.many(`SELECT ${BOOK_COLS} FROM ${BOOK_FROM} WHERE b.active ORDER BY b.title`),
  recent: (n = 18) => db.many(`SELECT ${BOOK_COLS} FROM ${BOOK_FROM} WHERE b.active ORDER BY b.created_at DESC LIMIT ${Number(n)}`),
  get: (id) => db.one(`SELECT ${BOOK_COLS} FROM ${BOOK_FROM} WHERE b.id = $1`, [id]),
  categories: () => db.many(`SELECT category, count(*)::int AS n FROM books WHERE active AND category IS NOT NULL AND category <> '' GROUP BY category ORDER BY category`),
  count: async () => (await db.one('SELECT count(*)::int AS n, COALESCE(sum(copies_total),0)::int AS copies FROM books WHERE active')),
};

const USER_COLS = `id, email, first_name, last_name, phone, address, city, state, zip, about, role, status,
  library_code, notify_email, created_at, approved_at, last_login_at`;

const users = {
  get: (id) => db.one(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]),
  byEmail: (email) => db.one('SELECT * FROM users WHERE lower(email) = lower($1)', [String(email || '').trim()]),
  staffEmails: async (roles = ['librarian']) => (await db.many(
    `SELECT email FROM users WHERE role = ANY($1::text[]) AND notify_email AND status = 'approved'`, [roles],
  )).map((r) => r.email),
  staffIds: async (roles = ['librarian', 'assistant']) => (await db.many(
    `SELECT id FROM users WHERE role = ANY($1::text[]) AND status = 'approved'`, [roles],
  )).map((r) => r.id),
  async nextCode() {
    const r = await db.one("SELECT nextval('library_code_seq')::int AS n");
    return `CBC-${r.n}`;
  },
  activeCount: async (userId) => (await db.one(`SELECT count(*)::int AS n FROM checkouts WHERE user_id = $1 AND ${ACTIVE}`, [userId])).n,
};

const CO_COLS = `c.*, b.title, b.author, b.shelf_location, (b.cover_image IS NOT NULL) AS has_cover, b.updated_at AS book_updated_at,
  u.first_name, u.last_name, u.email, u.phone, u.library_code`;
const CO_FROM = 'checkouts c JOIN books b ON b.id = c.book_id JOIN users u ON u.id = c.user_id';

const checkouts = {
  get: (id) => db.one(`SELECT ${CO_COLS} FROM ${CO_FROM} WHERE c.id = $1`, [id]),
  forUser: (userId) => db.many(`SELECT ${CO_COLS} FROM ${CO_FROM} WHERE c.user_id = $1 ORDER BY
    CASE c.status WHEN 'reserved' THEN 0 WHEN 'checked_out' THEN 1 ELSE 2 END, COALESCE(c.returned_at, c.cancelled_at, c.due_at, c.pickup_at) DESC LIMIT 200`, [userId]),
  reserved: () => db.many(`SELECT ${CO_COLS} FROM ${CO_FROM} WHERE c.status = 'reserved' ORDER BY c.pickup_at, u.last_name`),
  out: () => db.many(`SELECT ${CO_COLS} FROM ${CO_FROM} WHERE c.status = 'checked_out' ORDER BY c.due_at`),
  history: (limit = 150) => db.many(`SELECT ${CO_COLS} FROM ${CO_FROM} WHERE c.status IN ('returned','cancelled')
    ORDER BY COALESCE(c.returned_at, c.cancelled_at) DESC LIMIT ${Number(limit)}`),
  forBook: (bookId) => db.many(`SELECT ${CO_COLS} FROM ${CO_FROM} WHERE c.book_id = $1 ORDER BY c.reserved_at DESC LIMIT 50`, [bookId]),
  takenSlots: async () => {
    const rows = await db.many(`SELECT pickup_at, count(DISTINCT user_id)::int AS n FROM checkouts
      WHERE status = 'reserved' AND pickup_at >= now() - interval '1 day' GROUP BY pickup_at`);
    return new Map(rows.map((r) => [new Date(r.pickup_at).toISOString(), r.n]));
  },
  userSlots: async (userId) => new Set((await db.many(
    `SELECT DISTINCT pickup_at FROM checkouts WHERE user_id = $1 AND status = 'reserved' AND pickup_at >= now()`, [userId],
  )).map((r) => new Date(r.pickup_at).toISOString())),
};

const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ');

module.exports = { books, users, checkouts, fullName, BOOK_COLS, BOOK_FROM };

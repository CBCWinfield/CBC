'use strict';
// Database access (PostgreSQL, e.g. Neon) plus schema migrations.

const { Pool } = process.env.PG_SHIM ? require('../scripts/pg-shim') : require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Add your Neon connection string to the environment.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_SIZE || 5),
  idleTimeoutMillis: 30000,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: true },
});
pool.on?.('error', (err) => console.error('Database pool error:', err.message));

const query = (text, params = []) => pool.query(text, params);
const many = async (text, params) => (await query(text, params)).rows;
const one = async (text, params) => (await query(text, params)).rows[0] || null;

// Run fn inside a transaction. fn receives a client with the same helpers.
async function tx(fn) {
  if (!pool.connect) return fn({ query, many, one });
  const client = await pool.connect();
  const c = {
    query: (t, p = []) => client.query(t, p),
    many: async (t, p) => (await client.query(t, p)).rows,
    one: async (t, p) => (await client.query(t, p)).rows[0] || null,
  };
  try {
    await client.query('BEGIN');
    const result = await fn(c);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS settings (
        key text PRIMARY KEY,
        value jsonb NOT NULL
      );

      CREATE SEQUENCE IF NOT EXISTS library_code_seq START 1001;

      CREATE TABLE IF NOT EXISTS users (
        id serial PRIMARY KEY,
        email text NOT NULL,
        password_hash text NOT NULL,
        first_name text NOT NULL,
        last_name text NOT NULL,
        phone text,
        address text,
        city text,
        state text,
        zip text,
        about text,
        role text NOT NULL DEFAULT 'patron' CHECK (role IN ('patron','assistant','librarian')),
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','paused')),
        library_code text UNIQUE,
        notify_email boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        approved_at timestamptz,
        last_login_at timestamptz,
        reset_token_hash text,
        reset_expires timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));
      CREATE INDEX IF NOT EXISTS users_status ON users (status);

      CREATE TABLE IF NOT EXISTS books (
        id serial PRIMARY KEY,
        title text NOT NULL,
        subtitle text,
        author text,
        isbn text,
        category text,
        audience text,
        format text NOT NULL DEFAULT 'Book',
        description text,
        tags text,
        publisher text,
        published_year int,
        pages int,
        copies_total int NOT NULL DEFAULT 1 CHECK (copies_total >= 0),
        shelf_location text,
        cover_image bytea,
        cover_type text,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS books_isbn ON books (isbn);
      CREATE INDEX IF NOT EXISTS books_category ON books (category);

      CREATE TABLE IF NOT EXISTS checkouts (
        id serial PRIMARY KEY,
        book_id int NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status text NOT NULL CHECK (status IN ('reserved','checked_out','returned','cancelled')),
        reserved_at timestamptz NOT NULL DEFAULT now(),
        pickup_at timestamptz,
        picked_up_at timestamptz,
        due_at timestamptz,
        returned_at timestamptz,
        cancelled_at timestamptz,
        cancel_reason text,
        times_extended int NOT NULL DEFAULT 0,
        pickup_reminder_sent boolean NOT NULL DEFAULT false,
        due_reminder_sent boolean NOT NULL DEFAULT false,
        last_overdue_notice_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS checkouts_status ON checkouts (status);
      CREATE INDEX IF NOT EXISTS checkouts_user ON checkouts (user_id);
      CREATE INDEX IF NOT EXISTS checkouts_book ON checkouts (book_id);
      CREATE INDEX IF NOT EXISTS checkouts_pickup ON checkouts (pickup_at) WHERE status = 'reserved';

      CREATE TABLE IF NOT EXISTS sessions (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id serial PRIMARY KEY,
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint text NOT NULL UNIQUE,
        p256dh text NOT NULL,
        auth text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    // Fields from the old WooCommerce library, and the background cover finder.
    version: 2,
    sql: `
      ALTER TABLE books ADD COLUMN IF NOT EXISTS legacy_id text;
      ALTER TABLE books ADD COLUMN IF NOT EXISTS call_number text;
      ALTER TABLE books ADD COLUMN IF NOT EXISTS series text;
      ALTER TABLE books ADD COLUMN IF NOT EXISTS subcategory text;
      ALTER TABLE books ADD COLUMN IF NOT EXISTS details jsonb;
      ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_source_url text;
      ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_status text NOT NULL DEFAULT 'none';
      ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_attempts int NOT NULL DEFAULT 0;
      ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_note text;
      CREATE UNIQUE INDEX IF NOT EXISTS books_legacy_id ON books (legacy_id) WHERE legacy_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS books_call_number ON books (call_number);
      CREATE INDEX IF NOT EXISTS books_cover_pending ON books (id) WHERE cover_status = 'pending';
      UPDATE books SET cover_status = 'done' WHERE cover_image IS NOT NULL AND cover_status = 'none';
    `,
  },
];

async function migrate() {
  await query('CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await many('SELECT version FROM schema_migrations')).map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    console.log(`Applying database migration ${m.version}…`);
    await tx(async (c) => {
      await c.query(m.sql);
      await c.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
    });
  }
}

module.exports = { pool, query, many, one, tx, migrate };

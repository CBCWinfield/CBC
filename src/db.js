'use strict';
// Database access (PostgreSQL, e.g. Neon) plus schema migrations.

const pgLib = process.env.PG_SHIM ? require('../scripts/pg-shim') : require('pg');
const { Pool } = pgLib;
// Keep calendar dates (birthdays, event dates) as plain "YYYY-MM-DD" text so time zones can't shift them.
if (pgLib.types) pgLib.types.setTypeParser(1082, (v) => v);

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
  {
    // The old system's separate "Short description".
    version: 3,
    sql: `ALTER TABLE books ADD COLUMN IF NOT EXISTS short_description text;`,
  },
  {
    // Church check-in: families, people, safety info, waivers, events and attendance.
    version: 4,
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_role text CHECK (checkin_role IN ('admin','coadmin','leader','volunteer'));

      CREATE TABLE IF NOT EXISTS families (
        id serial PRIMARY KEY,
        name text NOT NULL,
        address text, city text, state text, zip text,
        home_phone text,
        staff_notes text,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','new','archived')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by int REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS families_name ON families (lower(name));

      CREATE TABLE IF NOT EXISTS people (
        id serial PRIMARY KEY,
        family_id int NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('adult','child')),
        first_name text NOT NULL,
        last_name text NOT NULL,
        preferred_name text,
        birthdate date,
        gender text,
        grade text,
        relationship text,
        is_primary boolean NOT NULL DEFAULT false,
        email text,
        phone text,
        contact_method text,
        user_id int REFERENCES users(id) ON DELETE SET NULL,
        allergies text,
        medical_notes text,
        medications text,
        special_needs text,
        custody_alert boolean NOT NULL DEFAULT false,
        custody_notes text,
        photo_consent boolean,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS people_family ON people (family_id);
      CREATE INDEX IF NOT EXISTS people_user ON people (user_id);
      CREATE INDEX IF NOT EXISTS people_names ON people (lower(first_name), lower(last_name));

      CREATE TABLE IF NOT EXISTS emergency_contacts (
        id serial PRIMARY KEY,
        family_id int NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        name text NOT NULL, relationship text, phone text NOT NULL, email text
      );

      CREATE TABLE IF NOT EXISTS authorized_pickups (
        id serial PRIMARY KEY,
        family_id int NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        name text NOT NULL, relationship text, phone text,
        not_allowed boolean NOT NULL DEFAULT false,
        notes text
      );

      CREATE TABLE IF NOT EXISTS waivers (
        id serial PRIMARY KEY,
        family_id int NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        kind text NOT NULL,
        version text NOT NULL,
        children text,
        signer_name text NOT NULL,
        signer_relationship text,
        signer_user_id int REFERENCES users(id) ON DELETE SET NULL,
        signed_at timestamptz NOT NULL DEFAULT now(),
        ip text, user_agent text,
        text_snapshot text NOT NULL,
        text_hash text NOT NULL
      );
      CREATE INDEX IF NOT EXISTS waivers_family ON waivers (family_id);

      CREATE TABLE IF NOT EXISTS family_invites (
        id serial PRIMARY KEY,
        family_id int REFERENCES families(id) ON DELETE CASCADE,
        email text NOT NULL,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_by int REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS events (
        id serial PRIMARY KEY,
        name text NOT NULL,
        event_date date NOT NULL,
        created_by int REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (name, event_date)
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id serial PRIMARY KEY,
        event_id int NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        person_id int NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        family_id int NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        security_code text NOT NULL,
        checked_in_at timestamptz NOT NULL DEFAULT now(),
        checked_in_by int REFERENCES users(id) ON DELETE SET NULL,
        checked_out_at timestamptz,
        checked_out_by int REFERENCES users(id) ON DELETE SET NULL,
        checked_out_to text,
        UNIQUE (event_id, person_id)
      );
      CREATE INDEX IF NOT EXISTS attendance_event ON attendance (event_id);
      CREATE INDEX IF NOT EXISTS attendance_code ON attendance (event_id, security_code);

      CREATE TABLE IF NOT EXISTS checkin_audit (
        id serial PRIMARY KEY,
        user_id int REFERENCES users(id) ON DELETE SET NULL,
        action text NOT NULL,
        family_id int,
        person_id int,
        detail text,
        at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    // Check-in, round two: guests, class override, policies and the serving calendar.
    version: 5,
    sql: `
      ALTER TABLE people ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;
      ALTER TABLE people ADD COLUMN IF NOT EXISTS class_override text;
      ALTER TABLE people ADD COLUMN IF NOT EXISTS guest_note text;
      -- Photos live in their own table so lists of people stay light.
      ALTER TABLE people ADD COLUMN IF NOT EXISTS photo_at timestamptz;
      CREATE TABLE IF NOT EXISTS person_photos (
        person_id int PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
        data bytea NOT NULL,
        content_type text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS policies (
        id serial PRIMARY KEY,
        title text NOT NULL,
        description text,
        filename text,
        mime text,
        data bytea,
        size int,
        audience text NOT NULL DEFAULT 'team' CHECK (audience IN ('team','everyone')),
        requires_ack boolean NOT NULL DEFAULT false,
        created_by int REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS policy_acks (
        policy_id int NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        acked_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (policy_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS serve_services (
        id serial PRIMARY KEY,
        service_date date NOT NULL,
        name text NOT NULL,
        start_time text,
        cancelled boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (service_date, name)
      );
      CREATE TABLE IF NOT EXISTS serve_slots (
        id serial PRIMARY KEY,
        service_id int NOT NULL REFERENCES serve_services(id) ON DELETE CASCADE,
        area text NOT NULL CHECK (area IN ('Nursery','Toddlers','Kids','Teens','Adults')),
        user_id int REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL,
        email text,
        note text,
        created_by int REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS serve_slots_service ON serve_slots (service_id);
      CREATE INDEX IF NOT EXISTS serve_slots_user ON serve_slots (user_id);

      CREATE TABLE IF NOT EXISTS print_jobs (
        id serial PRIMARY KEY,
        event_id int NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        family_id int NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        people text NOT NULL,
        include_parent boolean NOT NULL DEFAULT true,
        summary text,
        status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','printed','cancelled')),
        created_by int REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        printed_at timestamptz,
        printed_by int REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS print_jobs_status ON print_jobs (status, created_at);

      -- Saved event names (the choices on the station). Archived names stop showing as choices.
      CREATE TABLE IF NOT EXISTS event_names (
        id serial PRIMARY KEY,
        name text NOT NULL,
        archived boolean NOT NULL DEFAULT false,
        notes text,
        created_by int REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS event_names_lower ON event_names (lower(name));
      INSERT INTO event_names (name, created_at)
        SELECT DISTINCT ON (lower(name)) name, created_at FROM events ORDER BY lower(name), created_at
        ON CONFLICT DO NOTHING;

      -- Each person's notification and privacy choices (missing keys use the defaults in prefs.js).
      ALTER TABLE users ADD COLUMN IF NOT EXISTS prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

      -- Automatic emails the admins can switch on/off and reword.
      CREATE TABLE IF NOT EXISTS automations (
        key text PRIMARY KEY,
        enabled boolean NOT NULL DEFAULT true,
        subject text,
        body text,
        updated_by int REFERENCES users(id) ON DELETE SET NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS automation_log (
        id serial PRIMARY KEY,
        key text NOT NULL,
        ref text NOT NULL,
        email text,
        user_id int REFERENCES users(id) ON DELETE SET NULL,
        sent_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (key, ref)
      );

      -- Inbox: conversations between users (one-to-one or groups).
      CREATE TABLE IF NOT EXISTS conversations (
        id serial PRIMARY KEY,
        title text,
        is_group boolean NOT NULL DEFAULT false,
        created_by int REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_message_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id int NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at timestamptz NOT NULL DEFAULT now(),
        last_read_at timestamptz,
        last_emailed_at timestamptz,
        muted boolean NOT NULL DEFAULT false,
        left_at timestamptz,
        PRIMARY KEY (conversation_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS conversation_members_user ON conversation_members (user_id);
      CREATE TABLE IF NOT EXISTS messages (
        id serial PRIMARY KEY,
        conversation_id int NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id int REFERENCES users(id) ON DELETE SET NULL,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS messages_conv ON messages (conversation_id, id);
      CREATE TABLE IF NOT EXISTS message_reports (
        id serial PRIMARY KEY,
        message_id int NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id int REFERENCES users(id) ON DELETE SET NULL,
        reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz,
        resolved_by int REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS user_blocks (
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, blocked_id)
      );
    `,
  },
  {
    // Training, required policies, incident reports, group messages, prayer wall, anniversaries.
    version: 6,
    sql: `
      ALTER TABLE people ADD COLUMN IF NOT EXISTS anniversary date;
      -- New library welcome wording (only if the librarian hadn't already changed it).
      UPDATE settings SET value = to_jsonb('Borrow Christian books, Bibles, devotionals and family reading at no cost. Our library consists of over 3000 offerings. All of which have been lovingly, meticulously, and diligently selected for its quality moral content. You will not find immoral books in our library. We thank God for the opportunity to offer the public such a rich selection of Christian work. Apply for a free library account, reserve books online, and pick them up during library hours.'::text)
        WHERE key = 'welcome_message' AND value = to_jsonb('Borrow Christian books, Bibles, devotionals and family reading at no cost. Apply for a free library account, reserve books online, and pick them up during library hours.'::text);
      ALTER TABLE policies ADD COLUMN IF NOT EXISTS body text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS training_waived_at timestamptz;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS training_waived_by int REFERENCES users(id) ON DELETE SET NULL;

      CREATE TABLE IF NOT EXISTS training_completions (
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        module text NOT NULL,
        version text NOT NULL,
        completed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, module)
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id serial PRIMARY KEY,
        occurred_at timestamptz NOT NULL,
        event_id int REFERENCES events(id) ON DELETE SET NULL,
        location text,
        category text NOT NULL,
        severity text NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor','moderate','serious')),
        person_ids text,
        people_text text,
        description text NOT NULL,
        action_taken text,
        first_aid boolean NOT NULL DEFAULT false,
        witnesses text,
        parent_notified boolean NOT NULL DEFAULT false,
        parent_notified_how text,
        authorities_contacted boolean NOT NULL DEFAULT false,
        authorities_detail text,
        follow_up text,
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','closed')),
        admin_notes text,
        reported_by int REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        reviewed_by int REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS incidents_status ON incidents (status, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS broadcasts (
        id serial PRIMARY KEY,
        title text,
        body text NOT NULL,
        kind text NOT NULL DEFAULT 'info' CHECK (kind IN ('info','confirm')),
        yes_label text,
        no_label text,
        audience text,
        created_by int REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS broadcast_recipients (
        broadcast_id int NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        response text CHECK (response IN ('yes','no')),
        responded_at timestamptz,
        PRIMARY KEY (broadcast_id, user_id)
      );
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS broadcast_id int REFERENCES broadcasts(id) ON DELETE SET NULL;
      CREATE TABLE IF NOT EXISTS message_templates (
        id serial PRIMARY KEY,
        title text NOT NULL,
        body text NOT NULL,
        kind text NOT NULL DEFAULT 'info' CHECK (kind IN ('info','confirm')),
        yes_label text,
        no_label text,
        created_by int REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS prayers (
        id serial PRIMARY KEY,
        user_id int REFERENCES users(id) ON DELETE CASCADE,
        body text NOT NULL,
        anonymous boolean NOT NULL DEFAULT false,
        audience text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone','team')),
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','hidden')),
        answered_note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS prayers_recent ON prayers (status, created_at DESC);
      CREATE TABLE IF NOT EXISTS prayer_praying (
        prayer_id int NOT NULL REFERENCES prayers(id) ON DELETE CASCADE,
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (prayer_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS prayer_comments (
        id serial PRIMARY KEY,
        prayer_id int NOT NULL REFERENCES prayers(id) ON DELETE CASCADE,
        user_id int REFERENCES users(id) ON DELETE SET NULL,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `,
  },
  {
    // Church contact details: correct any blank or placeholder values saved in Library settings.
    version: 7,
    sql: `
      UPDATE settings SET value = to_jsonb('904 Wheat Rd, Winfield, KS 67156'::text)
        WHERE key = 'library_address' AND (value #>> '{}' = '' OR value #>> '{}' ILIKE '%church st%' OR value #>> '{}' NOT ILIKE '%winfield%');
      UPDATE settings SET value = to_jsonb('(620) 221-2980'::text)
        WHERE key = 'contact_phone' AND (value #>> '{}' = '' OR value #>> '{}' LIKE '%555-%');
      UPDATE settings SET value = to_jsonb('centralbaptistchurchcalendar@gmail.com'::text)
        WHERE key = 'contact_email' AND (value #>> '{}' = '' OR value #>> '{}' ILIKE '%example.com%');
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

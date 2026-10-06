'use strict';
const path = require('node:path');
const { App, HttpError, bodyParser, serveStatic } = require('./lib/http');
const security = require('./lib/security');
const db = require('./db');
const settings = require('./settings');
const { users } = require('./models');
const { layout } = require('./views/layout');
const V = require('./views/public');
const reminders = require('./reminders');
const covers = require('./covers');

const app = new App();
const PORT = Number(process.env.PORT || 3000);
const TRUST_PROXY = process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === '1';

// Client IP (Render sits behind a proxy).
app.use(async (req, res, next) => {
  const fwd = TRUST_PROXY && req.headers['x-forwarded-for'];
  req.ip = fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress;
  await next();
});

app.use(security.headers());

// Health check for Render and UptimeRobot (no database or session work).
app.use(async (req, res, next) => {
  if (req.path === '/healthz') return res.type('text/plain').send('ok');
  await next();
});

app.use(serveStatic(path.join(__dirname, '..', 'public'), { maxAge: 86400 }));
// The catalog import accepts a large spreadsheet; everything else stays small.
app.use(bodyParser({ limit: (req) => (req.path === '/admin/books/import' ? 30 : 6) * 1024 * 1024 }));
app.use(security.sessions());
app.use(security.csrf());

// Load the signed-in user and settings, and give every page a render helper.
app.use(async (req, res, next) => {
  req.settings = await settings.get();
  if (req.session.userId) {
    req.user = await users.get(req.session.userId);
    if (!req.user) delete req.session.userId;
  }
  res.render = (body, opts = {}) => {
    res.send(layout({
      body,
      user: req.user,
      csrf: res.locals.csrf,
      flash: security.takeFlash(req),
      settings: req.settings,
      ...opts,
    }).toString());
  };
  await next();
});

require('./routes/public')(app);
require('./routes/account')(app);
require('./routes/admin')(app);
require('./checkin/routes')(app);

app.notFound = async (req, res) => {
  res.status(404);
  if (!res.render) return res.send('Not found');
  res.render(V.errorPage({ status: 404 }), { title: 'Page not found' });
};

app.errorHandler = async (err, req, res) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return;
  res.statusCode = status;
  const message = status >= 500 ? 'Something went wrong on our end. Please try again in a moment.' : err.message;
  if ((req.headers.accept || '').includes('application/json') || req.path.startsWith('/api/')) {
    return res.json({ error: message });
  }
  if (res.render) return res.render(V.errorPage({ status, message }), { title: 'Error' });
  res.send(message);
};

async function bootstrap() {
  await db.migrate();
  await settings.load();

  // First librarian account, from ADMIN_EMAIL / ADMIN_PASSWORD.
  const librarians = await db.one("SELECT count(*)::int AS n FROM users WHERE role = 'librarian'");
  if (!librarians.n) {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (email && password) {
      const existing = await users.byEmail(email);
      if (existing) {
        await db.query("UPDATE users SET role = 'librarian', status = 'approved', approved_at = COALESCE(approved_at, now()) WHERE id = $1", [existing.id]);
      } else {
        const code = await users.nextCode();
        await db.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, status, library_code, approved_at)
           VALUES ($1, $2, $3, $4, 'librarian', 'approved', $5, now())`,
          [email.trim(), await security.hashPassword(password), process.env.ADMIN_FIRST_NAME || 'Library', process.env.ADMIN_LAST_NAME || 'Admin', code],
        );
      }
      console.log(`Librarian account ready: ${email}`);
    } else {
      console.warn('No librarian account yet. Set ADMIN_EMAIL and ADMIN_PASSWORD, then restart.');
    }
  }

  // Primary check-in admin (Anthony Ryker by default).
  const ciAdmins = await db.one("SELECT count(*)::int AS n FROM users WHERE checkin_role = 'admin'");
  if (!ciAdmins.n) {
    const email = (process.env.CHECKIN_ADMIN_EMAIL || 'centralbaptistchurchcalendar@gmail.com').trim();
    const existing = await users.byEmail(email);
    if (existing) {
      await db.query("UPDATE users SET checkin_role = 'admin', status = 'approved' WHERE id = $1", [existing.id]);
      console.log(`Check-in primary admin: ${email}`);
    } else {
      const password = process.env.CHECKIN_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
      if (password) {
        await db.query(`INSERT INTO users (email, password_hash, first_name, last_name, role, status, library_code, approved_at, checkin_role)
          VALUES ($1, $2, $3, $4, 'patron', 'approved', $5, now(), 'admin')`,
        [email, await security.hashPassword(password), process.env.CHECKIN_ADMIN_FIRST_NAME || 'Anthony', process.env.CHECKIN_ADMIN_LAST_NAME || 'Ryker', await users.nextCode()]);
        console.log(`Check-in primary admin created: ${email}`);
      } else {
        console.warn('No check-in admin yet. Set CHECKIN_ADMIN_PASSWORD (or ADMIN_PASSWORD), then restart.');
      }
    }
  }
}

if (require.main === module) {
  bootstrap()
    .then(() => {
      app.listen(PORT, () => console.log(`Library running on port ${PORT}`));
      if (process.env.DISABLE_REMINDERS !== '1') reminders.start();
      if (process.env.DISABLE_COVERS !== '1') covers.start();
    })
    .catch((err) => {
      console.error('Startup failed:', err);
      process.exit(1);
    });
}

module.exports = { app, bootstrap };

'use strict';
// Passwords, tokens, sessions, CSRF, rate limits and security headers.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const db = require('../db');
const { HttpError } = require('./http');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltB64, keyB64] = stored.split('$');
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(key, expected);
}

const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Readable temporary password, e.g. "maple-river-4821"
const WORDS = ['psalm', 'cedar', 'river', 'grace', 'light', 'stone', 'olive', 'harvest', 'shepherd', 'morning', 'garden', 'lamp', 'mercy', 'valley', 'spring', 'bread', 'dove', 'anchor', 'meadow', 'hope'];
function tempPassword() {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${pick()}-${pick()}-${crypto.randomInt(1000, 10000)}`;
}

// ---- Sessions (stored in Postgres) ----
const COOKIE = 'cbc_sid';
const SESSION_DAYS = 30;
const secureCookies = process.env.NODE_ENV === 'production';

function sessions() {
  return async (req, res, next) => {
    const sid = req.cookies[COOKIE];
    let row = null;
    if (sid && /^[A-Za-z0-9_-]{30,64}$/.test(sid)) {
      row = await db.one('SELECT data FROM sessions WHERE id = $1 AND expires_at > now()', [sid]);
    }
    req.sessionId = row ? sid : null;
    req.session = row ? row.data : {};
    const before = JSON.stringify(req.session);

    req.regenerateSession = async () => {
      if (req.sessionId) await db.query('DELETE FROM sessions WHERE id = $1', [req.sessionId]);
      req.sessionId = null;
      req.session = { csrf: req.session.csrf };
    };
    req.destroySession = async () => {
      if (req.sessionId) await db.query('DELETE FROM sessions WHERE id = $1', [req.sessionId]);
      req.sessionId = null;
      req.session = {};
      res.cookie(COOKIE, '', { maxAge: 0, secure: secureCookies });
    };

    // Persist the session just before the response is written.
    let saving = null;
    res.saveSession = async () => {
      if (saving) return saving;
      const now = JSON.stringify(req.session);
      if (now === before && req.sessionId) return null;
      if (!Object.keys(req.session).length && !req.sessionId) return null;
      saving = (async () => {
        if (!req.sessionId) {
          req.sessionId = token(32);
          res.cookie(COOKIE, req.sessionId, { maxAge: SESSION_DAYS * 86400, secure: secureCookies });
        }
        await db.query(
          `INSERT INTO sessions (id, data, expires_at) VALUES ($1, $2::jsonb, now() + interval '${SESSION_DAYS} days')
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
          [req.sessionId, now],
        );
      })();
      return saving;
    };
    // Wrap terminal response helpers so the session is saved first.
    for (const fn of ['send', 'redirect']) {
      const orig = res[fn];
      res[fn] = (...args) => res.saveSession()
        .then(() => orig(...args))
        .catch((err) => {
          console.error('Session save failed:', err.message);
          if (!res.headersSent) { res.statusCode = 500; res.end('Something went wrong. Please try again.'); }
        });
    }
    await next();
  };
}

// ---- Flash messages ----
function flash(req, type, message) {
  (req.session.flash = req.session.flash || []).push({ type, message });
}
function takeFlash(req) {
  const f = req.session.flash || [];
  if (f.length) delete req.session.flash;
  return f;
}

// ---- CSRF ----
function csrf() {
  return async (req, res, next) => {
    if (!req.session.csrf) req.session.csrf = token(24);
    res.locals.csrf = req.session.csrf;
    if (req.method === 'POST') {
      const sent = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
      const ok = sent && sent.length === req.session.csrf.length &&
        crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrf));
      if (!ok) throw new HttpError(403, 'Your session expired. Go back, refresh the page and try again.');
    }
    await next();
  };
}

// ---- Rate limiting (in memory, per IP + key) ----
const hits = new Map();
function rateLimit(key, { max, windowMs }) {
  return async (req, res, next) => {
    const id = `${key}:${req.ip}`;
    const now = Date.now();
    const list = (hits.get(id) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
    }
    list.push(now);
    hits.set(id, list);
    await next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < 3600000)) hits.delete(k);
}, 600000).unref();

// ---- Security headers ----
function headers() {
  return async (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()'); // camera: scanning pickup tags
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "img-src 'self' data: blob: https://covers.openlibrary.org https://*.archive.org",
      "style-src 'self' https://fonts.googleapis.com",
      "style-src-attr 'unsafe-inline'",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-src 'self' https://player.vimeo.com https://www.youtube-nocookie.com https://www.youtube.com",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '));
    if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    await next();
  };
}

module.exports = {
  hashPassword, verifyPassword, token, sha256, tempPassword,
  sessions, flash, takeFlash, csrf, rateLimit, headers,
};

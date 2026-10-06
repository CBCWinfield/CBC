'use strict';
// A small, dependency-free web framework: routing, body parsing, cookies,
// static files. Kept deliberately simple so the whole app has one dependency.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function parseForm(text) {
  const out = {};
  const params = new URLSearchParams(text);
  for (const [k, v] of params) {
    if (k.endsWith('[]')) {
      const key = k.slice(0, -2);
      (out[key] = out[key] || []).push(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'That upload is too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function decorate(req, res) {
  const url = new URL(req.url, 'http://local');
  req.path = decodeURIComponent(url.pathname);
  req.query = Object.fromEntries(url.searchParams);
  req.cookies = parseCookies(req.headers.cookie);
  req.body = {};
  req.params = {};

  res.locals = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.type = (t) => { res.setHeader('Content-Type', t); return res; };
  res.send = (body) => {
    if (res.writableEnded) return;
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    res.setHeader('Content-Length', buf.length);
    res.end(req.method === 'HEAD' ? undefined : buf);
  };
  res.json = (obj) => { res.type('application/json; charset=utf-8'); res.send(JSON.stringify(obj)); };
  res.redirect = (to, code = 303) => {
    res.statusCode = code;
    res.setHeader('Location', to);
    res.end();
  };
  res.cookie = (name, value, opts = {}) => {
    let c = `${name}=${encodeURIComponent(value)}; Path=${opts.path || '/'}`;
    if (opts.maxAge != null) c += `; Max-Age=${Math.floor(opts.maxAge)}`;
    if (opts.httpOnly !== false) c += '; HttpOnly';
    c += `; SameSite=${opts.sameSite || 'Lax'}`;
    if (opts.secure) c += '; Secure';
    const prev = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
  };
}

class App {
  constructor() {
    this.middleware = [];
    this.routes = [];
    this.errorHandler = null;
    this.notFound = null;
  }

  use(fn) { this.middleware.push(fn); }

  route(method, pattern, handlers) {
    const keys = [];
    // ":id" parameters only match digits, so "/books/import" never hits "/books/:id".
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return k === 'id' ? '/(\\d+)' : '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }

  get(p, ...h) { this.route('GET', p, h); }
  post(p, ...h) { this.route('POST', p, h); }

  match(method, p) {
    for (const r of this.routes) {
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const m = r.re.exec(p);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return null;
  }

  async handle(req, res) {
    decorate(req, res);
    try {
      if (this.beforeMatch) this.beforeMatch(req); // e.g. serve the church website on its own domain
      const found = this.match(req.method, req.path);
      const chain = [...this.middleware];
      if (found) {
        req.params = found.params;
        chain.push(...found.route.handlers);
      } else if (this.notFound) {
        chain.push(this.notFound);
      }
      let i = 0;
      const next = async (err) => {
        if (err) throw err;
        const fn = chain[i++];
        if (!fn || res.writableEnded) return;
        await fn(req, res, next);
      };
      await next();
      if (!res.writableEnded && !res.headersSent && !found) {
        res.status(404).send('Not found');
      }
    } catch (err) {
      if (this.errorHandler) {
        try { await this.errorHandler(err, req, res); return; } catch (e) { console.error(e); }
      }
      console.error(err);
      if (!res.headersSent) res.status(500).send('Something went wrong.');
    }
  }

  listen(port, cb) {
    const server = http.createServer((req, res) => this.handle(req, res));
    server.listen(port, cb);
    return server;
  }
}

// Body parser middleware: urlencoded forms and JSON.
function bodyParser({ limit = 4 * 1024 * 1024 } = {}) {
  return async (req, res, next) => {
    if (req.method === 'POST') {
      const type = (req.headers['content-type'] || '').toLowerCase();
      const buf = await readBody(req, typeof limit === 'function' ? limit(req) : limit);
      const text = buf.toString('utf8');
      if (type.includes('application/json')) {
        try { req.body = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'Invalid JSON.'); }
      } else if (type.includes('application/x-www-form-urlencoded')) {
        req.body = parseForm(text);
      } else {
        req.rawBody = buf;
      }
    }
    await next();
  };
}

// Static file middleware with traversal protection.
function serveStatic(root, { maxAge = 3600 } = {}) {
  const base = path.resolve(root);
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const target = path.resolve(base, '.' + req.path);
    if (!target.startsWith(base + path.sep)) return next();
    let stat;
    try { stat = await fs.promises.stat(target); } catch { return next(); }
    if (!stat.isFile()) return next();
    const ext = path.extname(target).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', req.path === '/sw.js' ? 'no-cache' : `public, max-age=${maxAge}`);
    res.send(await fs.promises.readFile(target));
  };
}

module.exports = { App, HttpError, bodyParser, serveStatic, parseForm, parseCookies, MIME };

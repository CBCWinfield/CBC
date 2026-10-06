'use strict';
const { HttpError } = require('../lib/http');

const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : null);

async function requireUser(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.path)}`);
  await next();
}
async function requireStaff(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.path)}`);
  if (req.user.role === 'patron' || req.user.status !== 'approved') throw new HttpError(403, 'This page is for library staff.');
  await next();
}
async function requireLibrarian(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.path)}`);
  if (req.user.role !== 'librarian' || req.user.status !== 'approved') throw new HttpError(403, 'Only the librarian can do that.');
  await next();
}

const intParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Not found.');
  return n;
};

const clean = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));

module.exports = { requireUser, requireStaff, requireLibrarian, safeNext, intParam, clean };

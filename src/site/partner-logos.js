'use strict';
// Partner logos for the Ministries page, copied daily from each organization's website, trimmed, and served at
// /partner-logos/<key>.png. A logo that can't be fetched shows as the organization's name.
const crypto = require('crypto');

let sharp = null;
try { sharp = require('sharp'); } catch { /* optional: logos are served as they come without it */ }

const SOURCES = {
  scasb: { site: 'https://scasbks.com/', files: ['https://s3.amazonaws.com/mychurchwebsite/images/c6523/logo_osmst4.jpg'] },
  churchforward: { site: 'https://www.kncsb.org/', files: [] },
  sbc: { site: 'https://www.sbc.net/', files: ['https://sbcnet.wpenginepowered.com/wp-content/uploads/2020/04/sbc__logo-blue.svg'] },
  namb: { site: 'https://www.namb.net/', files: ['https://www.namb.net/wp-content/uploads/2026/03/logo.svg'] },
  imb: { site: 'https://www.imb.org/', files: ['https://www.imb.org/wp-content/uploads/2025/02/Logo.svg'] },
  bp: { site: 'https://www.baptistpress.com/', files: ['https://www.baptistpress.com/wp-content/uploads/2020/08/baptistpress__main-logo.svg'] },
  // Missions & outreach: found on each one's own homepage.
  kfl: { site: 'https://kfl.org/', files: [] },
  casas: { site: 'https://casasporcristo.org/', files: [] },
  occ: { site: 'https://www.samaritanspurse.org/what-we-do/operation-christmas-child/', files: [] },
};

const UA = 'Mozilla/5.0 (compatible; CentralBaptistWinfield/1.0; +https://cbcwinfield.org)';
const MAX_BYTES = 3 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const RETRY = 30 * 60 * 1000;
const BOX = { width: 640, height: 200 }; // twice the size shown, for sharp screens

const cache = new Map();
let timer = null;

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').replace(/&amp;/g, '&').trim() : '';
};

async function get(url, accept) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('file too large');
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_BYTES) throw new Error('file too large');
  return { data, type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), url: res.url || url };
}

// Logo addresses on a homepage, best first: images that call themselves a logo (the header logo comes
// first in the page), then a logo-named share image, then the site's app icon.
function findLogos(html, pageUrl) {
  const out = [];
  const add = (u) => {
    if (!u || /^data:/i.test(u)) return;
    try { const abs = new URL(u, pageUrl).href; if (/^https?:/.test(abs) && !out.includes(abs)) out.push(abs); } catch { /* not a URL */ }
  };
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/logo/i.test(tag)) continue;
    const set = attr(tag, 'data-srcset') || attr(tag, 'srcset');
    add(attr(tag, 'data-src') || attr(tag, 'data-lazy-src') || attr(tag, 'src') || (set && set.split(',').pop().trim().split(/\s+/)[0]));
  }
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([t]) => t);
  for (const t of metas) if (/og:image["'\s]/i.test(t) && /logo/i.test(attr(t, 'content'))) add(attr(t, 'content'));
  for (const [t] of html.matchAll(/<link\b[^>]*>/gi)) if (/apple-touch-icon/i.test(attr(t, 'rel'))) add(attr(t, 'href'));
  for (const t of metas) if (/msapplication-TileImage/i.test(t)) add(attr(t, 'content'));
  return out;
}

async function discover(site) {
  const page = await get(site, 'text/html,application/xhtml+xml');
  return findLogos(page.data.toString('utf8').slice(0, 2_000_000), page.url);
}

async function fetchImage(url) {
  const img = await get(url, 'image/svg+xml,image/png,image/webp,image/jpeg,image/*;q=0.8');
  const head = img.data.subarray(0, 4096).toString('utf8');
  const svg = img.type.includes('svg') || (/<svg\b/i.test(head) && !/<html\b/i.test(head));
  if (!svg && !/^image\/(png|jpe?g|webp|gif|avif)$/.test(img.type)) throw new Error(`not an image (${img.type || 'unknown type'})`);
  if (img.data.length < 100) throw new Error('empty file');
  return { data: img.data, svg };
}

// How a logo should sit on its tile:
//   see-through artwork that is mostly white or very light was drawn for dark backgrounds -> dark tile;
//   artwork with its own solid background -> a tile the same color as that background;
//   everything else -> white tile.
function toneOf(px, channels) {
  let opaque = 0, clear = 0, light = 0;
  for (let i = 0; i < px.length; i += channels) {
    if (px[i + 3] < 128) { clear++; continue; }
    opaque++;
    if ((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255 > 0.88) light++;
  }
  const total = opaque + clear || 1;
  if (clear / total < 0.04) return { tone: 'solid' };
  return { tone: opaque && light / opaque > 0.3 ? 'light' : 'dark' };
}

const hex = (r, g, b) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;

async function normalize({ data, svg }) {
  if (!sharp) {
    // Without sharp the file is served as it came; guess the tone from the SVG's colors.
    const text = svg ? data.toString('utf8') : '';
    const fills = text.match(/(?:fill|stroke|stop-color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|white|rgb\([^)]*\))/gi) || [];
    const white = fills.filter((f) => /#fff\b|#ffffff|white|255\s*,\s*255\s*,\s*255/i.test(f)).length;
    return { data, type: svg ? 'image/svg+xml' : 'image/png', tone: fills.length && white / fills.length > 0.5 ? 'light' : 'dark', width: null, height: null };
  }
  let density = 72;
  if (svg) {
    const meta = await sharp(data, { failOn: 'none' }).metadata();
    const scale = Math.min((BOX.width * 2) / (meta.width || 300), (BOX.height * 2) / (meta.height || 100));
    density = Math.max(18, Math.min(2400, Math.round(72 * scale)));
  }
  const flat = await sharp(data, { density, failOn: 'none', limitInputPixels: 60e6 }).rotate().ensureAlpha().png().toBuffer();
  const corner = await sharp(flat).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  let trimmed = flat;
  try { trimmed = await sharp(flat).trim({ threshold: 14 }).png().toBuffer(); } catch { /* nothing to trim */ }
  const sized = await sharp(trimmed).resize({ width: BOX.width, height: BOX.height, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const { data: px, info } = await sharp(sized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { tone } = toneOf(px, info.channels);
  const out = await sharp(sized).png({ compressionLevel: 9, palette: true, quality: 95, effort: 8 }).toBuffer();
  return { data: out, type: 'image/png', tone, bg: tone === 'solid' && corner[3] > 200 ? hex(corner[0], corner[1], corner[2]) : null, width: info.width, height: info.height };
}

async function load(key) {
  const { site, files } = SOURCES[key];
  const errors = [];
  const tryUrl = async (url) => {
    try { return { ...(await normalize(await fetchImage(url))), from: url }; } catch (e) { errors.push(`${url}: ${e.message}`); return null; }
  };
  for (const url of files) { const got = await tryUrl(url); if (got) return got; }
  let found = [];
  try { found = await discover(site); } catch (e) { errors.push(`${site}: ${e.message}`); }
  for (const url of found.filter((u) => !files.includes(u)).slice(0, 6)) { const got = await tryUrl(url); if (got) return got; }
  throw new Error(errors.join('; ') || `no logo found on ${site}`);
}

// Fetch the given logos (all of them by default). Returns the keys that failed.
async function refresh(keys = Object.keys(SOURCES)) {
  const failed = [];
  await Promise.all(keys.map(async (key) => {
    try {
      const got = await load(key);
      got.v = crypto.createHash('sha1').update(got.data).digest('hex').slice(0, 10);
      got.at = new Date();
      cache.set(key, got);
      console.log(`Partner logo ${key}: ${got.width || '?'}x${got.height || '?'} ${got.tone}${got.bg ? ` ${got.bg}` : ''}, ${got.data.length} bytes, from ${got.from}`);
    } catch (e) {
      failed.push(key);
      console.warn(`Partner logo ${key} not available yet: ${e.message.slice(0, 600)}`);
    }
  }));
  return failed;
}

// Daily refresh; logos that failed are retried every 30 minutes.
function start() {
  if (timer) return;
  const run = async (keys) => {
    const failed = await refresh(keys).catch(() => keys || Object.keys(SOURCES));
    timer = setTimeout(() => run(failed.length ? failed : undefined), failed.length ? RETRY : DAY);
    if (timer.unref) timer.unref();
  };
  timer = setTimeout(() => run(), 0);
  if (timer.unref) timer.unref();
}

// What a page needs to show a logo (sizes are as displayed), or null while it isn't available.
function info(key) {
  const c = cache.get(key);
  if (!c) return null;
  return { v: c.v, tone: c.tone, bg: c.bg || null, width: c.width ? Math.round(c.width / 2) : null, height: c.height ? Math.round(c.height / 2) : null };
}
const file = (key) => cache.get(key) || null;

module.exports = { SOURCES, start, refresh, info, file, findLogos, toneOf, normalize };

'use strict';
// What every page shows when its link is shared or previewed (Facebook, Messages, email, Slack): a picture made for
// that page (public/img/share/, drawn by scripts/share-image.js) and the Open Graph / Twitter tags that point to it.
// Library books get their own picture, made from the book's cover the first time someone shares one (bookImage).
const fs = require('fs');
const path = require('path');
const { html } = require('./lib/html');

let sharp = null;
try { sharp = require('sharp'); } catch { /* optional: without it, a book shares the library's picture */ }

// key → picture (bump ?v= after redrawing one, so Facebook fetches it again)
const V = 2;
const PICTURES = {
  home: 'A church family on Wheat Road: Central Baptist Church in Winfield, Kansas, since 1951.',
  visit: 'We saved you a seat: service times at Central Baptist Church, Sundays 9:30 and 10:45 AM and Wednesdays 6:00 PM.',
  about: 'Rooted in faith, hope, and love: Central Baptist Church, on Wheat Road in Winfield, Kansas, since 1951.',
  ministries: 'Every age, growing in Christ together: Central Kids, Central Teens, adult Bible study, the bus ministry, and missions.',
  sermons: 'Sunday’s message, any day of the week: watch past sermons from Central Baptist Church in Winfield, Kansas.',
  events: 'What’s happening at Central: the rhythm of every week at Central Baptist Church.',
  staff: 'The people who serve: the pastors, staff, and deacons of Central Baptist Church.',
  give: 'Generosity that reaches Winfield and the world: give online to Central Baptist Church through Vanco.',
  connect: 'We’d love to hear from you: call (620) 221-2980 or visit 904 Wheat Rd. in Winfield.',
  serve: 'Find your place on the team: ways to serve at Central Baptist Church.',
  ride: 'Need a ride to church? The Central Baptist Church bus picks up kids and families on Wednesday nights.',
  partners: 'Cooperating for the Gospel: the Southern Baptist family Central Baptist Church belongs to.',
  library: 'The CBC Public Christian Library: borrow books, Bibles, and DVDs, free. Reserve online, pick up at church.',
  prayer: 'Join your church family in prayer on the Central Baptist Church Prayer Wall.',
};
const picture = (key) => {
  const k = PICTURES[key] ? key : 'home';
  return { image: `/img/share/${k}.png?v=${V}`, alt: PICTURES[k], width: 1200, height: 630, type: 'image/png' };
};

// The address the site is reached at (Render answers on https; local runs on http).
function origin(req) {
  const host = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '').split(',')[0].trim();
  if (!host) return '';
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
  return `${local ? 'http' : 'https'}://${host}`;
}

// The tags. base: the absolute origin the picture is served from; url: this page's address.
function tags({ title, description, siteName, base, url, pic }) {
  const img = /^https?:/.test(pic.image) ? pic.image : `${base}${pic.image}`;
  return html`<meta property="og:site_name" content="${siteName}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description || ''}">
${url ? html`<meta property="og:url" content="${url}">` : ''}
<meta property="og:image" content="${img}">
<meta property="og:image:secure_url" content="${img.replace(/^http:/, 'https:')}">
<meta property="og:image:type" content="${pic.type || 'image/png'}">
<meta property="og:image:width" content="${pic.width || 1200}">
<meta property="og:image:height" content="${pic.height || 630}">
<meta property="og:image:alt" content="${pic.alt || title}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description || ''}">
<meta name="twitter:image" content="${img}">
<meta name="twitter:image:alt" content="${pic.alt || title}">`;
}

// ---------- a library book: its cover on the library background ----------
const FRAME = { x: 766, y: 82, w: 300, h: 450, r: 10 }; // where scripts/share-image.js leaves room for the cover
let frame = null;
const made = new Map(); // `${id}:${version}` → jpeg, the most recent 120
function bookPicture(book) {
  if (!book || !book.has_cover || !sharp) return picture('library');
  const v = new Date(book.updated_at || 0).getTime();
  return { image: `/share/book/${book.id}.jpg?v=${v}`, alt: `${book.title}${book.author ? ` by ${book.author}` : ''}, from the CBC Public Christian Library.`, width: 1200, height: 630, type: 'image/jpeg' };
}
async function bookImage(book, cover) {
  if (!sharp) return null;
  const key = `${book.id}:${new Date(book.updated_at || 0).getTime()}`;
  if (made.has(key)) return made.get(key);
  if (!frame) frame = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'share', 'book-frame.png'));
  const corners = Buffer.from(`<svg width="${FRAME.w}" height="${FRAME.h}"><rect width="${FRAME.w}" height="${FRAME.h}" rx="${FRAME.r}" ry="${FRAME.r}"/></svg>`);
  const art = await sharp(cover, { failOn: 'none' }).rotate().resize(FRAME.w, FRAME.h, { fit: 'cover', position: 'top' })
    .composite([{ input: corners, blend: 'dest-in' }]).png().toBuffer();
  const out = await sharp(frame).composite([{ input: art, left: FRAME.x, top: FRAME.y }]).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  made.set(key, out);
  if (made.size > 120) made.delete(made.keys().next().value);
  return out;
}

module.exports = { PICTURES, picture, origin, tags, bookPicture, bookImage, hasSharp: () => !!sharp };

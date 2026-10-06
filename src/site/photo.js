'use strict';
// The homepage wheat photo. If public/img/wheat-hero.jpg exists it's served directly by the
// static file handler; otherwise we fetch a public-domain USDA wheat photo once and cache it.
const fs = require('fs');
const path = require('path');
const os = require('os');

// "Golden fields of wheat fill up many cropland areas in Anson, Texas" - USDA NRCS (U.S. Government work, public domain).
const DEFAULT = 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Golden_fields_of_wheat_fill_up_many_cropland_areas_in_Anson%2C_Texas._%2824742958109%29.jpg/1920px-Golden_fields_of_wheat_fill_up_many_cropland_areas_in_Anson%2C_Texas._%2824742958109%29.jpg';
const SOURCE = process.env.WHEAT_PHOTO_URL || DEFAULT;
const LOCAL = path.join(__dirname, '..', '..', 'public', 'img', 'wheat-hero.jpg');
const CACHE = path.join(os.tmpdir(), 'cbc-wheat-hero.jpg');
let mem = null;
let failedAt = 0;

async function get() {
  if (mem) return mem;
  try { mem = fs.readFileSync(CACHE); return mem; } catch { /* not cached yet */ }
  if (Date.now() - failedAt < 10 * 60 * 1000) return null; // don't hammer the source after a failure
  try {
    const res = await fetch(SOURCE, { headers: { 'User-Agent': 'CentralBaptistChurchWebsite/1.0 (centralbaptistchurchcalendar@gmail.com)' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok || !/image\//.test(res.headers.get('content-type') || '')) throw new Error(`status ${res.status}`);
    mem = Buffer.from(await res.arrayBuffer());
    try { fs.writeFileSync(CACHE, mem); } catch { /* memory copy is enough */ }
    return mem;
  } catch (err) {
    failedAt = Date.now();
    console.error('Wheat photo fetch failed:', err.message);
    return null;
  }
}

const hasLocal = () => fs.existsSync(LOCAL);
module.exports = { get, hasLocal };

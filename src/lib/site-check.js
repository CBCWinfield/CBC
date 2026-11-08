'use strict';
// Checks the live church site the way a visitor would: every page it links to loads, every sermon video is
// still on YouTube and allowed to play on other sites, and the site sends its address to YouTube (without it
// YouTube shows "Error 153" in every player). Used by the daily job (src/site-check-job.js) and by hand:
// `node scripts/site-check.js [https://www.cbcwinfield.org]`.
const UA = 'Mozilla/5.0 (compatible; CBC-site-check/1.0; +https://github.com/CBCWinfield/CBC)';

async function get(url, opts = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow', ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(60000) });
      if (r.status < 500 || i === 2) return r;
    } catch (e) {
      if (i === 2) return { ok: false, status: 0, error: e.message, headers: new Headers(), text: async () => '' };
    }
    await new Promise((res) => setTimeout(res, 5000 * (i + 1)));
  }
}

function links(html, from, host) {
  const out = new Set();
  for (const m of html.matchAll(/\shref="([^"#]+)/g)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'), from);
      if (u.host === host && /^https?:$/.test(u.protocol)) out.add(u.origin + u.pathname);
    } catch { /* not a URL */ }
  }
  return out;
}

async function check(base, { log = () => {} } = {}) {
  const BASE = String(base).replace(/\/$/, '');
  const host = new URL(BASE).host;
  const problems = [];
  const bad = (s) => { problems.push(s); log('  PROBLEM: ' + s); };
  log('Checking ' + BASE);
  // 1. every page the site links to, two clicks deep from the home page
  const seen = new Map();
  let level = [BASE + '/'];
  for (let depth = 0; depth < 2 && level.length; depth++) {
    const next = [];
    for (const url of level) {
      if (seen.has(url)) continue;
      const r = await get(url);
      seen.set(url, r.status);
      if (!r.ok) { bad(`${url} answers ${r.status || r.error}`); continue; }
      if (!/text\/html/.test(r.headers.get('content-type') || '')) continue;
      for (const l of links(await r.text(), url, host)) if (!seen.has(l) && !/\/(checkin|admin|login|logout|api)\b/.test(l)) next.push(l);
    }
    level = [...new Set(next)];
  }
  log(`${seen.size} pages checked.`);
  // 2. the referrer YouTube needs
  const sp = await get(BASE + '/sermons');
  const rp = (sp.headers.get('referrer-policy') || '').toLowerCase();
  if (/(^|,\s*)(no-referrer|same-origin)\s*$/.test(rp)) bad(`Referrer-Policy is "${rp}": YouTube will refuse to play the sermons (Error 153)`);
  // 3. every sermon video on the home page and /sermons: still on YouTube, embedding allowed
  const ids = new Set();
  for (const p of ['/', '/sermons']) {
    const r = await get(BASE + p);
    if (r.ok) for (const m of (await r.text()).matchAll(/data-video="([\w-]{11})"/g)) ids.add(m[1]);
  }
  if (!ids.size) bad('No sermon videos found on the home page or /sermons');
  for (const id of ids) {
    const o = await get(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
    if (o.status === 401 || o.status === 403) bad(`Sermon video ${id} does not allow embedding (on YouTube, turn "Allow embedding" back on)`);
    else if (!o.ok) bad(`Sermon video ${id} is not on YouTube (${o.status || o.error}): private, deleted or wrong ID`);
  }
  log(`${ids.size} sermon videos checked.`);
  return { base: BASE, pages: seen.size, videos: ids.size, problems, at: new Date().toISOString() };
}

module.exports = { check, links };

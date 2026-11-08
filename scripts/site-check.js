#!/usr/bin/env node
'use strict';
// Daily check of the live church site, run by .github/workflows/site-check.yml (and by hand:
// `node scripts/site-check.js [https://www.cbcwinfield.org]`). It fails, and GitHub emails the
// people watching the repository, when any of these breaks:
//   - a page linked from the site (same host) does not load
//   - a sermon video on the site is gone from YouTube or will not play when embedded
//   - the site stops sending its address to YouTube (YouTube then shows "Error 153" in every player)
const BASE = (process.argv[2] || process.env.SITE_URL || 'https://www.cbcwinfield.org').replace(/\/$/, '');
const host = new URL(BASE).host;
const UA = 'Mozilla/5.0 (compatible; CBC-site-check/1.0; +https://github.com/CBCWinfield/CBC)';
const problems = [];
const say = (s) => console.log(s);
const bad = (s) => { problems.push(s); console.log('  PROBLEM: ' + s); };

async function get(url, opts = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow', ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(60000) });
      if (r.status < 500 || i === 2) return r;
    } catch (e) {
      if (i === 2) return { ok: false, status: 0, error: e.message, headers: new Headers(), text: async () => '' };
    }
    await new Promise((res) => setTimeout(res, 5000 * (i + 1))); // the free server may be waking up
  }
}

function links(html, from) {
  const out = new Set();
  for (const m of html.matchAll(/\shref="([^"#]+)/g)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'), from);
      if (u.host === host && /^https?:$/.test(u.protocol)) out.add(u.origin + u.pathname);
    } catch { /* not a URL */ }
  }
  return out;
}

async function main() {
  say('Checking ' + BASE);
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
      for (const l of links(await r.text(), url)) if (!seen.has(l) && !/\/(checkin|admin|login|logout|api)\b/.test(l)) next.push(l);
    }
    level = [...new Set(next)];
  }
  say(`${seen.size} pages checked.`);

  // 2. the referrer YouTube needs
  const home = await get(BASE + '/sermons');
  const rp = (home.headers.get('referrer-policy') || '').toLowerCase();
  if (/(^|,\s*)(no-referrer|same-origin)\s*$/.test(rp)) bad(`Referrer-Policy is "${rp}": YouTube will refuse to play the sermons (Error 153)`);

  // 3. every sermon video on the sermons page and the home page: still on YouTube, embedding allowed
  const ids = new Set();
  for (const p of ['/', '/sermons']) {
    const r = await get(BASE + p);
    if (r.ok) for (const m of (await r.text()).matchAll(/data-video="([\w-]{11})"/g)) ids.add(m[1]);
  }
  if (!ids.size) bad('No sermon videos found on the home page or /sermons');
  for (const id of ids) {
    const o = await get(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
    if (o.status === 401 || o.status === 403) bad(`Sermon video ${id} does not allow embedding (YouTube setting "Allow embedding" is off)`);
    else if (!o.ok) bad(`Sermon video ${id} is not on YouTube (${o.status || o.error}): private, deleted or wrong ID`);
  }
  say(`${ids.size} sermon videos checked.`);

  if (problems.length) {
    console.log(`\n${problems.length} problem(s) on ${BASE}:\n- ` + problems.join('\n- '));
    process.exit(1);
  }
  say('All good.');
}

main().catch((e) => { console.error(e); process.exit(1); });

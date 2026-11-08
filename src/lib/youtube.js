'use strict';
// Recent videos from the church's YouTube channel, read from YouTube's public RSS feed
// (newest first, up to 15) and cached for 20 minutes.
const CHANNEL = process.env.YOUTUBE_CHANNEL_ID || 'UC9BRxQwyc_4GnB8p-p8k-aw';
const TTL = 20 * 60 * 1000;
let cache = { at: 0, videos: [] };

const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]).trim() : ''; };

function parse(xml) {
  return (String(xml).match(/<entry>[\s\S]*?<\/entry>/g) || []).map((e) => ({
    id: tag(e, 'yt:videoId'),
    title: tag(e, 'title'),
    published: tag(e, 'published'),
    description: tag(e, 'media:description'),
    views: +((e.match(/<media:statistics views="(\d+)"/) || [])[1] || 0),
  })).filter((v) => /^[\w-]{6,20}$/.test(v.id));
}

// Can this video be watched now? The feed also lists streams scheduled for later (and ones not processed yet),
// which only show "live stream offline" when played. Their watch page says so; the answer is kept for 15 minutes.
const playCache = new Map();
// Only YouTube's own word that it is a stream not started yet counts: a server is sometimes shown a sign-in or
// "not a bot" page instead, and that must never hide a sermon.
function playableFrom(html) {
  const m = String(html).match(/"playabilityStatus":\{"status":"([A-Z_]+)"/);
  if (m && m[1] === 'LIVE_STREAM_OFFLINE') return false;
  if (/"isUpcoming":true/.test(html) && !/"isLiveNow":true/.test(html)) return false;
  return true;
}
async function playable(id) {
  const c = playCache.get(id);
  if (c && Date.now() - c.at < 15 * 60 * 1000) return c.ok;
  let ok = true; // unknown counts as playable: never hide a sermon because YouTube was slow
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { 'Accept-Language': 'en-US', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (res.ok) ok = playableFrom(await res.text());
  } catch { /* keep it */ }
  playCache.set(id, { at: Date.now(), ok });
  return ok;
}
// the newest few are the ones that can be a scheduled stream; older ones were watchable last week
// A scheduled stream also shows in the feed as a second copy of a title with no views yet, next to the real one.
function placeholders(videos) {
  const out = new Set();
  for (const v of videos.slice(0, 4)) {
    const twin = videos.find((w) => w !== v && w.title === v.title && w.views > 0);
    if (twin && !v.views) out.add(v.id);
  }
  return out;
}
async function onlyPlayable(videos) {
  const head = videos.slice(0, 4);
  const twin = placeholders(videos);
  const ok = await Promise.all(head.map((v) => (twin.has(v.id) ? false : playable(v.id))));
  return head.filter((v, i) => ok[i]).concat(videos.slice(4));
}

async function recent() {
  if (process.env.YOUTUBE_FEED_FILE) return parse(require('fs').readFileSync(process.env.YOUTUBE_FEED_FILE, 'utf8')); // tests
  if (Date.now() - cache.at < TTL && cache.videos.length) return cache.videos;
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`YouTube feed ${res.status}`);
    const videos = await onlyPlayable(parse(await res.text()));
    if (videos.length) cache = { at: Date.now(), videos };
  } catch (err) {
    console.error('YouTube feed failed:', err.message);
  }
  return cache.videos; // last good copy if YouTube is briefly unreachable
}

// Is the church streaming right now? YouTube's /live address for the channel points (rel=canonical) at the live
// video while a stream is on, and at the channel when it is not. Checked at most every 2 minutes.
let liveCache = { at: 0, video: null };
function parseLive(html) {
  const m = String(html).match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
  if (!m) return null;
  if (/"isUpcoming":true/.test(html) || !/"isLive(Now)?":true/.test(html)) return null; // scheduled, or a finished stream
  const t = String(html).match(/<meta name="title" content="([^"]*)"/);
  return { id: m[1], title: t ? decode(t[1]) : 'Live now', live: true };
}
async function live() {
  if (process.env.YOUTUBE_LIVE_FILE) return parseLive(require('fs').readFileSync(process.env.YOUTUBE_LIVE_FILE, 'utf8')); // tests
  if (Date.now() - liveCache.at < 2 * 60 * 1000) return liveCache.video;
  try {
    const res = await fetch(`https://www.youtube.com/channel/${CHANNEL}/live`, { headers: { 'Accept-Language': 'en-US', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    liveCache = { at: Date.now(), video: res.ok ? parseLive(await res.text()) : null };
  } catch (err) {
    liveCache = { at: Date.now(), video: null };
  }
  return liveCache.video;
}

// What the "watch" spots on the site show: the live stream while we're live, otherwise the newest sermon.
async function current() {
  const [on, videos] = await Promise.all([live(), recent()]);
  return { live: on, latest: on || videos[0] || null, videos: on ? videos.filter((v) => v.id !== on.id) : videos };
}

// Who preached, only when the video says so (title first, then description): "Pastor Blake Orr", "Bro. Jim Smith",
// "Rev. Dr. Ann Lee"... YouTube gives no speaker of its own, so a video that names nobody gets no name on the site.
const TITLES = '(?:Senior |Associate |Youth |Interim |Guest |Lead )?(?:Pastor|Pr\\.|Rev\\.?|Reverend|Dr\\.|Brother|Bro\\.|Evangelist|Missionary|Elder|Deacon)';
const SPEAKER = new RegExp(`\\b(${TITLES}(?:\\s+${TITLES})*\\s+[A-Z][a-zA-Z.'’-]+(?:\\s+[A-Z][a-zA-Z'’-]+){0,2})`);
function speaker(v) {
  for (const s of [v && v.title, v && v.description]) {
    const m = String(s || '').match(SPEAKER);
    if (m) return m[1].replace(/\s+/g, ' ').replace(/\s+(Sunday|Service|Sermon|Message)$/i, '').trim();
  }
  return '';
}

module.exports = { recent, parse, parseLive, playableFrom, placeholders, live, current, speaker, CHANNEL };

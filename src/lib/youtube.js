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
  })).filter((v) => /^[\w-]{6,20}$/.test(v.id));
}

async function recent() {
  if (process.env.YOUTUBE_FEED_FILE) return parse(require('fs').readFileSync(process.env.YOUTUBE_FEED_FILE, 'utf8')); // tests
  if (Date.now() - cache.at < TTL && cache.videos.length) return cache.videos;
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`YouTube feed ${res.status}`);
    const videos = parse(await res.text());
    if (videos.length) cache = { at: Date.now(), videos };
  } catch (err) {
    console.error('YouTube feed failed:', err.message);
  }
  return cache.videos; // last good copy if YouTube is briefly unreachable
}

module.exports = { recent, parse, CHANNEL };

'use strict';
// AI helpers for announcements, using OpenAI (one key does both the writing and the voice).
//   OPENAI_API_KEY   turns on AI copy polishing, narration scripts and the spoken voiceover
//   OPENAI_TEXT_MODEL (default gpt-4o-mini), OPENAI_TTS_MODEL (default gpt-4o-mini-tts), TTS_VOICE (default "sage")
// Without a key everything still works: slides use the words as typed, and reels are built without a voice.
// AI_FAKE=1 (tests) returns predictable text and a generated tone instead of calling the internet.

const KEY = () => process.env.OPENAI_API_KEY || '';
const FAKE = () => process.env.AI_FAKE === '1';
const THEMES = ['wheat', 'cross', 'kids', 'teens', 'missions', 'fellowship', 'worship', 'prayer', 'calendar', 'celebration'];

const enabled = () => FAKE() || Boolean(KEY());
const voiceEnabled = enabled;

// Pick a slide design from the words, used when AI is off or returns something unexpected.
function guessTheme(text) {
  const s = String(text || '').toLowerCase();
  const rules = [
    ['missions', /\b(mission|missions|mexico|juarez|juárez|shoebox|christmas child|lottie|annie armstrong|outreach)\b/],
    ['kids', /\b(kid|kids|child|children|vbs|nursery|toddler|preschool|awana|trunk or treat|hayride|easter egg)\b/],
    ['teens', /\b(teen|teens|youth|student|students|middle school|high school|camp)\b/],
    ['fellowship', /\b(potluck|meal|dinner|lunch|breakfast|supper|fellowship|picnic|cookout|chili|pie|food)\b/],
    ['worship', /\b(choir|worship|music|concert|sing|singing|cantata|band)\b/],
    ['prayer', /\b(pray|prayer|vigil|fasting)\b/],
    ['celebration', /\b(anniversary|celebrat|birthday|baptism|graduat|wedding|shower|75th)\b/],
    ['cross', /\b(easter|good friday|resurrection|cross|communion|lord's supper|revival)\b/],
    ['calendar', /\b(meeting|business|deadline|sign up|signup|register|schedule|closed|cancel)\b/],
  ];
  for (const [theme, re] of rules) if (re.test(s)) return theme;
  return 'wheat';
}

const clip = (s, n) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
};

// Plain fallback copy straight from what the admin typed.
function plainCopy(a) {
  return {
    headline: clip(a.title, 60),
    blurb: clip(a.description, 150),
    narration: [a.title, a.description, a.when_text, a.details].filter(Boolean).map((x) => String(x).trim().replace(/[.!?]?$/, '.')).join(' '),
    theme: guessTheme(`${a.title} ${a.description} ${a.details}`),
  };
}

async function openai(path, body, { binary = false, timeoutMs = 45000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`https://api.openai.com/v1/${path}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const msg = (await r.text()).slice(0, 300);
      throw new Error(`OpenAI ${r.status}: ${msg}`);
    }
    return binary ? Buffer.from(await r.arrayBuffer()) : r.json();
  } finally { clearTimeout(timer); }
}

async function chatJSON(system, user) {
  const out = await openai('chat/completions', {
    model: process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini',
    temperature: 0.5,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return JSON.parse(out.choices[0].message.content);
}

// Turn the admin's words into slide copy + a spoken line. Never invents facts.
async function polish(a) {
  const plain = plainCopy(a);
  if (FAKE()) return { ...plain, headline: plain.headline, blurb: plain.blurb, ai: true };
  if (!KEY()) return { ...plain, ai: false };
  try {
    const j = await chatJSON(
      `You write church announcement slides for Central Baptist Church in Winfield, Kansas (Southern Baptist). Warm, clear, joyful, never cheesy.
Return JSON: {"headline": string (max 7 words, title case, no emoji), "blurb": string (one or two short sentences, max 150 characters),
"narration": string (what a friendly announcer says aloud, 2-4 sentences, about 12-20 seconds; say dates and times naturally, e.g. "this Sunday at 10:45"),
"theme": one of ${JSON.stringify(THEMES)}}.
Use only the facts given. Never invent dates, times, places, names, prices or details. If something is missing, leave it out.`,
      JSON.stringify({ title: a.title, description: a.description, when: a.when_text, details: a.details }),
    );
    return {
      headline: clip(j.headline || plain.headline, 60),
      blurb: clip(j.blurb || plain.blurb, 160),
      narration: clip(j.narration || plain.narration, 600),
      theme: THEMES.includes(j.theme) ? j.theme : plain.theme,
      ai: true,
    };
  } catch (e) {
    console.error('AI polish failed, using the words as typed:', e.message);
    return { ...plain, ai: false };
  }
}

// The reel's opening and closing lines.
function introLine(serviceLabel, count) {
  return `Welcome to Central Baptist Church! Here ${count === 1 ? 'is your announcement' : 'are your announcements'} for ${serviceLabel}.`;
}
const OUTRO = 'We’re so glad you’re part of our church family. See you Sunday, and remember: the Cross is Central.';

// Speech for one segment (mp3). Returns { audio: Buffer, type } or null when voice is off.
async function speak(text) {
  if (FAKE()) return { audio: toneWav(Math.min(6, 1.2 + String(text).length / 40)), type: 'audio/wav' };
  if (!KEY()) return null;
  const audio = await openai('audio/speech', {
    model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    voice: process.env.TTS_VOICE || 'sage',
    input: String(text).slice(0, 3800),
    instructions: 'A warm, friendly church announcer in a small Kansas town. Smile while you talk. Clear, unhurried, upbeat, natural pauses between sentences.',
    response_format: 'mp3',
  }, { binary: true, timeoutMs: 90000 });
  return { audio, type: 'audio/mpeg' };
}

// A quiet tone as a WAV file (tests only).
function toneWav(seconds) {
  const rate = 16000, n = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 330) * 1200), 44 + i * 2);
  return buf;
}

module.exports = { enabled, voiceEnabled, polish, plainCopy, guessTheme, introLine, OUTRO, speak, THEMES };

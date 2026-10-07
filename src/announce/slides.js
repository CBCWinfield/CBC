'use strict';
// Branded announcement slides, drawn as SVG (1920×1080) with the church fonts and logo built in,
// so every slide is crisp, on-brand and readable on the website, in the reel and as a download.
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', '..', 'public');
const b64 = (f) => fs.readFileSync(path.join(PUB, f)).toString('base64');
let assets;
function A() {
  if (!assets) {
    assets = {
      fonts: `@font-face{font-family:B;src:url(data:font/woff2;base64,${b64('fonts/bricolage.woff2')}) format('woff2');font-weight:200 800}
@font-face{font-family:S;src:url(data:font/woff2;base64,${b64('fonts/instrument-sans.woff2')}) format('woff2');font-weight:400 700}
@font-face{font-family:I;src:url(data:font/woff2;base64,${b64('fonts/instrument-serif-italic.woff2')}) format('woff2');font-style:italic}`,
      white: `data:image/png;base64,${b64('img/logo-central-white.png')}`,
      kids: `data:image/webp;base64,${b64('img/central-kids.webp')}`,
      teens: `data:image/webp;base64,${b64('img/central-teens.webp')}`,
    };
  }
  return assets;
}

const W = 1920, H = 1080;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Rough text measuring (average glyph width as a share of font size) for line wrapping.
const AVG = { B: 0.56, S: 0.5, I: 0.42 };
function wrap(text, size, maxW, font) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const per = size * AVG[font];
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length * per > maxW && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
// Largest size (down to min) where the text fits in maxLines.
function fit(text, { size, min, maxW, maxLines, font }) {
  for (let s = size; s >= min; s -= 4) {
    const lines = wrap(text, s, maxW, font);
    if (lines.length <= maxLines) return { size: s, lines };
  }
  const lines = wrap(text, min, maxW, font);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
  return { size: min, lines };
}
const tspans = (lines, x, lh) => lines.map((l, i) => `<tspan x="${x}" dy="${i ? lh : 0}">${esc(l)}</tspan>`).join('');

// ---------------------------------------------------------------- themes
// bg: background, ink: headline colour, soft: body text, accent: pill colour, dark: use the white logo
const THEME = {
  wheat: { bg: ['#1F5A33', '#0C2115'], ink: '#F5F1E6', soft: '#E6DFC8', accent: '#E2BE66', accentInk: '#10261A', dark: true, label: 'Announcement' },
  cross: { bg: ['#183F27', '#081A10'], ink: '#F5F1E6', soft: '#E6DFC8', accent: '#E2BE66', accentInk: '#10261A', dark: true, label: 'Announcement' },
  kids: { bg: ['#FFE07A', '#F7B84B'], ink: '#10261A', soft: '#2E3B2A', accent: '#1F5A33', accentInk: '#FFFDF7', dark: false, label: 'Central Kids' },
  teens: { bg: ['#1C1C1C', '#050505'], ink: '#FFFFFF', soft: '#D7DDD0', accent: '#9BD14B', accentInk: '#0B140A', dark: true, label: 'Central Teens' },
  missions: { bg: ['#1E3D6B', '#0B1A33'], ink: '#F5F1E6', soft: '#D8E2F0', accent: '#E2BE66', accentInk: '#10261A', dark: true, label: 'Missions' },
  fellowship: { bg: ['#B8572F', '#6E2C14'], ink: '#FFF7EC', soft: '#F6DCC8', accent: '#FFE2A8', accentInk: '#4A1F0C', dark: true, label: 'Fellowship' },
  worship: { bg: ['#3D2A63', '#170F2B'], ink: '#F7F2FF', soft: '#DED3F2', accent: '#E2BE66', accentInk: '#1E1433', dark: true, label: 'Worship' },
  prayer: { bg: ['#22344F', '#0A1220'], ink: '#F5F1E6', soft: '#D9DEE8', accent: '#F2D68A', accentInk: '#1A2233', dark: true, label: 'Prayer' },
  calendar: { bg: ['#FFFDF7', '#EDE6D2'], ink: '#10261A', soft: '#34443A', accent: '#1F5A33', accentInk: '#FFFDF7', dark: false, label: 'Save the date' },
  celebration: { bg: ['#1F5A33', '#0C2115'], ink: '#F5F1E6', soft: '#E6DFC8', accent: '#E2BE66', accentInk: '#10261A', dark: true, label: 'Celebrate' },
};

// Simple, recognisable motif for the right-hand side of each theme.
function motif(theme, t) {
  const stalk = (x, h, rot, op) => {
    let g = `<g transform="translate(${x} ${H}) rotate(${rot})" opacity="${op}"><path d="M0 0 C2 ${-h * 0.4} -2 ${-h * 0.7} 0 ${-h}" stroke="#C9A24A" stroke-width="5" fill="none"/>`;
    for (let i = 0; i < 7; i++) {
      const y = -h + 12 + i * 22;
      g += `<ellipse cx="${i % 2 ? 11 : -11}" cy="${y}" rx="10" ry="20" transform="rotate(${i % 2 ? 22 : -22} ${i % 2 ? 11 : -11} ${y})" fill="#E2BE66"/>`;
    }
    return g + `<ellipse cx="0" cy="${-h - 6}" rx="9" ry="18" fill="#F0D58C"/></g>`;
  };
  switch (theme) {
    case 'wheat': case 'celebration': {
      let s = '';
      for (let i = 0; i < 26; i++) s += stalk(1080 + i * 33 + (i % 3) * 7, 230 + ((i * 53) % 150), ((i * 37) % 13) - 6, 0.55 + ((i * 17) % 40) / 100);
      if (theme === 'celebration') for (let i = 0; i < 46; i++) s += `<rect x="${1150 + ((i * 97) % 720)}" y="${60 + ((i * 61) % 560)}" width="16" height="9" rx="2" fill="${['#E2BE66', '#F5F1E6', '#9BD14B', '#F2A65A'][i % 4]}" transform="rotate(${(i * 41) % 180} ${1150 + ((i * 97) % 720)} ${60 + ((i * 61) % 560)})" opacity=".85"/>`;
      return s;
    }
    case 'cross':
      return `<circle cx="1530" cy="420" r="380" fill="url(#glow)"/>
        ${Array.from({ length: 16 }, (_, i) => `<rect x="1530" y="418" width="${i % 2 ? 300 : 420}" height="4" fill="#F6DE9C" opacity=".22" transform="rotate(${i * 22.5} 1530 420)"/>`).join('')}
        <path d="M1505 150h50v220h150v50h-150v520h-50V420h-150v-50h150z" fill="url(#gold)" stroke="#FFF6DA" stroke-opacity=".5" stroke-width="2"/>`;
    case 'kids':
      return `${Array.from({ length: 26 }, (_, i) => `<circle cx="${1160 + ((i * 89) % 720)}" cy="${60 + ((i * 131) % 960)}" r="${10 + (i % 5) * 9}" fill="${['#1F5A33', '#FFFDF7', '#F26B5B', '#4AA3DF'][i % 4]}" opacity=".6"/>`).join('')}
        <rect x="1180" y="330" width="660" height="400" rx="48" fill="#FFFFFF" transform="rotate(-3 1510 530)"/>
        <image href="${A().kids}" x="1200" y="370" width="620" height="320" preserveAspectRatio="xMidYMid meet" transform="rotate(-3 1510 530)"/>`;
    case 'teens':
      return `${Array.from({ length: 9 }, (_, i) => `<rect x="${1140 + i * 84}" y="${120 + ((i * 7) % 3) * 70}" width="20" height="${820 - ((i * 7) % 3) * 70}" rx="10" fill="#9BD14B" opacity="${0.12 + (i % 3) * 0.08}"/>`).join('')}
        <rect x="1180" y="340" width="660" height="380" rx="40" fill="#FFFFFF"/>
        <image href="${A().teens}" x="1200" y="370" width="620" height="320" preserveAspectRatio="xMidYMid meet"/>`;
    case 'missions':
      return `<g fill="none" stroke="#E2BE66" stroke-opacity=".55" stroke-width="4"><circle cx="1520" cy="540" r="330"/>
        <ellipse cx="1520" cy="540" rx="150" ry="330"/><ellipse cx="1520" cy="540" rx="260" ry="330"/><line x1="1190" y1="540" x2="1850" y2="540"/>
        <path d="M1215 400 Q1520 450 1825 400"/><path d="M1215 680 Q1520 630 1825 680"/></g>
        <path d="M1380 380 Q1520 220 1700 330" stroke="#F5F1E6" stroke-width="5" stroke-dasharray="14 14" fill="none"/><circle cx="1700" cy="330" r="16" fill="#F5F1E6"/>`;
    case 'fellowship':
      return `<circle cx="1530" cy="560" r="300" fill="#FFF7EC" opacity=".14"/><circle cx="1530" cy="560" r="230" fill="#FFF7EC" opacity=".92"/>
        <circle cx="1530" cy="560" r="165" fill="none" stroke="#E7C9A9" stroke-width="10"/>
        <rect x="1180" y="400" width="18" height="320" rx="9" fill="#FFF7EC" opacity=".9"/><rect x="1862" y="400" width="18" height="320" rx="9" fill="#FFF7EC" opacity=".9"/>
        <path d="M1171 400v90M1189 400v90M1207 400v90" stroke="#FFF7EC" stroke-width="7" stroke-linecap="round" opacity=".9"/>`;
    case 'worship':
      return `<g stroke="#DED3F2" stroke-opacity=".35" stroke-width="4">${[0, 1, 2, 3, 4].map((i) => `<path d="M1120 ${380 + i * 44} C1350 ${330 + i * 44} 1600 ${470 + i * 44} 1900 ${400 + i * 44}" fill="none"/>`).join('')}</g>
        <g fill="#E2BE66"><ellipse cx="1420" cy="560" rx="44" ry="32" transform="rotate(-20 1420 560)"/><rect x="1456" y="320" width="12" height="240"/>
        <ellipse cx="1640" cy="520" rx="44" ry="32" transform="rotate(-20 1640 520)"/><rect x="1676" y="280" width="12" height="240"/><path d="M1462 320 L1682 280 L1682 330 L1462 370z"/></g>`;
    case 'prayer':
      return `<circle cx="1530" cy="470" r="360" fill="url(#glow)"/>
        <rect x="1490" y="520" width="80" height="300" rx="14" fill="#F5F1E6"/><path d="M1530 380 C1490 440 1500 490 1530 510 C1560 490 1570 440 1530 380z" fill="#F2D68A"/>
        <rect x="1526" y="500" width="8" height="26" fill="#3A3A3A"/>`;
    case 'calendar':
      return `<g transform="translate(1260 220)"><rect width="540" height="600" rx="36" fill="#FFFFFF" stroke="#1F5A33" stroke-opacity=".2" stroke-width="4"/>
        <rect width="540" height="150" rx="36" fill="#1F5A33"/><rect y="110" width="540" height="40" fill="#1F5A33"/>
        <rect x="120" y="-40" width="24" height="90" rx="12" fill="#10261A"/><rect x="396" y="-40" width="24" height="90" rx="12" fill="#10261A"/>
        ${Array.from({ length: 20 }, (_, i) => `<rect x="${40 + (i % 5) * 96}" y="${190 + Math.floor(i / 5) * 96}" width="72" height="72" rx="14" fill="${i === 12 ? '#E2BE66' : '#EDE6D2'}"/>`).join('')}</g>`;
    default: return '';
  }
}

function frame(theme, inner) {
  const t = THEME[theme] || THEME.wheat;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><style>${A().fonts}</style>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.bg[0]}"/><stop offset="1" stop-color="${t.bg[1]}"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#F6DE9C" stop-opacity=".55"/><stop offset=".4" stop-color="#E2BE66" stop-opacity=".2"/><stop offset="1" stop-color="#E2BE66" stop-opacity="0"/></radialGradient>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6DA"/><stop offset=".55" stop-color="#EBCB7C"/><stop offset="1" stop-color="#B98F3A"/></linearGradient>
<radialGradient id="vig" cx=".3" cy=".25" r="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="${t.dark ? '.10' : '.35'}"/><stop offset="1" stop-color="#000000" stop-opacity="${t.dark ? '.25' : '0'}"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#vig)"/>
${inner}
</svg>`;
}

// One announcement slide.
function slide(a) {
  const theme = THEME[a.theme] ? a.theme : 'wheat';
  const t = THEME[theme];
  const X = 120, maxW = 980;
  const head = fit(a.headline || a.title, { size: 116, min: 72, maxW, maxLines: 3, font: 'B' });
  const blurb = fit(a.blurb || a.description || '', { size: 44, min: 34, maxW: 940, maxLines: 3, font: 'S' });
  const details = a.details ? fit(a.details, { size: 32, min: 28, maxW: 940, maxLines: 2, font: 'S' }) : null;
  let y = 330;
  let out = motif(theme, t);
  out += t.dark ? `<image href="${A().white}" x="${X}" y="84" width="300" height="105" preserveAspectRatio="xMinYMid meet"/>`
    : `<rect x="${X - 6}" y="78" width="324" height="118" rx="22" fill="#10261A"/><image href="${A().white}" x="${X + 12}" y="88" width="288" height="98" preserveAspectRatio="xMidYMid meet"/>`;
  out += `<rect x="${X}" y="262" width="56" height="4" fill="${t.accent}"/><text x="${X + 76}" y="276" font-family="S" font-weight="700" font-size="30" letter-spacing="5" fill="${t.accent}">${esc(t.label.toUpperCase())}</text>`;
  y += head.size * 0.95;
  out += `<text x="${X}" y="${y}" font-family="B" font-weight="800" font-size="${head.size}" letter-spacing="-2" fill="${t.ink}">${tspans(head.lines, X, head.size * 1.02)}</text>`;
  y += (head.lines.length - 1) * head.size * 1.02 + 40;
  if (blurb.lines.length && (a.blurb || a.description)) {
    y += blurb.size;
    out += `<text x="${X}" y="${y}" font-family="S" font-size="${blurb.size}" fill="${t.soft}">${tspans(blurb.lines, X, blurb.size * 1.4)}</text>`;
    y += (blurb.lines.length - 1) * blurb.size * 1.4 + 36;
  }
  if (a.when_text) {
    const label = String(a.when_text).slice(0, 60);
    const pw = Math.min(980, label.length * 40 * 0.53 + 120);
    out += `<g transform="translate(${X} ${y})"><rect width="${pw}" height="78" rx="39" fill="${t.accent}"/>
      <g transform="translate(30 21)" stroke="${t.accentInk}" stroke-width="4" fill="none"><rect x="1" y="5" width="34" height="30" rx="6"/><path d="M1 15h34M10 1v8M26 1v8"/></g>
      <text x="82" y="52" font-family="S" font-weight="700" font-size="38" fill="${t.accentInk}">${esc(label)}</text></g>`;
    y += 78 + 40;
  }
  if (details && y < H - 90) {
    y += details.size;
    out += `<text x="${X}" y="${y}" font-family="S" font-size="${details.size}" fill="${t.soft}" opacity=".85">${tspans(details.lines, X, details.size * 1.4)}</text>`;
  }
  out += `<text x="${W - 80}" y="${H - 50}" text-anchor="end" font-family="S" font-weight="600" font-size="26" fill="${t.ink}" opacity=".55">cbcwinfield.org</text>`;
  return frame(theme, out);
}

// Opening and closing card of the reel: logo + the service date.
function titleCard(dateLabel) {
  let out = '';
  for (let i = 0; i < 58; i++) {
    const x = -10 + i * 34 + (i % 3) * 6, h = 150 + ((i * 53) % 110), rot = ((i * 37) % 13) - 6;
    let g = `<g transform="translate(${x} ${H + 10}) rotate(${rot})" opacity="${0.45 + ((i * 17) % 45) / 100}"><path d="M0 0 C2 ${-h * 0.4} -2 ${-h * 0.7} 0 ${-h}" stroke="#C9A24A" stroke-width="4" fill="none"/>`;
    for (let k = 0; k < 6; k++) { const y = -h + 10 + k * 18; g += `<ellipse cx="${k % 2 ? 9 : -9}" cy="${y}" rx="8" ry="16" transform="rotate(${k % 2 ? 22 : -22} ${k % 2 ? 9 : -9} ${y})" fill="#E2BE66"/>`; }
    out += g + `<ellipse cx="0" cy="${-h - 4}" rx="7" ry="14" fill="#F0D58C"/></g>`;
  }
  out += `<circle cx="${W / 2}" cy="420" r="460" fill="url(#glow)" opacity=".6"/>`;
  out += `<image href="${A().white}" x="${W / 2 - 330}" y="150" width="660" height="231" preserveAspectRatio="xMidYMid meet"/>`;
  out += `<text x="${W / 2}" y="520" text-anchor="middle" font-family="I" font-style="italic" font-size="120" fill="#E2BE66">Announcements</text>`;
  out += `<text x="${W / 2}" y="625" text-anchor="middle" font-family="B" font-weight="800" font-size="68" letter-spacing="-1" fill="#F5F1E6">${esc(dateLabel)}</text>`;
  out += `<text x="${W / 2}" y="695" text-anchor="middle" font-family="S" font-weight="700" font-size="28" letter-spacing="6" fill="#E6DFC8" opacity=".8">THE CROSS IS CENTRAL</text>`;
  return frame('wheat', out);
}

// SVG responses carry their own fonts and logo inline.
const SVG_HEADERS = {
  'Content-Type': 'image/svg+xml; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:",
};

module.exports = { slide, titleCard, THEME, SVG_HEADERS, W, H };

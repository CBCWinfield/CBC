'use strict';
// Code 128 (set B) barcodes as SVG, for name tags and parent pickup tags.
// Readable by handheld USB/Bluetooth scanners and phone/laptop cameras.

// Bar/space widths for symbol values 0–106 (106 = stop).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

function encode(text) {
  const s = String(text);
  const values = [START_B];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error('Code 128 B supports printable ASCII only');
    values.push(c - 32);
  }
  let sum = START_B;
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, STOP);
  return values.map((v) => PATTERNS[v]).join('');
}

// Returns an SVG string. `height` in viewBox units; width scales with the data.
function svg(text, { height = 60, quiet = 10 } = {}) {
  const widths = encode(text);
  let x = quiet;
  let rects = '';
  for (let i = 0; i < widths.length; i++) {
    const w = Number(widths[i]);
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
    x += w;
  }
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" class="barcode" role="img" aria-label="Barcode ${String(text).replace(/[<&"]/g, '')}"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

module.exports = { svg, encode, PATTERNS };

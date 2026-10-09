/* The Christmas story (December) and the crucifixion and resurrection (Mar 15 – May 1), told in
   pictures on the homepage. Every caption is the King James Bible, word for word, and the pictures
   show only what those verses say. Each telling ends on the cross.
   Two ways to show it: in an arched window where the cross usually stands (.hero-story), or across
   the green banner itself as a landscape of hills the camera travels through (.hero-pano). */
(function () {
  'use strict';
  var fig = document.querySelector('.hero-story, .hero-pano');
  if (!fig) return;
  var pano = fig.classList.contains('hero-pano');
  var kind = fig.getAttribute('data-story');
  var stage = fig.querySelector(pano ? '.pano-stage' : '.story-stage');
  var canvas = fig.querySelector(pano ? '.pano-canvas' : '.story-canvas');
  if (!canvas || !canvas.getContext || (kind !== 'christmas' && kind !== 'easter')) return;
  var c = canvas.getContext('2d');
  var LW = 400, LH = 500, SC = 1, T = 0;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- small helpers ---------- */
  var INK = '#0A1510';
  var LIGHT = { dir: -1, col: 'rgba(240, 205, 130, .6)' };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ramp(v, a, b) { return clamp((v - a) / (b - a), 0, 1); }
  function ease(x) { return x * x * (3 - 2 * x); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function rng(seed) { return function () { seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hex(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function mixCol(a, b, t) { var x = hex(a), y = hex(b); return 'rgb(' + Math.round(mix(x[0], y[0], t)) + ',' + Math.round(mix(x[1], y[1], t)) + ',' + Math.round(mix(x[2], y[2], t)) + ')'; }
  function words(s) { return s.split(/\s+/).length; }

  /* ---------- painters ---------- */
  function sky(stops) {
    var g = c.createLinearGradient(0, 0, 0, LH);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    c.fillStyle = g; c.fillRect(-20, -20, LW + 40, LH + 40);
  }
  function skyMix(a, b, t) { sky(a.map(function (s, i) { return [s[0], mixCol(s[1], b[i][1], t)]; })); }
  function stars(seed, n, maxY, a) {
    if (a <= 0) return;
    var r = rng(seed); c.fillStyle = '#FFF8E6';
    for (var i = 0; i < n; i++) {
      var x = r() * LW, y = r() * maxY, s = r() * 1.1 + 0.35, sp = 0.6 + r() * 1.6;
      c.globalAlpha = a * (0.55 + 0.45 * Math.sin(T * sp + i)) * (1 - (y / maxY) * 0.55);
      c.beginPath(); c.arc(x, y, s, 0, 6.283); c.fill();
    }
    c.globalAlpha = 1;
  }
  function glow(x, y, r, rgb, a) {
    if (a <= 0.003) return;
    c.save(); c.globalCompositeOperation = 'lighter';
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(0.35, 'rgba(' + rgb + ',' + a * 0.4 + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
  }
  function ridgeY(x, y, w) { for (var i = 0; i < w.length; i++) y += w[i][0] * Math.sin((x / LW) * Math.PI * w[i][1] + w[i][2]); return y; }
  function ridge(y, w, fill, sh) {
    c.save();
    if (sh) { c.shadowColor = 'rgba(0,0,0,' + sh + ')'; c.shadowBlur = 10 * SC; c.shadowOffsetY = -2 * SC; }
    c.beginPath(); c.moveTo(-20, LH + 20);
    for (var x = -20; x <= LW + 20; x += 4) c.lineTo(x, ridgeY(x, y, w));
    c.lineTo(LW + 20, LH + 20); c.closePath(); c.fillStyle = fill; c.fill(); c.restore();
  }
  function blob(pts) {
    var n = pts.length; c.beginPath();
    c.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
    for (var i = 0; i < n; i++) { var p = pts[i], q = pts[(i + 1) % n]; c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
    c.closePath();
  }
  function rim(dir, col) {
    if (!dir) { c.shadowColor = 'transparent'; return; }
    c.shadowColor = col || LIGHT.col; c.shadowBlur = 0; c.shadowOffsetX = dir * 1.3 * SC; c.shadowOffsetY = -0.5 * SC;
  }
  function noRim() { c.shadowColor = 'transparent'; c.shadowOffsetX = 0; c.shadowOffsetY = 0; c.shadowBlur = 0; }

  // A flat-roofed house of the land, with a lit window.
  function house(x, y, w, h, col, lit, door) {
    c.fillStyle = col; c.fillRect(x, y - h, w, h); c.fillRect(x - 1.5, y - h - 2.5, w + 3, 2.5);
    if (door) { c.fillStyle = door === 'lit' ? '#E8B45E' : 'rgba(0,0,0,.55)'; c.fillRect(x + w * 0.3, y - h * 0.5, Math.max(4, w * 0.2), h * 0.5); if (door === 'lit') glow(x + w * 0.4, y - h * 0.25, h * 0.9, '232,180,94', 0.3); }
    if (lit > 0) {
      var ww = Math.max(2.5, w * 0.12), wy = y - h * 0.72;
      c.fillStyle = 'rgba(242,196,107,' + lit + ')'; c.fillRect(x + w * 0.66, wy, ww, ww * 1.2);
      glow(x + w * 0.66 + ww / 2, wy + ww / 2, ww * 4, '242,196,107', 0.22 * lit);
    }
  }
  function town(seed, cx, y, s, col, lit, n) {
    var r = rng(seed), list = [];
    for (var i = 0; i < (n || 9); i++) list.push([cx + (r() - 0.5) * 120 * s, y - r() * 18 * s, (14 + r() * 16) * s, (12 + r() * 16) * s, r() < 0.6 ? lit : 0]);
    list.sort(function (a, b) { return a[1] - b[1]; });
    list.forEach(function (hs) { house(hs[0], hs[1], hs[2], hs[3], col, hs[4]); });
  }
  function palm(x, y, h, col, sway) {
    c.save(); c.strokeStyle = col; c.fillStyle = col; c.lineCap = 'round'; c.lineWidth = h * 0.045;
    var s = Math.sin(T * 0.8 + x) * 0.5 + (sway || 0), tx = x + h * 0.1 + s * h * 0.02, ty = y - h;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + h * 0.02, y - h * 0.6, tx, ty); c.stroke();
    for (var i = 0; i < 11; i++) {
      // Fronds fan out from the crown and droop under their own weight.
      var a = -Math.PI / 2 + ((i - 5) / 5) * 1.95, L = h * (0.34 + (i % 3) * 0.03);
      var ex = tx + Math.cos(a) * L, ey = ty + Math.sin(a) * L * 0.55 + L * 0.42 * Math.abs(Math.cos(a)) + s;
      var mx = tx + Math.cos(a) * L * 0.55, my = ty + Math.sin(a) * L * 0.55 - L * 0.1;
      var nx = -(ey - ty), ny = ex - tx, nl = Math.hypot(nx, ny) || 1, w = L * 0.08; nx = (nx / nl) * w; ny = (ny / nl) * w;
      c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(mx + nx, my + ny, ex, ey); c.quadraticCurveTo(mx - nx, my - ny, tx, ty); c.fill();
    }
    c.restore();
  }
  function olive(x, y, s, col, seed) {
    var r = rng(seed || 3); c.fillStyle = col;
    c.beginPath(); c.moveTo(x - 0.1 * s, y); c.quadraticCurveTo(x - 0.02 * s, y - 0.35 * s, x - 0.14 * s, y - 0.6 * s); c.lineTo(x + 0.02 * s, y - 0.62 * s); c.quadraticCurveTo(x + 0.08 * s, y - 0.3 * s, x + 0.12 * s, y); c.closePath(); c.fill();
    for (var i = 0; i < 9; i++) { c.beginPath(); c.ellipse(x + (r() - 0.5) * 0.9 * s, y - (0.62 + r() * 0.38) * s, (0.16 + r() * 0.14) * s, (0.1 + r() * 0.08) * s, 0, 0, 6.283); c.fill(); }
  }
  function sheep(x, y, s, f, graze, body, head) {
    c.save(); c.translate(x, y); c.scale(f, 1);
    c.strokeStyle = head; c.lineWidth = s * 0.08; c.lineCap = 'round';
    [-0.24, -0.1, 0.12, 0.26].forEach(function (lx) { c.beginPath(); c.moveTo(lx * s, -0.28 * s); c.lineTo(lx * s, 0); c.stroke(); });
    c.fillStyle = body;
    [[-0.22, -0.46, 0.2], [0, -0.52, 0.24], [0.2, -0.46, 0.2], [-0.08, -0.34, 0.2], [0.13, -0.34, 0.2]].forEach(function (b) { c.beginPath(); c.arc(b[0] * s, b[1] * s, b[2] * s, 0, 6.283); c.fill(); });
    c.fillStyle = head; c.beginPath(); c.ellipse(0.44 * s, (-0.52 + graze * 0.24) * s, 0.12 * s, 0.085 * s, 0.35 + graze * 0.6, 0, 6.283); c.fill();
    c.beginPath(); c.ellipse(0.36 * s, (-0.6 + graze * 0.2) * s, 0.07 * s, 0.03 * s, -0.4, 0, 6.283); c.fill();
    c.restore();
  }
  function colt(x, y, s, f, w, col) {
    c.save(); c.translate(x, y); c.scale(f, 1); c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round'; c.lineWidth = s * 0.075;
    [-0.3, -0.18, 0.2, 0.32].forEach(function (lx, i) { var sw = Math.sin(w + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.07; c.beginPath(); c.moveTo(lx * s, -0.5 * s); c.lineTo((lx + sw) * s, 0); c.stroke(); });
    c.beginPath(); c.ellipse(0, -0.6 * s, 0.44 * s, 0.17 * s, 0, 0, 6.283); c.fill();
    c.beginPath(); c.moveTo(0.26 * s, -0.7 * s); c.lineTo(0.38 * s, -0.98 * s); c.lineTo(0.5 * s, -0.96 * s); c.lineTo(0.42 * s, -0.6 * s); c.closePath(); c.fill();
    c.beginPath(); c.ellipse(0.53 * s, -0.93 * s, 0.17 * s, 0.075 * s, 0.55, 0, 6.283); c.fill();
    c.beginPath(); c.ellipse(0.39 * s, -1.08 * s, 0.028 * s, 0.11 * s, -0.25, 0, 6.283); c.fill();
    c.beginPath(); c.ellipse(0.44 * s, -1.07 * s, 0.028 * s, 0.11 * s, 0.05, 0, 6.283); c.fill();
    c.lineWidth = s * 0.04; c.beginPath(); c.moveTo(-0.42 * s, -0.64 * s); c.quadraticCurveTo(-0.5 * s, -0.5 * s, -0.48 * s, -0.36 * s); c.stroke();
    c.restore();
  }
  function manger(x, y, s, col) {
    c.save(); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = s * 0.08; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - 0.42 * s, y); c.lineTo(x - 0.15 * s, y - 0.5 * s); c.moveTo(x - 0.15 * s, y); c.lineTo(x - 0.42 * s, y - 0.5 * s);
    c.moveTo(x + 0.42 * s, y); c.lineTo(x + 0.15 * s, y - 0.5 * s); c.moveTo(x + 0.15 * s, y); c.lineTo(x + 0.42 * s, y - 0.5 * s); c.stroke();
    c.beginPath(); c.moveTo(x - 0.55 * s, y - 0.62 * s); c.lineTo(x + 0.55 * s, y - 0.62 * s); c.lineTo(x + 0.42 * s, y - 0.4 * s); c.lineTo(x - 0.42 * s, y - 0.4 * s); c.closePath(); c.fill();
    c.strokeStyle = '#C9A24A'; c.lineWidth = s * 0.025;
    for (var i = 0; i < 9; i++) { var sx = x - 0.5 * s + i * 0.125 * s; c.beginPath(); c.moveTo(sx, y - 0.6 * s); c.lineTo(sx + (i % 2 ? 0.08 : -0.06) * s, y - 0.72 * s); c.stroke(); }
    c.restore();
  }
  function baby(x, y, s, a) {
    if (a <= 0) return;
    glow(x, y, s * 6, '255,226,150', 0.6 * a); glow(x, y, s * 2.2, '255,246,222', 0.5 * a);
    c.save(); c.globalAlpha = a; c.fillStyle = '#FBF1DC';
    c.beginPath(); c.ellipse(x - 0.08 * s, y, 0.5 * s, 0.2 * s, 0, 0, 6.283); c.fill();
    c.strokeStyle = 'rgba(190,160,110,.6)'; c.lineWidth = s * 0.03;
    for (var i = 0; i < 3; i++) { c.beginPath(); c.moveTo(x - 0.4 * s + i * 0.2 * s, y - 0.17 * s); c.lineTo(x - 0.3 * s + i * 0.2 * s, y + 0.17 * s); c.stroke(); }
    c.fillStyle = '#F6E2C0'; c.beginPath(); c.arc(x + 0.42 * s, y - 0.04 * s, 0.17 * s, 0, 6.283); c.fill();
    c.restore();
  }
  function shelter(x, y, w, h, col) {
    c.fillStyle = col;
    c.fillRect(x, y - h, w * 0.05, h); c.fillRect(x + w * 0.95, y - h * 0.86, w * 0.05, h * 0.86);
    c.beginPath(); c.moveTo(x - w * 0.08, y - h - 4); c.lineTo(x + w * 1.08, y - h * 0.84 - 2); c.lineTo(x + w * 1.08, y - h * 0.78); c.lineTo(x - w * 0.08, y - h + 6); c.closePath(); c.fill();
    c.fillRect(x - w * 0.02, y - h * 0.3, w * 0.25, h * 0.3);
    c.fillRect(x + w * 0.8, y - h * 0.24, w * 0.24, h * 0.24);
  }
  function bstar(x, y, r, a) {
    if (a <= 0) return;
    glow(x, y, r * 7, '255,240,205', 0.45 * a); glow(x, y, r * 2.5, '255,250,235', 0.6 * a);
    c.save(); c.translate(x, y); c.globalAlpha = a; c.fillStyle = '#FFFBEF';
    var tw = 1 + 0.08 * Math.sin(T * 2.2);
    c.beginPath();
    for (var i = 0; i < 16; i++) {
      var ang = (i / 16) * Math.PI * 2 - Math.PI / 2, rr;
      if (i % 4 === 0) rr = (i === 8 ? r * 4.2 : r * 2.4) * tw; else if (i % 2 === 0) rr = r * 1.0; else rr = r * 0.32;
      c.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    c.closePath(); c.fill(); c.restore();
  }

  /* ---------- people ---------- */
  // Robe outlines (feet at 0,0; height 1; facing right), standing, kneeling and sitting.
  var P_STAND = [[-0.05, -0.8], [-0.12, -0.76], [-0.15, -0.45], [-0.18, -0.02], [-0.1, 0], [0.1, 0], [0.17, -0.02], [0.13, -0.45], [0.11, -0.76], [0.05, -0.8]];
  var P_KNEEL = [[-0.05, -0.57], [-0.12, -0.53], [-0.17, -0.3], [-0.31, -0.04], [-0.27, 0], [0.08, 0], [0.15, -0.03], [0.15, -0.26], [0.11, -0.53], [0.05, -0.57]];
  var P_SIT = [[-0.05, -0.62], [-0.12, -0.58], [-0.15, -0.32], [-0.17, -0.03], [-0.1, 0], [0.26, 0], [0.29, -0.09], [0.15, -0.25], [0.11, -0.58], [0.05, -0.62]];
  var H_STAND = [0, -0.875], H_KNEEL = [0.02, -0.645], H_SIT = [0, -0.695];

  function person(o) {
    var k = o.kneel || 0, s = o.sit || 0, b = o.bow || 0, f = o.f || 1, h = o.h, i;
    var pts = [];
    for (i = 0; i < 10; i++) {
      pts.push([P_STAND[i][0] + (P_KNEEL[i][0] - P_STAND[i][0]) * k + (P_SIT[i][0] - P_STAND[i][0]) * s,
        P_STAND[i][1] + (P_KNEEL[i][1] - P_STAND[i][1]) * k + (P_SIT[i][1] - P_STAND[i][1]) * s]);
    }
    if (o.walk != null) { var w = Math.sin(o.walk) * 0.04; pts[3][0] += w; pts[4][0] += w * 0.7; pts[5][0] -= w * 0.7; pts[6][0] -= w; }
    if (o.belly) { pts[7][0] += 0.07 * o.belly; pts[6][0] += 0.02 * o.belly; }
    pts[0][0] += b * 0.03; pts[8][0] += b * 0.04; pts[9][0] += b * 0.04;
    var hx = H_STAND[0] + (H_KNEEL[0] - H_STAND[0]) * k + (H_SIT[0] - H_STAND[0]) * s + b * 0.075;
    var hy = H_STAND[1] + (H_KNEEL[1] - H_STAND[1]) * k + (H_SIT[1] - H_STAND[1]) * s + b * 0.07;
    var bob = o.walk != null ? Math.abs(Math.cos(o.walk)) * 0.014 : 0;
    var col = o.col || INK;
    c.save(); c.translate(o.x, o.y); if (o.rot) c.rotate(o.rot); c.scale(f * h, h); c.translate(0, -bob);
    if (o.a != null) c.globalAlpha = o.a;
    rim(o.rim === undefined ? LIGHT.dir : o.rim, o.rimCol);
    c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round'; c.lineJoin = 'round';
    blob(pts); c.fill();
    c.beginPath(); c.arc(hx, hy, 0.072, 0, 6.283); c.fill();
    if (o.cloth) { c.beginPath(); c.moveTo(hx + 0.065, hy - 0.04); c.quadraticCurveTo(hx + 0.01, hy - 0.118, hx - 0.065, hy - 0.078); c.quadraticCurveTo(hx - 0.13, hy - 0.02, hx - 0.128, hy + 0.15); c.lineTo(hx - 0.03, hy + 0.1); c.closePath(); c.fill(); }
    if (o.hat) { c.beginPath(); c.moveTo(hx - 0.08, hy - 0.03); c.quadraticCurveTo(hx - 0.09, hy - 0.2, hx, hy - 0.22); c.quadraticCurveTo(hx + 0.09, hy - 0.2, hx + 0.08, hy - 0.03); c.closePath(); c.fill(); c.beginPath(); c.moveTo(hx - 0.06, hy); c.quadraticCurveTo(hx - 0.14, hy + 0.12, hx - 0.12, hy + 0.2); c.lineTo(hx - 0.05, hy + 0.08); c.closePath(); c.fill(); }
    if (o.helmet) { c.beginPath(); c.arc(hx, hy - 0.005, 0.082, Math.PI, 0); c.fill(); c.beginPath(); c.ellipse(hx - 0.01, hy - 0.11, 0.1, 0.035, -0.1, 0, 6.283); c.fill(); }
    if (o.veil) {
      var vk = 1 - k * 0.35 - s * 0.2;
      c.fillStyle = o.veil;
      c.beginPath(); c.moveTo(hx + 0.072, hy - 0.015); c.quadraticCurveTo(hx + 0.035, hy - 0.125, hx - 0.06, hy - 0.088);
      c.quadraticCurveTo(hx - 0.16, hy - 0.02, hx - 0.17, hy + 0.42 * vk); c.lineTo(hx - 0.05, hy + 0.36 * vk);
      c.quadraticCurveTo(hx - 0.03, hy + 0.06, hx + 0.038, hy + 0.05); c.closePath(); c.fill();
      c.fillStyle = col;
    }
    var sx = 0.06 + b * 0.04, sy = pts[8][1] + 0.08;
    c.lineWidth = 0.055;
    function arm(x2, y2) { c.beginPath(); c.moveTo(sx, sy); c.lineTo(x2, y2); c.stroke(); c.beginPath(); c.arc(x2, y2, 0.03, 0, 6.283); c.fill(); }
    var am = o.arms;
    if (am === 'raise') { arm(sx + 0.15, sy - 0.3); c.beginPath(); c.moveTo(sx - 0.1, sy); c.lineTo(sx - 0.22, sy - 0.28); c.stroke(); }
    else if (am === 'reach') arm(sx + 0.24, sy + 0.08);
    else if (am === 'low') arm(sx + 0.22, sy + 0.3);
    else if (am === 'pray') arm(sx + 0.11, sy + 0.08);
    else if (am === 'out') arm(sx + 0.2, sy - 0.04);
    else if (am === 'offer') { arm(sx + 0.24, sy + 0.12); gift(sx + 0.28, sy + 0.1, o.gift); }
    else if (am === 'wave') { var wv = Math.sin(T * 3 + o.x) * 0.12; arm(sx + 0.12, sy - 0.28); frond(sx + 0.12, sy - 0.28, -1.35 + wv, 0.4); }
    if (o.staff) {
      c.lineWidth = 0.026; c.beginPath(); c.moveTo(0.22, 0); c.lineTo(0.22, -0.98); c.stroke();
      if (o.staff === 'crook') { c.beginPath(); c.arc(0.18, -0.98, 0.04, 0, Math.PI, true); c.stroke(); }
      c.beginPath(); c.arc(0.205, -0.52, 0.035, 0, 6.283); c.fill();
    }
    if (o.spear) { c.lineWidth = 0.02; c.beginPath(); c.moveTo(0.2, 0); c.lineTo(0.2, -1.25); c.stroke(); c.beginPath(); c.moveTo(0.17, -1.22); c.lineTo(0.2, -1.36); c.lineTo(0.23, -1.22); c.closePath(); c.fill(); }
    c.restore();
  }
  function frond(x, y, ang, L) {
    c.save(); c.translate(x, y); c.rotate(ang); c.lineWidth = 0.018; c.beginPath(); c.moveTo(0, 0); c.lineTo(L, 0); c.stroke();
    c.lineWidth = 0.012;
    for (var i = 1; i < 8; i++) { var px = (i / 8) * L, l = 0.09 * (1 - i / 10); c.beginPath(); c.moveTo(px, 0); c.lineTo(px + l * 0.6, -l); c.moveTo(px, 0); c.lineTo(px + l * 0.6, l); c.stroke(); }
    c.restore();
  }
  function gift(x, y, g) {
    noRim(); c.save();
    if (g === 'gold') { c.fillStyle = '#E2BE66'; c.fillRect(x - 0.035, y - 0.06, 0.08, 0.06); c.fillStyle = '#FFF0C0'; c.fillRect(x - 0.035, y - 0.068, 0.08, 0.014); }
    else { c.fillStyle = g === 'incense' ? '#C9A86A' : '#B98D5E'; c.beginPath(); c.ellipse(x + 0.005, y - 0.04, 0.035, 0.045, 0, 0, 6.283); c.fill(); c.fillRect(x - 0.012, y - 0.1, 0.034, 0.03); }
    c.restore();
    if (g === 'incense') { c.save(); c.strokeStyle = 'rgba(245,235,215,.35)'; c.lineWidth = 0.012; c.beginPath(); c.moveTo(x + 0.005, y - 0.1); for (var i = 1; i < 10; i++) c.lineTo(x + 0.005 + Math.sin(T * 2 + i * 0.9) * 0.02, y - 0.1 - i * 0.025); c.stroke(); c.restore(); }
  }
  // A keeper fallen to the ground "as dead men": lying face down, helmet on, spear dropped.
  function fallen(x, y, h, f, col, a) {
    if (a <= 0) return;
    c.save(); c.translate(x, y); c.scale(f * h, h); c.globalAlpha = a; rim(LIGHT.dir * f); c.fillStyle = col; c.strokeStyle = col;
    blob([[-0.5, 0], [-0.48, -0.09], [-0.2, -0.13], [0.12, -0.15], [0.32, -0.12], [0.4, -0.05], [0.42, 0]]); c.fill();
    c.beginPath(); c.arc(0.49, -0.065, 0.07, 0, 6.283); c.fill();
    c.beginPath(); c.arc(0.5, -0.07, 0.08, Math.PI * 0.9, Math.PI * 1.9); c.fill();
    c.lineWidth = 0.018; c.beginPath(); c.moveTo(-0.55, -0.01); c.lineTo(0.75, -0.04); c.stroke();
    c.restore(); noRim();
  }
  // The Lord riding upon the colt (seated, robe draped over its side).
  function rider(x, y, h, col) {
    c.save(); c.translate(x, y); c.scale(h, h); rim(LIGHT.dir); c.fillStyle = col;
    blob([[-0.05, -0.8], [-0.12, -0.76], [-0.15, -0.42], [-0.16, -0.12], [0.02, -0.04], [0.2, -0.1], [0.22, 0.28], [0.12, 0.3], [0.08, 0.02], [0.12, -0.45], [0.11, -0.76], [0.05, -0.8]]);
    c.fill(); c.beginPath(); c.arc(0.01, -0.875, 0.072, 0, 6.283); c.fill();
    c.beginPath(); c.moveTo(0.075, -0.915); c.quadraticCurveTo(0.02, -0.995, -0.055, -0.955); c.quadraticCurveTo(-0.12, -0.9, -0.118, -0.73); c.lineTo(-0.02, -0.78); c.closePath(); c.fill();
    c.restore(); noRim();
  }
  // The cross laid over his shoulder, its foot trailing on the ground behind.
  function carried(x, y, h, col) {
    var px = x + 0.06 * h, py = y - 0.7 * h, ex = x - 0.62 * h, ey = y - 0.02 * h;
    var ang = Math.atan2(ey - py, ex - px), L = Math.hypot(ex - px, ey - py) + 0.22 * h, w = 0.06 * h;
    c.save(); c.translate(px, py); c.rotate(ang); rim(LIGHT.dir); c.fillStyle = col;
    c.fillRect(-0.22 * h, -w / 2, L, w);
    c.fillRect(-0.12 * h, -0.27 * h, w * 0.9, 0.54 * h);
    c.restore(); noRim();
  }
  // An angel of the Lord: clothed in light, with the glory shining round about.
  function angel(o) {
    var x = o.x, y = o.y, h = o.h, a = o.a == null ? 1 : o.a, f = o.f || 1;
    if (a <= 0) return;
    var fl = Math.sin(T * 1.3 + (o.ph || 0)) * 0.05;
    glow(x, y - h * 0.55, h * (o.big || 1.5), '255,232,170', 0.36 * a);
    glow(x, y - h * 0.7, h * 0.45, '255,250,232', 0.3 * a);
    c.save(); c.translate(x, y); c.scale(f * h, h); c.globalAlpha = a;
    var wg = c.createLinearGradient(0, -1.15, 0, -0.45); wg.addColorStop(0, 'rgba(255,250,236,.92)'); wg.addColorStop(1, 'rgba(255,236,196,.25)');
    [-1, 1].forEach(function (sd) {
      // A tall wing, swept up behind the shoulder, with a scalloped trailing edge.
      c.fillStyle = wg; c.beginPath(); c.moveTo(sd * 0.05, -0.74);
      c.bezierCurveTo(sd * 0.14, -1.0 - fl, sd * 0.3, -1.16 - fl, sd * 0.44, -1.2 - fl);
      c.bezierCurveTo(sd * 0.4, -1.02 - fl * 0.6, sd * 0.36, -0.86, sd * 0.3, -0.7);
      c.quadraticCurveTo(sd * 0.28, -0.62, sd * 0.22, -0.6); c.quadraticCurveTo(sd * 0.19, -0.54, sd * 0.13, -0.55);
      c.quadraticCurveTo(sd * 0.1, -0.5, sd * 0.06, -0.55); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(214,184,120,.35)'; c.lineWidth = 0.008;
      for (var q = 0; q < 3; q++) { c.beginPath(); c.moveTo(sd * (0.08 + q * 0.06), -0.6 - q * 0.02); c.quadraticCurveTo(sd * (0.18 + q * 0.07), -0.85 - q * 0.08, sd * (0.3 + q * 0.04), -1.05 - q * 0.04 - fl); c.stroke(); }
    });
    var g = c.createLinearGradient(0, -0.85, 0, 0.05); g.addColorStop(0, '#FFFCF2'); g.addColorStop(0.7, 'rgba(255,240,205,.85)'); g.addColorStop(1, 'rgba(255,236,190,0)');
    c.fillStyle = g;
    blob(o.sit ? [[-0.05, -0.62], [-0.12, -0.58], [-0.15, -0.32], [-0.17, -0.03], [-0.1, 0], [0.26, 0], [0.29, -0.09], [0.15, -0.25], [0.11, -0.58], [0.05, -0.62]]
      : [[-0.05, -0.8], [-0.12, -0.75], [-0.15, -0.42], [-0.2, -0.05], [0, 0.06], [0.2, -0.05], [0.15, -0.42], [0.12, -0.75], [0.05, -0.8]]);
    c.fill();
    c.fillStyle = '#FFFCF2'; c.beginPath(); c.arc(0, o.sit ? -0.695 : -0.875, 0.072, 0, 6.283); c.fill();
    c.strokeStyle = '#FFF6DE'; c.lineWidth = 0.05; c.lineCap = 'round';
    var sy = o.sit ? -0.5 : -0.68;
    if (o.arms === 'raise') { c.beginPath(); c.moveTo(0.06, sy); c.lineTo(0.22, sy - 0.3); c.moveTo(-0.06, sy); c.lineTo(-0.2, sy - 0.28); c.stroke(); }
    else if (o.arms === 'out') { c.beginPath(); c.moveTo(0.06, sy); c.lineTo(0.3, sy - 0.06); c.stroke(); }
    c.restore();
  }
  // The risen Lord, in light.
  function risen(o) {
    glow(o.x, o.y - o.h * 0.55, o.h * 1.6, '255,228,160', 0.35);
    person({ x: o.x, y: o.y, h: o.h, f: o.f, col: '#FBF3E1', rim: o.f, rimCol: 'rgba(214,170,90,.9)', arms: o.arms, cloth: true });
  }
  function rcross(x, y, h, col, opt) {
    opt = opt || {};
    var w = h * 0.075;
    c.save(); c.fillStyle = col; rim(opt.rim, opt.rimCol);
    c.fillRect(x - w / 2, y - h, w, h); c.fillRect(x - h * 0.3, y - h * 0.8, h * 0.6, w * 0.85);
    if (opt.title) { c.fillRect(x - h * 0.06, y - h * 0.99, h * 0.12, h * 0.055); noRim(); c.fillStyle = 'rgba(230,215,180,.55)'; c.fillRect(x - h * 0.05, y - h * 0.985, h * 0.1, h * 0.04); c.fillStyle = col; }
    if (opt.fig) {
      noRim(); c.fillStyle = opt.figCol || '#05090A'; c.strokeStyle = c.fillStyle; c.lineCap = 'round';
      c.lineWidth = h * 0.035; c.beginPath(); c.moveTo(x - h * 0.27, y - h * 0.79); c.quadraticCurveTo(x, y - h * 0.73, x + h * 0.27, y - h * 0.79); c.stroke();
      c.beginPath(); c.moveTo(x - h * 0.05, y - h * 0.76); c.lineTo(x + h * 0.05, y - h * 0.76); c.lineTo(x + h * 0.035, y - h * 0.46); c.lineTo(x + h * 0.055, y - h * 0.42); c.lineTo(x + h * 0.02, y - h * 0.24); c.lineTo(x - h * 0.02, y - h * 0.24); c.lineTo(x - h * 0.055, y - h * 0.42); c.lineTo(x - h * 0.035, y - h * 0.46); c.closePath(); c.fill();
      var bw = opt.bow || 0;
      c.beginPath(); c.arc(x + bw * h * 0.03, y - h * 0.84 + bw * h * 0.045, h * 0.045, 0, 6.283); c.fill();
    }
    c.restore();
  }
  function rock(pts, col) { c.fillStyle = col; blob(pts); c.fill(); }
  function tomb(x, y, s, col, stoneOff, open) {
    // A garden hillside of rock, with the tomb hewn into its face.
    c.fillStyle = col; c.beginPath(); c.moveTo(x - 1.25 * s, y + 4);
    var top = [[-1.25, -0.5], [-1.05, -0.78], [-0.85, -0.82], [-0.6, -1.05], [-0.2, -1.12], [0.15, -1.2], [0.5, -1.08], [0.8, -1.14], [1.1, -0.92], [1.35, -0.95], [1.6, -0.7], [1.75, -0.3], [1.8, 0.04]];
    top.forEach(function (q) { c.lineTo(x + q[0] * s, y + q[1] * s); }); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 1.5;
    [[-0.9, -0.55, -0.5, -0.5], [0.45, -0.75, 1.0, -0.62], [1.1, -0.35, 1.5, -0.4], [-0.6, -0.85, -0.3, -0.92]].forEach(function (l) { c.beginPath(); c.moveTo(x + l[0] * s, y + l[1] * s); c.lineTo(x + l[2] * s, y + l[3] * s); c.stroke(); });
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x - 0.32 * s, y - 0.66 * s, 0.64 * s, 0.66 * s);
    c.fillStyle = '#030605'; c.beginPath(); c.moveTo(x - 0.22 * s, y); c.lineTo(x - 0.22 * s, y - 0.32 * s); c.arc(x, y - 0.32 * s, 0.22 * s, Math.PI, 0); c.lineTo(x + 0.22 * s, y); c.closePath(); c.fill();
    if (open) glow(x, y - 0.25 * s, 0.4 * s, '255,236,190', 0.25 * open);
    if (stoneOff === null) return; // the stone is being moved by the scene itself
    var sx = x + (stoneOff || 0) * s, rot = (stoneOff || 0) * 1.6;
    c.save(); c.translate(sx, y - 0.31 * s); c.rotate(rot);
    var sg = c.createRadialGradient(-0.1 * s, -0.12 * s, 0.02 * s, 0, 0, 0.33 * s); sg.addColorStop(0, '#4A4440'); sg.addColorStop(1, '#25211F');
    c.fillStyle = sg; c.beginPath(); c.arc(0, 0, 0.31 * s, 0, 6.283); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 0.27 * s, 0.4, 2.2); c.stroke(); c.beginPath(); c.arc(0, 0, 0.12 * s, 3.5, 5.2); c.stroke();
    c.restore();
  }
  function walls(x, y, w, h, col, gate) {
    c.fillStyle = col; c.fillRect(x, y - h, w, h);
    for (var i = 0; i < w; i += 9) c.fillRect(x + i, y - h - 5, 5, 5);
    c.fillRect(x - 6, y - h * 1.45, 26, h * 1.45); c.fillRect(x + w - 24, y - h * 1.35, 26, h * 1.35);
    if (gate) { c.fillStyle = 'rgba(0,0,0,.6)'; c.beginPath(); c.moveTo(gate - 13, y); c.lineTo(gate - 13, y - h * 0.5); c.arc(gate, y - h * 0.5, 13, Math.PI, 0); c.lineTo(gate + 13, y); c.closePath(); c.fill(); }
  }
  // The earth quakes: tt is seconds since it began.
  function shake(tt, len, amt) { if (tt > 0 && tt < len) { var e = (1 - tt / len) * amt; c.translate(Math.sin(T * 47) * e, Math.cos(T * 39) * e * 0.6); } }

  /* ---------- the stories ---------- */
  var BLUE_VEIL = '#1E3658';
  var STORIES = {
    christmas: {
      title: 'The Christmas Story',
      scenes: [
        { name: 'Nazareth', caps: [
          { ref: 'Luke 1:26–27', text: 'And in the sixth month the angel Gabriel was sent from God unto a city of Galilee, named Nazareth, To a virgin espoused to a man whose name was Joseph, of the house of David; and the virgin’s name was Mary.' },
          { ref: 'Luke 1:30–31', text: 'And the angel said unto her, Fear not, Mary: for thou hast found favour with God. And, behold, thou shalt conceive in thy womb, and bring forth a son, and shalt call his name JESUS.' },
          { ref: 'Luke 1:38', text: 'And Mary said, Behold the handmaid of the Lord; be it unto me according to thy word. And the angel departed from her.' },
        ], draw: function (k) {
          sky([[0, '#0D1830'], [0.55, '#25335A'], [1, '#43496F']]); stars(11, 80, 320, 0.9);
          ridge(352, [[9, 1.3, 0.4], [5, 3.1, 1]], '#2B3459');
          town(5, 300, 350, 0.8, '#1D2545', 0.9, 7);
          ridge(405, [[10, 1.1, 2], [4, 2.6, 0.3]], '#172039', 0.3);
          ridge(452, [[4, 1.4, 0.8]], INK, 0.4);
          house(28, 462, 110, 100, '#0D1913', 1, 'lit');
          olive(150, 458, 62, '#0D1913', 4);
          var come = ease(ramp(k.at(0), 3, 6)), leave = ease(ramp(k.at(2), 6, 9));
          var ga = come * (1 - leave);
          LIGHT.dir = 1;
          person({ x: 196, y: 462, h: 96, f: 1, veil: BLUE_VEIL, bow: 0.15 + 0.7 * ease(ramp(k.at(1), 1, 3)) * (1 - 0.4 * ease(ramp(k.at(2), 0, 2))) + 0.5 * ease(ramp(k.at(2), 1, 3)), rim: ga > 0.05 ? 1 : 0, rimCol: 'rgba(255,236,190,' + (0.75 * ga) + ')' });
          angel({ x: 296, y: 440 - 26 * (1 - come) - 14 * leave, h: 112, f: -1, a: ga, arms: k.cap >= 1 ? 'out' : null });
        } },
        { name: 'The road to Bethlehem', caps: [
          { ref: 'Luke 2:1', text: 'And it came to pass in those days, that there went out a decree from Caesar Augustus, that all the world should be taxed.' },
          { ref: 'Luke 2:4', text: 'And Joseph also went up from Galilee, out of the city of Nazareth, into Judaea, unto the city of David, which is called Bethlehem; (because he was of the house and lineage of David:)' },
          { ref: 'Luke 2:5', text: 'To be taxed with Mary his espoused wife, being great with child.' },
        ], draw: function (k) {
          var p = k.t / k.dur;
          sky([[0, '#1B2242'], [0.45, '#55395E'], [0.78, '#C2704A'], [1, '#E9A65A']]); stars(21, 30, 160, 0.5 * (1 - p) + 0.2);
          glow(250, 360, 190, '255,190,110', 0.35);
          c.fillStyle = 'rgba(255,214,150,.9)'; c.beginPath(); c.arc(250, 362, 26, 0, 6.283); c.fill();
          ridge(352, [[12, 1.2, 1.4], [6, 3.4, 0.2]], '#6B3E52');
          town(9, 320, 336, 0.75, '#3A2438', 0.4 + 0.6 * p, 9);
          ridge(392, [[10, 1.0, 0.2], [5, 2.8, 1.7]], '#3A2235', 0.3);
          olive(70, 400, 62, '#26172A', 2); olive(366, 404, 50, '#26172A', 8);
          ridge(450, [[6, 1.2, 2.2], [3, 4, 0]], INK, 0.4);
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,190,110,.75)';
          var x = 66 + 190 * p, g = ridgeY(x, 450, [[6, 1.2, 2.2], [3, 4, 0]]);
          person({ x: x + 40, y: ridgeY(x + 40, 450, [[6, 1.2, 2.2], [3, 4, 0]]) + 2, h: 100, f: 1, cloth: true, staff: true, walk: k.t * 3.6 });
          person({ x: x, y: g + 2, h: 90, f: 1, veil: BLUE_VEIL, belly: 1, walk: k.t * 3.6 + 1.6, bow: 0.15 });
        } },
        { name: 'Bethlehem', caps: [
          { ref: 'Luke 2:6', text: 'And so it was, that, while they were there, the days were accomplished that she should be delivered.' },
          { ref: 'Luke 2:7', text: 'And she brought forth her firstborn son, and wrapped him in swaddling clothes, and laid him in a manger; because there was no room for them in the inn.' },
        ], draw: function (k) {
          sky([[0, '#071324'], [0.6, '#122647'], [1, '#1F3A5E']]); stars(31, 90, 300, 1);
          ridge(372, [[8, 1.1, 0.9]], '#15253F');
          house(12, 400, 98, 72, '#0F1B2A', 1); house(26, 372, 40, 30, '#0F1B2A', 1);
          house(70, 395, 30, 20, '#0F1B2A', 0.8);
          c.fillStyle = 'rgba(242,196,107,.9)'; c.fillRect(30, 352, 7, 9); c.fillRect(52, 352, 7, 9); glow(45, 356, 40, '242,196,107', 0.2);
          house(110, 404, 56, 46, '#0F1B2A', 0.9);
          ridge(456, [[3, 1.5, 0.4]], INK, 0.4);
          var ba = ease(ramp(k.at(1), 0.5, 3));
          glow(268, 432, 160, '255,214,140', 0.3 * ba);
          shelter(186, 458, 166, 118, '#0C1712');
          manger(268, 458, 50, '#0C1712');
          baby(268, 423, 29, ba);
          LIGHT.col = 'rgba(255,220,150,' + (0.3 + 0.5 * ba) + ')';
          person({ x: 222, y: 460, h: 88, f: 1, veil: BLUE_VEIL, kneel: 1, bow: 0.3 + 0.3 * ba, belly: 1 - ba, rim: 1 });
          person({ x: 322, y: 460, h: 104, f: -1, cloth: true, staff: true, bow: 0.25, rim: -1 });
        } },
        { name: 'The shepherds', caps: [
          { ref: 'Luke 2:8', text: 'And there were in the same country shepherds abiding in the field, keeping watch over their flock by night.' },
          { ref: 'Luke 2:9', text: 'And, lo, the angel of the Lord came upon them, and the glory of the Lord shone round about them: and they were sore afraid.' },
          { ref: 'Luke 2:10', text: 'And the angel said unto them, Fear not: for, behold, I bring you good tidings of great joy, which shall be to all people.' },
          { ref: 'Luke 2:11', text: 'For unto you is born this day in the city of David a Saviour, which is Christ the Lord.' },
          { ref: 'Luke 2:12', text: 'And this shall be a sign unto you; Ye shall find the babe wrapped in swaddling clothes, lying in a manger.' },
          { ref: 'Luke 2:13', text: 'And suddenly there was with the angel a multitude of the heavenly host praising God, and saying,' },
          { ref: 'Luke 2:14', text: 'Glory to God in the highest, and on earth peace, good will toward men.' },
        ], draw: function (k) {
          var ga = ease(ramp(k.at(1), 0, 2.2)), host = ease(ramp(k.at(5), 0, 3)), praise = ease(ramp(k.at(6), 0, 2));
          skyMix([[0, '#06101F'], [0.6, '#0F2340'], [1, '#18304F']], [[0, '#2A2E3F'], [0.6, '#5A5440'], [1, '#6F6446']], ga * 0.55 + host * 0.2);
          stars(41, 100, 300, 1 - ga * 0.6);
          glow(250, 250, 420, '255,226,160', 0.32 * ga + 0.2 * host);
          ridge(360, [[8, 1.0, 2.4], [4, 3.3, 1]], '#16294A');
          town(13, 70, 352, 0.65, '#0F1D33', 0.9, 8);
          ridge(410, [[7, 1.3, 0.6]], '#0E1C2E', 0.3);
          ridge(462, [[3, 1.6, 1.2]], INK, 0.4);
          var r = rng(77);
          for (var i = 0; i < 9; i++) { var sx = 40 + r() * 330, sy = 446 + r() * 22, ss = 22 + r() * 8; sheep(sx, sy, ss, r() < 0.5 ? 1 : -1, ga > 0.3 ? 0 : 0.5 + 0.5 * Math.sin(T * 0.7 + i * 2), mixCol('#5D6878', '#E7DCC0', ga), '#0A1510'); }
          LIGHT.col = 'rgba(255,226,160,' + (0.2 + 0.6 * ga) + ')';
          var fear = ease(ramp(k.at(1), 0.6, 2.2));
          person({ x: 108, y: 466, h: 96, f: 1, cloth: true, staff: 'crook', kneel: fear, bow: fear * 0.7, rim: 1 });
          person({ x: 172, y: 468, h: 92, f: 1, cloth: true, sit: 1 - fear, kneel: fear, bow: 0.2 + fear * 0.6, rim: 1 });
          person({ x: 336, y: 466, h: 100, f: -1, cloth: true, staff: 'crook', kneel: fear, bow: fear * 0.7, rim: -1 });
          var hr = rng(9);
          for (var j = 0; j < 24; j++) {
            var hx = 50 + hr() * 300, hy = 150 + hr() * 150, hs = 20 + hr() * 18;
            if (Math.abs(hx - 236) < 55 && hy > 200) hx += hx < 236 ? -70 : 70;
            angel({ x: hx, y: hy + Math.sin(T * 0.9 + j) * 3, h: hs, a: host * (0.55 + 0.45 * hr()), f: hx < 250 ? 1 : -1, arms: praise > 0.5 ? 'raise' : null, ph: j, big: 0.9 });
          }
          angel({ x: 236, y: 330 - 30 * (1 - ga), h: 124, f: 1, a: ga, arms: k.cap >= 2 ? (k.cap >= 6 ? 'raise' : 'out') : null, big: 1.8 });
        } },
        { name: 'The manger', caps: [
          { ref: 'Luke 2:16', text: 'And they came with haste, and found Mary, and Joseph, and the babe lying in a manger.' },
          { ref: 'Luke 2:19', text: 'But Mary kept all these things, and pondered them in her heart.' },
        ], draw: function (k) {
          sky([[0, '#071324'], [0.6, '#122647'], [1, '#1F3A5E']]); stars(31, 90, 300, 1);
          ridge(372, [[8, 1.1, 0.9]], '#15253F');
          town(17, 70, 380, 0.7, '#0F1B2A', 0.9, 6);
          ridge(456, [[3, 1.5, 0.4]], INK, 0.4);
          glow(200, 432, 170, '255,214,140', 0.3);
          shelter(110, 458, 190, 122, '#0C1712');
          manger(200, 458, 52, '#0C1712'); baby(200, 422, 30, 1);
          LIGHT.col = 'rgba(255,220,150,.75)';
          var come = ease(ramp(k.at(0), 0, 4));
          person({ x: 96, y: 460, h: 106, f: 1, cloth: true, staff: true, bow: 0.25, rim: 1 });
          person({ x: 150, y: 460, h: 88, f: 1, veil: BLUE_VEIL, kneel: 1, bow: 0.35 + 0.35 * ease(ramp(k.at(1), 0, 2)), rim: 1 });
          person({ x: mix(400, 256, come), y: 462, h: 92, f: -1, cloth: true, kneel: ease(ramp(k.at(0), 3.5, 5)), bow: 0.7 * ease(ramp(k.at(0), 4, 6)), rim: -1 });
          person({ x: mix(430, 300, come), y: 462, h: 96, f: -1, cloth: true, kneel: ease(ramp(k.at(0), 3.8, 5.3)), bow: 0.7 * ease(ramp(k.at(0), 4.3, 6.3)), rim: -1 });
          person({ x: mix(460, 350, come), y: 462, h: 102, f: -1, cloth: true, staff: 'crook', bow: 0.6 * ease(ramp(k.at(0), 4.5, 6.5)), walk: come < 1 ? k.t * 4 : null, rim: -1 });
        } },
        { name: 'Wise men from the east', caps: [
          { ref: 'Matthew 2:1', text: 'Now when Jesus was born in Bethlehem of Judaea in the days of Herod the king, behold, there came wise men from the east to Jerusalem,' },
          { ref: 'Matthew 2:2', text: 'Saying, Where is he that is born King of the Jews? for we have seen his star in the east, and are come to worship him.' },
          { ref: 'Matthew 2:9', text: 'When they had heard the king, they departed; and, lo, the star, which they saw in the east, went before them, till it came and stood over where the young child was.' },
          { ref: 'Matthew 2:10', text: 'When they saw the star, they rejoiced with exceeding great joy.' },
        ], draw: function (k) {
          var p = k.t / k.dur, mv = ease(ramp(k.at(2), 0, 8)), joy = ease(ramp(k.at(3), 0, 1.5));
          sky([[0, '#060E1F'], [0.6, '#122140'], [1, '#2A3550']]); stars(51, 110, 330, 1);
          var stx = mix(296, 100, mv), sty = mix(214, 262, mv);
          bstar(stx, sty, 5 + joy * 1.5, 1);
          if (mv > 0.7) { c.save(); c.globalCompositeOperation = 'lighter'; var bg = c.createLinearGradient(82, 260, 82, 380); bg.addColorStop(0, 'rgba(255,240,200,' + 0.25 * ease(ramp(mv, 0.7, 1)) + ')'); bg.addColorStop(1, 'rgba(255,240,200,0)'); c.fillStyle = bg; c.beginPath(); c.moveTo(96, 272); c.lineTo(104, 272); c.lineTo(128, 382); c.lineTo(72, 382); c.closePath(); c.fill(); c.restore(); }
          ridge(374, [[10, 0.9, 0.3], [4, 3, 1]], '#1A2742');
          house(74, 384, 52, 40, '#101A2B', 0.9, 'lit'); house(40, 382, 30, 24, '#101A2B', 0.6); house(130, 386, 26, 20, '#101A2B', 0.5);
          ridge(416, [[8, 1.4, 2.1]], '#0F1A2C', 0.3);
          ridge(458, [[5, 1.1, 0.4], [2, 5, 0]], INK, 0.4);
          LIGHT.dir = -1; LIGHT.col = 'rgba(255,240,205,' + (0.3 + 0.4 * mv) + ')';
          var gx = mix(372, 176, p);
          [[0, 104, 'gold'], [36, 98, 'incense'], [70, 108, 'myrrh'], [104, 96, null]].forEach(function (m, i) {
            var px = gx + m[0], py = ridgeY(px, 458, [[5, 1.1, 0.4], [2, 5, 0]]) + 2;
            person({ x: px, y: py, h: m[1], f: -1, hat: i % 2 === 0, cloth: i % 2 === 1, walk: k.t * 3 + i * 1.3, arms: joy > 0.3 && i < 3 ? 'raise' : null });
          });
        } },
        { name: 'The house', zoom: 1.1, caps: [
          { ref: 'Matthew 2:11', text: 'And when they were come into the house, they saw the young child with Mary his mother, and fell down, and worshipped him:' },
          { ref: 'Matthew 2:11', text: 'and when they had opened their treasures, they presented unto him gifts; gold, and frankincense, and myrrh.' },
        ], draw: function (k) {
          sky([[0, '#24170E'], [0.6, '#3E2A19'], [1, '#2C1D12']]);
          c.fillStyle = '#4A3320'; c.fillRect(0, 0, LW, 330);
          glow(150, 240, 280, '255,190,110', 0.22);
          // A window onto the night, and the star standing over the house.
          c.fillStyle = '#0A1426'; c.beginPath(); c.moveTo(66, 290); c.lineTo(66, 210); c.arc(104, 210, 38, Math.PI, 0); c.lineTo(142, 290); c.closePath(); c.fill();
          c.save(); c.beginPath(); c.moveTo(66, 290); c.lineTo(66, 210); c.arc(104, 210, 38, Math.PI, 0); c.lineTo(142, 290); c.closePath(); c.clip();
          stars(61, 18, 290, 1); bstar(108, 206, 4, 1); c.restore();
          c.strokeStyle = '#2A1C10'; c.lineWidth = 6; c.beginPath(); c.moveTo(66, 290); c.lineTo(66, 210); c.arc(104, 210, 38, Math.PI, 0); c.lineTo(142, 290); c.closePath(); c.stroke();
          c.save(); c.globalCompositeOperation = 'lighter'; var bm = c.createLinearGradient(104, 240, 150, 440); bm.addColorStop(0, 'rgba(255,240,205,.22)'); bm.addColorStop(1, 'rgba(255,240,205,0)'); c.fillStyle = bm; c.beginPath(); c.moveTo(70, 286); c.lineTo(138, 286); c.lineTo(214, 470); c.lineTo(80, 470); c.closePath(); c.fill(); c.restore();
          c.fillStyle = '#2B1C10'; c.fillRect(0, 330, LW, 6);
          var fl = c.createLinearGradient(0, 336, 0, LH); fl.addColorStop(0, '#3A2716'); fl.addColorStop(1, '#1C120A'); c.fillStyle = fl; c.fillRect(0, 336, LW, LH);
          var bowd = ease(ramp(k.at(0), 2, 4.5)), give = ease(ramp(k.at(1), 0.5, 3));
          LIGHT.dir = -1; LIGHT.col = 'rgba(255,220,160,.6)';
          glow(130, 420, 70, '255,236,190', 0.25);
          person({ x: 94, y: 460, h: 96, f: 1, veil: BLUE_VEIL, sit: 1, bow: 0.15, col: '#140D07' });
          person({ x: 136, y: 460, h: 50, f: 1, col: '#140D07', rim: -1, rimCol: 'rgba(255,240,205,.8)' });
          [[200, 'gold', 98], [246, 'incense', 96], [292, 'myrrh', 100], [338, null, 104]].forEach(function (m, i) {
            var kn = i < 3 ? bowd : bowd * 0.4;
            person({ x: m[0], y: 462, h: m[2], f: -1, hat: i % 2 === 0, cloth: i % 2 === 1, kneel: kn, bow: kn * (give > 0 && i < 3 ? 0.35 : 0.8), arms: give > 0.1 && m[1] ? 'offer' : null, gift: m[1], col: '#140D07' });
          });
        } },
        { name: 'A Saviour', final: true, caps: [
          { ref: 'Luke 2:11', text: 'For unto you is born this day in the city of David a Saviour, which is Christ the Lord.' },
          { ref: 'Matthew 1:21', text: 'And she shall bring forth a son, and thou shalt call his name JESUS: for he shall save his people from their sins.' },
          { brand: true, d: 8 },
        ], draw: function (k) {
          sky([[0, '#071324'], [0.6, '#122647'], [1, '#1F3A5E']]); stars(71, 120, 340, 1);
          ridge(390, [[10, 1.1, 0.4], [3, 4, 1]], '#15253F');
          town(23, 200, 392, 1.25, '#0F1B2A', 1, 13);
          ridge(452, [[4, 1.5, 2]], INK, 0.4);
          glow(200, 300, 260, '226,190,102', 0.25 * ease(ramp(k.at(1), 0, 4)));
        } },
      ],
    },
    easter: {
      title: 'The Crucifixion and Resurrection Story',
      scenes: [
        { name: 'Jerusalem', zoom: 1.14, caps: [
          { ref: 'Matthew 21:8', text: 'And a very great multitude spread their garments in the way; others cut down branches from the trees, and strawed them in the way.' },
          { ref: 'Matthew 21:9', text: 'And the multitudes that went before, and that followed, cried, saying, Hosanna to the Son of David: Blessed is he that cometh in the name of the Lord; Hosanna in the highest.' },
        ], draw: function (k) {
          var p = k.t / k.dur;
          sky([[0, '#5F8BA3'], [0.55, '#B9C8C4'], [1, '#E8D3A2']]);
          glow(330, 120, 120, '255,240,200', 0.5);
          ridge(340, [[8, 1.0, 0.8]], '#A9A08A');
          c.fillStyle = '#B9A47E'; c.fillRect(250, 262, 120, 52); c.fillRect(270, 248, 80, 16);
          walls(220, 372, 200, 64, '#7A6A55', 300);
          ridge(380, [[3, 2, 0]], '#5C4E3E');
          palm(84, 392, 104, '#2C2A20'); palm(196, 386, 88, '#2C2A20', 0.3);
          ridge(458, [[3, 1.2, 0.3]], '#2A2219', 0.35);
          var cols = ['#7A2E2A', '#2F4F6E', '#8C6A2E', '#5A3A5E', '#3E5A3A'];
          for (var i = 0; i < 6; i++) { c.fillStyle = cols[i % 5]; c.save(); c.translate(196 + i * 30, 470 + (i % 2) * 4); c.rotate((i % 3 - 1) * 0.12); c.fillRect(-14, -3, 28, 6); c.restore(); }
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,236,190,.75)';
          var crowd = [[34, 88, 1], [64, 92, 1], [312, 94, -1], [342, 88, -1], [372, 96, -1]];
          crowd.forEach(function (m, i) { person({ x: m[0], y: 464, h: m[1], f: m[2], cloth: i % 2 === 0, veil: i % 2 ? '#3A2E26' : null, arms: k.cap >= 1 || i % 2 ? 'wave' : null, col: '#1C1712' }); });
          var jx = mix(130, 238, p);
          colt(jx, 470, 92, 1, k.t * 3.2, '#1A1611');
          rider(jx - 6, 470 - 92 * 0.74, 78, '#1C1712');
        } },
        { name: 'Gethsemane', caps: [
          { ref: 'Luke 22:39', text: 'And he came out, and went, as he was wont, to the mount of Olives; and his disciples also followed him.' },
          { ref: 'Luke 22:41', text: 'And he was withdrawn from them about a stone’s cast, and kneeled down, and prayed,' },
          { ref: 'Luke 22:42', text: 'Saying, Father, if thou be willing, remove this cup from me: nevertheless not my will, but thine, be done.' },
          { ref: 'Luke 22:43', text: 'And there appeared an angel unto him from heaven, strengthening him.' },
        ], draw: function (k) {
          sky([[0, '#060D1C'], [0.6, '#0F1E38'], [1, '#1B2C4A']]); stars(81, 80, 300, 0.9);
          glow(300, 200, 120, '220,230,255', 0.32); c.fillStyle = '#E9ECF2'; c.beginPath(); c.arc(300, 200, 16, 0, 6.283); c.fill();
          ridge(352, [[6, 1.2, 1]], '#1A2843');
          walls(60, 350, 220, 30, '#14203A');
          ridge(400, [[9, 1.1, 2.2]], '#111C30', 0.3);
          olive(40, 432, 110, '#0C1612', 3); olive(372, 440, 100, '#0C1612', 5); olive(150, 410, 70, '#0E1916', 7);
          ridge(462, [[4, 1.3, 0.4]], INK, 0.4);
          rock([[248, 468], [246, 436], [268, 422], [306, 428], [318, 448], [316, 468]], '#111A16');
          var kn = ease(ramp(k.at(1), 0, 2.5)), walkIn = ease(ramp(k.t, 0, 6));
          var sleepA = ease(ramp(k.at(1), 1, 4));
          LIGHT.col = 'rgba(210,225,255,.7)'; LIGHT.dir = 1;
          [[146, 1, 76], [108, 1, 72], [70, 1, 74]].forEach(function (d) { person({ x: d[0], y: 462, h: d[2], f: d[1], cloth: true, sit: 1, bow: 1.15, a: sleepA, rim: 1, rimCol: 'rgba(210,225,255,.45)', col: '#0D1713' }); });
          person({ x: mix(150, 222, walkIn), y: 466, h: 108, f: 1, cloth: true, kneel: kn, bow: 0.25 + kn * 0.35, arms: kn > 0.5 ? 'pray' : null, walk: walkIn < 1 ? k.t * 3 : null });
          var an = ease(ramp(k.at(3), 0, 2.5));
          angel({ x: 300, y: 360 + 20 * (1 - an), h: 88, f: -1, a: an, arms: 'out' });
        } },
        { name: 'Golgotha', caps: [
          { ref: 'John 19:16', text: 'Then delivered he him therefore unto them to be crucified. And they took Jesus, and led him away.' },
          { ref: 'John 19:17', text: 'And he bearing his cross went forth into a place called the place of a skull, which is called in the Hebrew Golgotha:' },
          { ref: 'Luke 23:27', text: 'And there followed him a great company of people, and of women, which also bewailed and lamented him.' },
        ], draw: function (k) {
          var p = k.t / k.dur;
          sky([[0, '#2B2530'], [0.55, '#6A4A44'], [1, '#A8774E']]);
          ridge(330, [[6, 1, 0.3]], '#4A3634');
          walls(10, 360, 150, 40, '#3A2C2C');
          var hw = [[46, 0.6, 3.4], [6, 3, 0]];
          ridge(470, hw, '#24191A', 0.35);
          LIGHT.dir = -1; LIGHT.col = 'rgba(255,200,140,.55)';
          var x = mix(150, 250, p), y = ridgeY(x, 470, hw) + 2;
          person({ x: x, y: y, h: 100, f: 1, cloth: true, bow: 0.6, walk: k.t * 2.2, col: '#120C0C' });
          carried(x, y, 100, '#1E1410');
          var fa = ease(ramp(k.at(2), 0, 3));
          [[-56, 88, BLUE_VEIL], [-90, 84, '#3A2638'], [-124, 92, null], [-156, 86, '#3A2638']].forEach(function (m, i) {
            var fx = x + m[0] - 30 * (1 - fa); person({ x: fx, y: ridgeY(fx, 470, hw) + 2, h: m[1], f: 1, veil: m[2], cloth: !m[2], bow: 0.6, walk: k.t * 2.2 + i, a: i < 1 ? 1 : fa, col: '#140E0E' });
          });
        } },
        { name: 'Calvary', caps: [
          { ref: 'Luke 23:33', text: 'And when they were come to the place, which is called Calvary, there they crucified him, and the malefactors, one on the right hand, and the other on the left.' },
          { ref: 'Luke 23:34', text: 'Then said Jesus, Father, forgive them; for they know not what they do.' },
          { ref: 'John 19:19', text: 'And Pilate wrote a title, and put it on the cross. And the writing was, JESUS OF NAZARETH THE KING OF THE JEWS.' },
          { ref: 'Luke 23:44', text: 'And it was about the sixth hour, and there was a darkness over all the earth until the ninth hour.' },
          { ref: 'John 19:30', text: 'When Jesus therefore had received the vinegar, he said, It is finished: and he bowed his head, and gave up the ghost.' },
          { ref: 'Matthew 27:54', text: 'Now when the centurion, and they that were with him, watching Jesus, saw the earthquake, and those things that were done, they feared greatly, saying, Truly this was the Son of God.' },
        ], draw: function (k) {
          var dark = ease(ramp(k.at(3), 0, 4)), bow = ease(ramp(k.at(4), 4, 6));
          shake(k.at(5), 2.4, 4);
          skyMix([[0, '#3A3036'], [0.55, '#7C5845'], [1, '#B98656']], [[0, '#07060A'], [0.55, '#1A1114'], [1, '#3A1E18']], dark);
          ridge(372, [[6, 1.1, 0.5]], mixCol('#4E3A36', '#140E10', dark));
          var hw = [[58, 1, 3.15], [5, 3.2, 0]];
          ridge(470, hw, mixCol('#24191A', '#080608', dark), 0.35);
          LIGHT.dir = -1; LIGHT.col = 'rgba(255,190,130,' + 0.45 * (1 - dark) + ')';
          var col = mixCol('#120C0C', '#030203', dark), wood = mixCol('#2A1C14', '#0C0807', dark), body = mixCol('#070505', '#000000', dark);
          rcross(146, ridgeY(146, 470, hw) + 4, 118, wood, { fig: true, figCol: body, rim: -1 });
          rcross(254, ridgeY(254, 470, hw) + 4, 118, wood, { fig: true, figCol: body, rim: -1 });
          rcross(200, ridgeY(200, 470, hw) + 4, 140, wood, { fig: true, figCol: body, title: true, bow: bow, rim: -1 });
          [[68, BLUE_VEIL], [92, '#2A1C26'], [116, null]].forEach(function (m) { person({ x: m[0], y: ridgeY(m[0], 470, hw) + 30, h: 66, f: 1, veil: m[1], cloth: !m[1], bow: 0.5, col: col }); });
          person({ x: 312, y: ridgeY(312, 470, hw) + 26, h: 88, f: -1, helmet: true, spear: true, bow: k.cap >= 5 ? -0.2 : 0, col: col });
        } },
        { name: 'The tomb', zoom: 1.12, caps: [
          { ref: 'Matthew 27:59', text: 'And when Joseph had taken the body, he wrapped it in a clean linen cloth,' },
          { ref: 'Matthew 27:60', text: 'And laid it in his own new tomb, which he had hewn out in the rock: and he rolled a great stone to the door of the sepulchre, and departed.' },
          { ref: 'Matthew 27:61', text: 'And there was Mary Magdalene, and the other Mary, sitting over against the sepulchre.' },
          { ref: 'Matthew 27:66', text: 'So they went, and made the sepulchre sure, sealing the stone, and setting a watch.' },
        ], draw: function (k) {
          sky([[0, '#1A1E30'], [0.55, '#4C3A4E'], [1, '#93604F']]); stars(91, 30, 180, 0.4);
          ridge(380, [[7, 1.2, 1]], '#2C2533');
          olive(52, 420, 90, '#141015', 2);
          ridge(462, [[3, 1.3, 0.2]], INK, 0.35);
          var roll = ease(ramp(k.at(1), 4, 9));
          tomb(244, 462, 90, '#1D1B20', mix(0.75, 0, roll), 0);
          if (k.cap >= 3) { c.fillStyle = '#8A2E24'; c.beginPath(); c.arc(244, 434, 3, 0, 6.283); c.fill(); }
          LIGHT.dir = -1; LIGHT.col = 'rgba(255,180,130,.5)';
          var jx = mix(232, 336, roll), leave = ease(ramp(k.at(1), 10, 13));
          person({ x: jx + 30 * leave, y: 464, h: 98, f: -1, cloth: true, bow: 0.45, arms: roll > 0 && roll < 1 ? 'reach' : null, a: 1 - leave });
          var wa = ease(ramp(k.at(2), 0, 2));
          person({ x: 58, y: 466, h: 84, f: 1, veil: BLUE_VEIL, sit: 1, bow: 0.5, a: wa });
          person({ x: 100, y: 466, h: 84, f: 1, veil: '#3A2638', sit: 1, bow: 0.4, a: wa });
          var ga = ease(ramp(k.at(3), 0, 2.5));
          person({ x: 166, y: 466, h: 100, f: 1, helmet: true, spear: true, a: ga });
          person({ x: 350, y: 466, h: 100, f: -1, helmet: true, spear: true, a: ga });
        } },
        { name: 'The first day of the week', zoom: 1.12, caps: [
          { ref: 'Matthew 28:1', text: 'In the end of the sabbath, as it began to dawn toward the first day of the week, came Mary Magdalene and the other Mary to see the sepulchre.' },
          { ref: 'Matthew 28:2', text: 'And, behold, there was a great earthquake: for the angel of the Lord descended from heaven, and came and rolled back the stone from the door, and sat upon it.' },
          { ref: 'Matthew 28:3', text: 'His countenance was like lightning, and his raiment white as snow:' },
          { ref: 'Matthew 28:4', text: 'And for fear of him the keepers did shake, and became as dead men.' },
        ], draw: function (k) {
          var dawn = ease(ramp(k.t, 0, k.dur));
          var desc = ease(ramp(k.at(1), 1.5, 4.5)), roll = ease(ramp(k.at(1), 4.5, 8)), bright = ease(ramp(k.at(2), 0, 1.5));
          c.save(); shake(k.at(1), 3, 5);
          skyMix([[0, '#0D1226'], [0.55, '#2E3256'], [1, '#6E5068']], [[0, '#26304F'], [0.55, '#8A6672'], [1, '#E3A57A']], dawn);
          stars(101, 50, 220, 1 - dawn);
          ridge(380, [[7, 1.2, 1]], '#252036');
          olive(52, 420, 90, '#100D14', 2);
          ridge(462, [[3, 1.3, 0.2]], INK, 0.35);
          tomb(244, 462, 90, '#1B191F', mix(0, 0.85, roll), roll);
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,245,225,' + 0.8 * desc + ')';
          var wx = mix(0, 88, ease(ramp(k.at(0), 0, 7)));
          person({ x: wx, y: 466, h: 86, f: 1, veil: BLUE_VEIL, walk: k.cap === 0 ? k.t * 3 : null, rim: desc > 0 ? 1 : -1 });
          person({ x: wx - 34, y: 466, h: 84, f: 1, veil: '#3A2638', walk: k.cap === 0 ? k.t * 3 + 1 : null, rim: desc > 0 ? 1 : -1 });
          var fall = ease(ramp(k.at(3), 1.2, 3));
          var jit = k.cap >= 3 && fall < 1 ? Math.sin(T * 40) * 1.5 : 0;
          var st1 = 1 - ramp(fall, 0.35, 0.7);
          person({ x: 158 + jit, y: 466, h: 100, f: 1, helmet: true, spear: true, bow: fall * 0.6, rot: fall * 0.25, a: st1, rim: 1 });
          person({ x: 356 + jit, y: 466, h: 100, f: -1, helmet: true, spear: true, bow: fall * 0.6, rot: -fall * 0.25, a: st1, rim: -1 });
          fallen(150, 466, 100, 1, INK, 1 - st1); fallen(352, 466, 100, -1, INK, 1 - st1);
          var ax = 244 + 76 * roll, ay = mix(-60, 404, desc);
          angel({ x: ax, y: roll >= 1 ? 437 : ay, h: roll >= 1 ? 92 : 116, a: desc, f: -1, big: 2 + bright, sit: roll >= 1 });
          if (bright > 0) glow(ax, 390, 130, '255,255,255', 0.22 * bright);
          c.restore();
        } },
        { name: 'He is risen', zoom: 1.14, caps: [
          { ref: 'Matthew 28:5', text: 'And the angel answered and said unto the women, Fear not ye: for I know that ye seek Jesus, which was crucified.' },
          { ref: 'Matthew 28:6', text: 'He is not here: for he is risen, as he said. Come, see the place where the Lord lay.' },
        ], draw: function (k) {
          sky([[0, '#2A3756'], [0.55, '#B07A68'], [1, '#F0C080']]);
          glow(110, 420, 240, '255,210,140', 0.4);
          ridge(380, [[7, 1.2, 1]], '#4A3C4A');
          olive(52, 420, 90, '#1A1418', 2);
          ridge(462, [[3, 1.3, 0.2]], '#120F12', 0.35);
          tomb(244, 462, 90, '#221E24', 0.85, 1);
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,240,215,.75)';
          fallen(108, 466, 100, 1, '#120F12', 1);
          var look = ease(ramp(k.at(1), 2, 5));
          person({ x: mix(150, 196, look), y: 466, h: 86, f: 1, veil: BLUE_VEIL, bow: 0.3 + 0.3 * look });
          person({ x: mix(112, 158, look), y: 466, h: 84, f: 1, veil: '#3A2638', bow: 0.3 + 0.2 * look });
          angel({ x: 316, y: 437, h: 92, f: -1, sit: true, arms: 'out', big: 1.9 });
        } },
        { name: 'All hail', caps: [
          { ref: 'Matthew 28:9', text: 'And as they went to tell his disciples, behold, Jesus met them, saying, All hail. And they came and held him by the feet, and worshipped him.' },
          { ref: 'Matthew 28:10', text: 'Then said Jesus unto them, Be not afraid: go tell my brethren that they go into Galilee, and there shall they see me.' },
        ], draw: function (k) {
          sky([[0, '#4F7392'], [0.5, '#E2B38A'], [1, '#F6D49A']]);
          glow(110, 380, 220, '255,226,160', 0.45); c.fillStyle = 'rgba(255,240,205,.95)'; c.beginPath(); c.arc(110, 386, 28, 0, 6.283); c.fill();
          ridge(386, [[8, 1.1, 0.4], [3, 3, 1]], '#7E6A70');
          ridge(420, [[6, 1.3, 2]], '#4C3C42');
          olive(40, 450, 84, '#241C20', 2); olive(366, 446, 84, '#241C20', 6);
          ridge(466, [[3, 1.1, 0.4]], '#1B1418', 0.35);
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,236,190,.85)';
          var kn = ease(ramp(k.at(0), 3.5, 6));
          risen({ x: 262, y: 468, h: 108, f: -1, arms: k.cap === 0 && kn < 0.5 ? 'out' : null });
          person({ x: mix(120, 210, ease(ramp(k.at(0), 0, 4))), y: 468, h: 86, f: 1, veil: BLUE_VEIL, kneel: kn, bow: 0.8 * kn, arms: kn > 0.6 ? 'reach' : null, col: '#1B1418' });
          person({ x: mix(84, 166, ease(ramp(k.at(0), 0, 4.4))), y: 468, h: 84, f: 1, veil: '#3A2638', kneel: kn, bow: 0.8 * kn, col: '#1B1418' });
        } },
        { name: 'According to the scriptures', final: true, caps: [
          { ref: '1 Corinthians 15:3–4', text: 'For I delivered unto you first of all that which I also received, how that Christ died for our sins according to the scriptures; And that he was buried, and that he rose again the third day according to the scriptures:' },
          { brand: true, d: 8 },
        ], draw: function (k) {
          sky([[0, '#4F7392'], [0.5, '#E2B38A'], [1, '#F6D49A']]);
          glow(200, 300, 300, '255,226,160', 0.5);
          var hw = [[58, 1, 3.15], [5, 3.2, 0]];
          ridge(420, [[8, 1.1, 0.4]], '#8A7276');
          ridge(472, hw, '#2B2026', 0.35);
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,236,190,.8)';
          rcross(200, ridgeY(200, 472, hw) + 4, 140, '#2B2026', { rim: 1 });
          rcross(146, ridgeY(146, 472, hw) + 4, 118, '#2B2026', { rim: 1 });
          rcross(254, ridgeY(254, 472, hw) + 4, 118, '#2B2026', { rim: 1 });
        } },
      ],
    },
  };


  /* ---------- the landscape: the story told across the banner ---------- */
  // Four bands of hills, far to near. Each slides at its own speed as the camera travels,
  // which is what gives the page its depth.
  var BH = 320, BW = 800, cam = 0, camSet = false, K = 1, lastDt = 0.016;
  var LAY = {
    far: { spd: 0.22, base: 86, w: [[13, 0.0062, 1], [7, 0.017, 2], [3, 0.041, 0.5]], col: '#24493A', haze: '#3C6650', s: 0.38 },
    mid: { spd: 0.48, base: 120, w: [[16, 0.0047, 0.4], [8, 0.013, 1.7], [3, 0.033, 2.4]], col: '#173827', haze: '#2A5540', s: 0.56 },
    near: { spd: 0.8, base: 158, w: [[13, 0.0036, 2.2], [6, 0.011, 0.3], [2, 0.029, 1.1]], col: '#0E2618', haze: '#1D4430', s: 0.82 },
    front: { spd: 1.25, base: 206, w: [[10, 0.0042, 1], [4, 0.014, 0], [2, 0.037, 2]], col: '#07160D', haze: '#0F2A1A', s: 1.12 },
  };
  var ORDER = ['far', 'mid', 'near', 'front'];
  function LY(L, wx) { var y = L.base; for (var i = 0; i < L.w.length; i++) y += L.w[i][0] * Math.sin(wx * L.w[i][1] + L.w[i][2]); return y; }
  function Pat(C) {
    return {
      x: function (l, ox) { return BW / 2 + ox * K + (C - cam) * LAY[l].spd; },
      y: function (l, ox) { return LY(LAY[l], C * LAY[l].spd + ox * K); },
      s: function (l) { return LAY[l].s; },
    };
  }
  function pRidge(l, fill) {
    var L = LAY[l], off = cam * L.spd;
    c.beginPath(); c.moveTo(-10, BH + 10);
    for (var sx = -10; sx <= BW + 10; sx += 4) c.lineTo(sx, LY(L, sx - BW / 2 + off));
    c.lineTo(BW + 10, BH + 10); c.closePath(); c.fillStyle = fill; c.fill();
  }
  function pCap(l, col, wdt) {
    var L = LAY[l], off = cam * L.spd;
    c.beginPath(); for (var sx = -10; sx <= BW + 10; sx += 4) { var y = LY(L, sx - BW / 2 + off); if (sx < -9) c.moveTo(sx, y); else c.lineTo(sx, y); }
    c.strokeStyle = col; c.lineWidth = wdt; c.stroke();
  }
  function pStars(seed, n, maxY, a) {
    if (a <= 0) return;
    var r = rng(seed); c.fillStyle = '#FFF8E6';
    for (var i = 0; i < n; i++) {
      var x = r() * BW, y = r() * maxY, sz = r() * 1 + 0.3, sp = 0.6 + r() * 1.6;
      c.globalAlpha = a * (0.5 + 0.5 * Math.sin(T * sp + i)) * (1 - y / maxY) * 0.9;
      c.beginPath(); c.arc(x, y, sz, 0, 6.283); c.fill();
    }
    c.globalAlpha = 1;
  }
  // The light of the hour along the horizon, fading up into the banner's green.
  function horizon(rgb, a, y) {
    if (a <= 0) return;
    var g = c.createLinearGradient(0, 0, 0, BH);
    g.addColorStop(0, 'rgba(' + rgb + ',0)'); g.addColorStop(y / BH, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(Math.min(1, (y + 60) / BH), 'rgba(' + rgb + ',' + a * 0.4 + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    c.fillStyle = g; c.fillRect(0, 0, BW, BH);
  }
  function wheatRow(seed) {
    var r = rng(seed), L = LAY.front, off = cam * L.spd;
    for (var sx = -6; sx < BW + 6; sx += 7 + r() * 6) {
      var y = LY(L, sx - BW / 2 + off) + 4 + r() * 10, hh = 30 + r() * 26, sw = Math.sin(T * 1.1 + sx * 0.05) * 3;
      c.strokeStyle = 'rgba(176,140,62,.85)'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(sx, y); c.quadraticCurveTo(sx + sw * 0.4, y - hh * 0.6, sx + sw, y - hh); c.stroke();
      c.fillStyle = r() < 0.5 ? '#E2BE66' : '#C9A24A';
      for (var q = 0; q < 4; q++) { c.beginPath(); c.ellipse(sx + sw + (q % 2 ? 1.3 : -1.3), y - hh + q * 3.2, 1.3, 2.6, (q % 2 ? 0.4 : -0.4), 0, 6.283); c.fill(); }
    }
  }
  function cutawayHouse(x, y, w, h) {
    // A stone footing down into the hillside, so the house sits on the land.
    c.fillStyle = '#0A1A10'; c.beginPath(); c.moveTo(x - 30, y + 60); c.lineTo(x - 8, y - 4); c.lineTo(x + w + 8, y - 4); c.lineTo(x + w + 40, y + 60); c.closePath(); c.fill();
    var g = c.createLinearGradient(0, y - h, 0, y); g.addColorStop(0, '#4A3320'); g.addColorStop(1, '#2C1D12');
    c.fillStyle = g; c.fillRect(x, y - h, w, h);
    glow(x + w * 0.3, y - h * 0.35, w * 0.6, '255,190,110', 0.25);
    c.fillStyle = '#0B140E'; c.fillRect(x - 8, y - h - 10, w + 16, 12); c.fillRect(x - 8, y - h, 10, h); c.fillRect(x + w - 2, y - h, 10, h);
    c.fillStyle = '#0A1426'; c.beginPath(); c.moveTo(x + w * 0.14, y - h * 0.45); c.lineTo(x + w * 0.14, y - h * 0.75); c.arc(x + w * 0.2, y - h * 0.75, w * 0.06, Math.PI, 0); c.lineTo(x + w * 0.26, y - h * 0.45); c.closePath(); c.fill();
  }
  function mound(x, y, w, h, col) {
    c.fillStyle = col; c.beginPath(); c.moveTo(x - w / 2, y + 10);
    c.bezierCurveTo(x - w * 0.3, y - h * 0.2, x - w * 0.18, y - h, x, y - h); c.bezierCurveTo(x + w * 0.18, y - h, x + w * 0.3, y - h * 0.2, x + w / 2, y + 10); c.closePath(); c.fill();
  }

  var PANO = {
    christmas: {
      locs: { nazareth: 0, road: 1200, bethlehem: 2400, fields: 3600, east: 4800, house: 6000, finale: 7200 },
      snow: true,
      props: function (loc, l, P) {
        var S = P.s(l);
        if (loc === 'nazareth') {
          if (l === 'far') town(5, P.x('far', 260), P.y('far', 260) + 3, 0.55, '#16301F', 0.9, 7);
          if (l === 'near') { house(P.x('near', -330), P.y('near', -330) + 8, 110 * S, 92 * S, '#0A1A10', 1, 'lit'); olive(P.x('near', -190), P.y('near', -190) + 6, 66 * S, '#0A1A10', 4); }
        } else if (loc === 'road') {
          if (l === 'far') town(9, P.x('far', 330), P.y('far', 330) + 3, 0.6, '#16301F', 0.9, 9);
          if (l === 'mid') { olive(P.x('mid', -260), P.y('mid', -260) + 4, 70 * S, '#112619', 2); olive(P.x('mid', 220), P.y('mid', 220) + 4, 60 * S, '#112619', 8); }
        } else if (loc === 'bethlehem') {
          if (l === 'mid') town(17, P.x('mid', -230), P.y('mid', -230) + 4, 0.95, '#112619', 1, 10);
          if (l === 'near') { shelter(P.x('near', 0), P.y('near', 0) + 8, 200 * S, 132 * S, '#0A1A10'); manger(P.x('near', 100), P.y('near', 100) + 8, 52 * S, '#0A1A10'); }
        } else if (loc === 'fields') {
          if (l === 'far') town(13, P.x('far', -360), P.y('far', -360) + 3, 0.55, '#16301F', 0.9, 8);
          if (l === 'near') { var r = rng(77); for (var i = 0; i < 10; i++) { var ox = -330 + r() * 640, gz = 0.5 + 0.5 * Math.sin(T * 0.7 + i * 2); sheep(P.x('near', ox), P.y('near', ox) + 6 + r() * 14, 26 * S, r() < 0.5 ? 1 : -1, gz, '#D9D6C8', '#0A1510'); } }
        } else if (loc === 'east') {
          if (l === 'far') walls(P.x('far', -380), P.y('far', -380) + 4, 120, 18, '#16301F');
          if (l === 'mid') { house(P.x('mid', 300), P.y('mid', 300) + 6, 60, 44, '#112619', 1, 'lit'); house(P.x('mid', 250), P.y('mid', 250) + 6, 34, 26, '#112619', 0.6); house(P.x('mid', 370), P.y('mid', 370) + 6, 30, 22, '#112619', 0.5); }
        } else if (loc === 'house') {
          if (l === 'near') cutawayHouse(P.x('near', -90), P.y('near', -90) + 8, 360 * S, 150 * S);
        } else if (loc === 'finale') {
          if (l === 'far') town(23, P.x('far', -40), P.y('far', -40) + 3, 1.2, '#16301F', 1, 15);
        }
      },
      scenes: [
        { loc: 'nazareth', mood: function () { return { stars: 1, hz: ['60,90,140', 0.25] }; }, actors: function (k, P) {
          var S = P.s('near'), come = ease(ramp(k.at(0), 3, 6)), leave = ease(ramp(k.at(2), 6, 9)), ga = come * (1 - leave);
          LIGHT.dir = 1;
          person({ x: P.x('near', -60), y: P.y('near', -60) + 8, h: 118 * S, f: 1, veil: BLUE_VEIL, bow: 0.15 + 0.7 * ease(ramp(k.at(1), 1, 3)) * (1 - 0.4 * ease(ramp(k.at(2), 0, 2))) + 0.5 * ease(ramp(k.at(2), 1, 3)), rim: ga > 0.05 ? 1 : 0, rimCol: 'rgba(255,236,190,' + 0.75 * ga + ')' });
          angel({ x: P.x('near', 80), y: P.y('near', 80) - 14 - 26 * (1 - come) - 14 * leave, h: 128 * S, f: -1, a: ga, arms: k.cap >= 1 ? 'out' : null });
        } },
        { loc: 'road', cam: function (k) { return 0.7 * (-260 + 440 * (k.t / k.dur)) * K / 0.8; }, mood: function () { return { stars: 0.4, hz: ['235,150,90', 0.45], sun: [0.62, 110, 18] }; }, actors: function (k, P) {
          var S = P.s('near'), ox = -260 + 440 * (k.t / k.dur);
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,190,110,.8)';
          person({ x: P.x('near', ox + 44), y: P.y('near', ox + 44) + 8, h: 122 * S, f: 1, cloth: true, staff: true, walk: k.t * 3.6 });
          person({ x: P.x('near', ox), y: P.y('near', ox) + 8, h: 110 * S, f: 1, veil: BLUE_VEIL, belly: 1, walk: k.t * 3.6 + 1.6, bow: 0.15 });
        } },
        { loc: 'bethlehem', mood: function () { return { stars: 1, hz: ['50,80,130', 0.25] }; }, actors: function (k, P) {
          var S = P.s('near'), ba = ease(ramp(k.at(1), 0.5, 3));
          glow(P.x('near', 100), P.y('near', 100) - 30 * S, 170 * S, '255,214,140', 0.3 * ba);
          baby(P.x('near', 100), P.y('near', 100) + 8 - 36 * S, 30 * S, ba);
          LIGHT.col = 'rgba(255,220,150,' + (0.3 + 0.5 * ba) + ')';
          person({ x: P.x('near', 50), y: P.y('near', 50) + 8, h: 106 * S, f: 1, veil: BLUE_VEIL, kneel: 1, bow: 0.3 + 0.3 * ba, belly: 1 - ba, rim: 1 });
          person({ x: P.x('near', 168), y: P.y('near', 168) + 8, h: 124 * S, f: -1, cloth: true, staff: true, bow: 0.25, rim: -1 });
        } },
        { loc: 'fields', mood: function (k) { var ga = ease(ramp(k.at(1), 0, 2.2)), host = ease(ramp(k.at(5), 0, 3)); return { stars: 1 - ga * 0.6, hz: ['50,80,130', 0.22], glory: ga * 0.55 + host * 0.25 }; }, actors: function (k, P) {
          var S = P.s('near'), ga = ease(ramp(k.at(1), 0, 2.2)), host = ease(ramp(k.at(5), 0, 3)), praise = ease(ramp(k.at(6), 0, 2)), fear = ease(ramp(k.at(1), 0.6, 2.2));
          LIGHT.col = 'rgba(255,226,160,' + (0.2 + 0.6 * ga) + ')';
          person({ x: P.x('near', -220), y: P.y('near', -220) + 8, h: 118 * S, f: 1, cloth: true, staff: 'crook', kneel: fear, bow: fear * 0.7, rim: 1 });
          person({ x: P.x('near', -150), y: P.y('near', -150) + 10, h: 112 * S, f: 1, cloth: true, sit: 1 - fear, kneel: fear, bow: 0.2 + fear * 0.6, rim: 1 });
          person({ x: P.x('near', 230), y: P.y('near', 230) + 8, h: 122 * S, f: -1, cloth: true, staff: 'crook', kneel: fear, bow: fear * 0.7, rim: -1 });
          var hr = rng(9), cx = P.x('near', 20);
          for (var j = 0; j < 30; j++) { var hx = hr() * BW, hy = 30 + hr() * 70; if (Math.abs(hx - cx) < 70) hx += hx < cx ? -90 : 90; angel({ x: hx, y: hy + Math.sin(T * 0.9 + j) * 2, h: 20 + hr() * 14, a: host * (0.55 + 0.45 * hr()), f: hx < cx ? 1 : -1, arms: praise > 0.5 ? 'raise' : null, ph: j, big: 0.9 }); }
          angel({ x: cx, y: P.y('near', 20) - 30 - 20 * (1 - ga), h: 132 * S, f: 1, a: ga, arms: k.cap >= 2 ? (k.cap >= 6 ? 'raise' : 'out') : null, big: 1.8 });
        } },
        { loc: 'bethlehem', mood: function () { return { stars: 1, hz: ['50,80,130', 0.25] }; }, actors: function (k, P) {
          var S = P.s('near'), come = ease(ramp(k.at(0), 0, 4));
          glow(P.x('near', 100), P.y('near', 100) - 30 * S, 170 * S, '255,214,140', 0.3);
          baby(P.x('near', 100), P.y('near', 100) + 8 - 36 * S, 30 * S, 1);
          LIGHT.col = 'rgba(255,220,150,.75)';
          person({ x: P.x('near', -10), y: P.y('near', -10) + 8, h: 124 * S, f: 1, cloth: true, staff: true, bow: 0.25, rim: 1 });
          person({ x: P.x('near', 50), y: P.y('near', 50) + 8, h: 106 * S, f: 1, veil: BLUE_VEIL, kneel: 1, bow: 0.35 + 0.35 * ease(ramp(k.at(1), 0, 2)), rim: 1 });
          [[156, 3.5, 112], [204, 3.8, 116], [256, 4.5, 122]].forEach(function (m, i) {
            var ox = mix(m[0] + 260, m[0], come);
            person({ x: P.x('near', ox), y: P.y('near', ox) + 8, h: m[2] * S, f: -1, cloth: true, staff: i === 2 ? 'crook' : null, kneel: i < 2 ? ease(ramp(k.at(0), m[1], m[1] + 1.5)) : 0, bow: 0.7 * ease(ramp(k.at(0), m[1] + 0.5, m[1] + 2.5)), walk: come < 1 ? k.t * 4 + i : null, rim: -1 });
          });
        } },
        { loc: 'east', mood: function () { return { stars: 1, hz: ['50,80,130', 0.22] }; }, actors: function (k, P) {
          var S = P.s('near'), p = k.t / k.dur, mv = ease(ramp(k.at(2), 0, 8)), joy = ease(ramp(k.at(3), 0, 1.5));
          var hx = P.x('mid', 300), stx = mix(P.x('mid', -60), hx + 8, mv), sty = mix(26, 54, mv);
          bstar(stx, sty, 4 + joy * 1.2, 1);
          if (mv > 0.7) { c.save(); c.globalCompositeOperation = 'lighter'; var bg = c.createLinearGradient(0, 60, 0, P.y('mid', 300)); bg.addColorStop(0, 'rgba(255,240,200,' + 0.22 * ease(ramp(mv, 0.7, 1)) + ')'); bg.addColorStop(1, 'rgba(255,240,200,0)'); c.fillStyle = bg; c.beginPath(); c.moveTo(hx + 4, 62); c.lineTo(hx + 12, 62); c.lineTo(hx + 40, P.y('mid', 300) - 30); c.lineTo(hx - 24, P.y('mid', 300) - 30); c.closePath(); c.fill(); c.restore(); }
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,240,205,' + (0.3 + 0.4 * mv) + ')';
          var gx = mix(-380, 40, p);
          [[0, 124, 'gold'], [-40, 116, 'incense'], [-80, 128, 'myrrh'], [-120, 114, null]].forEach(function (m, i) {
            var ox = gx + m[0]; person({ x: P.x('near', ox), y: P.y('near', ox) + 8, h: m[1] * S, f: 1, hat: i % 2 === 0, cloth: i % 2 === 1, walk: k.t * 3 + i * 1.3, arms: joy > 0.3 && i < 3 ? 'raise' : null });
          });
        } },
        { loc: 'house', mood: function () { return { stars: 1, hz: ['50,80,130', 0.22] }; }, actors: function (k, P) {
          var S = P.s('near'), bowd = ease(ramp(k.at(0), 2, 4.5)), give = ease(ramp(k.at(1), 0.5, 3));
          bstar(P.x('near', 0), 22, 4.5, 1);
          LIGHT.dir = -1; LIGHT.col = 'rgba(255,220,160,.6)';
          person({ x: P.x('near', -40), y: P.y('near', -90) + 6, h: 104 * S, f: 1, veil: BLUE_VEIL, sit: 1, bow: 0.15, col: '#140D07' });
          person({ x: P.x('near', 0), y: P.y('near', -90) + 6, h: 56 * S, f: 1, col: '#140D07', rim: -1, rimCol: 'rgba(255,240,205,.8)' });
          [[72, 'gold', 112], [118, 'incense', 110], [164, 'myrrh', 114], [212, null, 118]].forEach(function (m, i) {
            var kn = i < 3 ? bowd : bowd * 0.4;
            person({ x: P.x('near', m[0]), y: P.y('near', -90) + 6, h: m[2] * S, f: -1, hat: i % 2 === 0, cloth: i % 2 === 1, kneel: kn, bow: kn * (give > 0 && i < 3 ? 0.35 : 0.8), arms: give > 0.1 && m[1] ? 'offer' : null, gift: m[1], col: '#140D07' });
          });
        } },
        { loc: 'finale', mood: function (k) { return { stars: 1, hz: ['50,80,130', 0.25], gold: 0.35 * ease(ramp(k.at(1), 0, 4)) }; }, actors: function (k, P) {
          var ca = ease(ramp(k.at(1), 1, 5));
          if (ca > 0) { glow(P.x('far', 230), P.y('far', 230) - 30, 120, '246,222,156', 0.4 * ca); c.save(); c.globalAlpha = ca; rcross(P.x('far', 230), P.y('far', 230) + 2, 56, '#E8C878', {}); c.restore(); }
        } },
      ],
    },
    easter: {
      locs: { jerusalem: 0, olives: 1200, via: 2400, calvary: 3600, garden: 4800, path: 6000 },
      wheat: true,
      props: function (loc, l, P, n) {
        var S = P.s(l);
        if (loc === 'jerusalem') {
          if (l === 'mid') { var x0 = P.x('mid', 20), y0 = P.y('mid', 180) + 6; c.fillStyle = '#8C7A5E'; c.fillRect(x0 + 70, y0 - 78, 140, 40); c.fillRect(x0 + 96, y0 - 90, 90, 14); walls(x0, y0, 300, 42, '#6E6250', x0 + 150); }
          if (l === 'near') { palm(P.x('near', -340), P.y('near', -340) + 8, 112 * S, '#1C2418'); palm(P.x('near', -80), P.y('near', -80) + 8, 96 * S, '#1C2418', 0.3); var cols = ['#7A2E2A', '#2F4F6E', '#8C6A2E', '#5A3A5E', '#3E5A3A']; for (var i = 0; i < 7; i++) { var ox = 30 + i * 34; c.fillStyle = cols[i % 5]; c.save(); c.translate(P.x('near', ox), P.y('near', ox) + 10 + (i % 2) * 3); c.rotate((i % 3 - 1) * 0.12); c.fillRect(-15, -3, 30, 6); c.restore(); } }
        } else if (loc === 'olives') {
          if (l === 'far') walls(P.x('far', 120), P.y('far', 200) + 4, 220, 22, '#16301F');
          if (l === 'near') { olive(P.x('near', -330), P.y('near', -330) + 8, 120 * S, '#0A1A10', 3); olive(P.x('near', -120), P.y('near', -120) + 6, 90 * S, '#0B1C12', 7); olive(P.x('near', 290), P.y('near', 290) + 8, 116 * S, '#0A1A10', 5); var rx = P.x('near', 80), ry = P.y('near', 80) + 8; rock([[rx - 30, ry], [rx - 32, ry - 26], [rx - 10, ry - 40], [rx + 24, ry - 34], [rx + 36, ry - 14], [rx + 34, ry]], '#0E1A13'); }
        } else if (loc === 'via') {
          if (l === 'mid') walls(P.x('mid', -420), P.y('mid', -300) + 6, 260, 44, '#22372A');
        } else if (loc === 'calvary') {
          if (l === 'near') { mound(P.x('near', 0), P.y('near', 0) + 8, 520 * S, 46 * S, '#0D2317'); if (n > 3) { var hy = P.y('near', 0) + 8 - 42 * S; rcross(P.x('near', -66), hy + 6, 98 * S, '#1C1410', { rim: 1 }); rcross(P.x('near', 66), hy + 6, 98 * S, '#1C1410', { rim: 1 }); rcross(P.x('near', 0), hy, 118 * S, '#1C1410', { rim: 1 }); } }
        } else if (loc === 'garden') {
          if (l === 'near') { olive(P.x('near', -300), P.y('near', -300) + 8, 100 * S, '#0A1A10', 2); var tx = P.x('near', 60), ty = P.y('near', 60) + 8; tomb(tx, ty, 92 * S, '#1A1C1C', n < 4 ? 0.75 : n > 5 ? 0.85 : null, n > 5 ? 1 : 0); }
        } else if (loc === 'path') {
          if (l === 'near') { olive(P.x('near', -330), P.y('near', -330) + 8, 100 * S, '#0A1A10', 2); olive(P.x('near', 320), P.y('near', 320) + 8, 96 * S, '#0A1A10', 6); }
        }
      },
      scenes: [
        { loc: 'jerusalem', cam: function (k) { return (-120 + 200 * (k.t / k.dur)) * K * 0.6; }, mood: function () { return { hz: ['250,225,170', 0.5], sun: [0.78, 40, 14], tint: ['#7C8A6A', 0.35] }; }, actors: function (k, P) {
          var S = P.s('near'), p = k.t / k.dur;
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,236,190,.8)';
          [[-300, 112, 1], [-262, 116, 1], [262, 118, -1], [300, 112, -1], [338, 120, -1]].forEach(function (m, i) { person({ x: P.x('near', m[0]), y: P.y('near', m[0]) + 8, h: m[1] * S, f: m[2], cloth: i % 2 === 0, veil: i % 2 ? '#3A2E26' : null, arms: k.cap >= 1 || i % 2 ? 'wave' : null, col: '#1A1A12' }); });
          var ox = mix(-160, 120, p), gx = P.x('near', ox), gy = P.y('near', ox) + 10;
          colt(gx, gy, 104 * S, 1, k.t * 3.2, '#16160F');
          rider(gx - 6 * S, gy - 104 * S * 0.66, 86 * S, '#1A1A12');
        } },
        { loc: 'olives', mood: function () { return { stars: 0.9, hz: ['70,100,150', 0.25], moon: [0.72, 40, 12] }; }, actors: function (k, P) {
          var S = P.s('near'), kn = ease(ramp(k.at(1), 0, 2.5)), walkIn = ease(ramp(k.t, 0, 6)), sleepA = ease(ramp(k.at(1), 1, 4));
          LIGHT.col = 'rgba(210,225,255,.7)'; LIGHT.dir = 1;
          [[-250, 92], [-210, 88], [-170, 90]].forEach(function (d) { person({ x: P.x('near', d[0]), y: P.y('near', d[0]) + 8, h: d[1] * S, f: 1, cloth: true, sit: 1, bow: 1.15, a: sleepA, rim: 1, rimCol: 'rgba(210,225,255,.45)', col: '#0B1A12' }); });
          var ox = mix(-120, 30, walkIn);
          person({ x: P.x('near', ox), y: P.y('near', ox) + 8, h: 126 * S, f: 1, cloth: true, kneel: kn, bow: 0.25 + kn * 0.35, arms: kn > 0.5 ? 'pray' : null, walk: walkIn < 1 ? k.t * 3 : null });
          var an = ease(ramp(k.at(3), 0, 2.5));
          angel({ x: P.x('near', 150), y: P.y('near', 150) - 40 + 16 * (1 - an), h: 110 * S, f: -1, a: an, arms: 'out' });
        } },
        { loc: 'via', cam: function (k) { return (-140 + 240 * (k.t / k.dur)) * K * 0.7; }, mood: function () { return { hz: ['200,140,100', 0.4], tint: ['#3E3328', 0.35] }; }, actors: function (k, P) {
          var S = P.s('near'), ox = mix(-160, 120, k.t / k.dur), fa = ease(ramp(k.at(2), 0, 3));
          LIGHT.dir = -1; LIGHT.col = 'rgba(255,200,140,.55)';
          var x = P.x('near', ox), y = P.y('near', ox) + 8;
          person({ x: x, y: y, h: 124 * S, f: 1, cloth: true, bow: 0.6, walk: k.t * 2.2, col: '#120C0C' });
          carried(x, y, 124 * S, '#1E1410');
          [[-70, 108, BLUE_VEIL], [-110, 104, '#3A2638'], [-150, 112, null], [-190, 106, '#3A2638']].forEach(function (m, i) { var fx = ox + m[0] - 30 * (1 - fa); person({ x: P.x('near', fx), y: P.y('near', fx) + 8, h: m[1] * S, f: 1, veil: m[2], cloth: !m[2], bow: 0.6, walk: k.t * 2.2 + i, a: i < 1 ? 1 : fa, col: '#140E0E' }); });
        } },
        { loc: 'calvary', mood: function (k) { var dk = ease(ramp(k.at(3), 0, 4)); return { hz: ['210,140,90', 0.45 * (1 - dk) + 0.15], tint: ['#3A2E28', 0.4], dark: dk * 0.7, shake: k.at(5) }; }, actors: function (k, P) {
          var S = P.s('near'), dk = ease(ramp(k.at(3), 0, 4)), bow = ease(ramp(k.at(4), 4, 6));
          var hy = P.y('near', 0) + 8 - 42 * S, wood = mixCol('#2A1C14', '#0C0807', dk), body = mixCol('#070505', '#000000', dk);
          LIGHT.dir = -1; LIGHT.col = 'rgba(255,190,130,' + 0.45 * (1 - dk) + ')';
          rcross(P.x('near', -66), hy + 6, 98 * S, wood, { fig: true, figCol: body, rim: -1 });
          rcross(P.x('near', 66), hy + 6, 98 * S, wood, { fig: true, figCol: body, rim: -1 });
          rcross(P.x('near', 0), hy, 118 * S, wood, { fig: true, figCol: body, title: true, bow: bow, rim: -1 });
          var col = mixCol('#120C0C', '#030203', dk);
          [[-270, BLUE_VEIL], [-240, '#2A1C26'], [-210, null]].forEach(function (m) { person({ x: P.x('near', m[0]), y: P.y('near', m[0]) + 8, h: 96 * S, f: 1, veil: m[1], cloth: !m[1], bow: 0.5, col: col }); });
          person({ x: P.x('near', 230), y: P.y('near', 230) + 8, h: 120 * S, f: -1, helmet: true, spear: true, bow: k.cap >= 5 ? -0.2 : 0, col: col });
        } },
        { loc: 'garden', mood: function () { return { stars: 0.4, hz: ['200,120,100', 0.4], tint: ['#2E2630', 0.3] }; }, actors: function (k, P) {
          var S = P.s('near'), roll = ease(ramp(k.at(1), 4, 9)), tx = P.x('near', 60), ty = P.y('near', 60) + 8;
          tombStone(tx, ty, 92 * S, mix(0.75, 0, roll));
          if (k.cap >= 3) { c.fillStyle = '#8A2E24'; c.beginPath(); c.arc(tx, ty - 28 * S, 3, 0, 6.283); c.fill(); }
          LIGHT.dir = -1; LIGHT.col = 'rgba(255,180,130,.5)';
          var leave = ease(ramp(k.at(1), 10, 13)), jx = mix(40, 150, roll) + 40 * leave;
          person({ x: P.x('near', jx), y: P.y('near', jx) + 8, h: 120 * S, f: -1, cloth: true, bow: 0.45, arms: roll > 0 && roll < 1 ? 'reach' : null, a: 1 - leave });
          var wa = ease(ramp(k.at(2), 0, 2)), ga = ease(ramp(k.at(3), 0, 2.5));
          person({ x: P.x('near', -230), y: P.y('near', -230) + 10, h: 100 * S, f: 1, veil: BLUE_VEIL, sit: 1, bow: 0.5, a: wa });
          person({ x: P.x('near', -186), y: P.y('near', -186) + 10, h: 100 * S, f: 1, veil: '#3A2638', sit: 1, bow: 0.4, a: wa });
          person({ x: P.x('near', -70), y: P.y('near', -70) + 8, h: 122 * S, f: 1, helmet: true, spear: true, a: ga });
          person({ x: P.x('near', 250), y: P.y('near', 250) + 8, h: 122 * S, f: -1, helmet: true, spear: true, a: ga });
        } },
        { loc: 'garden', mood: function (k) { var dw = ease(ramp(k.t, 0, k.dur)); return { stars: 1 - dw, hz: ['240,170,120', 0.2 + 0.4 * dw], tint: ['#2E2630', 0.3 * (1 - dw)], shake: k.at(1) }; }, actors: function (k, P) {
          var S = P.s('near'), desc = ease(ramp(k.at(1), 1.5, 4.5)), roll = ease(ramp(k.at(1), 4.5, 8)), bright = ease(ramp(k.at(2), 0, 1.5));
          var tx = P.x('near', 60), ty = P.y('near', 60) + 8;
          if (roll > 0) glow(tx, ty - 25 * S, 40 * S, '255,236,190', 0.25 * roll);
          tombStone(tx, ty, 92 * S, mix(0, 0.85, roll));
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,245,225,' + 0.8 * desc + ')';
          var wo = mix(-380, -230, ease(ramp(k.at(0), 0, 7)));
          person({ x: P.x('near', wo), y: P.y('near', wo) + 8, h: 104 * S, f: 1, veil: BLUE_VEIL, walk: k.cap === 0 ? k.t * 3 : null });
          person({ x: P.x('near', wo - 40), y: P.y('near', wo - 40) + 8, h: 102 * S, f: 1, veil: '#3A2638', walk: k.cap === 0 ? k.t * 3 + 1 : null });
          var fall = ease(ramp(k.at(3), 1.2, 3)), st1 = 1 - ramp(fall, 0.35, 0.7), jit = k.cap >= 3 && fall < 1 ? Math.sin(T * 40) * 1.2 : 0;
          person({ x: P.x('near', -70) + jit, y: P.y('near', -70) + 8, h: 122 * S, f: 1, helmet: true, spear: true, bow: fall * 0.6, rot: fall * 0.25, a: st1 });
          person({ x: P.x('near', 250) + jit, y: P.y('near', 250) + 8, h: 122 * S, f: -1, helmet: true, spear: true, bow: fall * 0.6, rot: -fall * 0.25, a: st1 });
          fallen(P.x('near', -78), P.y('near', -78) + 8, 122 * S, 1, INK, 1 - st1); fallen(P.x('near', 246), P.y('near', 246) + 8, 122 * S, -1, INK, 1 - st1);
          var ax = tx + 78 * S * roll, ay = mix(-40, ty - 30 * S, desc);
          angel({ x: ax, y: roll >= 1 ? ty - 56 * S : ay, h: (roll >= 1 ? 100 : 128) * S, a: desc, f: -1, big: 2 + bright, sit: roll >= 1 });
        } },
        { loc: 'garden', mood: function () { return { hz: ['245,180,120', 0.55] }; }, actors: function (k, P) {
          var S = P.s('near'), tx = P.x('near', 60), ty = P.y('near', 60) + 8, look = ease(ramp(k.at(1), 2, 5));
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,240,215,.75)';
          glow(tx, ty - 25 * S, 40 * S, '255,236,190', 0.25);
          fallen(P.x('near', -78), P.y('near', -78) + 8, 122 * S, 1, INK, 1);
          var w1 = mix(-160, -40, look);
          person({ x: P.x('near', w1), y: P.y('near', w1) + 8, h: 104 * S, f: 1, veil: BLUE_VEIL, bow: 0.3 + 0.3 * look });
          person({ x: P.x('near', w1 - 40), y: P.y('near', w1 - 40) + 8, h: 102 * S, f: 1, veil: '#3A2638', bow: 0.3 + 0.2 * look });
          angel({ x: tx + 78 * S, y: ty - 56 * S, h: 100 * S, f: -1, sit: true, arms: 'out', big: 1.9 });
        } },
        { loc: 'path', mood: function () { return { hz: ['250,215,150', 0.6], sun: [0.34, 112, 20], tint: ['#6F7A5A', 0.3] }; }, actors: function (k, P) {
          var S = P.s('near'), kn = ease(ramp(k.at(0), 3.5, 6));
          LIGHT.dir = 1; LIGHT.col = 'rgba(255,236,190,.85)';
          risen({ x: P.x('near', 80), y: P.y('near', 80) + 8, h: 130 * S, f: -1, arms: k.cap === 0 && kn < 0.5 ? 'out' : null });
          var w1 = mix(-200, 4, ease(ramp(k.at(0), 0, 4))), w2 = mix(-246, -40, ease(ramp(k.at(0), 0, 4.4)));
          person({ x: P.x('near', w1), y: P.y('near', w1) + 8, h: 104 * S, f: 1, veil: BLUE_VEIL, kneel: kn, bow: 0.8 * kn, arms: kn > 0.6 ? 'reach' : null, col: '#151A12' });
          person({ x: P.x('near', w2), y: P.y('near', w2) + 8, h: 102 * S, f: 1, veil: '#3A2638', kneel: kn, bow: 0.8 * kn, col: '#151A12' });
        } },
        { loc: 'calvary', mood: function () { return { hz: ['250,215,150', 0.65], sun: [0.5, 104, 22], tint: ['#6F7A5A', 0.25] }; }, actors: function () {} },
      ],
    },
  };
  function tombStone(x, y, s, off) {
    var sx = x + off * s; c.save(); c.translate(sx, y - 0.31 * s); c.rotate(off * 1.6);
    var sg = c.createRadialGradient(-0.1 * s, -0.12 * s, 0.02 * s, 0, 0, 0.33 * s); sg.addColorStop(0, '#4A4440'); sg.addColorStop(1, '#25211F');
    c.fillStyle = sg; c.beginPath(); c.arc(0, 0, 0.31 * s, 0, 6.283); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 0.27 * s, 0.4, 2.2); c.stroke(); c.restore();
  }

  var actorCanvas = null, ac = null, mainC = c;
  function panoRender(sc, k, a) {
    var ps = PANO[kind], s2 = ps.scenes[si];
    var target = ps.locs[s2.loc] + (s2.cam ? s2.cam(k) : 0);
    if (!camSet) { cam = target; camSet = true; } else cam += (target - cam) * (1 - Math.exp(-lastDt * 1.15));
    var m = s2.mood ? s2.mood(k) : {};
    c.setTransform(SC, 0, 0, SC, 0, 0); c.clearRect(0, 0, BW, BH);
    c.save();
    if (m.shake != null) shake(m.shake, 2.6, 3);
    pStars(41, Math.round(BW / 8), 90, m.stars || 0);
    horizon((m.hz || ['50,80,130', 0.2])[0], (m.hz || [0, 0.2])[1], LAY.far.base - 10);
    if (m.sun) { var sx = BW * m.sun[0], sy = m.sun[1]; glow(sx, sy, 120, '255,220,150', 0.5); c.fillStyle = 'rgba(255,240,205,.95)'; c.beginPath(); c.arc(sx, sy, m.sun[2], 0, 6.283); c.fill(); }
    if (m.moon) { var mx = BW * m.moon[0], my = m.moon[1]; glow(mx, my, 70, '220,230,255', 0.3); c.fillStyle = '#E9ECF2'; c.beginPath(); c.arc(mx, my, m.moon[2], 0, 6.283); c.fill(); }
    if (m.gold) glow(BW * 0.82, 40, 260, '246,222,156', m.gold);
    var tint = m.tint || ['#000000', 0];
    ORDER.forEach(function (l) {
      var L = LAY[l], col = mixCol(L.col, tint[0], tint[1]), hz = mixCol(L.haze, tint[0], tint[1]);
      var g = c.createLinearGradient(0, L.base - 24, 0, L.base + 70);
      if (ps.snow && l === 'front') { g.addColorStop(0, '#9DB2C0'); g.addColorStop(0.35, '#5F7786'); g.addColorStop(1, '#22343E'); }
      else if (ps.snow) { g.addColorStop(0, mixCol(L.haze, '#C9D6DF', l === 'near' ? 0.42 : l === 'mid' ? 0.3 : 0.2)); g.addColorStop(0.3, hz); g.addColorStop(1, col); }
      else { g.addColorStop(0, hz); g.addColorStop(0.45, col); g.addColorStop(1, col); }
      pRidge(l, g);
      if (ps.snow && l === 'front') pCap(l, 'rgba(225,236,244,.55)', 1.4);
      for (var name in ps.locs) {
        var C = ps.locs[name];
        if (Math.abs((C - cam) * L.spd) < BW * 0.5 + 520 * K) { LIGHT = { dir: -1, col: 'rgba(240, 205, 130, .5)' }; ps.props(name, l, Pat(C), si); }
      }
      if (l === 'near') {
        // The people of the scene come and go softly as the camera arrives and leaves.
        if (!actorCanvas || actorCanvas.width !== canvas.width || actorCanvas.height !== canvas.height) { actorCanvas = document.createElement('canvas'); actorCanvas.width = canvas.width; actorCanvas.height = canvas.height; ac = actorCanvas.getContext('2d'); }
        c.restore(); c = ac; c.setTransform(SC, 0, 0, SC, 0, 0); c.clearRect(0, 0, BW, BH); c.save();
        LIGHT = { dir: -1, col: 'rgba(240, 205, 130, .6)' };
        s2.actors(k, Pat(ps.locs[s2.loc])); c.restore(); noRim();
        c = mainC; c.save();
        if (m.shake != null) shake(m.shake, 2.6, 3);
        c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = a; c.drawImage(actorCanvas, 0, 0); c.globalAlpha = 1; c.setTransform(SC, 0, 0, SC, 0, 0);
      }
      if (l === 'front' && ps.wheat) wheatRow(5);
    });
    if (m.glory) glow(BW / 2, 90, BW * 0.7, '255,226,160', m.glory * 0.6);
    if (m.dark) { var dg = c.createLinearGradient(0, 0, 0, BH); dg.addColorStop(0, 'rgba(4,4,6,0)'); dg.addColorStop(0.35, 'rgba(4,4,6,' + m.dark * 0.7 + ')'); dg.addColorStop(1, 'rgba(4,4,6,' + m.dark * 0.8 + ')'); c.fillStyle = dg; c.fillRect(0, 0, BW, BH); }
    c.restore(); noRim();
  }

  /* ---------- the player ---------- */
  var story = STORIES[kind], scenes = story.scenes;
  scenes.forEach(function (sc) {
    var t = 0; sc.starts = [];
    sc.caps.forEach(function (cp) { sc.starts.push(t); cp.d = cp.d || Math.max(5.5, 2.6 + words(cp.text) * 0.31); t += cp.d; });
    sc.dur = t + 0.6;
  });
  var si = 0, st = 0, playing = !reduce, visible = true, running = false;
  var capWrap = fig.querySelector('.story-cap'), eyebrow = fig.querySelector('.story-eyebrow'), verse = fig.querySelector('.story-verse'), ref = fig.querySelector('.story-ref');
  var shown = '';

  function kOf(sc, t) {
    var ci = 0; for (var i = 0; i < sc.starts.length; i++) if (t >= sc.starts[i]) ci = i;
    return { t: t, cap: ci, dur: sc.dur, at: function (n) { return n < sc.starts.length ? t - sc.starts[n] : -1; } };
  }
  function caption(sc, k) {
    var cp = sc.caps[k.cap], key = si + ':' + k.cap;
    fig.classList.toggle('is-cross', !!cp.brand);
    if (key === shown) return;
    shown = key;
    capWrap.classList.add('is-changing');
    setTimeout(function () {
      if (cp.brand) {
        eyebrow.textContent = story.title;
        verse.innerHTML = 'The Cross is <span class="serif">Central.</span>';
        verse.classList.add('story-brand'); ref.textContent = '';
      } else {
        eyebrow.textContent = story.title + ' · ' + sc.name;
        verse.textContent = cp.text; verse.classList.remove('story-brand'); ref.textContent = cp.ref;
      }
      capWrap.classList.remove('is-changing');
    }, shown === key && !reduce ? 380 : 0);
    dots.forEach(function (d, i) { d.setAttribute('aria-current', i === si ? 'true' : 'false'); });
  }
  function render() {
    var sc = scenes[si], k = kOf(sc, st);
    if (pano) {
      var brandA = sc.caps[k.cap].brand ? ease(ramp(k.at(k.cap), 0, 1.6)) : 0;
      var a = playing ? Math.min(ramp(st, 0.8, 2.6), 1 - ramp(st, sc.dur - 1.2, sc.dur - 0.2)) : 1;
      panoRender(sc, k, a * (1 - brandA * 0.85));
      if (brandA > 0) { c.setTransform(SC, 0, 0, SC, 0, 0); glow(BW * 0.82, 30, 300, '246,222,156', 0.3 * brandA); }
      caption(sc, k);
      return;
    }
    c.setTransform(SC, 0, 0, SC, 0, 0);
    c.clearRect(0, 0, LW, LH);
    LIGHT = { dir: -1, col: 'rgba(240, 205, 130, .6)' };
    var z = sc.zoom || 1.26;
    c.save(); c.translate(200, 500); c.scale(z, z); c.translate(-200, -500); sc.draw(k); c.restore(); noRim();
    if (sc.caps[k.cap].brand) { c.fillStyle = 'rgba(12,33,21,' + ease(ramp(k.at(k.cap), 0, 1.6)) * 0.92 + ')'; c.fillRect(0, 0, LW, LH); }
    var fade = playing ? Math.max(1 - ramp(st, 0, 0.9), ramp(st, sc.dur - 0.6, sc.dur)) : 0;
    if (fade > 0) { c.fillStyle = 'rgba(6,14,10,' + fade + ')'; c.fillRect(0, 0, LW, LH); }
    caption(sc, k);
  }
  // The moment that shows a verse best: most of the way through its picture.
  function capTime(sc, ci) { return Math.min(sc.dur - 0.7, sc.starts[ci] + Math.min(4.5, sc.caps[ci].d * 0.75)); }
  function keyTime(sc) { return capTime(sc, sc.caps.length - 1); }
  function go(i, ci) {
    si = (i + scenes.length) % scenes.length;
    if (!playing) camSet = false;
    st = playing ? 0 : capTime(scenes[si], ci || 0);
    render();
  }
  // While playing, the arrows move a scene; while paused, they move one verse at a time.
  function step(dir) {
    if (playing) return go(si + dir);
    var sc = scenes[si], ci = kOf(sc, st).cap + dir;
    if (ci >= sc.caps.length) return go(si + 1, 0);
    if (ci < 0) { var pi = (si - 1 + scenes.length) % scenes.length; return go(pi, scenes[pi].caps.length - 1); }
    st = capTime(sc, ci); render();
  }

  // Controls: back, play/pause, forward, and a dot for each scene.
  var ctrl = fig.querySelector('.story-ctrl'), dots = [];
  var btnPrev = ctrl.querySelector('[data-prev]'), btnPlay = ctrl.querySelector('[data-play]'), btnNext = ctrl.querySelector('[data-next]'), dotWrap = ctrl.querySelector('.story-dots');
  scenes.forEach(function (sc, i) {
    var d = document.createElement('button'); d.type = 'button'; d.className = 'story-dot';
    d.setAttribute('aria-label', 'Scene ' + (i + 1) + ' of ' + scenes.length + ': ' + sc.name);
    d.addEventListener('click', function () { go(i); });
    dotWrap.appendChild(d); dots.push(d);
  });
  function setPlay(p) {
    playing = p; btnPlay.setAttribute('aria-pressed', p ? 'false' : 'true');
    btnPlay.setAttribute('aria-label', p ? 'Pause the story' : 'Play the story');
    btnPlay.classList.toggle('is-paused', !p);
    if (p) start(); else { var sc = scenes[si]; st = capTime(sc, kOf(sc, st).cap); render(); }
  }
  btnPrev.addEventListener('click', function () { step(-1); });
  btnNext.addEventListener('click', function () { step(1); });
  btnPlay.addEventListener('click', function () { setPlay(!playing); });
  ctrl.hidden = false;

  var last = 0;
  function frame(now) {
    if (!running) return;
    if (!playing || !visible || document.hidden) { running = false; return; }
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016; last = now; lastDt = dt;
    T += dt; st += dt;
    if (st >= scenes[si].dur) { si = (si + 1) % scenes.length; st = 0; }
    render();
    requestAnimationFrame(frame);
  }
  function start() { if (running || !playing || !visible || document.hidden) return; running = true; last = 0; requestAnimationFrame(frame); }
  function measure() {
    var w = stage.clientWidth, h = stage.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (pano) { SC = canvas.height / BH; BW = canvas.width / SC; K = clamp(BW / 780, 0.42, 1); } else SC = canvas.width / LW;
    render();
  }
  fig.classList.add('is-ready');
  measure();
  setPlay(playing);
  if (window.ResizeObserver) new ResizeObserver(function () { measure(); }).observe(stage); else window.addEventListener('resize', measure);
  if (window.IntersectionObserver) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; start(); }).observe(fig);
  document.addEventListener('visibilitychange', start);
  // For checking each scene by eye: __story.show(scene, seconds)
  window.__story = { scenes: scenes.map(function (s) { return { name: s.name, dur: s.dur, starts: s.starts }; }), show: function (i, t, tt) { playing = false; running = false; si = i; st = t; T = tt == null ? t : tt; shown = ''; camSet = false; render(); } };
})();

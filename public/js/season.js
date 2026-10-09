/* Seasonal homepage banner, in place of the wheat field.
   Fall: leaves drift down, each on its own path, and come to rest in a pile on the ground.
   Winter: snow falls and builds into a drift along the ground.
   Draws on one canvas behind the banner text; pauses when off screen. */
(function () {
  'use strict';
  var canvas = document.querySelector('canvas.season-sky');
  if (!canvas || !canvas.getContext) return;
  var hero = canvas.parentNode;
  var mode = canvas.getAttribute('data-season');
  // When the Christmas story fills the banner, its own snowy hills are the ground: snow falls past, no drift.
  var noGround = canvas.getAttribute('data-ground') === 'none';
  if (mode !== 'fall' && mode !== 'winter') return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, FH = 240, dpr = 1, T = 0;
  var field = hero.querySelector('.field');
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var pick = function (a) { return a[(Math.random() * a.length) | 0]; };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  /* ---------- Fall ---------- */
  var LEAF_COLORS = [
    ['#C2410C', '#E0702A'], ['#D97A2B', '#F0A04B'], ['#E2BE66', '#F3D88F'], ['#A63A22', '#CF5A35'],
    ['#8C4A1F', '#B36A33'], ['#B8860B', '#D9AA3A'], ['#9B2C1F', '#C2452C'], ['#C9822E', '#E6A957'],
  ];
  function maplePath(c) {
    var p = [[0, -1], [0.13, -0.62], [0.42, -0.8], [0.36, -0.42], [0.86, -0.52], [0.66, -0.2], [0.98, 0.0], [0.52, 0.1], [0.62, 0.42], [0.14, 0.28], [0.04, 0.6]];
    c.beginPath(); c.moveTo(p[0][0], p[0][1]);
    for (var i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1]);
    for (var j = p.length - 1; j >= 1; j--) c.lineTo(-p[j][0], p[j][1]);
    c.closePath();
  }
  function curvePath(c, fx, fy) {
    c.beginPath();
    for (var i = 0; i <= 120; i++) { var t = (i / 120) * Math.PI * 2; var x = fx(t), y = fy(t); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.closePath();
  }
  var SHAPES = [
    { draw: maplePath, veins: [[0, 0.6, 0, -0.9], [0, 0.35, 0.78, -0.45], [0, 0.35, -0.78, -0.45], [0, 0.4, 0.85, 0.02], [0, 0.4, -0.85, 0.02]] },
    { draw: function (c) { curvePath(c, function (t) { return 0.46 * Math.sin(t) * (1 + 0.2 * Math.cos(9 * t)); }, function (t) { return -0.95 * Math.cos(t); }); }, veins: [[0, 0.95, 0, -0.9], [0, 0.4, 0.35, 0.05], [0, 0.4, -0.35, 0.05], [0, -0.1, 0.32, -0.45], [0, -0.1, -0.32, -0.45]] },
    { draw: function (c) { curvePath(c, function (t) { return 0.52 * Math.sin(t) * (1 - 0.32 * Math.cos(t)) * (1 + 0.025 * Math.cos(44 * t)); }, function (t) { return -0.95 * Math.cos(t); }); }, veins: [[0, 0.95, 0, -0.9], [0, 0.45, 0.4, 0.15], [0, 0.45, -0.4, 0.15], [0, 0.0, 0.34, -0.3], [0, 0.0, -0.34, -0.3]] },
    { draw: function (c) { curvePath(c, function (t) { return 0.62 * Math.sin(t) * (1 - 0.12 * Math.cos(t)); }, function (t) { return -0.85 * Math.cos(t) - 0.08; }); }, veins: [[0, 0.8, 0, -0.9], [0, 0.4, 0.45, 0.0], [0, 0.4, -0.45, 0.0]] },
  ];
  var sprites = [];
  function makeSprites() {
    sprites = [];
    SHAPES.forEach(function (shape) {
      LEAF_COLORS.forEach(function (col) {
        var S = 96, c = document.createElement('canvas'); c.width = c.height = S;
        var g = c.getContext('2d');
        g.translate(S / 2, S / 2); g.scale(S * 0.42, S * 0.42);
        var grad = g.createLinearGradient(-0.6, -1, 0.6, 1); grad.addColorStop(0, col[1]); grad.addColorStop(1, col[0]);
        shape.draw(g); g.fillStyle = grad; g.fill();
        g.lineWidth = 0.035; g.strokeStyle = 'rgba(60, 25, 8, .28)'; g.stroke();
        g.lineCap = 'round'; g.strokeStyle = 'rgba(70, 30, 10, .45)'; g.lineWidth = 0.04;
        shape.veins.forEach(function (v) { g.beginPath(); g.moveTo(v[0], v[1]); g.lineTo(v[2], v[3]); g.stroke(); });
        g.strokeStyle = col[0]; g.lineWidth = 0.06; g.beginPath(); g.moveTo(0, 0.6); g.quadraticCurveTo(0.04, 0.85, -0.02, 1.08); g.stroke();
        // The underside of the leaf: the same shape, a little darker.
        var b = document.createElement('canvas'); b.width = b.height = S;
        var bg = b.getContext('2d'); bg.drawImage(c, 0, 0); bg.globalCompositeOperation = 'source-atop'; bg.fillStyle = 'rgba(40, 18, 6, .22)'; bg.fillRect(0, 0, S, S);
        sprites.push({ front: c, back: b });
      });
    });
  }
  // The top edge of the lawn, a gentle roll across the bottom of the banner where the wheat stood.
  function groundY(x) {
    var u = x / Math.max(W, 1);
    return H - FH * 0.6 - 12 * Math.sin(u * Math.PI * 1.3 + 0.6) - 6 * Math.sin(u * Math.PI * 3.7 + 1.9);
  }
  // Where a resting leaf lies: depth 0 is the back of the lawn, 1 the front.
  function restY(l) { var g = groundY(l.x); return g + 4 + l.d * (H - g - 12); }
  function depthScale(d) { return 0.62 + 0.5 * d; }
  function addResting(l) {
    var i = resting.length; while (i > 0 && resting[i - 1].y > l.y) i--;
    resting.splice(i, 0, l);
  }
  var falling = [], resting = [];
  function maxRest() { return clamp(Math.round(W / 4.5), 70, 320); }
  function maxFalling() { return clamp(Math.round(W / 75), 6, 22); }
  function newLeaf(y) {
    var size = rand(13, 26) * (W < 600 ? 0.85 : 1);
    var tumble = Math.random() < 0.35;
    return {
      spr: pick(sprites), size: size, x0: rand(-40, W + 40), x: 0, y: y === undefined ? rand(-60, -25) : y,
      t: rand(0, 20), A: rand(18, 70), w: rand(0.5, 1.25), ph: rand(0, 6.28),
      drift: rand(-8, 8), vy: rand(22, 42) * (size / 20), windK: rand(0.6, 1.4),
      rot0: rand(0, 6.28), tilt: rand(0.35, 0.9), spin: tumble ? rand(-1.6, 1.6) : rand(-0.25, 0.25),
      fw: tumble ? rand(1.6, 3.2) : rand(0.6, 1.4), fph: rand(0, 6.28), d: Math.pow(Math.random(), 0.8),
      rot: 0, flip: 1, alpha: 1,
    };
  }
  function restingLeaf() {
    var l = newLeaf(0); l.x = rand(-10, W + 10); l.y = restY(l); l.rot = rand(0, 6.28); l.scale = depthScale(l.d); l.alpha = 0.8 + 0.2 * l.d;
    l.flip = (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.75); l.restFlip = l.flip; l.settle = 1; return l;
  }
  function initFall() {
    makeSprites(); falling = []; resting = [];
    var n = Math.round(maxRest() * 0.55); for (var i = 0; i < n; i++) addResting(restingLeaf());
    var f = maxFalling(); for (var j = 0; j < f; j++) falling.push(newLeaf(rand(-40, groundY(W / 2) - 40)));
  }
  var spawnIn = 0;
  function wind() { return 10 * Math.sin(T * 0.07) + 6 * Math.sin(T * 0.19 + 1.3) + 3 * Math.sin(T * 0.53); }
  function stepFall(dt) {
    var wv = wind();
    spawnIn -= dt;
    if (spawnIn <= 0 && falling.length < maxFalling()) { falling.push(newLeaf()); spawnIn = rand(0.35, 1.6); }
    for (var i = falling.length - 1; i >= 0; i--) {
      var l = falling[i];
      l.t += dt;
      var a = l.w * l.t + l.ph, s = Math.sin(a), c = Math.cos(a);
      l.x0 += (l.drift + wv * l.windK) * dt;
      l.x = l.x0 + l.A * s;
      // Like a real leaf: it glides down fastest through the bottom of each swing and slows at the ends.
      l.y += l.vy * (0.45 + 0.85 * c * c) * dt;
      l.rot = l.rot0 + l.tilt * c * 0.9 + l.spin * l.t;
      l.flip = Math.cos(l.fw * l.t + l.fph);
      if (Math.abs(l.flip) < 0.12) l.flip = l.flip < 0 ? -0.12 : 0.12;
      if (l.x < -60) l.x0 += W + 120; else if (l.x > W + 60) l.x0 -= W + 120;
      // As it nears the lawn it eases toward its resting size, so it seems to settle into its spot.
      var gy = restY(l), g0 = groundY(l.x);
      l.scale = l.y > g0 ? 1 + (depthScale(l.d) - 1) * clamp((l.y - g0) / Math.max(gy - g0, 1), 0, 1) : 1;
      if (l.y >= gy) {
        l.y = gy; l.landFlip = l.flip; l.restFlip = (l.flip < 0 ? -1 : 1) * rand(0.35, 0.75); l.settle = 0; l.scale = depthScale(l.d);
        falling.splice(i, 1); addResting(l);
      }
    }
    var cap = maxRest(), extra = resting.length - cap;
    for (var k = 0; k < resting.length; k++) {
      var r = resting[k];
      if (r.settle < 1) { r.settle = Math.min(1, r.settle + dt * 1.6); var e = 1 - Math.pow(1 - r.settle, 3); r.flip = r.landFlip + (r.restFlip - r.landFlip) * e; }
      if (k < extra && !r.fading) r.fading = true; // the oldest leaves slowly fade into the ground
      if (r.fading) r.alpha -= dt / 6;
    }
    resting = resting.filter(function (r) { return r.alpha > 0; });
  }
  function drawLeaf(l) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, l.alpha);
    ctx.translate(l.x, l.y); ctx.rotate(l.rot); ctx.scale(1, l.flip);
    var s = l.size * 2.3 * (l.scale || 1); ctx.drawImage(l.flip < 0 ? l.spr.back : l.spr.front, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
  function drawGround() {
    var top = ctx.createLinearGradient(0, groundY(W / 2) - 20, 0, H);
    top.addColorStop(0, '#34431F'); top.addColorStop(0.35, '#22321A'); top.addColorStop(1, '#0E1E12');
    ctx.beginPath(); ctx.moveTo(0, H);
    for (var x = 0; x <= W + 8; x += 8) ctx.lineTo(x, groundY(x));
    ctx.lineTo(W, H); ctx.closePath(); ctx.fillStyle = top; ctx.fill();
    ctx.beginPath(); for (var x2 = 0; x2 <= W + 8; x2 += 8) { if (x2) ctx.lineTo(x2, groundY(x2)); else ctx.moveTo(x2, groundY(x2)); }
    ctx.strokeStyle = 'rgba(226, 190, 102, .22)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  function drawFall() {
    drawGround();
    for (var i = 0; i < resting.length; i++) drawLeaf(resting[i]);
    for (var j = 0; j < falling.length; j++) drawLeaf(falling[j]);
  }

  /* ---------- Winter ---------- */
  var flakes = [], landed = [], bins = [], base = [], cap = [], BIN = 3;
  function flakeCount() { return clamp(Math.round((W * H) / 7000), 70, 300); }
  function newFlake(y) {
    var near = Math.random() < 0.55;
    var r = near ? rand(1.5, 3.4) : rand(0.7, 1.5);
    return { x: rand(0, W), y: y === undefined ? rand(-30, -5) : y, r: r, near: near, vy: near ? rand(28, 56) : rand(14, 28),
      A: rand(6, 26), w: rand(0.4, 1.4), ph: rand(0, 6.28), t: rand(0, 10), alpha: near ? rand(0.75, 1) : rand(0.35, 0.6), drift: rand(-6, 6) };
  }
  function snowTop(x) {
    if (noGround) return H + 20;
    var i = clamp((x / BIN) | 0, 0, bins.length - 1);
    return H - bins[i];
  }
  function initWinter(keep) {
    var n = Math.ceil(W / BIN) + 2, old = bins;
    var b0 = FH * 0.48;
    base = []; bins = []; cap = [];
    for (var i = 0; i < n; i++) {
      var u = (i * BIN) / Math.max(W, 1);
      base[i] = b0 + 12 * Math.sin(u * Math.PI * 1.6 + 0.4) + 6 * Math.sin(u * Math.PI * 4.3 + 2.1) + 2 * Math.sin(u * Math.PI * 9.1);
      cap[i] = base[i] + FH * 0.2 + 10 * Math.sin(u * Math.PI * 6.7 + 1.1);
      bins[i] = keep && old.length ? Math.max(base[i], old[Math.min(old.length - 1, Math.round((i / n) * old.length))]) : base[i];
    }
    if (!keep) { flakes = []; landed = []; var c = flakeCount(); for (var j = 0; j < c; j++) flakes.push(newFlake(rand(-20, H))); }
  }
  var KERNEL = [0.02, 0.04, 0.07, 0.1, 0.13, 0.28, 0.13, 0.1, 0.07, 0.04, 0.02];
  function settleSnow(x, r) {
    var i = (x / BIN) | 0, add = r * r * 1.1;
    for (var k = 0; k < KERNEL.length; k++) {
      var j = i + k - 5; if (j < 0 || j >= bins.length) continue;
      var room = cap[j] - bins[j]; if (room <= 0) continue;
      bins[j] += Math.min(room, add * KERNEL[k] * (0.3 + 0.7 * room / (cap[j] - base[j])));
    }
  }
  function stepWinter(dt) {
    var wv = 0.6 * (8 * Math.sin(T * 0.09) + 5 * Math.sin(T * 0.23 + 0.7));
    var want = flakeCount();
    while (flakes.length < want) flakes.push(newFlake());
    for (var i = flakes.length - 1; i >= 0; i--) {
      var f = flakes[i];
      f.t += dt; f.y += f.vy * dt;
      f.x += (f.drift + wv * (f.near ? 1 : 0.6) + f.A * f.w * Math.cos(f.w * f.t + f.ph)) * dt;
      if (f.x < -10) f.x += W + 20; else if (f.x > W + 10) f.x -= W + 20;
      var top = snowTop(f.x);
      // Distant flakes melt into the scene a little above the drift; close ones land on it.
      if (f.y >= top - (f.near ? 0 : rand(4, 30))) {
        if (f.near && f.x >= 0 && f.x <= W) { settleSnow(f.x, f.r); landed.push({ x: f.x, y: top, r: f.r, life: 1 }); }
        flakes.splice(i, 1);
        if (flakes.length < want) flakes.push(newFlake());
      } else if (f.y > H + 10) { flakes.splice(i, 1); }
    }
    for (var k = landed.length - 1; k >= 0; k--) { var d = landed[k]; d.life -= dt / 2.2; d.y = snowTop(d.x) - d.r * 0.4; if (d.life <= 0) landed.splice(k, 1); }
    // Smooth the drift a little so it stays soft.
    for (var s = 1; s < bins.length - 1; s++) bins[s] = bins[s] * 0.8 + (bins[s - 1] + bins[s + 1]) * 0.1;
  }
  function drawFlake(f) {
    ctx.globalAlpha = f.alpha;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.2832); ctx.fill();
  }
  function drawWinter() {
    ctx.fillStyle = '#FFFFFF';
    for (var i = 0; i < flakes.length; i++) if (!flakes[i].near) drawFlake(flakes[i]);
    ctx.globalAlpha = 1;
    if (noGround) { for (var q = 0; q < flakes.length; q++) if (flakes[q].near) drawFlake(flakes[q]); ctx.globalAlpha = 1; return; }
    // A softer ridge behind the drift, for depth
    ctx.beginPath(); ctx.moveTo(0, H);
    for (var r = 0; r < bins.length; r += 2) { var rx = r * BIN, ru = rx / Math.max(W, 1); ctx.lineTo(rx, H - base[r] - FH * 0.12 - 14 * Math.sin(ru * Math.PI * 2.3 + 2.0) - 6 * Math.sin(ru * Math.PI * 5.1)); }
    ctx.lineTo(W, H); ctx.closePath();
    var rg = ctx.createLinearGradient(0, H - FH * 0.75, 0, H); rg.addColorStop(0, 'rgba(196, 214, 228, .55)'); rg.addColorStop(1, 'rgba(120, 146, 166, .4)');
    ctx.fillStyle = rg; ctx.fill();
    // The drift
    var hi = 0; for (var b = 0; b < bins.length; b++) if (bins[b] > hi) hi = bins[b];
    var g = ctx.createLinearGradient(0, H - hi, 0, H);
    g.addColorStop(0, '#F4F8FB'); g.addColorStop(0.18, '#DCE6EE'); g.addColorStop(0.6, '#AFC2D0'); g.addColorStop(1, '#7F97A8');
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, H - bins[0]);
    for (var j = 1; j < bins.length - 1; j++) { var x = j * BIN; ctx.quadraticCurveTo(x, H - bins[j], x + BIN / 2, H - (bins[j] + bins[j + 1]) / 2); }
    ctx.lineTo(W, H - bins[bins.length - 1]); ctx.lineTo(W, H); ctx.closePath();
    ctx.shadowColor = 'rgba(220, 235, 250, .35)'; ctx.shadowBlur = 18; ctx.fillStyle = g; ctx.fill(); ctx.shadowBlur = 0;
    // Sparkles on the snow
    ctx.fillStyle = '#FFFFFF';
    for (var s = 0; s < 40; s++) {
      var xx = ((s * 0.6180339 + 0.13) % 1) * W, tw = Math.sin(T * (1.3 + (s % 5) * 0.4) + s * 2.1);
      if (tw > 0.75) { ctx.globalAlpha = (tw - 0.75) * 3.2; ctx.beginPath(); ctx.arc(xx, snowTop(xx) + 4 + (s % 9) * 6, 1.1, 0, 6.2832); ctx.fill(); }
    }
    // Flakes that just landed, melting into the drift
    for (var k = 0; k < landed.length; k++) { var d = landed[k]; ctx.globalAlpha = Math.max(0, d.life); ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.2832); ctx.fill(); }
    for (var n = 0; n < flakes.length; n++) if (flakes[n].near) drawFlake(flakes[n]);
    ctx.globalAlpha = 1;
  }

  /* ---------- Loop ---------- */
  function measure() {
    var w = hero.clientWidth, h = hero.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var first = !W, dw = W ? w / W : 1, dh = h - H;
    W = w; H = h; FH = field ? field.offsetHeight : 240;
    if (first) { if (mode === 'fall') initFall(); else initWinter(false); return; }
    if (mode === 'fall') {
      resting.forEach(function (r) { r.x *= dw; r.y = restY(r); });
      resting.sort(function (a, b) { return a.y - b.y; });
      falling.forEach(function (l) { l.x0 *= dw; l.y += dh; });
    } else {
      flakes.forEach(function (f) { f.x *= dw; f.y += dh; });
      initWinter(true);
    }
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (mode === 'fall') drawFall(); else drawWinter();
  }
  var last = 0, running = false, visible = true;
  function frame(now) {
    if (!running) return;
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016; last = now; T += dt;
    if (mode === 'fall') stepFall(dt); else stepWinter(dt);
    draw();
    requestAnimationFrame(frame);
  }
  function start() { if (reduce || running || !visible || document.hidden) return; running = true; last = 0; requestAnimationFrame(frame); }
  function stop() { running = false; }

  measure();
  if (reduce) { draw(); } else { start(); }
  var resizeT;
  var onResize = function () { clearTimeout(resizeT); resizeT = setTimeout(function () { measure(); if (!running) draw(); }, 120); };
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(hero); else window.addEventListener('resize', onResize);
  if (window.IntersectionObserver) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) start(); else stop(); }).observe(hero);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
})();

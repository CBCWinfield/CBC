/* Records the weekly announcement video in the browser:
   title card → each slide (with its voiceover) → end card, drawn on a canvas and captured with MediaRecorder. */
(function () {
  'use strict';
  var root = document.getElementById('reel');
  if (!root) return;
  var stage = document.querySelector('.an-stage');
  var canvas = stage && stage.querySelector('canvas');
  var status = stage && stage.querySelector('.an-progress');
  var W = 1280, H = 720, FPS = 30, FADE = 0.7, PAD = 0.9, SILENT = 5.5, TITLE_SILENT = 4;

  function say(msg) { if (status) status.textContent = msg; }
  function loadImage(src) {
    return new Promise(function (ok, fail) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { fail(new Error('Could not load ' + src)); };
      img.src = src;
    });
  }
  function pickType() {
    var types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < types.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported(types[i])) return types[i];
    return '';
  }

  function drawFrame(ctx, segs, t) {
    // Find the current segment and, near its start, the previous one to fade from.
    var i = 0;
    while (i < segs.length - 1 && t >= segs[i + 1].start) i++;
    var cur = segs[i];
    var local = t - cur.start;
    ctx.fillStyle = '#0C2115';
    ctx.fillRect(0, 0, W, H);
    function paint(seg, alpha, lt) {
      var z = 1 + 0.035 * Math.min(1, Math.max(0, lt / seg.dur)); // slow push-in
      var w = W * z, h = H * z;
      ctx.globalAlpha = alpha;
      ctx.drawImage(seg.img, (W - w) / 2, (H - h) / 2, w, h);
      ctx.globalAlpha = 1;
    }
    if (i > 0 && local < FADE) {
      var prev = segs[i - 1];
      paint(prev, 1, t - prev.start);
      paint(cur, local / FADE, local);
    } else paint(cur, 1, local);
  }

  async function record() {
    var btns = document.querySelectorAll('[data-record]');
    btns.forEach(function (b) { b.disabled = true; });
    stage.hidden = false;
    var type = pickType();
    if (!type || !canvas.captureStream) { say('This browser can’t record video. Please use Chrome, Edge or Safari on a computer.'); return; }
    say('Getting the slides and voice ready…');
    var plan = await (await fetch(root.dataset.plan, { credentials: 'same-origin' })).json();
    var ac = new (window.AudioContext || window.webkitAudioContext)();
    var segs = [];
    var t = 0;
    for (var k = 0; k < plan.items.length; k++) {
      var it = plan.items[k];
      var img = await loadImage(it.image);
      var buf = null;
      if (it.audio) {
        var data = await (await fetch(it.audio, { credentials: 'same-origin' })).arrayBuffer();
        buf = await new Promise(function (ok, fail) { ac.decodeAudioData(data, ok, fail); });
      }
      var dur = buf ? buf.duration + PAD * 2 : (it.kind === 'slide' ? SILENT : TITLE_SILENT);
      segs.push({ img: img, buf: buf, start: t, dur: dur });
      t += dur;
      say('Getting ready… ' + (k + 1) + ' of ' + plan.items.length);
    }
    var total = t;
    var ctx = canvas.getContext('2d');
    drawFrame(ctx, segs, 0);

    var stream = canvas.captureStream(FPS);
    var dest = ac.createMediaStreamDestination();
    var tracks = stream.getVideoTracks().concat(dest.stream.getAudioTracks());
    var rec = new MediaRecorder(new MediaStream(tracks), { mimeType: type, videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 });
    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    var done = new Promise(function (ok) { rec.onstop = ok; });

    if (ac.state === 'suspended') await ac.resume();
    var t0 = ac.currentTime + 0.25;
    segs.forEach(function (s) {
      if (!s.buf) return;
      var src = ac.createBufferSource();
      src.buffer = s.buf;
      src.connect(dest);
      src.connect(ac.destination); // so you can hear it while it records
      src.start(t0 + s.start + PAD);
    });
    rec.start(1000);
    await new Promise(function (finish) {
      (function tick() {
        var now = ac.currentTime - t0;
        drawFrame(ctx, segs, Math.max(0, now));
        var left = Math.max(0, Math.ceil(total - now));
        say('Recording… ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + ' left. Keep this tab open.');
        if (now >= total + 0.3) return finish();
        setTimeout(tick, 1000 / FPS);
      })();
    });
    rec.stop();
    await done;
    ac.close();
    var blob = new Blob(chunks, { type: type.split(';')[0] });
    say('Saving the video (' + (blob.size / 1048576).toFixed(1) + ' MB)…');
    var r = await fetch(root.dataset.upload, {
      method: 'POST', credentials: 'same-origin', body: blob,
      headers: { 'Content-Type': type.split(';')[0], 'X-CSRF-Token': root.dataset.csrf, 'X-Duration': String(Math.round(total)) },
    });
    if (!r.ok) { say('Saving failed (' + r.status + '). Please try again.'); btns.forEach(function (b) { b.disabled = false; }); return; }
    var j = await r.json();
    say('Saved! Loading the video…');
    window.location.href = j.next;
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-record]');
    if (!b) return;
    e.preventDefault();
    record().catch(function (err) {
      say('Something went wrong: ' + err.message);
      document.querySelectorAll('[data-record]').forEach(function (x) { x.disabled = false; });
    });
  });
})();

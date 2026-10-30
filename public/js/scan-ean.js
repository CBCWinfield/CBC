/* Scans a book's ISBN barcode (EAN-13, starting 978 or 979) with the device camera, for the book form.
   Uses the browser's own barcode reader where there is one (Chrome, Edge, Android); elsewhere (iPhone, iPad,
   Firefox) it reads the bars from the camera picture itself. window.CBCScanIsbn(onFound) opens the camera. */
(function () {
  'use strict';
  // Widths of the four bars and spaces of each digit, left-hand odd parity (L); G is L reversed; R uses L's widths.
  var L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'];
  var G = L.map(function (s) { return s.split('').reverse().join(''); });
  var FIRST = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLG', 'LGLGGL', 'LGLGLG', 'LGGLGL'];

  function digitOf(runs, table) {
    var sum = runs[0] + runs[1] + runs[2] + runs[3],
      best = -1,
      bestErr = 1e9;
    for (var d = 0; d < 10; d++) {
      var err = 0;
      for (var j = 0; j < 4; j++) err += Math.abs((runs[j] * 7) / sum - +table[d][j]);
      if (err < bestErr) {
        bestErr = err;
        best = d;
      }
    }
    return bestErr < 1.6 ? { d: best, err: bestErr } : null;
  }
  function checks(code) {
    var s = 0;
    for (var i = 0; i < 12; i++) s += +code[i] * (i % 2 ? 3 : 1);
    return (10 - (s % 10)) % 10 === +code[12];
  }
  // runs: widths of alternating dark and light stretches, starting with a dark one
  function decodeRuns(runs) {
    for (var k = 0; k + 59 <= runs.length; k += 2) {
      var m = (runs[k] + runs[k + 1] + runs[k + 2]) / 3;
      if (!m || Math.abs(runs[k] - m) > m * 0.6 || Math.abs(runs[k + 2] - m) > m * 0.6) continue;
      var i = k + 3,
        left = '',
        parity = '',
        ok = true;
      for (var n = 0; n < 6 && ok; n++, i += 4) {
        var g = runs.slice(i, i + 4),
          a = digitOf(g, L),
          b = digitOf(g, G);
        if (!a && !b) ok = false;
        else if (a && (!b || a.err <= b.err)) {
          left += a.d;
          parity += 'L';
        } else {
          left += b.d;
          parity += 'G';
        }
      }
      if (!ok) continue;
      i += 5; // middle guard
      var right = '';
      for (n = 0; n < 6 && ok; n++, i += 4) {
        var r = digitOf(runs.slice(i, i + 4), L);
        if (!r) ok = false;
        else right += r.d;
      }
      var first = FIRST.indexOf(parity);
      if (!ok || first < 0) continue;
      var code = first + left + right;
      if (checks(code)) return code;
    }
    return null;
  }
  // Read across several rows of a picture, both ways; a code must start with 978 or 979 to be an ISBN.
  function decodeImage(img) {
    var w = img.width,
      h = img.height,
      px = img.data;
    for (var t = 0; t < 15; t++) {
      var y = Math.round(h * (0.5 + (t % 2 ? 1 : -1) * Math.ceil(t / 2) * 0.03));
      if (y < 0 || y >= h) continue;
      var row = new Float32Array(w),
        sum = 0;
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) * 4;
        row[x] = px[o] * 0.299 + px[o + 1] * 0.587 + px[o + 2] * 0.114;
        sum += row[x];
      }
      // a threshold that follows the light across the row
      var win = Math.max(16, Math.round(w / 12)),
        pre = new Float32Array(w + 1);
      for (x = 0; x < w; x++) pre[x + 1] = pre[x] + row[x];
      for (var sm = 0; sm < 3; sm++) {
        // camera noise breaks the bars into pieces, so the row is also read smoothed a little, then a little more
        var r2 = new Float32Array(w);
        for (x = 0; x < w; x++) {
          var s0 = Math.max(0, x - sm),
            s1 = Math.min(w, x + sm + 1);
          r2[x] = (pre[s1] - pre[s0]) / (s1 - s0);
        }
        // dark where darker than its neighbourhood; the neighbourhood is tried at a few sizes, since the bars' width in
        // the picture depends on how far away the book is (a blurred thin space only stands out against close neighbours)
        var p2 = new Float32Array(w + 1);
        for (x = 0; x < w; x++) p2[x + 1] = p2[x] + r2[x];
        // the lightest and darkest around each point, over a wide stretch
        var big = Math.max(12, Math.round(win / 3)),
          lo = new Float32Array(w),
          hi = new Float32Array(w);
        for (x = 0; x < w; x++) {
          var l = 255,
            u = 0;
          for (var z = Math.max(0, x - big), ze = Math.min(w, x + big); z < ze; z += 2) {
            if (r2[z] < l) l = r2[z];
            if (r2[z] > u) u = r2[z];
          }
          lo[x] = l;
          hi[x] = u;
        }
        var spans = [0, 3, 6, 12];
        for (var si = 0; si < spans.length; si++) {
          var span = spans[si],
            bits = new Uint8Array(w);
          for (x = 0; x < w; x++) {
            var mid = (lo[x] + hi[x]) / 2;
            if (span) {
              // between close bars, compare with the near neighbours, but never call the paper dark
              var a0 = Math.max(0, x - span),
                a1 = Math.min(w, x + span + 1),
                near = (p2[a1] - p2[a0]) / (a1 - a0);
              mid = Math.max(Math.min(near, hi[x] - (hi[x] - lo[x]) * 0.15), lo[x] + (hi[x] - lo[x]) * 0.25);
            }
            bits[x] = hi[x] - lo[x] > 24 && r2[x] < mid ? 1 : 0;
          }
          var hit = readBits(bits, w);
          if (hit) return hit;
        }
      }
    }
    return null;
  }
  function readBits(bits, w) {
    {
      for (var dir = 0; dir < 2; dir++) {
        var runs = [],
          cur = -1,
          len = 0;
        for (var q = 0; q < w; q++) {
          var v = bits[dir ? w - 1 - q : q];
          if (v === cur) len++;
          else {
            if (cur === 1 || (cur === 0 && runs.length)) runs.push(len);
            cur = v;
            len = 1;
          }
        }
        var code = decodeRuns(runs);
        if (code && /^97[89]/.test(code)) return code;
      }
    }
    return null;
  }

  var dlg, video, stream, timer, canvas, detector, found;
  function stop() {
    clearTimeout(timer);
    if (stream)
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
    stream = null;
    if (dlg && dlg.open) dlg.close();
  }
  function frame() {
    if (!stream || !video.videoWidth) {
      timer = setTimeout(frame, 150);
      return;
    }
    var done = function (code) {
      if (code) {
        if (navigator.vibrate) navigator.vibrate(60);
        stop();
        found(code);
      } else timer = setTimeout(frame, 120);
    };
    if (detector) {
      detector.detect(video).then(
        function (list) {
          var hit = (list || []).filter(function (b) {
            return /^97[89]\d{10}$/.test(b.rawValue);
          })[0];
          done(hit && hit.rawValue);
        },
        function () {
          done(null);
        }
      );
      return;
    }
    var w = Math.min(960, video.videoWidth),
      h = Math.round((video.videoHeight * w) / video.videoWidth);
    canvas.width = w;
    canvas.height = h;
    var g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(video, 0, 0, w, h);
    done(decodeImage(g.getImageData(0, 0, w, h)));
  }
  function open(onFound) {
    found = onFound;
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'scan-dlg';
      dlg.setAttribute('aria-labelledby', 'scanIsbnH');
      dlg.innerHTML =
        '<h2 id="scanIsbnH">Scan the barcode</h2><p class="small muted">Hold the barcode on the back cover inside the frame, a hand’s width from the camera.</p>' +
        '<div class="scan-view"><video playsinline muted></video><span class="scan-aim" aria-hidden="true"></span></div>' +
        '<p class="small" role="status" id="scanIsbnStatus"></p><div class="actions"><button type="button" class="btn btn-quiet" data-scan-close>Cancel</button></div>';
      document.body.appendChild(dlg);
      video = dlg.querySelector('video');
      canvas = document.createElement('canvas');
      dlg.addEventListener('close', stop);
      dlg.addEventListener('click', function (e) {
        if (e.target.closest('[data-scan-close]')) stop();
      });
    }
    var status = dlg.querySelector('#scanIsbnStatus');
    status.textContent = 'Starting the camera…';
    dlg.showModal();
    var ready =
      'BarcodeDetector' in window
        ? window.BarcodeDetector.getSupportedFormats().then(
            function (f) {
              detector = f.indexOf('ean_13') >= 0 ? new window.BarcodeDetector({ formats: ['ean_13'] }) : null;
            },
            function () {
              detector = null;
            }
          )
        : Promise.resolve();
    ready
      .then(function () {
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
      })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(function () {
        status.textContent = 'Looking for the barcode…';
        frame();
      })
      .catch(function () {
        status.textContent = 'The camera couldn’t start. Allow camera access for this site, or type the ISBN instead.';
      });
  }

  window.CBCScanIsbn = open;
  window.CBCScanIsbn.decodeImage = decodeImage; // for the tests
})();

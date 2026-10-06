/* Central Check-In behaviour: live family search, select all, roster filter,
   camera barcode scanning, and showing/hiding the custody notes box. */
(function () {
  'use strict';

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  /* ---------- Live family search on the station ---------- */
  var search = document.querySelector('[data-family-search]');
  if (search) {
    var results = document.getElementById('fam-results');
    var timer = null;
    var seq = 0;
    var active = -1;
    var rows = [];
    var draw = function (list, q) {
      results.innerHTML = '';
      rows = [];
      active = -1;
      if (!q) return;
      var ul = el('ul', { class: 'ci-family-list' });
      if (!list.length) {
        ul.appendChild(el('li', {}, [el('p', { class: 'ci-empty-hint', text: 'No family matches “' + q + '”. Check the spelling, or add a new family.' })]));
      }
      list.forEach(function (f) {
        var a = el('a', { class: 'ci-family-row', href: '/checkin/f/' + f.id }, [
          el('span', { class: 'ci-family-name', text: f.name }),
          el('span', { class: 'ci-family-members', text: f.members || 'No one added yet' }),
          f.checked ? el('span', { class: 'badge badge-ok', text: f.checked + ' in' }) : null,
        ]);
        rows.push(a);
        ul.appendChild(el('li', {}, [a]));
      });
      results.appendChild(ul);
    };
    var run = function () {
      var q = search.value.trim();
      if (!q) { draw([], ''); return; }
      var mine = ++seq;
      fetch('/checkin/api/families?q=' + encodeURIComponent(q), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (list) { if (mine === seq) draw(list, q); })
        .catch(function () {});
    };
    search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 120); });
    search.addEventListener('keydown', function (e) {
      if (!rows.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = Math.max(0, Math.min(rows.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
        rows.forEach(function (r, i) { r.classList.toggle('is-active', i === active); });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        window.location.href = rows[Math.max(0, active)].getAttribute('href');
      }
    });
    search.form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
  }

  /* ---------- Check-in form: select all / none, selected count ---------- */
  document.querySelectorAll('[data-checkin-form]').forEach(function (form) {
    var boxes = function () { return Array.prototype.slice.call(form.querySelectorAll('input[type=checkbox]:not(:disabled)')); };
    var count = form.querySelector('[data-selected-count]');
    var update = function () {
      var n = boxes().filter(function (b) { return b.checked; }).length;
      if (count) count.textContent = n ? n + ' selected' : 'No one selected';
    };
    form.addEventListener('change', update);
    var all = form.querySelector('[data-check-all]');
    var none = form.querySelector('[data-check-none]');
    if (all) all.addEventListener('click', function () { boxes().forEach(function (b) { b.checked = true; }); update(); });
    if (none) none.addEventListener('click', function () { boxes().forEach(function (b) { b.checked = false; }); update(); });
    form.addEventListener('submit', function () {
      var btn = form.querySelector('button[type=submit].ci-big-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
    });
    update();
  });

  /* ---------- Roster live filter ---------- */
  document.querySelectorAll('[data-live-filter]').forEach(function (input) {
    var target = document.querySelector(input.getAttribute('data-live-filter'));
    var apply = function () {
      var q = input.value.trim().toLowerCase();
      target.querySelectorAll('[data-filter-text]').forEach(function (row) {
        row.hidden = q && row.getAttribute('data-filter-text').toLowerCase().indexOf(q) < 0;
      });
    };
    input.addEventListener('input', apply);
    input.form.addEventListener('submit', function (e) { e.preventDefault(); apply(); });
    apply();
  });

  /* ---------- Show custody notes only when ticked ---------- */
  document.querySelectorAll('[data-toggle]').forEach(function (box) {
    var target = document.querySelector(box.getAttribute('data-toggle'));
    if (!target) return;
    box.addEventListener('change', function () { target.hidden = !box.checked; });
  });

  /* ---------- Camera scanning of pickup tags ---------- */
  var scanner = document.querySelector('[data-scanner]');
  var startBtn = document.querySelector('[data-start-scan]');
  var scanForm = document.querySelector('[data-scan-form]');
  if (scanner && startBtn && scanForm && 'BarcodeDetector' in window && navigator.mediaDevices) {
    startBtn.hidden = false;
    var video = scanner.querySelector('video');
    var status = scanner.querySelector('[data-scanner-status]');
    var stream = null;
    var stop = function () { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; };
    startBtn.addEventListener('click', function () {
      window.BarcodeDetector.getSupportedFormats().then(function (formats) {
        var want = ['code_128', 'qr_code'].filter(function (f) { return formats.indexOf(f) >= 0; });
        if (!want.length) throw new Error('unsupported');
        var detector = new window.BarcodeDetector({ formats: want });
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (s) {
          stream = s;
          video.srcObject = s;
          scanner.hidden = false;
          startBtn.hidden = true;
          return video.play().then(function () {
            var tick = function () {
              if (!stream) return;
              detector.detect(video).then(function (codes) {
                var hit = codes.map(function (c) { return (c.rawValue || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }).filter(function (v) { return v.length >= 4; })[0];
                if (hit) {
                  status.textContent = 'Found ' + hit;
                  stop();
                  scanForm.querySelector('input[name=code]').value = hit.slice(-4);
                  scanForm.submit();
                } else {
                  setTimeout(tick, 250);
                }
              }).catch(function () { setTimeout(tick, 500); });
            };
            tick();
          });
        });
      }).catch(function () {
        status.textContent = 'This device can’t scan with the camera. Type the code instead.';
        scanner.hidden = false;
        startBtn.hidden = true;
      });
    });
    window.addEventListener('pagehide', stop);
  }
})();

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

  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  /* ---------- One-tap family check-in ---------- */
  document.querySelectorAll('[data-quick-checkin]').forEach(function (f) {
    f.addEventListener('submit', function () {
      var b = f.querySelector('button');
      if (b) { b.disabled = true; b.textContent = 'Checking in…'; }
    });
  });

  /* ---------- Ask ---------- */
  var askForm = document.getElementById('ci-ask-form');
  if (askForm) {
    var askInput = document.getElementById('ci-ask-input');
    var askPanel = document.getElementById('ci-ask-panel');
    var askQ = document.getElementById('ci-ask-q');
    var askAnswer = document.getElementById('ci-ask-answer');
    var askItems = document.getElementById('ci-ask-items');
    var askTopics = document.getElementById('ci-ask-topics');
    var askSeq = 0;
    var showAnswer = function (q, data) {
      askPanel.hidden = false;
      askQ.textContent = q;
      askAnswer.textContent = data.answer || '';
      askItems.innerHTML = '';
      (data.items || []).forEach(function (it) {
        askItems.appendChild(el('li', {}, [el('a', { href: it.url || '#' }, [el('strong', { text: it.title }), it.sub ? el('span', { text: it.sub }) : null])]));
      });
      askTopics.innerHTML = '';
      if (data.topics && data.topics.length > 1) {
        askTopics.appendChild(document.createTextNode('Related: '));
        data.topics.slice(1).forEach(function (tp) {
          var b = el('button', { type: 'button', class: 'linklike', text: tp.title });
          b.addEventListener('click', function () { openHelp(tp.id); });
          askTopics.appendChild(b);
          askTopics.appendChild(document.createTextNode(' '));
        });
      }
    };
    askForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = askInput.value.trim();
      if (!q) { askPanel.hidden = true; return; }
      var mine = ++askSeq;
      askPanel.hidden = false;
      askQ.textContent = q;
      askAnswer.textContent = 'Looking…';
      askItems.innerHTML = '';
      askTopics.innerHTML = '';
      fetch('/checkin/api/ask', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Accept: 'application/json' }, body: JSON.stringify({ q: q }) })
        .then(function (r) { return r.json(); })
        .then(function (data) { if (mine === askSeq) showAnswer(q, data); })
        .catch(function () { askAnswer.textContent = 'Couldn’t reach the server. Try again.'; });
    });
    document.getElementById('ci-ask-close').addEventListener('click', function () { askPanel.hidden = true; askInput.value = ''; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') askPanel.hidden = true; });
  }

  /* ---------- HELP ---------- */
  var helpModal = document.getElementById('ci-help');
  var helpTopics = null;
  var openHelp = function (focusId) {
    if (!helpModal) return;
    helpModal.hidden = false;
    document.body.classList.add('ci-modal-open');
    var body = document.getElementById('ci-help-body');
    var search = document.getElementById('ci-help-search');
    var draw = function () {
      var q = search.value.trim().toLowerCase();
      var words = q.split(/\s+/).filter(Boolean);
      body.innerHTML = '';
      var list = helpTopics.filter(function (tp) {
        var hay = (tp.title + ' ' + tp.keys + ' ' + tp.steps.join(' ')).toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      });
      if (!list.length) { body.appendChild(el('p', { class: 'muted', text: 'Nothing matches. Try another word, or type your question in Ask at the top.' })); return; }
      list.forEach(function (tp) {
        var d = el('details', { class: 'ci-help-topic', id: 'help-' + tp.id }, [
          el('summary', { text: tp.title }),
          el('ol', {}, tp.steps.map(function (st) { return el('li', { text: st }); })),
        ]);
        var actions = el('p', { class: 'ci-help-actions' });
        if (tp.tour && tp.url) actions.appendChild(el('a', { class: 'btn btn-small', href: tp.url + (tp.url.indexOf('?') >= 0 ? '&' : '?') + 'tour=' + tp.tour, text: 'Show me' }));
        else if (tp.url) actions.appendChild(el('a', { class: 'btn btn-quiet btn-small', href: tp.url, text: 'Go there' }));
        if (actions.childNodes.length) d.appendChild(actions);
        if (tp.id === focusId || (words.length && list.length <= 2)) d.open = true;
        body.appendChild(d);
      });
      if (focusId) { var f = document.getElementById('help-' + focusId); if (f) f.scrollIntoView({ block: 'nearest' }); focusId = null; }
    };
    search.oninput = draw;
    if (helpTopics) { draw(); search.focus(); return; }
    fetch('/checkin/api/help', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (list) { helpTopics = list; draw(); search.focus(); })
      .catch(function () { body.textContent = 'Couldn’t load help. Check the connection.'; });
  };
  var closeHelp = function () { if (!helpModal) return; helpModal.hidden = true; document.body.classList.remove('ci-modal-open'); };
  if (helpModal) {
    document.getElementById('ci-help-open').addEventListener('click', function () { openHelp(); });
    helpModal.addEventListener('click', function (e) { if (e.target === helpModal || e.target.hasAttribute('data-help-close')) closeHelp(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !helpModal.hidden) closeHelp(); });
  }

  /* ---------- Guided tours (?tour=name) ---------- */
  var TOURS = {
    station: [
      ['.ci-event-pill', 'This is what you’re checking in for. Sundays switch from Sunday School (9:30) to Children’s Church (10:45) by themselves. Tap to change it.'],
      ['#fam-q', 'Type a family name, a child’s name or a phone number. Matches appear as you type.'],
      ['.ci-family-tools', 'No match? Add a new family, or use Quick guest for a child here without a parent.'],
      ['[data-tour="quick"]', 'Check in puts the whole family in for the service happening now and prints their tags.'],
      ['[data-tour="help"]', 'Press HELP anytime, or type a question in Ask.'],
    ],
    families: [
      ['.ci-filter', 'Search any family, person, phone or email.'],
      ['[data-tour="quick"]', 'One tap checks in the whole family for the service happening now and prints their tags.'],
      ['.ci-family-row', 'Tap the name instead to choose who’s here.'],
    ],
    family: [
      ['.ci-people', 'Everyone starts ticked. Untick anyone who isn’t here.'],
      ['.ci-flags', 'Red tags show allergies with their symbol; blue is medical; dark red is a custody alert.'],
      ['.ci-big-btn', 'Press Check in. Tags print and the parent gets an email.'],
    ],
    scan: [
      ['#scan-code', 'Scan the parent’s pickup tag here, or type the 4-letter code.'],
      ['[data-start-scan]', 'On Android and computers you can use the camera.'],
    ],
    roster: [
      ['.ci-filter', 'Filter by name or pickup code.'],
      ['.ci-roster-row', 'Each person shows when they came in, their code and any allergy symbols. Reprint, Check out or Remove from here.'],
      ['form[action="/checkin/checkout-all"]', 'At the end, Check out all kids. Parents get a pickup email.'],
    ],
    serve: [
      ['.ci-cal', 'Each service shows five dots: Nursery, Toddlers, Kids, Teens and Adults. Green means someone is signed up.'],
      ['.ci-cal-svc', 'Tap a service to sign up or see who’s serving.'],
    ],
    print: [
      ['[data-tour="printer"]', 'On the laptop connected to the Brother printer, turn this on and leave the page open.'],
      ['[data-tour="queue"]', 'Tags from every phone and iPad wait here. Print or Cancel any of them.'],
    ],
    events: [
      ['.ci-event-add', 'Add an event ahead of time, like VBS or a lock-in. It shows as a choice on the check-in screen.'],
      ['[data-tour="events"]', 'Every event you’ve created is listed here with how often it was held.'],
      ['[data-tour="archive"]', 'Archive takes an old event off the check-in screen. Attendance stays in Reports, and you can Restore it anytime.'],
    ],
  };
  var tourName = new URLSearchParams(window.location.search).get('tour');
  if (tourName && TOURS[tourName]) {
    var steps = TOURS[tourName].filter(function (st) { var n = document.querySelector(st[0]); return n && n.offsetParent !== null; });
    var i = 0;
    var bubble = null;
    var lit = null;
    var end = function () {
      if (bubble) bubble.remove();
      if (lit) lit.classList.remove('ci-tour-lit');
      var u = new URL(window.location.href); u.searchParams.delete('tour'); history.replaceState(null, '', u.toString());
    };
    var show = function () {
      if (lit) lit.classList.remove('ci-tour-lit');
      if (bubble) bubble.remove();
      if (i >= steps.length) { end(); return; }
      lit = document.querySelector(steps[i][0]);
      lit.classList.add('ci-tour-lit');
      lit.scrollIntoView({ block: 'center', behavior: 'smooth' });
      var next = el('button', { type: 'button', class: 'btn btn-small', text: i === steps.length - 1 ? 'Done' : 'Next' });
      var skip = el('button', { type: 'button', class: 'linklike', text: 'End tour' });
      next.addEventListener('click', function () { i++; show(); });
      skip.addEventListener('click', end);
      bubble = el('div', { class: 'ci-tour', role: 'dialog', 'aria-live': 'polite' }, [
        el('p', { class: 'ci-tour-count', text: 'Step ' + (i + 1) + ' of ' + steps.length }),
        el('p', { text: steps[i][1] }),
        el('div', { class: 'ci-tour-actions' }, [skip, next]),
      ]);
      document.body.appendChild(bubble);
      next.focus({ preventScroll: true });
    };
    if (steps.length) setTimeout(show, 250);
  }

  /* ---------- Printing: this device is the printer ---------- */
  var pToggle = document.querySelector('[data-printer-toggle]');
  if (pToggle) {
    var pStatus = document.querySelector('[data-printer-status]');
    var frame = document.querySelector('[data-print-frame]');
    var busy = false;
    var poll = null;
    var setCookie = function (on) {
      document.cookie = 'ci_printer=' + (on ? '1' : '0') + '; path=/checkin; max-age=' + (on ? 31536000 : 0) + '; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    };
    var check = function () {
      if (busy || !pToggle.checked) return;
      fetch('/checkin/api/print-jobs', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (jobs) {
          if (!jobs.length || busy) { pStatus.textContent = 'Watching for new name tags… (checked ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ')'; return; }
          busy = true;
          pStatus.textContent = 'Printing ' + jobs.map(function (j) { return j.family + ' (' + j.kids + ')'; }).join(', ') + '…';
          frame.src = '/checkin/print?embed=1&jobs=' + jobs.map(function (j) { return j.id; }).join(',');
        })
        .catch(function () { pStatus.textContent = 'Lost connection. Retrying…'; });
    };
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'ci-printed') return;
      busy = false;
      // Refresh the list when nothing is being typed.
      setTimeout(function () { window.location.reload(); }, 600);
    });
    var start = function () { check(); poll = setInterval(check, 4000); };
    pToggle.addEventListener('change', function () {
      setCookie(pToggle.checked);
      pToggle.closest('.ci-printer-card').classList.toggle('is-on', pToggle.checked);
      if (pToggle.checked) { pStatus.textContent = 'Watching for new name tags…'; start(); }
      else { clearInterval(poll); pStatus.textContent = 'Off. Tags checked in on this device go to the printer device.'; }
    });
    if (pToggle.checked) start();
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
        ul.appendChild(el('li', {}, [el('p', { class: 'ci-empty-hint', text: 'No family matches “' + q + '”.' })]));
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
      // Always offer the two ways forward when the family isn't found.
      var add = el('a', { class: 'ci-add-row' + (list.length ? '' : ' is-primary'), href: '/checkin/new?name=' + encodeURIComponent(q) }, [
        el('span', { class: 'ci-add-icon', text: '+' }),
        el('span', {}, [el('strong', { text: 'Add a new family' }), el('small', { text: 'Parent, emergency contact, then the kids' })]),
      ]);
      var guest = el('a', { class: 'ci-add-row', href: '/checkin/guest?name=' + encodeURIComponent(q) }, [
        el('span', { class: 'ci-add-icon', text: '★' }),
        el('span', {}, [el('strong', { text: 'Quick guest check-in' }), el('small', { text: 'A child here without a parent: just a phone number' })]),
      ]);
      rows.push(add, guest);
      ul.appendChild(el('li', { class: 'ci-add-actions' }, [add, guest]));
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

  /* ---------- Guest check-in: choose the family they came with ---------- */
  var hostSearch = document.querySelector('[data-host-search]');
  if (hostSearch) {
    var hostId = document.querySelector('[data-host-id]');
    var hostResults = document.querySelector('[data-host-results]');
    var hostChosen = document.querySelector('[data-host-chosen]');
    var onOwn = document.querySelector('[data-on-own]');
    var hTimer = null;
    var choose = function (f) {
      hostId.value = f ? f.id : '';
      hostSearch.value = f ? f.name : '';
      hostResults.innerHTML = '';
      hostChosen.textContent = f ? 'Coming with ' + f.name + '. Their pickup tag covers this child.' : 'The guest will share that family’s pickup code.';
      if (f && onOwn) onOwn.checked = false;
    };
    hostSearch.addEventListener('input', function () {
      hostId.value = '';
      clearTimeout(hTimer);
      var q = hostSearch.value.trim();
      if (!q) { hostResults.innerHTML = ''; return; }
      hTimer = setTimeout(function () {
        fetch('/checkin/api/families?q=' + encodeURIComponent(q), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (list) {
            hostResults.innerHTML = '';
            var ul = el('ul', { class: 'ci-family-list' });
            list.slice(0, 6).forEach(function (f) {
              var b = el('button', { type: 'button', class: 'ci-family-row' }, [el('span', { class: 'ci-family-name', text: f.name }), el('span', { class: 'ci-family-members', text: f.members || '' })]);
              b.addEventListener('click', function () { choose(f); });
              ul.appendChild(el('li', {}, [b]));
            });
            if (!list.length) ul.appendChild(el('li', {}, [el('p', { class: 'ci-empty-hint', text: 'No family found. Tick “They came on their own”.' })]));
            hostResults.appendChild(ul);
          });
      }, 140);
    });
    if (onOwn) onOwn.addEventListener('change', function () { if (onOwn.checked) choose(null); });
  }

  /* ---------- Policy upload: read the file into the form ---------- */
  var pFile = document.querySelector('[data-policy-file]');
  if (pFile) {
    var pForm = pFile.form;
    var pInfo = pForm.querySelector('[data-policy-info]');
    pFile.addEventListener('change', function () {
      var f = pFile.files && pFile.files[0];
      pForm.querySelector('[data-file-data]').value = '';
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) { pInfo.textContent = 'That file is over 15 MB. Please choose a smaller one.'; return; }
      pInfo.textContent = 'Reading ' + f.name + '…';
      var r = new FileReader();
      r.onload = function () {
        pForm.querySelector('[data-file-data]').value = r.result;
        pForm.querySelector('[data-file-name]').value = f.name;
        var title = pForm.querySelector('[name=title]');
        if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        pInfo.textContent = 'Ready: ' + f.name;
      };
      r.readAsDataURL(f);
    });
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

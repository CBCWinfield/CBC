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

  /* ---------- Close the More menu when tapping elsewhere ---------- */
  document.addEventListener('click', function (e) {
    document.querySelectorAll('details.ci-more[open]').forEach(function (d) { if (!d.contains(e.target)) d.open = false; });
  });

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
      ['[data-tour="quick"]', 'See the whole family arriving? Hit Quick Check: everyone is checked in for the service happening now and the kids’ name tags print. No need to open the family.'],
      ['[data-tour="help"]', 'Press HELP anytime, or type a question in Ask.'],
    ],
    families: [
      ['.ci-filter', 'Search any family, person, phone or email.'],
      ['[data-tour="quick"]', 'Quick Check checks in the whole family for the service happening now and prints the kids’ name tags.'],
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

  /* ---------- Inbox thread: live updates and sending without reloading ---------- */
  var thread = document.getElementById('ci-thread');
  if (thread) {
    var convId = thread.getAttribute('data-thread');
    var lastId = Number(thread.getAttribute('data-last')) || 0;
    var scrollDown = function () { window.scrollTo(0, document.body.scrollHeight); };
    var addMsg = function (m) {
      if (m.id <= lastId) return;
      lastId = m.id;
      var empty = thread.querySelector('.ci-thread-empty'); if (empty) empty.remove();
      var who = m.mine ? null : el('span', { class: 'ci-msg-who', text: m.name + (m.team ? ' · ' + m.team : '') });
      var bubble = el('div', { class: 'ci-bubble' });
      if (m.body == null) bubble.appendChild(el('em', { class: 'muted', text: 'Message removed' })); else bubble.textContent = m.body;
      thread.appendChild(el('div', { class: 'ci-msg' + (m.mine ? ' is-mine' : ''), 'data-msg': String(m.id) }, [who, bubble, el('span', { class: 'ci-msg-meta', text: m.at })]));
    };
    var badge = function (n) {
      var link = document.querySelector('.ci-inbox-link'); if (!link) return;
      var b = link.querySelector('.ci-unread');
      if (!n) { if (b) b.remove(); return; }
      if (!b) { b = el('span', { class: 'ci-unread' }); link.appendChild(b); }
      b.textContent = n > 99 ? '99+' : String(n);
    };
    var pull = function () {
      if (document.hidden) return;
      fetch('/checkin/api/inbox/' + convId + '?after=' + lastId, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var near = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
          (d.messages || []).forEach(addMsg);
          if (d.messages && d.messages.length && near) scrollDown();
          badge(d.unread || 0);
        }).catch(function () {});
    };
    setInterval(pull, 4000);
    document.addEventListener('visibilitychange', pull);
    scrollDown();
    var compose = document.querySelector('[data-compose]');
    if (compose) {
      var ta = compose.querySelector('textarea');
      var grow = function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };
      ta.addEventListener('input', grow);
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); compose.requestSubmit(); } });
      compose.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = ta.value.trim();
        if (!text) return;
        var btn = compose.querySelector('button'); btn.disabled = true;
        var body = new URLSearchParams(); body.append('_csrf', csrf); body.append('body', text);
        fetch(compose.action, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
          .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Not sent'); return d; }); })
          .then(function (d) { ta.value = ''; grow(); addMsg(d.message); scrollDown(); })
          .catch(function (err) { alert(err.message || 'Couldn’t send. Check the connection and try again.'); })
          .then(function () { btn.disabled = false; ta.focus(); });
      });
    }
  }

  /* ---------- "Download the app" / "Add to desktop" prompt ---------- */
  (function installPrompt() {
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    if (standalone) return;
    var framed = false; try { framed = window.self !== window.top; } catch (e) { framed = true; }
    if (framed) return; // shown inside the church website's pop-up: no install banner
    var store = function (k, v) { try { if (v === undefined) return window.localStorage.getItem(k); window.localStorage.setItem(k, v); } catch (e) { return null; } return null; };
    var snoozed = Number(store('ciInstallSnooze') || 0);
    if (snoozed && Date.now() < snoozed) return;
    var ua = navigator.userAgent || '';
    var iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var android = /Android/.test(ua);
    var mobile = iOS || android || /Mobi/.test(ua);
    var macSafari = !mobile && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
    var deferred = null;
    var banner = null;
    var show = function (how) {
      if (banner) banner.remove();
      var title = mobile ? 'Download the Central app' : 'Add Central to your desktop';
      var text;
      if (how === 'prompt') text = mobile ? 'Put Central on your home screen for quick check-in, messages and notifications.' : 'Open Central from your desktop or taskbar like any other app.';
      else if (iOS) text = 'Tap the Share button (the square with an arrow ↑), then “Add to Home Screen”.';
      else if (android) text = 'Tap the ⋮ menu in your browser, then “Install app” or “Add to Home screen”.';
      else if (macSafari) text = 'In Safari’s menu bar choose File › Add to Dock.';
      else text = 'In Chrome or Edge, click the install icon at the right end of the address bar, or open the ⋮ menu and choose “Install Central”.';
      var later = el('button', { type: 'button', class: 'linklike', text: 'Not now' });
      var actions = [later];
      if (how === 'prompt') {
        var go = el('button', { type: 'button', class: 'btn btn-small', text: mobile ? 'Download' : 'Add to desktop' });
        go.addEventListener('click', function () {
          deferred.prompt();
          deferred.userChoice.then(function (c) { if (c.outcome === 'accepted') banner.remove(); else snooze(3); deferred = null; });
        });
        actions.push(go);
      } else {
        actions.push(el('a', { class: 'btn btn-quiet btn-small', href: '/checkin/install', text: 'Show me' }));
      }
      banner = el('div', { class: 'ci-install', role: 'dialog', 'aria-label': title }, [
        el('img', { src: '/img/checkin-192.png', alt: '', width: '48', height: '48' }),
        el('div', { class: 'ci-install-text' }, [el('strong', { text: title }), el('span', { text: text })]),
        el('div', { class: 'ci-install-actions' }, actions),
      ]);
      later.addEventListener('click', function () { snooze(7); });
      document.body.appendChild(banner);
    };
    var snooze = function (days) { store('ciInstallSnooze', String(Date.now() + days * 86400000)); if (banner) banner.remove(); banner = null; };
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; show('prompt'); });
    window.addEventListener('appinstalled', function () { if (banner) banner.remove(); store('ciInstallSnooze', String(Date.now() + 3650 * 86400000)); });
    // Browsers without an install event get simple instructions after a moment.
    setTimeout(function () { if (!deferred && !banner && (iOS || android || macSafari)) show('manual'); }, 2500);
  })();

  /* ---------- Person photos: shrink on the device, then send ---------- */
  document.querySelectorAll('[data-photo-form]').forEach(function (form) {
    var input = form.querySelector('[data-photo-input]');
    var label = input.closest('label');
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (label) label.firstChild.textContent = 'Saving…';
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 640;
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        form.querySelector('[data-photo-data]').value = c.toDataURL('image/jpeg', 0.85);
        form.submit();
      };
      img.onerror = function () { URL.revokeObjectURL(url); alert('That picture couldn’t be opened. Try a JPG or PNG photo.'); if (label) label.firstChild.textContent = 'Add photo'; };
      img.src = url;
    });
  });

  /* ---------- Lessons and policies: scroll to the end to unlock the boxes ---------- */
  var gate = document.querySelector('[data-scroll-gate]');
  if (gate) {
    var gated = Array.prototype.slice.call(document.querySelectorAll('[data-gated]'));
    var note = document.querySelector('[data-gate-note]');
    var needsOpen = gate.hasAttribute('data-needs-open');
    var opened = !needsOpen;
    var scrolled = false;
    var unlock = function () {
      if (!(scrolled && opened)) return;
      gated.forEach(function (g) { g.disabled = false; });
      if (note) note.textContent = 'Thanks for reading. Tick each box to finish.';
    };
    var boxes = gated.filter(function (g) { return g.type === 'checkbox'; });
    if (boxes.length && boxes.some(function (b) { return !b.checked; })) {
      gated.forEach(function (g) { g.disabled = true; });
      var form = document.querySelector('[data-confirm-form]');
      var check = function () {
        var rect = form.getBoundingClientRect();
        if (rect.top < window.innerHeight - 40) { scrolled = true; unlock(); window.removeEventListener('scroll', check); }
      };
      window.addEventListener('scroll', check, { passive: true });
      setTimeout(check, 1500);
      document.querySelectorAll('[data-open-file]').forEach(function (a) { a.addEventListener('click', function () { opened = true; setTimeout(unlock, 300); }); });
    }
  }

  /* ---------- Group message: templates, buttons, people filter ---------- */
  var bform = document.querySelector('[data-broadcast-form]');
  if (bform) {
    var labels = bform.querySelector('[data-confirm-labels]');
    var syncKind = function () { var c = bform.querySelector('input[name=kind]:checked'); labels.hidden = !(c && c.value === 'confirm'); };
    bform.addEventListener('change', syncKind);
    syncKind();
    document.querySelectorAll('[data-template]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = JSON.parse(b.getAttribute('data-template'));
        bform.querySelector('[name=title]').value = d.title || '';
        bform.querySelector('[name=body]').value = d.body || '';
        bform.querySelector('input[name=kind][value="' + (d.kind === 'confirm' ? 'confirm' : 'info') + '"]').checked = true;
        if (d.yes) bform.querySelector('[name=yes_label]').value = d.yes;
        if (d.no) bform.querySelector('[name=no_label]').value = d.no;
        syncKind();
        document.querySelectorAll('[data-template]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
        bform.querySelector('[name=body]').focus();
      });
    });
    var pf = bform.querySelector('[data-filter-people]');
    if (pf) pf.addEventListener('input', function () {
      var q = pf.value.trim().toLowerCase();
      bform.querySelectorAll('.ci-dir li').forEach(function (li) { li.hidden = q && li.getAttribute('data-name').indexOf(q) < 0; });
    });
    var sdate = bform.querySelector('[name=serving_date]');
    if (sdate) sdate.addEventListener('change', function () { var cb = sdate.closest('label').querySelector('input[type=checkbox]'); if (cb && sdate.value) cb.checked = true; });
  }

  /* ---------- Incident report: pick people on file ---------- */
  var pSearch = document.querySelector('[data-people-search]');
  if (pSearch) {
    var pIds = document.querySelector('[data-people-ids]');
    var pRes = document.querySelector('[data-people-results]');
    var pt = null;
    pSearch.addEventListener('input', function () {
      clearTimeout(pt);
      var last = pSearch.value.split(',').pop().trim();
      if (last.length < 2) { pRes.innerHTML = ''; return; }
      pt = setTimeout(function () {
        fetch('/checkin/api/people?q=' + encodeURIComponent(last), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (list) {
            pRes.innerHTML = '';
            if (!list.length) return;
            var ul = el('ul', { class: 'ci-family-list' });
            list.forEach(function (pp) {
              var b = el('button', { type: 'button', class: 'ci-family-row' }, [el('span', { class: 'ci-family-name', text: pp.name }), el('span', { class: 'ci-family-members', text: pp.sub })]);
              b.addEventListener('click', function () {
                var parts = pSearch.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
                parts.pop();
                parts.push(pp.name);
                pSearch.value = parts.join(', ') + ', ';
                pIds.value = (pIds.value ? pIds.value + ',' : '') + pp.id;
                pRes.innerHTML = '';
                pSearch.focus();
              });
              ul.appendChild(el('li', {}, [b]));
            });
            pRes.appendChild(ul);
          }).catch(function () {});
      }, 150);
    });
  }

  /* ---------- Print this page ---------- */
  document.querySelectorAll('[data-print-page]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });

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
        // Quick Check: whole family in, kids' tags printed, without opening the family.
        var token = search.getAttribute('data-csrf');
        var qf = token ? el('form', { method: 'post', action: '/checkin/quick/' + f.id, class: 'ci-quick-form' }, [
          el('input', { type: 'hidden', name: '_csrf', value: token }),
          el('input', { type: 'hidden', name: 'back', value: '/checkin' }),
          el('button', { class: 'btn ci-quick-btn', type: 'submit', text: 'Quick Check', title: 'Check in everyone in ' + f.name + ' and print the kids’ name tags' }),
        ]) : null;
        if (qf) qf.addEventListener('submit', function () { var b = qf.querySelector('button'); b.disabled = true; b.textContent = 'Checking in…'; });
        ul.appendChild(el('li', { class: qf ? 'ci-family-item' : '' }, [a, qf]));
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

  /* ---------- Camera scanning of pickup tags ----------
     Uses the browser's own barcode reader when it has one (Chrome on Android, Edge, Chrome on Mac),
     and our built-in reader (scan128.js) everywhere else, including iPhone and iPad. */
  var scanner = document.querySelector('[data-scanner]');
  var startBtn = document.querySelector('[data-start-scan]');
  var scanForm = document.querySelector('[data-scan-form]');
  if (scanner && startBtn && scanForm && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    startBtn.hidden = false;
    var video = scanner.querySelector('video');
    var status = scanner.querySelector('[data-scanner-status]');
    var canvas = document.createElement('canvas');
    var ctx2d = canvas.getContext('2d', { willReadFrequently: true });
    var stream = null;
    var lastHit = '';
    var stop = function () { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; };
    var found = function (raw) {
      var code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 4) return false;
      code = code.slice(-4);
      // The built-in reader must see the same code twice, so a smudge can't fool it.
      if (!nativeDetector && code !== lastHit) { lastHit = code; return false; }
      status.textContent = 'Found ' + code;
      if (navigator.vibrate) navigator.vibrate(80);
      stop();
      scanForm.querySelector('input[name=code]').value = code;
      scanForm.submit();
      return true;
    };
    var nativeDetector = null;
    var frame = function () {
      var w = video.videoWidth;
      var h = video.videoHeight;
      if (!w || !h) return null;
      var scale = Math.min(1, 960 / w);
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
      return ctx2d.getImageData(0, 0, canvas.width, canvas.height);
    };
    var tick = function () {
      if (!stream) return;
      if (nativeDetector) {
        nativeDetector.detect(video).then(function (codes) {
          if (!codes.some(function (c) { return found(c.rawValue); })) setTimeout(tick, 200);
        }).catch(function () { setTimeout(tick, 400); });
        return;
      }
      var img = frame();
      var text = img && window.Scan128 ? window.Scan128.decodeImageData(img) : null;
      if (!(text && found(text))) setTimeout(tick, 120);
    };
    var setup = function () {
      if (!('BarcodeDetector' in window)) return Promise.resolve(null);
      return window.BarcodeDetector.getSupportedFormats().then(function (formats) {
        return formats.indexOf('code_128') >= 0 ? new window.BarcodeDetector({ formats: ['code_128', 'qr_code'].filter(function (f) { return formats.indexOf(f) >= 0; }) }) : null;
      }).catch(function () { return null; });
    };
    startBtn.addEventListener('click', function () {
      setup().then(function (d) {
        nativeDetector = d;
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      }).then(function (s) {
        stream = s;
        video.setAttribute('playsinline', '');
        video.muted = true;
        video.srcObject = s;
        scanner.hidden = false;
        startBtn.hidden = true;
        status.textContent = 'Hold the pickup tag’s barcode inside the box, about a hand’s width away.';
        return video.play();
      }).then(function () { tick(); })
        .catch(function () {
          status.textContent = 'The camera isn’t available. Allow camera access for this site, or type the code instead.';
          scanner.hidden = false;
          startBtn.hidden = true;
        });
    });
    var stopBtn = scanner.querySelector('[data-stop-scan]');
    if (stopBtn) stopBtn.addEventListener('click', function () { stop(); scanner.hidden = true; startBtn.hidden = false; });
    window.addEventListener('pagehide', stop);
  }
})();

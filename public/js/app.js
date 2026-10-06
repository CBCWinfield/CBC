/* Library front-end behaviour: the Ask bar, confirmations, phone notifications,
   and the book form helpers (ISBN lookup, cover photos, CSV import). */
(function () {
  'use strict';
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var SPINES = ['#1B4D1F', '#2E7D32', '#111111', '#3E6B2A', '#5E2424', '#23395A', '#2F3A33', '#4A7C23'];
  function hashColor(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return SPINES[h % SPINES.length];
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------- Ask bar ---------- */
  var form = document.getElementById('ask-form');
  var panel = document.getElementById('ask-panel');
  if (form && panel) {
    var input = document.getElementById('ask-input');
    var qEl = document.getElementById('ask-q');
    var answerEl = document.getElementById('ask-answer');
    var list = document.getElementById('ask-results');
    var toggle = document.getElementById('ask-collapse');

    function setCollapsed(c) {
      panel.classList.toggle('collapsed', c);
      toggle.textContent = c ? 'Show answer' : 'Collapse';
      toggle.setAttribute('aria-expanded', String(!c));
      store('askCollapsed', c ? '1' : '0');
    }
    toggle.addEventListener('click', function () { setCollapsed(!panel.classList.contains('collapsed')); });

    function render(q, data) {
      panel.hidden = false;
      qEl.textContent = '“' + q + '”';
      answerEl.textContent = data.answer || '';
      list.innerHTML = '';
      (data.books || []).forEach(function (b) {
        var thumb = b.cover
          ? el('img', { class: 'ask-thumb', src: b.cover, alt: '' })
          : el('span', { class: 'ask-thumb', style: '--spine:' + hashColor(b.title) });
        var status = el('span', { class: 'avail ' + (b.available > 0 ? 'avail-yes' : 'avail-no'), text: b.available > 0 ? 'Available' : 'Checked out' });
        var text = el('span', {}, [el('span', { class: 't', text: b.title }), b.author ? el('span', { class: 'a', text: b.author }) : null]);
        list.appendChild(el('li', {}, [el('a', { href: '/books/' + b.id }, [thumb, text, status])]));
      });
      if (data.total > (data.books || []).length) {
        list.appendChild(el('li', {}, [el('a', { href: '/catalog?q=' + encodeURIComponent(q) }, [el('span'), el('span', { text: 'See all ' + data.total + ' in the catalog' }), el('span')])]));
      }
    }

    form.addEventListener('submit', function (e) {
      var q = input.value.trim();
      if (!q) { e.preventDefault(); return; }
      e.preventDefault();
      panel.hidden = false;
      setCollapsed(false);
      qEl.textContent = '“' + q + '”';
      answerEl.innerHTML = '<span class="ask-loading">Looking through the shelves…</span>';
      list.innerHTML = '';
      fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Accept: 'application/json' },
        body: JSON.stringify({ q: q }),
        credentials: 'same-origin',
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data.error) data = { answer: data.error, books: [] };
        render(q, data);
        store('askLast', JSON.stringify({ q: q, data: data }));
      }).catch(function () {
        answerEl.textContent = 'The library didn’t answer. Check your connection and try again.';
      });
    });

    // Bring back the last answer (collapsed) when moving between pages.
    var last = store('askLast');
    if (last) {
      try {
        var saved = JSON.parse(last);
        render(saved.q, saved.data);
        input.value = saved.q;
        setCollapsed(store('askCollapsed') !== '0');
      } catch (e) { /* ignore */ }
    }
    input.addEventListener('search', function () {
      if (!input.value) { panel.hidden = true; store('askLast', ''); }
    });
  }

  /* ---------- Confirm before destructive actions ---------- */
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.dataset && f.dataset.confirm && !window.confirm(f.dataset.confirm)) e.preventDefault();
  }, true);

  /* ---------- Phone / browser notifications ---------- */
  var pushBox = document.querySelector('[data-push]');
  if (pushBox && 'serviceWorker' in navigator && 'PushManager' in window) {
    var btn = pushBox.querySelector('[data-push-toggle]');
    var status = pushBox.querySelector('[data-push-status]');
    var b64ToBytes = function (s) {
      var pad = '='.repeat((4 - (s.length % 4)) % 4);
      var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
      return out;
    };
    var post = function (url, body) {
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body), credentials: 'same-origin' });
    };
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        var update = function (on) {
          btn.hidden = false;
          btn.textContent = on ? 'Turn off notifications' : 'Turn on notifications';
          status.textContent = on ? 'Notifications are on for this device.' : '';
        };
        update(!!sub);
        btn.addEventListener('click', function () {
          btn.disabled = true;
          reg.pushManager.getSubscription().then(function (current) {
            if (current) {
              return post('/api/push/unsubscribe', { endpoint: current.endpoint }).then(function () { return current.unsubscribe(); }).then(function () { update(false); });
            }
            return fetch('/api/push/key', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (k) {
              if (!k.key) throw new Error('off');
              return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.key) });
            }).then(function (s) { return post('/api/push/subscribe', s.toJSON()); }).then(function () { update(true); });
          }).catch(function () {
            status.textContent = Notification.permission === 'denied'
              ? 'Notifications are blocked for this site in your browser settings.'
              : 'Notifications couldn’t be turned on. On iPhone, first add this site to your Home Screen (Share › Add to Home Screen), then open it from there.';
          }).then(function () { btn.disabled = false; });
        });
      });
    }).catch(function () { /* service worker unavailable */ });
  } else if (pushBox) {
    var s2 = pushBox.querySelector('[data-push-status]');
    s2.textContent = 'This browser doesn’t support notifications. On iPhone, add this site to your Home Screen first, then open it from there.';
  }

  /* ---------- Book form: ISBN lookup and cover photos ---------- */
  var bookForm = document.getElementById('book-form');
  if (bookForm) {
    var lookupBtn = document.getElementById('isbn-lookup');
    var isbnStatus = document.getElementById('isbn-status');
    var preview = document.getElementById('cover-preview');
    var coverData = document.getElementById('cover-data');
    var coverUrl = document.getElementById('cover-url');
    var field = function (name) { return bookForm.querySelector('[name="' + name + '"]'); };

    lookupBtn.addEventListener('click', function () {
      var isbn = field('isbn').value.trim();
      if (!isbn) { isbnStatus.textContent = 'Type the ISBN first.'; field('isbn').focus(); return; }
      lookupBtn.disabled = true;
      isbnStatus.textContent = 'Looking up the book…';
      fetch('/admin/books/lookup?isbn=' + encodeURIComponent(isbn), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.error) { isbnStatus.textContent = d.error; return; }
          var filled = [];
          ['title', 'subtitle', 'author', 'publisher', 'published_year', 'pages', 'description', 'tags'].forEach(function (k) {
            var f = field(k);
            if (f && d[k] && !f.value.trim()) { f.value = d[k]; filled.push(k); }
          });
          var aud = bookForm.querySelector('input[name="audience"]:checked');
          if (d.audience && (!aud || aud.value === 'Adults' || aud.value === 'Everyone')) {
            var pick = bookForm.querySelector('input[name="audience"][value="' + d.audience + '"]');
            if (pick) pick.checked = true;
          }
          var catChosen = bookForm.querySelector('input[name="category_path"]:checked');
          if (d.category && (!catChosen || !catChosen.value)) {
            var match = Array.prototype.find.call(bookForm.querySelectorAll('input[name="category_path"]'), function (r) { return r.value.split(' › ').pop().toLowerCase() === d.category.toLowerCase(); });
            if (match) match.checked = true;
            else { field('new_category_name').value = d.category; bookForm.querySelector('.add-cat').open = true; }
          }
          if (d.isbn) field('isbn').value = d.isbn;
          if (d.cover_url && !coverData.value) {
            coverUrl.value = d.cover_url;
            var img = el('img', { class: 'cover cover-lg', src: d.cover_url, alt: 'Cover found online' });
            img.onerror = function () { coverUrl.value = ''; img.remove(); };
            preview.innerHTML = '';
            preview.appendChild(img);
          }
          var msg = filled.length ? 'Filled in what we found. Check it over before saving.' : 'Found the book, but your fields were already filled in.';
          if (d.duplicate) msg += ' Note: “' + d.duplicate.title + '” with this ISBN is already in the catalog. You may just need to add a copy.';
          isbnStatus.textContent = msg;
        })
        .catch(function () { isbnStatus.textContent = 'The lookup didn’t work. You can type the details in yourself.'; })
        .then(function () { lookupBtn.disabled = false; });
    });

    // Shrink photos in the browser so they upload quickly from a phone.
    var fileInput = document.getElementById('cover-file');
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 600;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var data = c.toDataURL('image/jpeg', 0.85);
          coverData.value = data;
          coverUrl.value = '';
          preview.innerHTML = '';
          preview.appendChild(el('img', { class: 'cover cover-lg', src: data, alt: 'New cover' }));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- Book screen: category search, format-specific fields, trash button ---------- */
  var catFilter = document.getElementById('cat-filter');
  if (catFilter) {
    catFilter.addEventListener('input', function () {
      var q = catFilter.value.trim().toLowerCase();
      document.querySelectorAll('#cat-scroll li').forEach(function (li) {
        var own = li.querySelector(':scope > label').textContent.toLowerCase();
        var anyInside = li.textContent.toLowerCase().indexOf(q) >= 0;
        li.hidden = q && !anyInside && own.indexOf(q) < 0;
      });
    });
    var chosen = document.querySelector('#cat-scroll input:checked');
    var box = document.getElementById('cat-scroll');
    if (chosen && chosen.value) box.scrollTop = chosen.closest('label').offsetTop - box.offsetTop - 80;
  }
  var fmt = document.getElementById('b-format');
  if (fmt) {
    var showFor = function () {
      document.querySelectorAll('[data-show-for]').forEach(function (el) {
        var has = el.querySelector('input') && el.querySelector('input').value;
        el.hidden = !has && el.getAttribute('data-show-for').split(',').indexOf(fmt.value) < 0;
      });
    };
    fmt.addEventListener('change', showFor);
    showFor();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-confirm-click]');
    if (b && !window.confirm(b.getAttribute('data-confirm-click'))) e.preventDefault();
  });

  /* ---------- CSV import: read the chosen file into the form ---------- */
  var csvFile = document.getElementById('csv-file');
  if (csvFile) {
    csvFile.addEventListener('change', function () {
      var f = csvFile.files && csvFile.files[0];
      if (!f) return;
      var info = document.getElementById('csv-info');
      info.textContent = 'Reading ' + f.name + '…';
      var r = new FileReader();
      r.onload = function () {
        var text = document.getElementById('csv-text');
        text.value = r.result;
        info.textContent = 'Ready: ' + f.name + ' (' + Math.max(1, Math.round(f.size / 1024)).toLocaleString() + ' KB). Press Import books.';
        document.getElementById('csv-paste').hidden = true;
      };
      r.readAsText(f);
    });
    var importForm = document.getElementById('import-form');
    importForm.addEventListener('submit', function () {
      var btn = importForm.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Importing… this can take a minute';
    });
  }

  /* ---------- Cover finder progress on the Books page ---------- */
  var coverBox = document.querySelector('[data-cover-status][data-running]');
  if (coverBox) {
    var poll = function () {
      fetch('/admin/covers/status', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (st) {
          var set = function (k, v) { var n = coverBox.querySelector('[data-cv="' + k + '"]'); if (n) n.textContent = v; };
          set('with', st.with_cover.toLocaleString());
          set('pending', st.pending.toLocaleString());
          if (st.lastTitle) set('last', 'Working on “' + st.lastTitle + '”');
          if (st.running) setTimeout(poll, 5000); else window.location.reload();
        })
        .catch(function () { setTimeout(poll, 15000); });
    };
    setTimeout(poll, 5000);
  }
})();

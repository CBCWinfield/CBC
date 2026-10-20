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
        setCollapsed(true); // a new page starts with the last answer folded away
      } catch (e) { /* ignore */ }
    }
    input.addEventListener('search', function () {
      if (!input.value) { panel.hidden = true; store('askLast', ''); }
    });
  }

  /* ---------- Confirm before destructive actions ---------- */
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.dataset && f.dataset.confirm && !window.confirm(f.dataset.confirm)) { e.preventDefault(); return; }
    // Slow forms (AI writing a slide): show what's happening and stop double submits.
    if (f.dataset && f.dataset.busy && !e.defaultPrevented) {
      var btn = f.querySelector('button[type=submit]');
      if (btn) { setTimeout(function () { btn.disabled = true; btn.textContent = f.dataset.busy; }, 0); }
    }
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

  /* ---------- Description boxes: italics and bold ----------
     Kept as *italic* and **bold** (the same rules as src/lib/richtext.js, which shows them on the book page). */
  var FMT_BOTH = /\*\*\*([^\s*](?:[^*]*?[^\s*])?)\*\*\*/g;
  var FMT_BOLD = /\*\*([^\s*](?:(?:[^*]|\*(?!\*))*?[^\s*])?)\*\*/g;
  var FMT_ITAL = /(^|[^\w*])\*([^\s*](?:[^*]*?[^\s*])?)\*(?![\w*])/g;
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var fmtInline = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; })
      .replace(FMT_BOTH, '<strong><em>$1</em></strong>').replace(FMT_BOLD, '<strong>$1</strong>').replace(FMT_ITAL, '$1<em>$2</em>');
  };
  var fmtParagraphs = function (s) {
    return String(s || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return '<p>' + p.split('\n').map(fmtInline).join('<br>') + '</p>'; }).join('');
  };
  // Put text in place of from..to, keeping the browser's Undo when it can, then select selFrom..selTo.
  var fmtReplace = function (ta, from, to, text, selFrom, selTo) {
    ta.focus();
    ta.setSelectionRange(from, to);
    var ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok || ta.value.slice(from, from + text.length) !== text) ta.setRangeText(text, from, to, 'end');
    ta.setSelectionRange(selFrom, selTo);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  var stars = function (v, i, dir) { var n = 0; while (v.charAt(dir < 0 ? i - 1 - n : i + n) === '*') n++; return n; };
  // I or B: wrap the selection (or the word at the cursor) in stars, or take them off if it already has them.
  var fmtToggle = function (ta, kind) {
    var v = ta.value, a = ta.selectionStart, b = ta.selectionEnd, n = kind === 'b' ? 2 : 1, mark = kind === 'b' ? '**' : '*';
    if (a === b) {
      while (a > 0 && /[^\s*]/.test(v.charAt(a - 1))) a--;
      while (b < v.length && /[^\s*]/.test(v.charAt(b))) b++;
    }
    while (a < b && /[\s*]/.test(v.charAt(a))) a++;
    while (b > a && /[\s*]/.test(v.charAt(b - 1))) b--;
    if (a === b) { fmtReplace(ta, a, b, mark + mark, a + n, a + n); return; }
    var k = Math.min(stars(v, a, -1), stars(v, b, 1));
    var on = kind === 'b' ? k >= 2 : k === 1 || k === 3;
    var inner = v.slice(a, b);
    if (on) fmtReplace(ta, a - n, b + n, inner, a - n, b - n);
    else fmtReplace(ta, a, b, mark + inner + mark, a + n, b + n);
  };
  // Pasted from a web page or a document: its italics and bold come along as stars.
  var fmtFromHtml = function (h) {
    var doc = new DOMParser().parseFromString(h, 'text/html');
    var walk = function (node, it, bo) {
      if (node.nodeType === 3) return node.nodeValue.replace(/[\s ]+/g, ' ');
      if (node.nodeType !== 1) return '';
      var tag = node.tagName, st = node.getAttribute('style') || '';
      if (/^(SCRIPT|STYLE|HEAD|TITLE|META|LINK|TEMPLATE)$/.test(tag)) return '';
      if (tag === 'BR') return '\n';
      var i2 = it || /^(I|EM|CITE)$/.test(tag) || /font-style:\s*italic/i.test(st);
      var b2 = bo || (/^(B|STRONG)$/.test(tag) && !/font-weight:\s*(normal|[1-5]00)\b/i.test(st)) || /font-weight:\s*(bold|[6-9]00)\b/i.test(st);
      if (it && /font-style:\s*normal/i.test(st)) i2 = false;
      var inner = '';
      for (var c = node.firstChild; c; c = c.nextSibling) inner += walk(c, i2, b2);
      var open = (b2 && !bo ? '**' : '') + (i2 && !it ? '*' : '');
      if (open && inner.trim()) {
        var close = (i2 && !it ? '*' : '') + (b2 && !bo ? '**' : '');
        inner = /^\s*/.exec(inner)[0] + open + inner.trim() + close + /\s*$/.exec(inner)[0];
      }
      if (tag === 'LI') return '\n• ' + inner.trim() + '\n';
      if (/^(P|DIV|H[1-6]|BLOCKQUOTE|UL|OL|TABLE|TR|SECTION|ARTICLE)$/.test(tag)) return '\n\n' + inner.trim() + '\n\n';
      return inner;
    };
    return walk(doc.body, false, false).split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).join('\n')
      .replace(/\n{3,}/g, '\n\n').replace(/(• [^\n]*)\n\n(?=• )/g, '$1\n').trim();
  };
  Array.prototype.forEach.call(document.querySelectorAll('textarea[data-fmt]'), function (ta) {
    var bar = document.querySelector('[data-fmt-for="' + ta.id + '"]');
    var pv = el('div', { class: 'fmt-preview', hidden: '' }, [el('span', { class: 'fmt-preview-label', text: 'How it will look on the book page' }), el('div', { class: ta.rows > 3 ? 'description' : 'short-desc' })]);
    ta.parentNode.insertBefore(pv, ta.nextSibling);
    var show = function () {
      var h = ta.rows > 3 ? fmtParagraphs(ta.value) : fmtInline(ta.value.replace(/\s*\n+\s*/g, ' ').trim());
      pv.hidden = !/<(em|strong)>/.test(h);
      if (!pv.hidden) pv.lastChild.innerHTML = h;
    };
    ta.addEventListener('input', show);
    show();
    if (bar) bar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-fmt]');
      if (btn) { e.preventDefault(); fmtToggle(ta, btn.getAttribute('data-fmt')); }
    });
    // keep the selection when a button is pressed
    if (bar) bar.addEventListener('mousedown', function (e) { if (e.target.closest('[data-fmt]')) e.preventDefault(); });
    ta.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      var k = (e.key || '').toLowerCase();
      if (k === 'i' || k === 'b') { e.preventDefault(); fmtToggle(ta, k); }
    });
    ta.addEventListener('paste', function (e) {
      var cd = e.clipboardData, h = cd && cd.getData('text/html');
      if (!h || !/<(i|em|b|strong|cite)\b|font-style:\s*italic|font-weight:\s*(bold|[6-9]00)/i.test(h)) return;
      var text;
      try { text = fmtFromHtml(h); } catch (err) { return; }
      if (!text || !/\*/.test(text)) return;
      if (ta.rows <= 3) text = text.replace(/\s*\n+\s*/g, ' ');
      e.preventDefault();
      var a = ta.selectionStart;
      fmtReplace(ta, a, ta.selectionEnd, text, a + text.length, a + text.length);
    });
  });

  /* ---------- Book form: ISBN lookup and cover photos ---------- */
  var bookForm = document.getElementById('book-form');
  if (bookForm) {
    var lookupBtn = document.getElementById('isbn-lookup');
    var isbnStatus = document.getElementById('isbn-status');
    var preview = document.getElementById('cover-preview');
    var coverData = document.getElementById('cover-data');
    var coverUrl = document.getElementById('cover-url');
    var field = function (name) { return bookForm.querySelector('[name="' + name + '"]'); };

    // Who it's for: several groups can be ticked; Everyone stands alone.
    var audBox = document.getElementById('audience-choices');
    var audTouched = false;
    var audBoxes = function () { return audBox ? Array.prototype.slice.call(audBox.querySelectorAll('input[name="audiences[]"]')) : []; };
    var audChosen = function () { return audBoxes().filter(function (b) { return b.checked; }).map(function (b) { return b.value; }); };
    var audSet = function (list) { audBoxes().forEach(function (b) { b.checked = list.indexOf(b.value) >= 0; }); };
    if (audBox) audBox.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || t.name !== 'audiences[]') return;
      audTouched = true;
      var boxes = audBoxes();
      if (t.checked && t.value === 'Everyone') boxes.forEach(function (b) { if (b !== t) b.checked = false; });
      else if (t.checked) boxes.forEach(function (b) { if (b.value === 'Everyone') b.checked = false; });
      if (!audChosen().length) audSet(['Everyone']);
    });
    window.HTGAudiences = audChosen;

    // Fill in from ISBN: empty boxes, and boxes still holding what an earlier lookup put there, get the details found.
    // A box someone typed in is kept, with a button to use what was found instead.
    var FILL = ['title', 'subtitle', 'author', 'series', 'publisher', 'published_year', 'pages', 'description', 'tags'];
    var NAMES = { title: 'title', subtitle: 'subtitle', author: 'writer', series: 'series', publisher: 'publisher', published_year: 'year', pages: 'pages', description: 'description', tags: 'tags' };
    var lastFill = {};
    var listWords = function (keys) {
      var w = keys.map(function (k) { return NAMES[k]; });
      return w.length < 2 ? w.join('') : w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1];
    };
    var setField = function (k, v) {
      var f = field(k);
      f.value = v; lastFill[k] = v;
      f.dispatchEvent(new Event('input', { bubbles: true }));
    };
    lookupBtn.addEventListener('click', function () {
      var isbn = field('isbn').value.trim();
      if (!isbn) { isbnStatus.textContent = 'Type the ISBN first.'; field('isbn').focus(); return; }
      lookupBtn.disabled = true;
      isbnStatus.textContent = 'Looking up the book…';
      fetch('/admin/books/lookup?isbn=' + encodeURIComponent(isbn), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.error) { isbnStatus.textContent = d.error; return; }
          var filled = [], kept = [];
          FILL.forEach(function (k) {
            var f = field(k);
            if (!f) return;
            var found = d[k] == null ? '' : String(d[k]).trim();
            var cur = f.value.trim();
            var typed = cur && cur !== String(lastFill[k] || '').trim();
            if (!found) { if (cur && !typed) setField(k, ''); return; } // from an earlier lookup, for another book
            if (cur === found) { lastFill[k] = found; return; }
            if (typed) { kept.push(k); return; }
            setField(k, found); filled.push(k);
          });
          var aud = audChosen();
          if (d.audiences && d.audiences.length && !audTouched && (aud.length !== 1 || aud[0] === 'Adults' || aud[0] === 'Everyone')) audSet(d.audiences);
          // the subjects help the category suggestions; with none chosen yet, suggest them now
          if (window.HTGCats) { window.HTGCats.subjects = d.subjects || []; if (!window.HTGCats.chosen().length) window.HTGCats.suggest(true); }
          if (d.isbn) field('isbn').value = d.isbn;
          if (d.cover_url && !coverData.value) {
            coverUrl.value = d.cover_url;
            var img = el('img', { class: 'cover cover-lg', src: d.cover_url, alt: 'Cover found online' });
            img.onerror = function () { coverUrl.value = ''; img.remove(); };
            preview.innerHTML = '';
            preview.appendChild(img);
          }
          isbnStatus.textContent = '';
          isbnStatus.appendChild(document.createTextNode((filled.length ? 'Filled in the ' + listWords(filled) + (d.title ? ' for “' + d.title + '”' : '') + '. Check it over before saving.'
            : 'Found “' + (d.title || 'the book') + '”.') + (d.sources ? ' (From ' + d.sources + '.)' : '')));
          if (kept.length) {
            var keep = {};
            kept.forEach(function (k) { keep[k] = String(d[k]).trim(); });
            isbnStatus.appendChild(document.createTextNode(' You had already typed the ' + listWords(kept) + ', so ' + (kept.length > 1 ? 'those were' : 'that was') + ' left alone. '));
            var use = el('button', { type: 'button', class: 'btn btn-quiet btn-small', text: 'Use what was found instead' });
            use.addEventListener('click', function () { Object.keys(keep).forEach(function (k) { setField(k, keep[k]); }); use.remove(); });
            isbnStatus.appendChild(use);
          }
          if (d.duplicate) isbnStatus.appendChild(document.createTextNode(' Note: “' + d.duplicate.title + '” with this ISBN is already in the catalog. You may just need to add a copy.'));
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

  /* ---------- Search-as-you-type suggestions ---------- */
  function highlight(text, query) {
    // Bold the parts of the text that start with a typed word (built with DOM nodes, never HTML).
    var frag = document.createDocumentFragment();
    var words = query.toLowerCase().split(/\s+/).filter(Boolean);
    var re = words.length ? new RegExp('(^|[^a-z0-9])(' + words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'gi') : null;
    var last = 0;
    var str = String(text || '');
    if (re) {
      str.replace(re, function (m, pre, word, idx) {
        var start = idx + pre.length;
        frag.appendChild(document.createTextNode(str.slice(last, start)));
        frag.appendChild(el('mark', { text: str.substr(start, word.length) }));
        last = start + word.length;
        return m;
      });
    }
    frag.appendChild(document.createTextNode(str.slice(last)));
    return frag;
  }

  document.querySelectorAll('input[data-suggest]').forEach(function (input, n) {
    var mode = input.getAttribute('data-suggest');
    var isAsk = input.hasAttribute('data-suggest-ask');
    var wrap = input.closest('.suggest-wrap') || input.parentNode;
    var listId = 'suggest-list-' + n;
    var box = el('div', { class: 'suggest-box', id: listId, role: 'listbox' });
    box.hidden = true;
    wrap.appendChild(box);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'false');
    var items = [];
    var active = -1;
    var timer = null;
    var seq = 0;

    function close() { box.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; input.removeAttribute('aria-activedescendant'); }
    function setActive(i) {
      items.forEach(function (it, j) { it.classList.toggle('is-active', j === i); it.setAttribute('aria-selected', String(j === i)); });
      active = i;
      if (i >= 0) { input.setAttribute('aria-activedescendant', items[i].id); items[i].scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    }
    function option(url, kids, cls) {
      var a = el('a', { href: url, class: 'suggest-item' + (cls ? ' ' + cls : ''), role: 'option', id: listId + '-' + items.length, tabindex: '-1' }, kids);
      a.addEventListener('mousedown', function (e) { e.preventDefault(); window.location.href = url; });
      items.push(a);
      return a;
    }
    function render(q, d) {
      box.innerHTML = '';
      items = [];
      active = -1;
      if (!d.books.length && !d.writers.length && !d.categories.length) {
        box.appendChild(el('p', { class: 'suggest-empty', text: isAsk ? 'No title matches yet. Press Enter to ask the library.' : 'No matches yet. Keep typing, or press Enter to search.' }));
      }
      if (d.writers.length) {
        box.appendChild(el('p', { class: 'suggest-label', text: 'Writers' }));
        d.writers.forEach(function (w) {
          var t = el('span', { class: 'suggest-title' }); t.appendChild(highlight(w.name, q));
          box.appendChild(option(w.url, [el('span', { class: 'suggest-icon', text: '✎' }), el('span', { class: 'suggest-text' }, [t, el('span', { class: 'suggest-meta', text: w.n + (w.n === 1 ? ' book' : ' books') })])], 'suggest-small'));
        });
      }
      if (d.categories.length) {
        box.appendChild(el('p', { class: 'suggest-label', text: 'Categories' }));
        d.categories.forEach(function (c) {
          var t = el('span', { class: 'suggest-title' }); t.appendChild(highlight(c.label, q));
          box.appendChild(option(c.url, [el('span', { class: 'suggest-icon', text: '▤' }), el('span', { class: 'suggest-text' }, [t, el('span', { class: 'suggest-meta', text: c.n + (c.n === 1 ? ' book' : ' books') })])], 'suggest-small'));
        });
      }
      if (d.books.length) {
        box.appendChild(el('p', { class: 'suggest-label', text: 'Books' }));
        d.books.forEach(function (b) {
          var thumb = b.cover ? el('img', { class: 'suggest-thumb', src: b.cover, alt: '' }) : el('span', { class: 'suggest-thumb', style: '--spine:' + hashColor(b.title) });
          var t = el('span', { class: 'suggest-title' }); t.appendChild(highlight(b.title, q));
          var meta = el('span', { class: 'suggest-meta' });
          meta.appendChild(highlight([b.author, b.sku ? 'SKU ' + b.sku : '', b.format].filter(Boolean).join(' · '), q));
          var status = el('span', { class: 'avail ' + (b.hidden ? 'avail-none' : b.available > 0 ? 'avail-yes' : 'avail-no'), text: b.hidden ? 'Hidden' : b.available > 0 ? 'In' : 'Out' });
          box.appendChild(option(b.url, [thumb, el('span', { class: 'suggest-text' }, [t, meta]), status]));
        });
      }
      if (d.total > d.books.length && !isAsk) {
        box.appendChild(el('p', { class: 'suggest-foot', text: 'Press Enter to see all ' + d.total.toLocaleString() + ' matches' }));
      } else if (isAsk) {
        box.appendChild(el('p', { class: 'suggest-foot', text: 'Press Enter to ask the library' }));
      }
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function fetchSuggestions() {
      var q = input.value.trim();
      if (q.length < 2 && !/^\d$/.test(q)) { close(); return; }
      var mine = ++seq;
      fetch('/api/suggest?q=' + encodeURIComponent(q) + (mode === 'admin' ? '&for=admin' : ''), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (mine === seq && document.activeElement === input) render(q, d); })
        .catch(function () {});
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(fetchSuggestions, 140); });
    input.addEventListener('focus', function () { if (input.value.trim().length >= 2) fetchSuggestions(); });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
    input.addEventListener('keydown', function (e) {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(items.length - 1, active + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(-1, active - 1)); }
      else if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter') {
        if (active >= 0) { e.preventDefault(); window.location.href = items[active].getAttribute('href'); }
        else close();
      }
    });
  });

  // Sort menus apply as soon as a choice is made.
  document.querySelectorAll('select[data-autosubmit]').forEach(function (sel) {
    sel.addEventListener('change', function () { if (sel.form) sel.form.submit(); });
  });

  /* ---------- Book screen: categories (several), suggestions, the librarian's sign-off ---------- */
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
    var firstChosen = document.querySelector('#cat-scroll input:checked');
    var scrollBox = document.getElementById('cat-scroll');
    if (firstChosen) scrollBox.scrollTop = firstChosen.closest('label').offsetTop - scrollBox.offsetTop - 80;
  }
  var catBox = document.getElementById('cat-box');
  if (catBox) (function () {
    var SEP = ' › ';
    var form = catBox.closest('form');
    var list = document.getElementById('cat-chosen-list'), none = document.getElementById('cat-none'), count = document.getElementById('cat-count');
    var mainIn = document.getElementById('cat-main'), status = document.getElementById('cat-status');
    var also = document.getElementById('cat-also'), alsoList = document.getElementById('cat-also-list');
    var okBox = document.getElementById('cat-ok'), okNote = document.getElementById('cat-ok-note'), signoff = document.getElementById('cat-signoff');
    var btn = document.getElementById('cat-suggest');
    var why = {}; // path -> { strength, reasons } from the last suggestion
    var boxes = function () { return Array.prototype.slice.call(catBox.querySelectorAll('input[name="category_paths[]"]')); };
    var boxFor = function (p) { var low = p.toLowerCase(); return boxes().filter(function (b) { return b.value.toLowerCase() === low; })[0]; };
    // the order shown (the first is the main one): as saved, then in the order they're ticked
    var order = Array.prototype.map.call(list.querySelectorAll('li[data-path]'), function (li) { return li.getAttribute('data-path'); });
    var startKey = order.map(function (p) { return p.toLowerCase(); }).sort().join('|');
    var startOk = okBox ? okBox.checked : false, startNote = okNote ? okNote.textContent : '';
    var okKey = startOk ? startKey : null; // the categories the tick was given for
    var chosen = function () { return order.slice(); };
    function esc(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
    function nameHtml(p) { var parts = p.split(SEP), last = parts.pop(); return (parts.length ? '<span class="muted">' + esc(parts.join(SEP) + SEP) + '</span>' : '') + '<b>' + esc(last) + '</b>'; }
    function render() {
      list.innerHTML = order.map(function (p, i) {
        var w = why[p];
        return '<li data-path="' + esc(p) + '"' + (w ? ' class="is-suggested"' : '') + '><span class="cat-name">' + nameHtml(p) + (i === 0 ? ' <span class="badge badge-main">Main</span>' : '') +
          (w ? ' <span class="badge badge-suggest">' + (w.strength === 'strong' ? 'Suggested' : 'Suggested, check it') + '</span>' : '') + '</span>' +
          '<span class="cat-row-actions">' + (i ? '<button type="button" class="linklike small" data-cat-main="' + esc(p) + '">Make main</button>' : '') +
          '<button type="button" class="cat-x" data-cat-remove="' + esc(p) + '" aria-label="Remove ' + esc(p) + '">×</button></span>' +
          (w && w.reasons.length ? '<span class="cat-why small muted">' + w.reasons.slice(0, 2).map(esc).join(' · ') + '</span>' : '') + '</li>';
      }).join('');
      none.hidden = order.length > 0;
      count.textContent = order.length ? String(order.length) : '';
      mainIn.value = order[0] || '';
      // a change to the categories needs the librarian's sign-off again
      var key = order.map(function (p) { return p.toLowerCase(); }).sort().join('|');
      if (okBox) {
        okBox.disabled = !order.length;
        if (okBox.checked && key !== okKey) okBox.checked = false;
        if (!order.length) okNote.textContent = 'Choose at least one category first.';
        else if (key === startKey && okBox.checked === startOk) okNote.textContent = startNote;
        else okNote.textContent = okBox.checked ? 'Signed off when you save.' : key === startKey ? startNote : 'Changed. Tick this when they’re right.';
        signoff.classList.toggle('is-ok', okBox.checked);
      } else if (okNote && key !== startKey) okNote.textContent = 'Changed. The librarian will sign off on these categories.';
    }
    function setChosen(p, on) {
      var b = boxFor(p); if (b) b.checked = on;
      var at = order.map(function (x) { return x.toLowerCase(); }).indexOf(p.toLowerCase());
      if (on && at < 0) order.push(b ? b.value : p);
      if (!on && at >= 0) { order.splice(at, 1); delete why[p]; }
    }
    catBox.addEventListener('change', function (e) {
      if (e.target.name === 'category_paths[]') { setChosen(e.target.value, e.target.checked); render(); }
      if (e.target === okBox) { okKey = okBox.checked ? order.map(function (p) { return p.toLowerCase(); }).sort().join('|') : null; render(); }
    });
    catBox.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-cat-remove]'), mk = e.target.closest('[data-cat-main]'), add = e.target.closest('[data-cat-add]');
      if (rm) { setChosen(rm.getAttribute('data-cat-remove'), false); render(); }
      if (mk) { var p = mk.getAttribute('data-cat-main'), i = order.indexOf(p); if (i > 0) { order.splice(i, 1); order.unshift(p); render(); } }
      if (add) { var q = add.getAttribute('data-cat-add'); setChosen(q, true); why[q] = JSON.parse(add.getAttribute('data-why')); add.closest('li').remove(); if (!alsoList.children.length) also.hidden = true; render(); }
    });
    var val = function (n) { var f = form.querySelector('[name="' + n + '"]'); return f ? f.value : ''; };
    function suggest(auto) {
      btn.disabled = true; status.textContent = 'Looking at books like this one…';
      var body = { id: catBox.getAttribute('data-book-id'), title: val('title'), subtitle: val('subtitle'), author: val('author'), series: val('series'), tags: val('tags'),
        short_description: val('short_description'), description: val('description'), publisher: val('publisher'), format: val('format'), audiences: window.HTGAudiences ? window.HTGAudiences() : [], subjects: api.subjects || [] };
      fetch('/admin/books/suggest-categories', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Accept: 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var list2 = d.suggestions || [], added = [], maybe = [];
          list2.forEach(function (sg) {
            var b = boxFor(sg.path); if (!b) return;
            var on = order.some(function (x) { return x.toLowerCase() === sg.path.toLowerCase(); });
            if (sg.strength === 'maybe') { if (!on) maybe.push(sg); return; }
            why[b.value] = { strength: sg.strength, reasons: sg.reasons || [] };
            if (!on) { setChosen(b.value, true); added.push(b.value); }
          });
          alsoList.innerHTML = maybe.map(function (sg) {
            return '<li><span>' + nameHtml(sg.path) + (sg.reasons && sg.reasons.length ? '<span class="cat-why small muted">' + esc(sg.reasons[0]) + '</span>' : '') + '</span>' +
              '<button type="button" class="btn btn-quiet btn-small" data-cat-add="' + esc(sg.path) + '" data-why="' + esc(JSON.stringify({ strength: 'maybe', reasons: sg.reasons || [] })) + '">+ Add</button></li>';
          }).join('');
          also.hidden = !maybe.length;
          render();
          status.textContent = d.note ? d.note
            : added.length ? (auto ? 'Suggested from the ISBN details: ' : 'Added ') + added.length + ' suggested ' + (added.length === 1 ? 'category' : 'categories') + '. Check them below' + (okBox ? ', then tick “These categories are right”.' : '.')
            : list2.length ? 'The suggestions are already chosen' + (maybe.length ? ', or listed under “Also possible”.' : '.') : 'No suggestions.';
          var first = added[0] && boxFor(added[0]); if (first) first.closest('label').scrollIntoView({ block: 'nearest' });
        })
        .catch(function () { status.textContent = 'Suggestions didn’t load. You can choose from the list below.'; })
        .then(function () { btn.disabled = false; });
    }
    btn.addEventListener('click', function () { suggest(false); });
    var api = window.HTGCats = { suggest: suggest, chosen: chosen, subjects: [] };
    // from the list of books to check: "Suggest categories" opens the book and asks right away
    if (/[?&]suggest=1\b/.test(location.search) && !order.length) suggest(false);
  })();
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
        info.textContent = 'Ready: ' + f.name + ' (' + Math.max(1, Math.round(f.size / 1024)).toLocaleString() + ' KB). Press Import.';
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

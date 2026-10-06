'use strict';
const { html, raw, selected, checked } = require('../lib/html');
const P = require('./parts');
const t = require('../lib/time');
const { fullName } = require('../models');
const { DAY_NAMES } = require('../settings');

const isLib = (u) => u.role === 'librarian';

function shell({ user, current, pending = 0, body, title }) {
  const items = [
    ['/admin', 'Today', 'home'],
    ['/admin/checkouts', 'Pickups & checkouts', 'checkouts'],
    ['/admin/books', 'Books', 'books'],
    ['/admin/patrons', 'Patrons', 'patrons'],
  ];
  if (isLib(user)) {
    items.splice(3, 0, ['/admin/applications', 'Applications', 'applications']);
    items.push(['/admin/staff', 'Staff', 'staff'], ['/admin/settings', 'Settings', 'settings']);
  }
  return html`<div class="admin">
    <nav class="admin-nav" aria-label="Librarian">
      <p class="admin-role">${user.role === 'librarian' ? 'Librarian' : 'Assistant'}</p>
      ${items.map(([href, label, key]) => html`<a href="${href}"${current === key ? raw(' aria-current="page"') : ''}>${label}${key === 'applications' && pending ? html` <span class="count">${pending}</span>` : ''}</a>`)}
    </nav>
    <div class="admin-main">${title ? html`<h1>${title}</h1>` : ''}${body}</div>
  </div>`;
}

const btnForm = (action, csrf, label, { cls = 'btn-small', confirm } = {}) =>
  html`<form method="post" action="${action}" class="inline"${confirm ? html` data-confirm="${confirm}"` : ''}>${P.csrfField(csrf)}<button class="btn ${cls}" type="submit">${label}</button></form>`;

function coRow(c, csrf, { now = new Date(), showPickup = false } = {}) {
  const st = P.checkoutState(c, now);
  const daysOut = c.picked_up_at ? t.daysBetween(new Date(c.picked_up_at), now) : null;
  return html`<tr>
    <td><a href="/admin/books/${c.book_id}/edit">${c.title}</a>${c.shelf_location ? html`<br><span class="small muted">Shelf ${c.shelf_location}</span>` : ''}</td>
    <td><a href="/admin/patrons/${c.user_id}">${c.first_name} ${c.last_name}</a><br><span class="small muted">${c.library_code || ''}${c.phone ? ` · ${c.phone}` : ''}</span></td>
    ${showPickup ? html`<td>${t.fmtTime(c.pickup_at)}</td>` : html`<td>${c.status === 'checked_out' ? html`${t.fmtDate(c.picked_up_at)}<br><span class="small muted">${daysOut} day${daysOut === 1 ? '' : 's'} out</span>` : c.status === 'reserved' ? t.fmtDateTime(c.pickup_at) : t.fmtDate(c.returned_at || c.cancelled_at)}</td>`}
    <td>${c.due_at && c.status === 'checked_out' ? t.fmtDate(c.due_at) : ''} <span class="badge badge-${st.cls}">${st.label}</span></td>
    <td class="actions">
      ${c.status === 'reserved' ? html`${btnForm(`/admin/checkouts/${c.id}/pickup`, csrf, 'Picked up')} ${btnForm(`/admin/checkouts/${c.id}/cancel`, csrf, 'Cancel hold', { cls: 'btn-quiet btn-small', confirm: `Cancel ${c.first_name}'s hold on “${c.title}”? They'll get an email.` })}` : ''}
      ${c.status === 'checked_out' ? html`${btnForm(`/admin/checkouts/${c.id}/return`, csrf, 'Returned')} ${btnForm(`/admin/checkouts/${c.id}/extend`, csrf, 'Extend', { cls: 'btn-quiet btn-small' })}` : ''}
    </td>
  </tr>`;
}

const coTable = (rows, csrf, opts = {}) => html`<div class="table-wrap"><table class="table">
  <thead><tr><th>Book</th><th>Patron</th><th>${opts.showPickup ? 'Time' : opts.history ? 'Date' : 'Picked up'}</th><th>Status</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
  <tbody>${rows.map((c) => coRow(c, csrf, opts))}</tbody></table></div>`;

function home({ user, csrf, todays, overdue, pending, counts, s, now }) {
  return html`
  <p class="muted">${t.fmtLong(now)}</p>
  <div class="quick">
    <a class="btn" href="/admin/books/new">Add a book</a>
    <a class="btn btn-quiet" href="/admin/checkouts/new">Check out at the desk</a>
    ${isLib(user) && pending ? html`<a class="btn btn-quiet" href="/admin/applications">${pending} application${pending > 1 ? 's' : ''} to review</a>` : ''}
  </div>
  <section class="admin-section">
    <h2>Today's pickups</h2>
    ${todays.length ? coTable(todays, csrf, { showPickup: true, now }) : html`<p class="muted">No pickups scheduled today.</p>`}
  </section>
  <section class="admin-section">
    <h2>Overdue</h2>
    ${overdue.length ? coTable(overdue, csrf, { now }) : html`<p class="muted">Nothing is overdue.</p>`}
  </section>
  <p class="muted small">${counts.books} titles (${counts.copies} copies) · ${counts.out} checked out · ${counts.holds} on hold · ${counts.patrons} approved patrons · Checkout length ${s.checkout_days} days</p>`;
}

function checkoutsPage({ view, rows, csrf, now }) {
  const tabs = [['pickups', 'Waiting for pickup'], ['out', 'Checked out'], ['history', 'History']];
  let body;
  if (view === 'pickups') {
    const byDay = new Map();
    for (const c of rows) {
      const k = t.dateKey(new Date(c.pickup_at));
      (byDay.get(k) || byDay.set(k, []).get(k)).push(c);
    }
    body = rows.length ? [...byDay.values()].map((list) => html`<section class="admin-section"><h2>${t.fmtLong(list[0].pickup_at)}</h2>${coTable(list, csrf, { showPickup: true, now })}</section>`)
      : html`<p class="muted">No books are waiting for pickup.</p>`;
  } else if (view === 'out') {
    body = rows.length ? coTable(rows, csrf, { now }) : html`<p class="muted">No books are checked out.</p>`;
  } else {
    body = rows.length ? coTable(rows, csrf, { now, history: true }) : html`<p class="muted">No history yet.</p>`;
  }
  return html`
  <div class="quick"><a class="btn" href="/admin/checkouts/new">Check out at the desk</a></div>
  <nav class="tabs" aria-label="Checkout views">${tabs.map(([k, label]) => html`<a href="/admin/checkouts?view=${k}"${view === k ? raw(' aria-current="page"') : ''}>${label}</a>`)}</nav>
  ${body}`;
}

function deskCheckout({ csrf, books, error, values = {} }) {
  return html`
  <p>For someone checking out in person. The due date starts today.</p>
  ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
  <form method="post" action="/admin/checkouts/new" class="stack narrow-form">
    ${P.csrfField(csrf)}
    <div class="field"><label for="dc-patron">Patron's library code or email</label><input id="dc-patron" name="patron" required value="${values.patron || ''}" placeholder="CBC-1234"></div>
    <div class="field"><label for="dc-book">Book</label>
      <input id="dc-book" name="book" list="dc-books" required value="${values.book || ''}" placeholder="Start typing a title">
      <datalist id="dc-books">${books.map((b) => html`<option value="#${b.id} ${b.title}${b.author ? ' by ' + b.author : ''}">${b.available > 0 ? `${b.available} available` : 'checked out'}</option>`)}</datalist>
      <p class="hint">Pick from the list so the right book is used.</p></div>
    <button class="btn" type="submit">Check out</button>
  </form>`;
}

function coverCard(st, csrf) {
  if (!st || !st.total) return '';
  const missing = st.total - st.with_cover;
  const mb = (st.bytes / 1048576).toFixed(0);
  return html`<div class="card cover-card" data-cover-status${st.running ? raw(' data-running') : ''}>
    <div>
      <h2>Covers</h2>
      <p class="small"><strong data-cv="with">${st.with_cover.toLocaleString()}</strong> of ${st.total.toLocaleString()} books have a cover${st.pending ? html` · <span data-cv="pending">${st.pending.toLocaleString()}</span> being looked up now` : ''}${st.failed ? html` · ${st.failed} not found` : ''} · ${mb} MB</p>
      ${st.running ? html`<p class="small muted" data-cv="last">${st.lastTitle ? `Working on “${st.lastTitle}”` : 'Starting…'}</p>` : ''}
    </div>
    <div class="actions">
      ${missing && !st.pending ? html`<form method="post" action="/admin/covers/find-missing" class="inline">${P.csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">Find missing covers</button></form>` : ''}
      ${missing ? html`<a class="btn btn-quiet btn-small" href="/admin/books?nocover=1">Show books without a cover</a>` : ''}
    </div>
  </div>`;
}

function sortHead(label, key, sort, sortBase) {
  const active = sort === key || sort === `${key}_desc`;
  const next = sort === key ? `${key}_desc` : key;
  const sep = sortBase.includes('?') && !sortBase.endsWith('?') ? '&' : '';
  const arrow = !active ? '' : sort.endsWith('_desc') ? ' ▼' : ' ▲';
  return html`<th aria-sort="${!active ? 'none' : sort.endsWith('_desc') ? 'descending' : 'ascending'}"><a class="sort-link${active ? ' is-active' : ''}" href="${sortBase}${sep}sort=${next}">${label}${arrow}</a></th>`;
}

function booksPage({ rows, q, total, page, pages, base, categories, category, coverStatus, csrf, noCover, sort = 'title', sortBase = '/admin/books?', sorts = [] }) {
  return html`
  <div class="quick">
    <a class="btn" href="/admin/books/new">Add a book</a>
    <a class="btn btn-quiet" href="/admin/books/import">Import a list</a>
    <a class="btn btn-quiet" href="/admin/books/export.csv">Download the catalog</a>
  </div>
  ${coverCard(coverStatus, csrf)}
  <form class="filters" method="get" action="/admin/books">
    <div class="field grow suggest-wrap"><label for="ab-q">Search title, writer, SKU or ISBN</label><input id="ab-q" type="search" name="q" value="${q || ''}" autocomplete="off" data-suggest="admin" placeholder="Start typing…"></div>
    <div class="field"><label for="ab-cat">Category</label><select id="ab-cat" name="category"><option value="">All categories</option>${categories.map((c) => html`<option${selected(c.category, category)}>${c.category}</option>`)}</select></div>
    <div class="field"><label for="ab-sort">Sort by</label><select id="ab-sort" name="sort" data-autosubmit>${sorts.map(([k, label]) => html`<option value="${k}"${selected(k, sort)}>${label}</option>`)}</select></div>
    <label class="check"><input type="checkbox" name="nocover" value="1"${checked(noCover)}> No cover yet</label>
    <button class="btn btn-quiet" type="submit">Search</button>
  </form>
  <p class="muted small">${total} title${total === 1 ? '' : 's'}</p>
  ${rows.length ? html`<div class="table-wrap"><table class="table books-table">
    <thead><tr>${sortHead('Title', 'title', sort, sortBase)}${sortHead('SKU', 'sku', sort, sortBase)}${sortHead('Stock', 'stock', sort, sortBase)}${sortHead('Writer', 'writer', sort, sortBase)}${sortHead('Categories', 'category', sort, sortBase)}</tr></thead>
    <tbody>${rows.map((b) => html`<tr${b.active ? '' : raw(' class="inactive"')}>
      <td class="with-cover">${P.cover(b, 'xs')}<span><a href="/admin/books/${b.id}/edit">${b.title}</a>${b.active ? '' : html` <span class="badge badge-muted">Hidden</span>`}<br><span class="small muted">${b.format || ''}</span></span></td>
      <td>${b.call_number || html`<span class="muted">–</span>`}</td>
      <td>${b.available > 0 ? html`<span class="avail avail-yes">In stock (${b.available})</span>` : html`<span class="avail avail-no">Checked out</span>`}</td>
      <td>${b.author || ''}</td>
      <td>${[b.category, b.subcategory].filter(Boolean).join(' › ') || html`<span class="muted">Uncategorized</span>`}</td>
    </tr>`)}</tbody></table></div>`
    : html`<div class="empty"><p>${q ? 'No books match that search.' : 'The catalog is empty.'}</p><p><a class="btn" href="/admin/books/new">Add the first book</a></p></div>`}
  ${P.pager({ page, pages, base })}`;
}

const FORMATS = ['Book', 'Paperback', 'Hardback', 'Board Book', 'Large Print', 'Workbook', 'Audiobook', 'CD', 'DVD', 'Blu-ray', 'Pamphlet', 'Other'];
const VIDEO = 'DVD,Blu-ray';
const AUDIO = 'CD,Audiobook';

// Detail fields stored with each book (the old system's "attributes").
const DETAIL_FIELDS = [
  { key: 'Illustrator', name: 'detail_illustrator' },
  { key: 'Reading Level', name: 'detail_reading_level', hint: 'e.g. Age 7-10 or Grades 3-5' },
  { key: 'Book read by', name: 'detail_read_by', showFor: AUDIO },
  { key: 'Rated', name: 'detail_rated', showFor: VIDEO, hint: 'e.g. G, PG, Not Rated' },
  { key: 'Running Time', name: 'detail_running_time', showFor: VIDEO, hint: 'e.g. 88 minutes' },
];

// Turn "Christian Fiction" + "Historical Fiction › WW II" rows into a nested tree.
function categoryTree(paths) {
  const root = { children: new Map() };
  for (const { category, subcategory, n } of paths) {
    if (!category) continue;
    const parts = [category, ...(subcategory ? subcategory.split(' › ') : [])];
    let node = root;
    let path = '';
    for (const part of parts) {
      path = path ? `${path} › ${part}` : part;
      if (!node.children.has(part)) node.children.set(part, { name: part, path, n: 0, children: new Map() });
      node = node.children.get(part);
      node.n += n;
    }
  }
  return root;
}

function treeList(node, current, depth = 0) {
  const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!kids.length) return '';
  return html`<ul${depth ? '' : raw(' class="cat-tree"')}>${kids.map((k) => html`<li>
    <label class="check"><input type="radio" name="category_path" value="${k.path}"${checked(current === k.path)}> <span>${k.name}</span> <span class="muted small">${k.n}</span></label>
    ${treeList(k, current, depth + 1)}
  </li>`)}</ul>`;
}

function bookForm({ csrf, book = {}, errors = {}, categoryPaths = [], history = [], isNew }) {
  const formats = book.format && !FORMATS.includes(book.format) ? [...FORMATS, book.format] : FORMATS;
  const details = book.details || {};
  const currentPath = [book.category, book.subcategory].filter(Boolean).join(' › ');
  const paths = categoryPaths.some((p) => [p.category, p.subcategory].filter(Boolean).join(' › ') === currentPath) || !book.category
    ? categoryPaths
    : [...categoryPaths, { category: book.category, subcategory: book.subcategory, n: 0 }];
  const tree = categoryTree(paths);
  const allPaths = [];
  (function walk(n) { for (const k of n.children.values()) { allPaths.push(k.path); walk(k); } })(tree);
  allPaths.sort();

  const val = (name) => book[name] ?? '';
  const f = (name, label, opts = {}) => html`<div class="field${opts.cls ? ' ' + opts.cls : ''}"${opts.showFor ? raw(` data-show-for="${opts.showFor}"`) : ''}>
    <label for="b-${name}">${label}</label>
    <input id="b-${name}" name="${name}" type="${opts.type || 'text'}" value="${opts.value ?? val(name)}"${opts.req ? raw(' required') : ''}${opts.min != null ? raw(` min="${opts.min}"`) : ''}${opts.inputmode ? raw(` inputmode="${opts.inputmode}"`) : ''}${opts.placeholder ? html` placeholder="${opts.placeholder}"` : ''}>
    ${errors[name] ? html`<p class="error">${errors[name]}</p>` : ''}${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ''}</div>`;

  return html`
  <form method="post" action="${isNew ? '/admin/books' : `/admin/books/${book.id}`}" class="book-form wp-layout" id="book-form">
    ${P.csrfField(csrf)}
    <div class="wp-main">
      <div class="field title-field">
        <label for="b-title">Title</label>
        <input id="b-title" name="title" value="${val('title')}" required placeholder="Book title" class="input-title">
        ${errors.title ? html`<p class="error">${errors.title}</p>` : ''}
      </div>
      ${f('subtitle', 'Subtitle')}

      <div class="field">
        <label for="b-short">Short description</label>
        <textarea id="b-short" name="short_description" rows="2" placeholder="One line shown under the title, e.g. A Tale of Forgiveness and Grace">${val('short_description')}</textarea>
      </div>
      <div class="field">
        <label for="b-description">Description</label>
        <textarea id="b-description" name="description" rows="9">${val('description')}</textarea>
      </div>

      <section class="box">
        <h2 class="box-head">Book data</h2>
        <div class="box-body">
          <h3 class="box-sub">Inventory</h3>
          <div class="row">
            ${f('call_number', 'SKU (library no.)', { hint: 'The number on the book’s label, e.g. 6871 or DVD78.' })}
            ${f('copies_total', 'Stock (copies)', { type: 'number', min: 0, req: true, cls: 'short' })}
            ${f('shelf_location', 'Shelf location', { hint: 'Optional, e.g. B-3' })}
          </div>
          <div class="isbn-row">
            ${f('isbn', 'ISBN', { inputmode: 'numeric', hint: 'On the back cover above the barcode. Press the button to fill in the rest.' })}
            <button type="button" class="btn btn-quiet" id="isbn-lookup">Fill in from ISBN</button>
          </div>
          <p class="small muted" id="isbn-status" role="status"></p>

          <h3 class="box-sub">Attributes</h3>
          <div class="row">
            ${f('author', 'Writer', { hint: 'Separate several with commas.' })}
            <div class="field short"><label for="b-format">Format</label><select id="b-format" name="format">${formats.map((a) => html`<option${selected(a, book.format || 'Paperback')}>${a}</option>`)}</select></div>
          </div>
          <div class="row">
            ${f('publisher', 'Publisher')}
            ${f('published_year', 'Publication date', { type: 'number', cls: 'short', placeholder: 'Year' })}
            ${f('pages', 'Pages', { type: 'number', cls: 'short' })}
          </div>
          <div class="row">
            ${f('series', 'Series')}
            ${DETAIL_FIELDS.map((d) => f(d.name, d.key, { value: details[d.key] || '', hint: d.hint, showFor: d.showFor }))}
          </div>
        </div>
      </section>

      ${!isNew ? html`<section class="box">
        <h2 class="box-head">Recent checkouts</h2>
        <div class="box-body">${history.length ? coTable(history, csrf, { history: true }) : html`<p class="muted">This book hasn't been checked out yet.</p>`}</div>
      </section>` : ''}
    </div>

    <aside class="wp-side">
      <section class="box">
        <h2 class="box-head">Publish</h2>
        <div class="box-body stack">
          <input type="hidden" name="active_present" value="1">
          <label class="check"><input type="checkbox" name="active" value="1"${checked(isNew || book.active !== false)}> Show in the catalog</label>
          ${!isNew ? html`<p class="small muted">${book.out_count ? `${book.out_count} of ${book.copies_total} out right now.` : 'All copies are in.'}${book.legacy_id ? ` Old system ID ${book.legacy_id}.` : ''}</p>` : ''}
          <button class="btn" type="submit">${isNew ? 'Add book' : 'Update'}</button>
          ${isNew ? html`<button class="btn btn-quiet" type="submit" name="and_new" value="1">Add and start another</button>` : html`<a class="btn btn-quiet" href="/books/${book.id}" target="_blank" rel="noopener">View in catalog</a>`}
          <a class="small" href="/admin/books">Back to all books</a>
        </div>
      </section>

      <section class="box">
        <h2 class="box-head">Categories</h2>
        <div class="box-body">
          <input type="search" class="cat-filter" id="cat-filter" placeholder="Search categories" aria-label="Search categories">
          <div class="cat-scroll" id="cat-scroll">
            <label class="check"><input type="radio" name="category_path" value=""${checked(!currentPath)}> <span>Uncategorized</span></label>
            ${treeList(tree, currentPath)}
          </div>
          <details class="add-cat"${errors.category ? raw(' open') : ''}>
            <summary>+ Add new category</summary>
            <div class="stack">
              <div class="field"><label for="b-newcat">Name</label><input id="b-newcat" name="new_category_name"></div>
              <div class="field"><label for="b-newparent">Parent category</label>
                <select id="b-newparent" name="new_category_parent"><option value="">— None (top level) —</option>${allPaths.map((p) => html`<option>${p}</option>`)}</select></div>
              <p class="hint">The new category is used for this book when you save.</p>
            </div>
          </details>
        </div>
      </section>

      <section class="box">
        <h2 class="box-head">Who it's for</h2>
        <div class="box-body audience-choices">
          ${['Everyone', 'Adults', 'Youth', 'Children'].map((a) => html`<label class="check"><input type="radio" name="audience" value="${a}"${checked((book.audience || 'Adults') === a)}> ${a === 'Youth' ? 'Teens (Central Teens)' : a === 'Children' ? 'Children (Central Kids)' : a}</label>`)}
        </div>
      </section>

      <section class="box">
        <h2 class="box-head">Cover image</h2>
        <div class="box-body stack">
          <div class="cover-preview" id="cover-preview">${book.id ? P.cover(book, 'lg') : html`<div class="cover cover-lg cover-empty">No cover yet</div>`}</div>
          <label class="btn btn-quiet file-btn" for="cover-file">${book.has_cover ? 'Replace cover image' : 'Set cover image'}</label>
          <input type="file" id="cover-file" accept="image/*" capture="environment" class="visually-hidden">
          <p class="hint">Take a picture with your phone, or choose an image.</p>
          <input type="hidden" name="cover_data" id="cover-data">
          <input type="hidden" name="cover_url" id="cover-url">
          ${book.has_cover ? html`<label class="check small"><input type="checkbox" name="remove_cover" value="1"> Remove cover image</label>` : ''}
          ${!isNew && book.cover_status === 'pending' ? html`<p class="small muted">Looking for a cover…</p>` : ''}
          ${!isNew && book.cover_note ? html`<p class="small muted">${book.cover_note}</p>` : ''}
          ${!isNew && !book.has_cover ? html`<button class="btn btn-quiet btn-small" type="submit" formaction="/admin/books/${book.id}/find-cover" formnovalidate>Find a cover online</button>` : ''}
        </div>
      </section>

      <section class="box">
        <h2 class="box-head">Tags</h2>
        <div class="box-body">
          <div class="field"><label class="visually-hidden" for="b-tags">Tags</label><input id="b-tags" name="tags" value="${val('tags')}">
          <p class="hint">Separate with commas, e.g. grief, comfort, widows. Tags help people find the book with the Ask bar.</p></div>
        </div>
      </section>

      ${!isNew ? html`<section class="box danger-box">
        <h2 class="box-head">Remove</h2>
        <div class="box-body"><p class="small">Books with checkout history are archived instead of deleted.</p>
          <button class="btn btn-danger btn-small" type="submit" formaction="/admin/books/${book.id}/delete" formnovalidate data-confirm-click="Remove “${book.title}” from the library?">Move to trash</button></div>
      </section>` : ''}
    </aside>
  </form>`;
}

function importPage({ csrf, result }) {
  return html`
  <p>Add many books at once from a spreadsheet saved as <strong>CSV</strong> (in Excel or Google Sheets: File › Download › CSV).</p>
  <ul class="small">
    <li><strong>The old library system's export</strong> (the WooCommerce “product export” file) works as-is. Books are matched by their old ID, so importing the same file again updates them instead of adding duplicates. Cover photos are copied from the old site automatically.</li>
    <li>For a simple list, <a href="/admin/books/template.csv" download>download the template</a>. Only <em>title</em> is required. Columns: title, subtitle, author, isbn, category, audience, format, description, tags, publisher, year, pages, copies, shelf.</li>
  </ul>
  ${result ? html`<div class="card card-note" role="status">
    <h2>Import finished</h2>
    <p>${result.added.toLocaleString()} book${result.added === 1 ? '' : 's'} added${result.updated ? `, ${result.updated.toLocaleString()} updated` : ''}${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.</p>
    ${result.coversQueued ? html`<p>Covers are being copied for ${result.coversQueued.toLocaleString()} books in the background. The Books page shows the progress. This takes roughly half an hour for a few thousand books.</p>` : ''}
    ${result.skipped.length ? html`<ul class="small">${result.skipped.slice(0, 50).map((x) => html`<li>Row ${x.row}: ${x.reason}</li>`)}</ul>` : ''}
    <p><a href="/admin/books">See the books</a></p>
  </div>` : ''}
  <form method="post" action="/admin/books/import" class="stack" id="import-form">
    ${P.csrfField(csrf)}
    <div class="field"><label for="csv-file">CSV file</label><input type="file" id="csv-file" accept=".csv,text/csv"><p class="hint" id="csv-info"></p></div>
    <div class="field" id="csv-paste"><label for="csv-text">Or paste the rows here</label><textarea id="csv-text" name="csv" rows="8" required placeholder="title,author,category,copies"></textarea></div>
    <label class="check"><input type="checkbox" name="skip_duplicates" value="1" checked> For simple lists, skip books already in the catalog (same ISBN, or same title and author)</label>
    <button class="btn" type="submit">Import books</button>
  </form>`;
}

function applicationsPage({ csrf, pending, recent, s }) {
  return html`
  <form method="post" action="/admin/settings/auto-approve" class="toggle-card card">
    ${P.csrfField(csrf)}
    <div>
      <h2>Automatic approval is ${s.auto_approve ? 'on' : 'off'}</h2>
      <p class="small">${s.auto_approve ? 'New applicants are approved right away and get their library code immediately.' : 'You review each application before the person can check out books.'}</p>
    </div>
    <input type="hidden" name="auto_approve" value="${s.auto_approve ? '0' : '1'}">
    <button class="btn ${s.auto_approve ? 'btn-quiet' : ''}" type="submit">${s.auto_approve ? 'Turn off automatic approval' : 'Turn on automatic approval'}</button>
  </form>
  <section class="admin-section">
    <h2>Waiting for review</h2>
    ${pending.length ? html`<ul class="app-list">${pending.map((u) => html`<li class="card">
      <div class="app-head"><h3>${fullName(u)}</h3><span class="small muted">Applied ${t.fmtDateTime(u.created_at)}</span></div>
      <dl class="facts compact">
        <dt>Email</dt><dd><a href="mailto:${u.email}">${u.email}</a></dd>
        ${u.phone ? html`<dt>Phone</dt><dd>${u.phone}</dd>` : ''}
        ${u.address ? html`<dt>Address</dt><dd>${u.address}${u.city ? `, ${u.city}` : ''}${u.state ? ` ${u.state}` : ''} ${u.zip || ''}</dd>` : ''}
        ${u.about ? html`<dt>Note</dt><dd>${u.about}</dd>` : ''}
      </dl>
      <div class="actions">
        ${btnForm(`/admin/applications/${u.id}/approve`, csrf, 'Approve', { cls: '' })}
        ${btnForm(`/admin/applications/${u.id}/deny`, csrf, 'Deny', { cls: 'btn-quiet', confirm: `Deny ${fullName(u)}'s application? They'll get a polite email.` })}
      </div>
    </li>`)}</ul>` : html`<p class="muted">No applications are waiting.</p>`}
  </section>
  ${recent.length ? html`<section class="admin-section"><h2>Recently decided</h2>
    <ul class="line-list compact">${recent.map((u) => html`<li><a class="grow" href="/admin/patrons/${u.id}">${fullName(u)}</a>${P.statusBadge(u.status)}</li>`)}</ul></section>` : ''}`;
}

function patronsPage({ rows, q, status, counts }) {
  const tabs = [['', 'All'], ['approved', 'Approved'], ['pending', 'Waiting'], ['paused', 'Paused'], ['denied', 'Denied']];
  return html`
  <form class="filters" method="get" action="/admin/patrons">
    <div class="field grow"><label for="ap-q">Search name, email, phone or library code</label><input id="ap-q" type="search" name="q" value="${q || ''}"></div>
    <input type="hidden" name="status" value="${status || ''}">
    <button class="btn btn-quiet" type="submit">Search</button>
  </form>
  <nav class="tabs" aria-label="Patron status">${tabs.map(([k, label]) => html`<a href="/admin/patrons?status=${k}${q ? `&q=${encodeURIComponent(q)}` : ''}"${(status || '') === k ? raw(' aria-current="page"') : ''}>${label}${counts[k || 'all'] != null ? html` <span class="count">${counts[k || 'all']}</span>` : ''}</a>`)}</nav>
  ${rows.length ? html`<div class="table-wrap"><table class="table">
    <thead><tr><th>Name</th><th>Library code</th><th>Contact</th><th>Status</th><th>Books out</th></tr></thead>
    <tbody>${rows.map((u) => html`<tr>
      <td><a href="/admin/patrons/${u.id}">${fullName(u)}</a>${u.role !== 'patron' ? html` <span class="badge badge-info">${P.roleLabel(u.role)}</span>` : ''}</td>
      <td>${u.library_code || ''}</td>
      <td>${u.email}${u.phone ? html`<br><span class="small muted">${u.phone}</span>` : ''}</td>
      <td>${P.statusBadge(u.status)}</td>
      <td>${u.active_count || ''}</td>
    </tr>`)}</tbody></table></div>` : html`<p class="muted">No patrons match.</p>`}`;
}

function patronPage({ user, patron, items, csrf, tempPassword, now }) {
  const lib = isLib(user);
  const active = items.filter((c) => c.status === 'reserved' || c.status === 'checked_out');
  const past = items.filter((c) => c.status === 'returned' || c.status === 'cancelled');
  return html`
  <p class="crumb"><a href="/admin/patrons">Patrons</a></p>
  <div class="page-head split">
    <div><h1>${fullName(patron)}</h1><p>${P.statusBadge(patron.status)} ${patron.role !== 'patron' ? html`<span class="badge badge-info">${P.roleLabel(patron.role)}</span>` : ''}</p></div>
    ${patron.library_code ? html`<div class="code-card"><span>Library code</span><strong>${patron.library_code}</strong></div>` : ''}
  </div>
  ${tempPassword ? html`<div class="card card-note" role="status"><h2>Temporary password</h2><p>Give ${patron.first_name} this password: <strong class="code-big">${tempPassword}</strong></p><p class="small">They can change it on their My Library page. This is the only time it's shown.</p></div>` : ''}
  ${lib ? html`<div class="quick">
    ${patron.status === 'pending' || patron.status === 'denied' ? btnForm(`/admin/applications/${patron.id}/approve`, csrf, 'Approve', { cls: '' }) : ''}
    ${patron.status === 'approved' && patron.id !== user.id ? btnForm(`/admin/patrons/${patron.id}/pause`, csrf, 'Pause account', { cls: 'btn-quiet', confirm: `Pause ${patron.first_name}'s account? They won't be able to check out books until you resume it.` }) : ''}
    ${patron.status === 'paused' ? btnForm(`/admin/patrons/${patron.id}/resume`, csrf, 'Resume account', { cls: '' }) : ''}
    ${btnForm(`/admin/patrons/${patron.id}/reset-password`, csrf, 'Make a temporary password', { cls: 'btn-quiet', confirm: `Replace ${patron.first_name}'s password with a temporary one?` })}
  </div>` : ''}
  <div class="two-col">
    <section class="card">
      <h2>Details</h2>
      ${lib ? html`<form method="post" action="/admin/patrons/${patron.id}" class="stack">
        ${P.csrfField(csrf)}
        <div class="row"><div class="field"><label for="pp-first">First name</label><input id="pp-first" name="first_name" value="${patron.first_name}" required></div>
        <div class="field"><label for="pp-last">Last name</label><input id="pp-last" name="last_name" value="${patron.last_name}" required></div></div>
        <div class="field"><label for="pp-email">Email</label><input id="pp-email" name="email" type="email" value="${patron.email}" required></div>
        <div class="field"><label for="pp-phone">Phone</label><input id="pp-phone" name="phone" value="${patron.phone || ''}"></div>
        <div class="field"><label for="pp-address">Address</label><input id="pp-address" name="address" value="${patron.address || ''}"></div>
        <div class="row"><div class="field"><label for="pp-city">City</label><input id="pp-city" name="city" value="${patron.city || ''}"></div>
        <div class="field short"><label for="pp-state">State</label><input id="pp-state" name="state" value="${patron.state || ''}"></div>
        <div class="field short"><label for="pp-zip">ZIP</label><input id="pp-zip" name="zip" value="${patron.zip || ''}"></div></div>
        <button class="btn btn-quiet btn-small" type="submit">Save details</button>
      </form>` : html`<dl class="facts compact">
        <dt>Email</dt><dd>${patron.email}</dd>${patron.phone ? html`<dt>Phone</dt><dd>${patron.phone}</dd>` : ''}
        ${patron.address ? html`<dt>Address</dt><dd>${patron.address} ${patron.city || ''} ${patron.state || ''} ${patron.zip || ''}</dd>` : ''}</dl>`}
      <dl class="facts compact">
        <dt>Applied</dt><dd>${t.fmtDateYear(patron.created_at)}</dd>
        ${patron.approved_at ? html`<dt>Approved</dt><dd>${t.fmtDateYear(patron.approved_at)}</dd>` : ''}
        ${patron.last_login_at ? html`<dt>Last visit</dt><dd>${t.fmtDateYear(patron.last_login_at)}</dd>` : ''}
        ${patron.about ? html`<dt>Note</dt><dd>${patron.about}</dd>` : ''}
      </dl>
    </section>
    <section>
      <h2>Current books</h2>
      ${active.length ? coTable(active, csrf, { now }) : html`<p class="muted">No books on hold or checked out.</p>`}
      ${past.length ? html`<details><summary>History (${past.length})</summary>${coTable(past, csrf, { now, history: true })}</details>` : ''}
    </section>
  </div>
  ${lib && patron.id !== user.id ? html`<section class="admin-section danger-zone">
    <h2>Delete account</h2>
    <p class="small">Deletes ${patron.first_name}'s account and borrowing history. ${active.length ? 'Check in or cancel their current books first.' : 'This can’t be undone.'}</p>
    ${active.length ? '' : btnForm(`/admin/patrons/${patron.id}/delete`, csrf, 'Delete account', { cls: 'btn-danger btn-small', confirm: `Permanently delete ${fullName(patron)}'s account? This can't be undone.` })}
  </section>` : ''}`;
}

function staffPage({ csrf, staff, user, tempPassword, created }) {
  return html`
  <p>Assistants can add and edit books and handle pickups, checkouts and returns. They can't approve applications, pause or delete accounts, or change settings.</p>
  ${tempPassword ? html`<div class="card card-note" role="status"><h2>Account created</h2><p>${created}'s temporary password is <strong class="code-big">${tempPassword}</strong></p><p class="small">Give it to them in person. They can change it on their My Library page. This is the only time it's shown.</p></div>` : ''}
  <div class="table-wrap"><table class="table">
    <thead><tr><th>Name</th><th>Role</th><th>Email</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
    <tbody>${staff.map((u) => html`<tr>
      <td><a href="/admin/patrons/${u.id}">${fullName(u)}</a></td><td>${P.roleLabel(u.role)}</td><td>${u.email}</td>
      <td class="actions">${u.id !== user.id ? btnForm(`/admin/staff/${u.id}/remove`, csrf, u.role === 'librarian' ? 'Remove librarian access' : 'Remove assistant', { cls: 'btn-quiet btn-small', confirm: `Remove ${u.first_name}'s staff access? Their library account stays.` }) : html`<span class="small muted">You</span>`}</td>
    </tr>`)}</tbody></table></div>
  <div class="two-col">
    <section class="card">
      <h2>Give an existing patron staff access</h2>
      <form method="post" action="/admin/staff/promote" class="stack">
        ${P.csrfField(csrf)}
        <div class="field"><label for="st-who">Their email or library code</label><input id="st-who" name="who" required></div>
        <div class="field"><label for="st-role">Role</label><select id="st-role" name="role"><option value="assistant">Assistant</option><option value="librarian">Librarian (full access)</option></select></div>
        <button class="btn btn-small" type="submit">Give access</button>
      </form>
    </section>
    <section class="card">
      <h2>Create a new staff account</h2>
      <form method="post" action="/admin/staff/create" class="stack">
        ${P.csrfField(csrf)}
        <div class="row"><div class="field"><label for="sc-first">First name</label><input id="sc-first" name="first_name" required></div>
        <div class="field"><label for="sc-last">Last name</label><input id="sc-last" name="last_name" required></div></div>
        <div class="field"><label for="sc-email">Email</label><input id="sc-email" name="email" type="email" required></div>
        <div class="field"><label for="sc-role">Role</label><select id="sc-role" name="role"><option value="assistant">Assistant</option><option value="librarian">Librarian (full access)</option></select></div>
        <button class="btn btn-small" type="submit">Create account</button>
      </form>
    </section>
  </div>`;
}

function settingsPage({ csrf, s, mailOn, pushOn }) {
  const num = (name, label, hint, min = 1, max = 365) => html`<div class="field short"><label for="s-${name}">${label}</label><input id="s-${name}" name="${name}" type="number" min="${min}" max="${max}" value="${s[name]}" required>${hint ? html`<p class="hint">${hint}</p>` : ''}</div>`;
  const text = (name, label, hint) => html`<div class="field"><label for="s-${name}">${label}</label><input id="s-${name}" name="${name}" value="${s[name] || ''}">${hint ? html`<p class="hint">${hint}</p>` : ''}</div>`;
  return html`
  <form method="post" action="/admin/settings" class="settings-form">
    ${P.csrfField(csrf)}
    <fieldset class="card"><legend>Borrowing</legend>
      <div class="row">
        ${num('checkout_days', 'Checkout length (days)', 'Counted from pickup.')}
        ${num('max_books', 'Books per patron', 'Holds plus checked-out books.', 1, 50)}
        ${num('max_extensions', 'Extensions allowed', 'Per checkout.', 0, 10)}
        ${num('missed_pickup_days', 'Missed pickup grace (days)', 'Shown in the hold email.', 1, 30)}
      </div>
      <label class="check"><input type="checkbox" name="auto_approve" value="1"${checked(s.auto_approve)}> Approve new applications automatically</label>
    </fieldset>
    <fieldset class="card"><legend>Pickup hours</legend>
      <div class="day-checks">${[1, 2, 3, 4, 5, 6, 7].map((d) => html`<label class="check"><input type="checkbox" name="pickup_days[]" value="${d}"${checked(s.pickup_days.map(Number).includes(d))}> ${DAY_NAMES[d]}</label>`)}</div>
      <div class="row">
        <div class="field short"><label for="s-start">Opens</label><input id="s-start" name="pickup_start" type="time" value="${s.pickup_start}" required></div>
        <div class="field short"><label for="s-end">Closes</label><input id="s-end" name="pickup_end" type="time" value="${s.pickup_end}" required></div>
        ${num('slot_minutes', 'Minutes per pickup slot', null, 5, 120)}
        ${num('slot_capacity', 'People per slot', null, 1, 20)}
      </div>
      <div class="row">
        ${num('booking_window_days', 'Book up to (days ahead)', null, 1, 90)}
        ${num('min_lead_minutes', 'Earliest booking (minutes from now)', null, 0, 2880)}
      </div>
      <div class="field"><label for="s-closed">Closed dates</label><textarea id="s-closed" name="closed_dates" rows="3" placeholder="2026-11-26">${(s.closed_dates || []).join('\n')}</textarea><p class="hint">One date per line (YEAR-MONTH-DAY), for holidays or days the library is closed. Past dates are removed automatically.</p></div>
    </fieldset>
    <fieldset class="card"><legend>About the library</legend>
      ${text('library_name', 'Library name')}
      <div class="row">${text('short_name', 'Short name', 'Shown in the top corner.')}${text('church_name', 'Church name')}</div>
      <div class="field"><label for="s-welcome">Welcome message</label><textarea id="s-welcome" name="welcome_message" rows="3">${s.welcome_message}</textarea><p class="hint">Shown on the home page.</p></div>
      ${text('library_address', 'Address')}
      <div class="row">${text('contact_phone', 'Phone')}${text('contact_email', 'Email')}</div>
    </fieldset>
    <div class="form-actions"><button class="btn" type="submit">Save settings</button></div>
  </form>
  <section class="card">
    <h2>Connections</h2>
    <p>Email: ${mailOn ? html`<span class="badge badge-ok">Connected</span>` : html`<span class="badge badge-warn">Not set up</span> Add RESEND_API_KEY on Render to send emails.`}</p>
    <p>Phone notifications: ${pushOn ? html`<span class="badge badge-ok">Connected</span>` : html`<span class="badge badge-muted">Off</span> Add the VAPID keys on Render to turn these on.`}</p>
  </section>`;
}

module.exports = { shell, home, checkoutsPage, deskCheckout, booksPage, bookForm, importPage, applicationsPage, patronsPage, patronPage, staffPage, settingsPage };

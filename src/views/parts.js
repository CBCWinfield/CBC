'use strict';
// Reusable view pieces: covers, spines, book cards, badges, pagination.
const { html, raw } = require('../lib/html');
const t = require('../lib/time');

// Book spine colors: the church greens and black, with a few classic bindings mixed in.
const SPINES = ['#1B4D1F', '#2E7D32', '#111111', '#3E6B2A', '#5E2424', '#23395A', '#2F3A33', '#4A7C23'];
function hashColor(s) {
  let h = 0;
  for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPINES[h % SPINES.length];
}

function cover(book, size = 'md') {
  if (book.has_cover) {
    const v = book.updated_at ? new Date(book.updated_at).getTime() : 0;
    return html`<img class="cover cover-${size}" src="/covers/${book.id}?v=${v}" alt="" loading="lazy">`;
  }
  return html`<div class="cover cover-${size} cover-gen" style="--spine:${hashColor(book.category || book.title)}" aria-hidden="true"><span class="cover-gen-title">${book.title}</span>${book.author ? html`<span class="cover-gen-author">${book.author}</span>` : ''}</div>`;
}

function availability(book) {
  if (book.copies_total === 0) return html`<span class="avail avail-none">Not lending</span>`;
  if (book.available > 0) return html`<span class="avail avail-yes">Available${book.copies_total > 1 ? html` · ${book.available} of ${book.copies_total}` : ''}</span>`;
  return html`<span class="avail avail-no">Checked out</span>`;
}

function bookCard(book) {
  return html`<li class="book-card">
    <a href="/books/${book.id}" class="book-card-link">
      ${cover(book)}
      <span class="book-card-title">${book.title}</span>
    </a>
    ${book.author ? html`<span class="book-card-author">${book.author}</span>` : ''}
    ${availability(book)}
  </li>`;
}

// The landing-page shelf: book spines standing side by side.
function shelf(books) {
  const placeholder = ['Psalms', 'Proverbs', 'Daily Light', 'Pilgrim’s Progress', 'Hymns of Faith', 'Ruth', 'Mere Christianity', 'The Hiding Place', 'Romans', 'Morning & Evening', 'John', 'Acts'];
  const items = books.length ? books : placeholder.map((title) => ({ title }));
  return html`<div class="shelf" role="list" aria-label="Recently added">
    ${items.slice(0, 11).map((b, i) => {
      const len = b.title.length;
      const height = 150 + ((len * 7 + i * 13) % 70);
      const width = 34 + ((len * 3 + i * 5) % 18);
      const tilt = i === 5 && items.length > 8 ? ' spine-tilt' : '';
      const inner = html`<span class="spine-title">${b.title.length > 34 ? b.title.slice(0, 32) + '…' : b.title}</span>`;
      const style = `--spine:${hashColor(b.category || b.title)};--h:${height}px;--w:${width}px`;
      return b.id
        ? html`<a role="listitem" class="spine${tilt}" style="${style}" href="/books/${b.id}" title="${b.title}${b.author ? ' by ' + b.author : ''}">${inner}</a>`
        : html`<span role="listitem" class="spine${tilt}" style="${style}" aria-hidden="true">${inner}</span>`;
    })}
  </div><div class="shelf-board" aria-hidden="true"></div>`;
}

const STATUS_LABEL = { pending: 'Waiting for approval', approved: 'Approved', denied: 'Denied', paused: 'Paused' };
const statusBadge = (status) => html`<span class="badge badge-${status}">${STATUS_LABEL[status] || status}</span>`;
const roleLabel = (role) => ({ librarian: 'Librarian', assistant: 'Assistant', patron: 'Patron' }[role] || role);

function checkoutState(c, now = new Date()) {
  if (c.status === 'reserved') {
    const late = new Date(c.pickup_at) < now;
    return late ? { label: 'Missed pickup', cls: 'warn' } : { label: 'On hold for pickup', cls: 'info' };
  }
  if (c.status === 'checked_out') {
    const days = t.daysBetween(new Date(c.due_at), now);
    if (days > 0) return { label: `Overdue ${days} day${days > 1 ? 's' : ''}`, cls: 'danger' };
    if (days === 0) return { label: 'Due today', cls: 'warn' };
    return { label: 'Checked out', cls: 'ok' };
  }
  if (c.status === 'returned') return { label: 'Returned', cls: 'muted' };
  return { label: 'Cancelled', cls: 'muted' };
}

function pager({ page, pages, base }) {
  if (pages <= 1) return '';
  const link = (p, label, rel) => html`<a href="${base}${base.includes('?') ? '&' : '?'}page=${p}"${rel ? raw(` rel="${rel}"`) : ''}>${label}</a>`;
  return html`<nav class="pager" aria-label="Pages">
    ${page > 1 ? link(page - 1, 'Previous', 'prev') : html`<span></span>`}
    <span>Page ${page} of ${pages}</span>
    ${page < pages ? link(page + 1, 'Next', 'next') : html`<span></span>`}
  </nav>`;
}

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;

module.exports = { cover, availability, bookCard, shelf, statusBadge, roleLabel, checkoutState, pager, csrfField, hashColor };

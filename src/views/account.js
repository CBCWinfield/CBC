'use strict';
const { html, checked } = require('../lib/html');
const P = require('./parts');
const t = require('../lib/time');
const { hours } = require('./public');

function statusNote(user, s) {
  if (user.status === 'pending') return html`<div class="card card-note"><h2>Your application is waiting for approval</h2><p>The librarian will review it soon. We'll email your library code to ${user.email} once you're approved. You can browse the catalog in the meantime.</p></div>`;
  if (user.status === 'paused') return html`<div class="card card-warn"><h2>Your account is paused</h2><p>New checkouts are turned off for now. Please contact the librarian${s.contact_phone ? ` at ${s.contact_phone}` : ''} with any questions.</p></div>`;
  if (user.status === 'denied') return html`<div class="card card-warn"><h2>Your application wasn't approved</h2><p>Please contact the church office if you have questions.</p></div>`;
  return '';
}

function myLibrary({ user, items, s, csrf, pushEnabled, now = new Date() }) {
  const holds = items.filter((c) => c.status === 'reserved');
  const out = items.filter((c) => c.status === 'checked_out');
  const past = items.filter((c) => c.status === 'returned' || c.status === 'cancelled');

  // Group holds by pickup time.
  const groups = new Map();
  for (const c of holds) {
    const k = new Date(c.pickup_at).toISOString();
    (groups.get(k) || groups.set(k, []).get(k)).push(c);
  }

  return html`
  <div class="page-head split">
    <div><h1>My Library</h1><p class="muted">${user.first_name} ${user.last_name}</p></div>
    ${user.status === 'approved' ? html`<div class="code-card"><span>Your library code</span><strong>${user.library_code}</strong></div>` : ''}
  </div>
  ${statusNote(user, s)}

  <section class="my-section">
    <h2>Waiting for pickup</h2>
    ${groups.size ? [...groups.entries()].map(([iso, list]) => html`<div class="pickup-group">
      <div class="pickup-when">
        <p class="big">${t.fmtLong(iso)}</p>
        <p>${t.fmtTime(iso)} ${new Date(iso) < now ? html`<span class="badge badge-warn">Missed. Please contact the librarian</span>` : ''}</p>
        <a class="btn btn-quiet btn-small" href="/my/pickup/${list[0].id}/calendar.ics">Add to calendar</a>
      </div>
      <ul class="line-list">${list.map((c) => html`<li>
        ${P.cover({ id: c.book_id, title: c.title, author: c.author, has_cover: c.has_cover, updated_at: c.book_updated_at }, 'sm')}
        <div class="grow"><a href="/books/${c.book_id}">${c.title}</a>${c.author ? html`<span class="muted"> by ${c.author}</span>` : ''}</div>
        <form method="post" action="/my/checkouts/${c.id}/cancel" data-confirm="Cancel your hold on “${c.title}”?">${P.csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">Cancel hold</button></form>
      </li>`)}</ul>
    </div>`) : html`<p class="muted">Nothing on hold. ${user.status === 'approved' ? html`<a href="/catalog">Find a book</a> to check out.` : ''}</p>`}
  </section>

  <section class="my-section">
    <h2>Checked out</h2>
    ${out.length ? html`<ul class="line-list">${out.map((c) => {
      const st = P.checkoutState(c, now);
      const left = t.daysBetween(now, new Date(c.due_at));
      return html`<li>
        ${P.cover({ id: c.book_id, title: c.title, author: c.author, has_cover: c.has_cover, updated_at: c.book_updated_at }, 'sm')}
        <div class="grow"><a href="/books/${c.book_id}">${c.title}</a>
          <p class="small">Due ${t.fmtLong(c.due_at)}${left > 0 ? ` · ${left} day${left > 1 ? 's' : ''} left` : ''}</p></div>
        <span class="badge badge-${st.cls}">${st.label}</span>
      </li>`;
    })}</ul>` : html`<p class="muted">No books checked out right now.</p>`}
  </section>

  ${past.length ? html`<details class="my-section history">
    <summary><h2>Borrowing history</h2></summary>
    <ul class="line-list compact">${past.map((c) => html`<li>
      <div class="grow"><a href="/books/${c.book_id}">${c.title}</a></div>
      <span class="small muted">${c.status === 'returned' ? `Returned ${t.fmtDateYear(c.returned_at)}` : `Cancelled ${t.fmtDateYear(c.cancelled_at)}`}</span>
    </li>`)}</ul>
  </details>` : ''}

  <section class="my-section settings-grid">
    <div class="card">
      <h2>Reminders</h2>
      <form method="post" action="/my/preferences" class="stack">
        ${P.csrfField(csrf)}
        <label class="check"><input type="checkbox" name="notify_email" value="1"${checked(user.notify_email)}> Email me pickup reminders and due dates</label>
        <button class="btn btn-quiet btn-small" type="submit">Save</button>
      </form>
      ${pushEnabled ? html`<div class="push-box" data-push>
        <p class="small">You can also get reminders as notifications on this phone or computer.</p>
        <button class="btn btn-quiet btn-small" type="button" data-push-toggle hidden>Turn on notifications</button>
        <p class="small muted" data-push-status></p>
      </div>` : ''}
    </div>
    <div class="card">
      <h2>Your details</h2>
      <form method="post" action="/my/details" class="stack">
        ${P.csrfField(csrf)}
        <div class="field"><label for="d-phone">Phone</label><input id="d-phone" name="phone" type="tel" value="${user.phone || ''}"></div>
        <div class="field"><label for="d-address">Street address</label><input id="d-address" name="address" value="${user.address || ''}"></div>
        <div class="row"><div class="field"><label for="d-city">City</label><input id="d-city" name="city" value="${user.city || ''}"></div>
        <div class="field short"><label for="d-state">State</label><input id="d-state" name="state" value="${user.state || ''}"></div>
        <div class="field short"><label for="d-zip">ZIP</label><input id="d-zip" name="zip" value="${user.zip || ''}"></div></div>
        <button class="btn btn-quiet btn-small" type="submit">Save details</button>
      </form>
    </div>
    <div class="card">
      <h2>Password</h2>
      <form method="post" action="/my/password" class="stack">
        ${P.csrfField(csrf)}
        <div class="field"><label for="p-cur">Current password</label><input id="p-cur" name="current" type="password" required autocomplete="current-password"></div>
        <div class="field"><label for="p-new">New password</label><input id="p-new" name="password" type="password" required minlength="8" autocomplete="new-password"></div>
        <button class="btn btn-quiet btn-small" type="submit">Change password</button>
      </form>
    </div>
  </section>
  <p class="muted small">Library hours: ${hours(s)}. You can have up to ${s.max_books} books at a time, for ${s.checkout_days} days each.</p>`;
}

module.exports = { myLibrary };

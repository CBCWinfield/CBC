'use strict';
const { html, raw, selected, checked } = require('../lib/html');
const P = require('./parts');
const t = require('../lib/time');
const { describeDays } = require('../settings');

const hours = (s) => `${describeDays(s.pickup_days)}, ${t.fmtHm(s.pickup_start)}–${t.fmtHm(s.pickup_end)}`;

function landing({ s, recent, counts, categories, user }) {
  return html`
  <section class="hero">
    <div class="hero-text">
      <h1>${s.library_name}</h1>
      <p class="lede">${s.welcome_message}</p>
      <div class="actions">
        ${user ? html`<a class="btn" href="/catalog">Browse the catalog</a><a class="btn btn-quiet" href="/my">My Library</a>`
          : html`<a class="btn" href="/apply">Apply for a library account</a><a class="btn btn-quiet" href="/catalog">Browse the catalog</a>`}
      </div>
      ${counts.n ? html`<p class="hero-count">${counts.n.toLocaleString()} titles on the shelves</p>` : ''}
    </div>
    <div class="hero-shelf">${P.shelf(recent)}</div>
  </section>

  <section class="how">
    <h2>How borrowing works</h2>
    <ol class="steps">
      <li><h3>Apply</h3><p>Fill out a short form. ${s.auto_approve ? 'You’re approved right away' : 'Once the librarian approves you'}, you’ll get a library code by email.</p></li>
      <li><h3>Reserve</h3><p>Find a book, choose <em>Check out</em>, enter your library code and pick a pickup time.</p></li>
      <li><h3>Pick up</h3><p>Come by the church library ${hours(s)}. Keep books for ${s.checkout_days} days.</p></li>
    </ol>
  </section>

  <section class="ministries">
    <h2>For kids and teens</h2>
    <div class="ministry-cards">
      <a class="ministry-card" href="/catalog?audience=Children"><img src="/img/central-kids.webp" alt="Central Kids" width="640" height="312" loading="lazy"><span>Books for children</span></a>
      <a class="ministry-card" href="/catalog?audience=Youth"><img src="/img/central-teens.webp" alt="Central Teens" width="640" height="305" loading="lazy"><span>Books for teens</span></a>
    </div>
  </section>

  ${categories.length ? html`<section class="cats">
    <h2>Browse by subject</h2>
    <ul class="cat-list">${categories.map((c) => html`<li><a href="/catalog?category=${encodeURIComponent(c.category)}">${c.category} <span class="muted">${c.n}</span></a></li>`)}</ul>
  </section>` : ''}

  <section class="visit">
    <div>
      <h2>Library hours</h2>
      <p class="big">${hours(s)}</p>
      <p>Pickups and returns happen during these hours. Choose your pickup time when you reserve a book.</p>
    </div>
    ${s.library_address || s.contact_phone || s.contact_email ? html`<div>
      <h2>Find us</h2>
      ${s.library_address ? html`<p class="big">${s.library_address}</p>` : ''}
      ${s.contact_phone ? html`<p>${s.contact_phone}</p>` : ''}
      ${s.contact_email ? html`<p><a href="mailto:${s.contact_email}">${s.contact_email}</a></p>` : ''}
    </div>` : ''}
  </section>`;
}

function catalog({ q, category, audience, format, available, rows, total, page, pages, categories, base }) {
  const formats = ['Book', 'Large Print', 'Audiobook', 'DVD'];
  return html`
  <div class="page-head">
    ${audience === 'Children' ? html`<div class="audience-banner"><img src="/img/central-kids.webp" alt="Central Kids" width="640" height="312"></div>` : ''}
    ${audience === 'Youth' ? html`<div class="audience-banner"><img src="/img/central-teens.webp" alt="Central Teens" width="640" height="305"></div>` : ''}
    <h1>${audience === 'Children' ? 'Books for children' : audience === 'Youth' ? 'Books for teens' : 'Catalog'}</h1>
    <p class="muted">${total.toLocaleString()} ${total === 1 ? 'title' : 'titles'}${q ? html` matching “${q}”` : ''}${category ? html` in ${category}` : ''}</p>
  </div>
  <form class="filters" method="get" action="/catalog">
    <div class="field grow"><label for="f-q">Title, author or subject</label><input id="f-q" type="search" name="q" value="${q || ''}"></div>
    <div class="field"><label for="f-cat">Subject</label>
      <select id="f-cat" name="category"><option value="">All subjects</option>${categories.map((c) => html`<option${selected(c.category, category)}>${c.category}</option>`)}</select></div>
    <div class="field"><label for="f-aud">For</label>
      <select id="f-aud" name="audience"><option value="">Everyone</option>${['Adults', 'Youth', 'Children'].map((a) => html`<option${selected(a, audience)}>${a}</option>`)}</select></div>
    <div class="field"><label for="f-fmt">Format</label>
      <select id="f-fmt" name="format"><option value="">Any format</option>${formats.map((f) => html`<option${selected(f, format)}>${f}</option>`)}</select></div>
    <label class="check"><input type="checkbox" name="available" value="1"${checked(available)}> Available now</label>
    <button class="btn" type="submit">Search</button>
    ${q || category || audience || format || available ? html`<a class="btn btn-quiet" href="/catalog">Clear</a>` : ''}
  </form>
  ${rows.length ? html`<ul class="book-grid">${rows.map(P.bookCard)}</ul>`
    : html`<div class="empty"><p>No books match those filters.</p><p><a href="/catalog">Show the whole catalog</a> or try the Ask bar at the top with a question like “books about prayer for teens”.</p></div>`}
  ${P.pager({ page, pages, base })}`;
}

function bookPage({ book, user, s, myActive, canCheckout, reason }) {
  const details = [
    ['Author', book.author], ['Subject', book.category], ['For', book.audience], ['Format', book.format],
    ['Publisher', book.publisher], ['Published', book.published_year], ['Pages', book.pages], ['ISBN', book.isbn],
  ].filter(([, v]) => v);
  return html`
  <p class="crumb"><a href="/catalog">Catalog</a>${book.category ? html` / <a href="/catalog?category=${encodeURIComponent(book.category)}">${book.category}</a>` : ''}</p>
  <article class="book-detail">
    <div class="book-detail-cover">${P.cover(book, 'lg')}</div>
    <div class="book-detail-body">
      <h1>${book.title}</h1>
      ${book.subtitle ? html`<p class="subtitle">${book.subtitle}</p>` : ''}
      ${book.author ? html`<p class="byline">by <a href="/catalog?q=${encodeURIComponent(book.author)}">${book.author}</a></p>` : ''}
      <div class="checkout-box">
        ${P.availability(book)}
        ${myActive ? html`<p>You already have this book${myActive.status === 'reserved' ? ` on hold for ${t.fmtDateTime(myActive.pickup_at)}` : `, due ${t.fmtDate(myActive.due_at)}`}. <a href="/my">See My Library</a></p>`
          : canCheckout ? html`<a class="btn" href="/books/${book.id}/checkout">Check out</a><p class="muted small">Choose a pickup time on the next step.</p>`
          : html`<p class="muted">${reason}</p>`}
      </div>
      ${book.description ? html`<div class="description">${book.description.split(/\n{2,}/).map((p) => html`<p>${p}</p>`)}</div>` : ''}
      <dl class="facts">${details.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
      ${book.tags ? html`<p class="tags">${book.tags.split(',').map((x) => x.trim()).filter(Boolean).map((tag) => html`<a href="/catalog?q=${encodeURIComponent(tag)}">${tag}</a>`)}</p>` : ''}
    </div>
  </article>`;
}

function checkoutPage({ book, days, user, csrf, s, error, values = {} }) {
  return html`
  <p class="crumb"><a href="/books/${book.id}">Back to ${book.title}</a></p>
  <div class="page-head"><h1>Check out “${book.title}”</h1>
  <p class="muted">Choose when you'll come pick it up. Pickups are ${hours(s)}.</p></div>
  ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
  <form method="post" action="/books/${book.id}/checkout" class="checkout-form">
    ${P.csrfField(csrf)}
    ${days.length ? html`<fieldset class="slots">
      <legend>Pickup time</legend>
      ${days.map((d) => html`<div class="slot-day">
        <h2>${d.label}</h2>
        <div class="slot-grid">${d.slots.map((sl) => html`<label class="slot${sl.open ? '' : ' slot-full'}">
          <input type="radio" name="pickup_at" value="${sl.iso}" required${checked(values.pickup_at === sl.iso)}${sl.open ? '' : raw(' disabled')}>
          <span>${sl.label}${sl.mine ? html`<small>Your pickup</small>` : !sl.open ? html`<small>Full</small>` : ''}</span>
        </label>`)}</div>
      </div>`)}
    </fieldset>` : html`<p class="empty">There are no open pickup times in the next ${s.booking_window_days} days. Please check back soon.</p>`}
    <div class="field code-field">
      <label for="library_code">Your library code</label>
      <input id="library_code" name="library_code" required autocomplete="off" placeholder="CBC-1234" value="${values.library_code || ''}">
      <p class="hint">It's in your approval email and on your <a href="/my">My Library</a> page.</p>
    </div>
    ${days.length ? html`<button class="btn" type="submit">Reserve and schedule pickup</button>` : ''}
  </form>`;
}

function applyPage({ csrf, values = {}, errors = {}, s }) {
  const f = (name, label, opts = {}) => html`<div class="field${opts.cls ? ' ' + opts.cls : ''}">
    <label for="a-${name}">${label}${opts.optional ? html` <span class="muted">(optional)</span>` : ''}</label>
    <input id="a-${name}" name="${name}" type="${opts.type || 'text'}" value="${opts.type === 'password' ? '' : values[name] || ''}"${opts.optional ? '' : raw(' required')}${opts.auto ? raw(` autocomplete="${opts.auto}"`) : ''}${errors[name] ? raw(` aria-invalid="true" aria-describedby="e-${name}"`) : ''}>
    ${errors[name] ? html`<p class="error" id="e-${name}">${errors[name]}</p>` : ''}
    ${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ''}
  </div>`;
  return html`
  <div class="narrow">
    <div class="page-head"><h1>Apply for a library account</h1>
    <p>The library is free and open to the public. ${s.auto_approve ? 'Your account is approved as soon as you apply.' : 'The librarian reviews each application, usually within a few days.'} Once approved, you'll get a library code by email.</p></div>
    <form method="post" action="/apply" class="stack" novalidate>
      ${P.csrfField(csrf)}
      <div class="row">${f('first_name', 'First name', { auto: 'given-name' })}${f('last_name', 'Last name', { auto: 'family-name' })}</div>
      ${f('email', 'Email', { type: 'email', auto: 'email' })}
      ${f('phone', 'Phone', { type: 'tel', auto: 'tel' })}
      ${f('address', 'Street address', { auto: 'street-address' })}
      <div class="row">${f('city', 'City', { auto: 'address-level2' })}${f('state', 'State', { auto: 'address-level1', cls: 'short' })}${f('zip', 'ZIP', { auto: 'postal-code', cls: 'short' })}</div>
      <div class="field"><label for="a-about">Anything you'd like the librarian to know? <span class="muted">(optional)</span></label>
        <textarea id="a-about" name="about" rows="3" maxlength="600">${values.about || ''}</textarea>
        <p class="hint">For example, whether you attend Central Baptist or how you heard about the library.</p></div>
      ${f('password', 'Create a password', { type: 'password', auto: 'new-password', hint: 'At least 8 characters.' })}
      ${f('password2', 'Type the password again', { type: 'password', auto: 'new-password' })}
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn" type="submit">Send application</button>
      <p class="muted">Already applied? <a href="/login">Log in</a></p>
    </form>
  </div>`;
}

function applied({ user, s }) {
  return html`<div class="narrow notice">
    <h1>${user.status === 'approved' ? 'You’re all set' : 'Application sent'}</h1>
    ${user.status === 'approved'
      ? html`<p>Your account is approved. Your library code is</p><p class="code-big">${user.library_code}</p><p>You'll enter it when you check out a book. It's also on your My Library page.</p><p><a class="btn" href="/catalog">Browse the catalog</a></p>`
      : html`<p>Thank you, ${user.first_name}. The librarian will review your application, and you'll get an email at <strong>${user.email}</strong> with your library code once you're approved.</p><p>In the meantime you can <a href="/catalog">browse the catalog</a>.</p>`}
  </div>`;
}

function loginPage({ csrf, email = '', error, next = '' }) {
  return html`<div class="narrow">
    <div class="page-head"><h1>Log in</h1></div>
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    <form method="post" action="/login" class="stack">
      ${P.csrfField(csrf)}<input type="hidden" name="next" value="${next}">
      <div class="field"><label for="l-email">Email</label><input id="l-email" name="email" type="email" value="${email}" required autocomplete="email"></div>
      <div class="field"><label for="l-pw">Password</label><input id="l-pw" name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn" type="submit">Log in</button>
      <p><a href="/forgot">Forgot your password?</a></p>
      <p class="muted">New to the library? <a href="/apply">Apply for an account</a></p>
    </form>
  </div>`;
}

function forgotPage({ csrf, sent }) {
  return html`<div class="narrow">
    <div class="page-head"><h1>Reset your password</h1></div>
    ${sent ? html`<p class="flash flash-ok" role="status">If that email has a library account, a reset link is on its way. It works for 1 hour.</p>` : ''}
    <form method="post" action="/forgot" class="stack">
      ${P.csrfField(csrf)}
      <div class="field"><label for="fg-email">Email</label><input id="fg-email" name="email" type="email" required autocomplete="email"></div>
      <button class="btn" type="submit">Email me a reset link</button>
    </form>
  </div>`;
}

function resetPage({ csrf, token, error }) {
  return html`<div class="narrow">
    <div class="page-head"><h1>Choose a new password</h1></div>
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    <form method="post" action="/reset/${token}" class="stack">
      ${P.csrfField(csrf)}
      <div class="field"><label for="r-pw">New password</label><input id="r-pw" name="password" type="password" required minlength="8" autocomplete="new-password"><p class="hint">At least 8 characters.</p></div>
      <div class="field"><label for="r-pw2">Type it again</label><input id="r-pw2" name="password2" type="password" required autocomplete="new-password"></div>
      <button class="btn" type="submit">Save password</button>
    </form>
  </div>`;
}

function errorPage({ status, message }) {
  const title = status === 404 ? 'Page not found' : status === 403 ? 'Not allowed' : status === 429 ? 'Slow down' : 'Something went wrong';
  return html`<div class="narrow notice"><h1>${title}</h1><p>${message || (status === 404 ? 'That page doesn’t exist. It may have been moved or removed.' : 'Please try again.')}</p><p><a class="btn btn-quiet" href="/">Go to the library home page</a></p></div>`;
}

module.exports = { landing, catalog, bookPage, checkoutPage, applyPage, applied, loginPage, forgotPage, resetPage, errorPage, hours };

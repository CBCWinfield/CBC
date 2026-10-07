'use strict';
const { html, raw, selected, checked } = require('../lib/html');
const Privacy = require('../lib/privacy');
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
          : html`<a class="btn" href="/apply">Apply for a membership account</a><a class="btn btn-quiet" href="/catalog">Browse the catalog</a>`}
      </div>
      ${counts.n ? html`<p class="hero-count">${counts.n.toLocaleString()} titles on the shelves</p>` : ''}
    </div>
    <div class="hero-shelf">${P.shelf(recent)}</div>
  </section>

  <section class="how">
    <h2>How borrowing works</h2>
    <ol class="steps">
      <li><h3>Apply</h3><p>Fill out a short form for your free membership account. ${s.auto_approve ? 'You’re approved right away' : 'Once you’re approved'}, you’ll get your library card number by email.</p></li>
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
    <ul class="cat-list"><li><a href="/catalog?notable=1" class="cat-notable"><span class="notable-ico">${P.TROPHY}</span> Bestsellers &amp; award winners</a></li>${categories.map((c) => html`<li><a href="/catalog?category=${encodeURIComponent(c.category)}">${c.category} <span class="muted">${c.n}</span></a></li>`)}</ul>
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

function catalog({ q, category, subcategory, audience, format, available, notable, rows, total, page, pages, categories, subcategories = [], formats = [], base, sort = 'title', sorts = [] }) {
  const chipBase = (sub) => `/catalog?${new URLSearchParams(Object.entries({ q, category, subcategory: sub, audience, format, available: available ? '1' : '', notable: notable ? '1' : '' }).filter(([, v]) => v))}`;
  return html`
  <div class="page-head">
    ${audience === 'Children' ? html`<div class="audience-banner"><img src="/img/central-kids.webp" alt="Central Kids" width="640" height="312"></div>` : ''}
    ${audience === 'Youth' ? html`<div class="audience-banner"><img src="/img/central-teens.webp" alt="Central Teens" width="640" height="305"></div>` : ''}
    <h1>${notable ? html`<span class="notable-h">${P.TROPHY}</span> Bestsellers &amp; award winners` : audience === 'Children' ? 'Books for children' : audience === 'Youth' ? 'Books for teens' : 'Catalog'}</h1>
    <p class="muted">${total.toLocaleString()} ${total === 1 ? 'title' : 'titles'}${q ? html` matching “${q}”` : ''}${category ? html` in ${category}${subcategory ? ` › ${subcategory}` : ''}` : ''}</p>
  </div>
  <form class="filters" method="get" action="/catalog">
    <div class="field grow suggest-wrap"><label for="f-q">Title, author or subject</label><input id="f-q" type="search" name="q" value="${q || ''}" autocomplete="off" data-suggest="public" placeholder="Start typing a title, writer or library no."></div>
    <div class="field"><label for="f-cat">Subject</label>
      <select id="f-cat" name="category"><option value="">All subjects</option>${categories.map((c) => html`<option${selected(c.category, category)}>${c.category}</option>`)}</select></div>
    <div class="field"><label for="f-aud">For</label>
      <select id="f-aud" name="audience"><option value="">Everyone</option>${['Adults', 'Youth', 'Children'].map((a) => html`<option${selected(a, audience)}>${a}</option>`)}</select></div>
    <div class="field"><label for="f-fmt">Format</label>
      <select id="f-fmt" name="format"><option value="">Any format</option>${formats.map((f) => html`<option${selected(f, format)}>${f}</option>`)}</select></div>
    <div class="field"><label for="f-sort">Sort by</label>
      <select id="f-sort" name="sort" data-autosubmit>${sorts.map(([k, label]) => html`<option value="${k}"${selected(k, sort)}>${label}</option>`)}</select></div>
    <label class="check"><input type="checkbox" name="available" value="1"${checked(available)}> Available now</label>
    <label class="check check-notable"><input type="checkbox" name="notable" value="1"${checked(notable)}> <span class="notable-ico">${P.TROPHY}</span> Bestsellers &amp; award winners</label>
    <button class="btn" type="submit">Search</button>
    ${q || category || audience || format || available || notable ? html`<a class="btn btn-quiet" href="/catalog">Clear</a>` : ''}
  </form>
  ${subcategories.length > 1 ? html`<nav class="subcats" aria-label="Narrow ${category}">
    <a href="${chipBase('')}"${!subcategory ? raw(' aria-current="page"') : ''}>All ${category}</a>
    ${subcategories.slice(0, 12).map((sc) => html`<a href="${chipBase(sc.name)}"${subcategory === sc.name ? raw(' aria-current="page"') : ''}>${sc.name} <span class="muted">${sc.n}</span></a>`)}
    ${subcategories.length > 12 ? html`<details class="more-subcats"${subcategories.slice(12).some((sc) => sc.name === subcategory) ? raw(' open') : ''}><summary>${subcategories.length - 12} more</summary>
      ${subcategories.slice(12).map((sc) => html`<a href="${chipBase(sc.name)}"${subcategory === sc.name ? raw(' aria-current="page"') : ''}>${sc.name} <span class="muted">${sc.n}</span></a>`)}</details>` : ''}
  </nav>` : ''}
  ${rows.length ? html`<ul class="book-grid">${rows.map(P.bookCard)}</ul>`
    : html`<div class="empty"><p>No books match those filters.</p><p><a href="/catalog">Show the whole catalog</a> or try the Ask bar at the top with a question like “books about prayer for teens”.</p></div>`}
  ${P.pager({ page, pages, base })}`;
}

function bookPage({ book, user, s, myActive, canCheckout, reason, csrf }) {
  const details = [
    ['Author', book.author], ['Series', book.series], ['Subject', [book.category, book.subcategory].filter(Boolean).join(' › ')], ['For', book.audience], ['Format', book.format],
    ...Object.entries(book.details || {}).filter(([k]) => k !== 'Artist' || book.author !== book.details.Artist),
    ['Publisher', book.publisher], ['Published', book.published_year], ['Pages', book.pages], ['ISBN', book.isbn], ['Library no.', book.call_number],
  ].filter(([, v]) => v);
  return html`
  <p class="crumb"><a href="/catalog">Catalog</a>${book.category ? html` / <a href="/catalog?category=${encodeURIComponent(book.category)}">${book.category}</a>` : ''}</p>
  <article class="book-detail">
    <div class="book-detail-cover"><span class="book-card-cover">${P.cover(book, 'lg')}${P.notableBadge(book)}</span></div>
    <div class="book-detail-body">
      ${P.notableBadge(book, 'lg')}
      <h1>${book.title}</h1>
      ${book.subtitle ? html`<p class="subtitle">${book.subtitle}</p>` : ''}
      ${book.short_description ? html`<p class="short-desc">${book.short_description}</p>` : ''}
      ${book.author ? html`<p class="byline">by <a href="/catalog?q=${encodeURIComponent(book.author)}">${book.author}</a></p>` : ''}
      <div class="checkout-box">
        ${P.availability(book)}
        ${myActive ? html`<p>You already have this book${myActive.status === 'reserved' ? ` on hold for ${t.fmtDateTime(myActive.pickup_at)}` : `, due ${t.fmtDate(myActive.due_at)}`}. <a href="/my">See My Library</a></p>`
          : canCheckout ? html`<a class="btn" href="/books/${book.id}/checkout">Check out</a><p class="muted small">Choose a pickup time on the next step.</p>`
          : html`<p class="muted">${reason}</p>`}
      </div>
      ${book.description ? html`<div class="description">${book.description.split(/\n{2,}/).map((p) => html`<p>${p}</p>`)}</div>` : ''}
      <dl class="facts">${details.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
      ${user && user.role !== 'patron' && user.status === 'approved' ? html`<form method="post" action="/admin/books/${book.id}/notable" class="notable-toggle">${P.csrfField(csrf)}
        <label for="nk-${book.id}" class="small"><strong>${P.TROPHY} Badge</strong> <span class="muted">(staff only)</span></label>
        <select id="nk-${book.id}" name="kind"><option value="">No badge</option>${P.NOTABLE_KINDS.map(([k, , long]) => html`<option value="${k}"${book.notable && (book.notable_kind || 'other') === k ? raw(' selected') : ''}>${long}</option>`)}</select>
        <button class="btn btn-quiet btn-small" type="submit">Save badge</button></form>` : ''}
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

// Where someone started signing up from, so the page speaks to what they came for.
function signupContext(next) {
  const n = String(next || '');
  if (n.startsWith('/checkin/prayer')) return { key: 'prayer', icon: '🙏', eyebrow: 'Prayer Wall', lead: 'Create your free membership account to share prayer requests and pray with your church family.' };
  if (n.startsWith('/checkin')) return { key: 'family', icon: '👨‍👩‍👧', eyebrow: 'Family check-in', lead: 'Create your free membership account, then add your family for faster check-in on Sundays and Wednesdays.' };
  return { key: 'library', icon: '📚', eyebrow: 'Library', lead: 'Create your free membership account to borrow books, Bibles and devotionals from the church library.' };
}

const PERKS = [['📚', 'Library', 'Your own library card number to reserve and borrow books'], ['🙏', 'Prayer Wall', 'Share requests and pray for others'], ['👨‍👩‍👧', 'Family check-in', 'Faster, safer check-in for your kids'], ['💬', 'Messages', 'Stay in touch with families and the church team']];

function applyPage({ csrf, values = {}, errors = {}, s, next = '' }) {
  const ctx = signupContext(next);
  const f = (name, label, opts = {}) => html`<div class="field${opts.cls ? ' ' + opts.cls : ''}">
    <label for="a-${name}">${label}${opts.optional ? html` <span class="muted">(optional)</span>` : ''}</label>
    <input id="a-${name}" name="${name}" type="${opts.type || 'text'}" value="${opts.type === 'password' ? '' : values[name] || ''}"${opts.optional ? '' : raw(' required')}${opts.auto ? raw(` autocomplete="${opts.auto}"`) : ''}${errors[name] ? raw(` aria-invalid="true" aria-describedby="e-${name}"`) : ''}>
    ${errors[name] ? html`<p class="error" id="e-${name}">${errors[name]}</p>` : ''}
    ${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ''}
  </div>`;
  const tick = (name, label) => html`<div class="field"><label class="check consent"><input type="checkbox" name="${name}" value="1"${values[name] ? raw(' checked') : ''} required${errors[name] ? raw(` aria-invalid="true" aria-describedby="e-${name}"`) : ''}> <span>${label}</span></label>
    ${errors[name] ? html`<p class="error" id="e-${name}">${errors[name]}</p>` : ''}</div>`;
  return html`
  <div class="narrow join">
    <div class="join-head">
      <p class="join-eyebrow"><span aria-hidden="true">${ctx.icon}</span> ${ctx.eyebrow}</p>
      <h1>Apply for a membership account</h1>
      <p class="join-lead">${ctx.lead}</p>
    </div>
    <div class="join-perks" aria-label="One account for everything at Central">${PERKS.map(([i, t, d]) => html`<div class="join-perk${ctx.eyebrow === t ? ' is-here' : ''}"><span aria-hidden="true">${i}</span><strong>${t}</strong><small>${d}</small></div>`)}</div>
    <ol class="join-steps">
      <li><strong>Apply</strong><span>About two minutes</span></li>
      <li><strong>Get approved</strong><span>${s.auto_approve ? 'Right away' : 'By the librarian or a church admin, usually within a day or two'}</span></li>
      <li><strong>You’re in</strong><span>Your library card number arrives by email</span></li>
    </ol>
    <form method="post" action="/apply" class="stack join-form" novalidate>
      ${P.csrfField(csrf)}<input type="hidden" name="next" value="${next}">
      <div class="row">${f('first_name', 'First name', { auto: 'given-name' })}${f('last_name', 'Last name', { auto: 'family-name' })}</div>
      ${f('email', 'Email', { type: 'email', auto: 'email' })}
      ${f('phone', 'Phone', { type: 'tel', auto: 'tel' })}
      ${f('address', 'Street address', { auto: 'street-address' })}
      <div class="row">${f('city', 'City', { auto: 'address-level2' })}${f('state', 'State', { auto: 'address-level1', cls: 'short' })}${f('zip', 'ZIP', { auto: 'postal-code', cls: 'short' })}</div>
      <div class="field"><label for="a-about">Anything you’d like us to know? <span class="muted">(optional)</span></label>
        <textarea id="a-about" name="about" rows="3" maxlength="600">${values.about || ''}</textarea>
        <p class="hint">For example, whether you attend Central Baptist or how you heard about us.</p></div>
      ${f('password', 'Create a password', { type: 'password', auto: 'new-password', hint: 'At least 8 characters.' })}
      ${f('password2', 'Type the password again', { type: 'password', auto: 'new-password' })}
      ${Privacy.notice()}
      ${tick('privacy', raw('I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.'))}
      ${tick('adult', 'I’m 18 or older. (Children are added to a family by a parent or guardian.)')}
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn join-submit" type="submit">Send my application</button>
      <p class="muted">Already have an account? <a href="/login${next ? `?next=${encodeURIComponent(next)}` : ''}">Log in</a></p>
    </form>
  </div>`;
}

function applied({ user, s, next = '' }) {
  const ctx = signupContext(next);
  const go = next && next.startsWith('/') ? next : '/my';
  const goLabel = { prayer: 'Go to the Prayer Wall', family: 'Set up my family', library: 'Browse the catalog' }[ctx.key];
  return html`<div class="narrow notice join-done">
    <div class="join-done-icon" aria-hidden="true">${user.status === 'approved' ? '🎉' : '✉️'}</div>
    <h1>${user.status === 'approved' ? 'Welcome to Central!' : 'Application sent'}</h1>
    ${user.status === 'approved'
      ? html`<p>Your membership account is approved. Your library card number is</p><p class="code-big">${user.library_code}</p><p>You’ll use it to check out books. It’s also on your My Library page.</p><p><a class="btn" href="${ctx.key === 'library' ? '/catalog' : go}">${goLabel}</a></p>`
      : html`<p>Thank you, ${user.first_name}! The librarian or a church admin will review your application, usually within a day or two.</p>
        <p>We’ll email <strong>${user.email}</strong> as soon as you’re approved, with your library card number. After that you can use the library${ctx.key === 'prayer' ? ', post on the Prayer Wall' : ', the Prayer Wall'} and messages.</p>
        <p class="join-while">While you wait, you can <a href="/catalog">browse the catalog</a> or <a href="/checkin/welcome/family">set up your family for check-in</a>.</p>`}
  </div>`;
}

function loginPage({ csrf, email = '', error, next = '' }) {
  const ctx = signupContext(next);
  const nextQ = next ? `?next=${encodeURIComponent(next)}` : '';
  return html`<div class="narrow login-wrap">
    <div class="page-head"><h1>Log in</h1>${next && ctx.key !== 'library' ? html`<p class="muted">Log in to continue to the ${ctx.eyebrow}.</p>` : ''}</div>
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    <form method="post" action="/login" class="stack">
      ${P.csrfField(csrf)}<input type="hidden" name="next" value="${next}">
      <div class="field"><label for="l-email">Email</label><input id="l-email" name="email" type="email" value="${email}" required autocomplete="email"></div>
      <div class="field"><label for="l-pw">Password</label><input id="l-pw" name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn" type="submit">Log in</button>
      <p><a href="/forgot">Forgot your password?</a></p>
    </form>
    <div class="join-card">
      <p class="join-card-title"><span aria-hidden="true">${ctx.icon}</span> New to Central?</p>
      <p>One free membership account gives you the library (with your own library card number), the Prayer Wall, family check-in and messages.</p>
      <a class="btn btn-quiet" href="/apply${nextQ}">Apply for a membership account</a>
    </div>
  </div>`;
}

function forgotPage({ csrf, sent }) {
  return html`<div class="narrow">
    <div class="page-head"><h1>Reset your password</h1></div>
    ${sent ? html`<p class="flash flash-ok" role="status">If that email has an account, a reset link is on its way. It works for 1 hour.</p>` : ''}
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

module.exports = { signupContext, privacyPage: () => Privacy.page(), termsPage: () => Privacy.termsPage(), landing, catalog, bookPage, checkoutPage, applyPage, applied, loginPage, forgotPage, resetPage, errorPage, hours };

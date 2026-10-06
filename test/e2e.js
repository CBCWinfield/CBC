'use strict';
// End-to-end walk-through against a running server.
// Usage: BASE=http://localhost:3100 node test/e2e.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE || 'http://localhost:3100';

class Browser {
  constructor() { this.cookies = {}; }
  async go(p, opts = {}) {
    const res = await fetch(BASE + p, {
      redirect: 'manual',
      ...opts,
      headers: { ...(opts.headers || {}), Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      if (v) this.cookies[k] = v; else delete this.cookies[k];
    }
    const body = await res.text();
    return { status: res.status, location: res.headers.get('location'), body };
  }
  csrf(html) { return (/name="csrf-token" content="([^"]+)"/.exec(html) || [])[1]; }
  async get(p) { const r = await this.go(p); this.lastCsrf = this.csrf(r.body) || this.lastCsrf; return r; }
  async post(p, data) {
    if (!this.lastCsrf) await this.get('/');
    const body = new URLSearchParams({ _csrf: this.lastCsrf, ...data });
    return this.go(p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  }
  async follow(r) { while (r.location) r = await this.get(r.location); return r; }
}

(async () => {
  const lib = new Browser();
  const pat = new Browser();
  let r;

  // Librarian logs in
  await lib.get('/login');
  r = await lib.post('/login', { email: 'librarian@example.com', password: 'testpass123' });
  assert.strictEqual(r.location, '/admin', 'librarian goes to dashboard');
  r = await lib.follow(r);
  assert.match(r.body, /Today's pickups/);

  // Import the sample catalog
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures/sample-books.csv'), 'utf8');
  await lib.get('/admin/books/import');
  r = await lib.post('/admin/books/import', { csv, skip_duplicates: '1' });
  assert.match(r.body, /books? added/);
  console.log('Import:', (/(\d+) books? added[^<]*/.exec(r.body) || [])[0]);

  // Add one book by hand
  await lib.get('/admin/books/new');
  r = await lib.post('/admin/books', { title: 'Morning and Evening', author: 'Charles Spurgeon', category: 'Devotional', audience: 'Adults', format: 'Book', copies_total: '1', tags: 'daily, devotions' });
  assert.strictEqual(r.status, 303);

  // Public pages
  for (const p of ['/', '/catalog', '/catalog?category=Devotional', '/books/1', '/apply', '/login', '/forgot']) {
    r = await pat.get(p);
    assert.strictEqual(r.status, 200, `${p} loads`);
  }

  // Patron applies (manual approval)
  r = await pat.post('/apply', {
    first_name: 'Ruth', last_name: 'Miller', email: 'ruth@example.com', phone: '620-555-0101',
    address: '12 Main St', city: 'Winfield', state: 'KS', zip: '67156', about: 'Member since 1998',
    password: 'ruthpass1', password2: 'ruthpass1',
  });
  assert.match(r.body, /Application sent/);

  // Pending patron can't check out
  r = await pat.get('/books/1');
  assert.match(r.body, /waiting for approval/);

  // Librarian approves
  r = await lib.get('/admin/applications');
  assert.match(r.body, /Ruth Miller/);
  const pid = /\/admin\/applications\/(\d+)\/approve/.exec(r.body)[1];
  r = await lib.post(`/admin/applications/${pid}/approve`, {});
  r = await lib.follow(r);
  const code = (/library code is (CBC-\d+)/.exec(r.body) || [])[1];
  assert.ok(code, 'library code issued');
  console.log('Approved Ruth with code', code);

  // Patron checks out: wrong code first, then right
  r = await pat.get('/books/2/checkout');
  assert.strictEqual(r.status, 200);
  const slot = (/name="pickup_at" value="([^"]+)" required(?! disabled)/.exec(r.body) || [])[1];
  assert.ok(slot, 'a pickup slot is offered');
  r = await pat.post('/books/2/checkout', { pickup_at: slot, library_code: 'CBC-9999' });
  assert.strictEqual(r.status, 422);
  assert.match(r.body, /doesn.t match/);
  r = await pat.post('/books/2/checkout', { pickup_at: slot, library_code: code.toLowerCase().replace('-', ' ') });
  assert.strictEqual(r.location, '/my');
  r = await pat.follow(r);
  assert.match(r.body, /A Grief Observed/);
  assert.match(r.body, /Waiting for pickup/);

  // Second book, same slot
  r = await pat.get('/books/5/checkout');
  r = await pat.post('/books/5/checkout', { pickup_at: slot, library_code: code });
  assert.strictEqual(r.location, '/my');

  // Calendar file
  r = await pat.get('/my');
  const icsPath = /href="(\/my\/pickup\/\d+\/calendar\.ics)"/.exec(r.body)[1];
  r = await pat.go(icsPath);
  assert.match(r.body, /BEGIN:VCALENDAR/);

  // Ask bar
  const ask = async (q) => {
    const res = await pat.go('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': pat.lastCsrf }, body: JSON.stringify({ q }) });
    return JSON.parse(res.body);
  };
  for (const q of ['books about grief', 'anything by c.s. lewis that is available', 'when can I pick up books?', 'something for teens', 'devotionals', 'help with worry', 'how long can I keep a book', 'kids bible stories', 'marriage', 'praying', 'lewsi', 'dvd']) {
    const a = await ask(q);
    console.log(`ASK "${q}" -> ${a.answer} [${a.books.map((b) => b.title).join(' | ')}]`);
  }

  // Librarian sees pickups, marks picked up, returns one
  r = await lib.get('/admin/checkouts');
  assert.match(r.body, /Ruth/);
  const ids = [...r.body.matchAll(/\/admin\/checkouts\/(\d+)\/pickup/g)].map((m) => m[1]);
  assert.strictEqual(ids.length, 2);
  r = await lib.post(`/admin/checkouts/${ids[0]}/pickup`, {});
  r = await lib.follow(r);
  assert.match(r.body, /Checked out/);
  r = await lib.get('/admin/checkouts?view=out');
  const ret = /\/admin\/checkouts\/(\d+)\/return/.exec(r.body)[1];
  r = await lib.post(`/admin/checkouts/${ret}/extend`, {});
  r = await lib.post(`/admin/checkouts/${ret}/return`, {});
  r = await lib.follow(r);
  assert.match(r.body, /checked in/);

  // Desk checkout
  await lib.get('/admin/checkouts/new');
  r = await lib.post('/admin/checkouts/new', { patron: code, book: '#7 The Purpose Driven Life' });
  r = await lib.follow(r);
  assert.match(r.body, /Checked out “The Purpose Driven Life”/);

  // Auto-approve on, new applicant gets code immediately
  await lib.get('/admin/applications');
  r = await lib.post('/admin/settings/auto-approve', { auto_approve: '1' });
  const pat2 = new Browser();
  await pat2.get('/apply');
  r = await pat2.post('/apply', {
    first_name: 'Sam', last_name: 'Ortiz', email: 'sam@example.com', phone: '620-555-0102',
    address: '4 Elm', city: 'Winfield', state: 'KS', zip: '67156', password: 'sampass12', password2: 'sampass12',
  });
  assert.match(r.body, /You’re all set/);
  assert.match(r.body, /CBC-\d+/);

  // Staff: create an assistant, assistant can't open settings or applications
  await lib.get('/admin/staff');
  r = await lib.post('/admin/staff/create', { first_name: 'Grace', last_name: 'Lee', email: 'grace@example.com', role: 'assistant' });
  const temp = /code-big">([a-z]+-[a-z]+-\d+)</.exec(r.body)[1];
  const asst = new Browser();
  await asst.get('/login');
  r = await asst.post('/login', { email: 'grace@example.com', password: temp });
  assert.strictEqual(r.location, '/admin');
  assert.strictEqual((await asst.get('/admin/settings')).status, 403);
  assert.strictEqual((await asst.get('/admin/applications')).status, 403);
  assert.strictEqual((await asst.get('/admin/books/new')).status, 200);

  // Pause and resume a patron
  r = await lib.post(`/admin/patrons/${pid}/pause`, {});
  r = await pat.get('/books/3');
  assert.match(r.body, /paused/);
  r = await lib.post(`/admin/patrons/${pid}/resume`, {});


  // Librarian adds a patron directly: approved, library code, set-password link emailed
  r = await lib.get('/admin/patrons');
  assert.match(r.body, /Add a patron/);
  r = await lib.post('/admin/patrons/new', { first_name: 'Naomi', last_name: 'Bell', email: 'naomi@example.com', phone: '620-555-0133' });
  assert.match(r.location, /^\/admin\/patrons\/\d+$/);
  r = await lib.follow(r);
  assert.match(r.body, /We emailed them their code/);
  // Librarian creates a staff account: welcome email with set-password link
  r = await lib.post('/admin/staff/create', { first_name: 'Asa', last_name: 'Help', email: 'asa@example.com', role: 'assistant' });
  assert.match(r.body, /We emailed them a welcome/);

  // Settings save
  await lib.get('/admin/settings');
  r = await lib.post('/admin/settings', {
    checkout_days: '21', max_books: '4', max_extensions: '1', missed_pickup_days: '3', 'pickup_days[]': '1',
    pickup_start: '09:00', pickup_end: '13:00', slot_minutes: '15', slot_capacity: '2', booking_window_days: '14', min_lead_minutes: '60',
    closed_dates: '2030-12-25', library_name: 'Central Baptist Church Public Christian Library', short_name: 'CBC Library',
    church_name: 'Central Baptist Church', welcome_message: 'Welcome!', library_address: '1 Church St, Winfield, KS',
    contact_phone: '620-555-0100', contact_email: 'library@example.com',
  });
  r = await lib.follow(r);
  assert.match(r.body, /Settings saved/);
  assert.match(r.body, /value="21"/);

  // CSRF is enforced
  const raw = await pat.go('/my/preferences', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'notify_email=1' });
  assert.strictEqual(raw.status, 403);

  // Patron cancels remaining hold
  r = await pat.get('/my');
  const cancel = /\/my\/checkouts\/(\d+)\/cancel/.exec(r.body);
  if (cancel) { r = await pat.post(`/my/checkouts/${cancel[1]}/cancel`, {}); r = await pat.follow(r); assert.match(r.body, /Hold cancelled/); }

  console.log('\nAll end-to-end checks passed.');
})().catch((err) => { console.error(err); process.exit(1); });

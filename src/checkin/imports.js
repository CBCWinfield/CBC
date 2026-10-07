'use strict';
// One import tool for every list in the admin portal: upload a CSV (or paste rows), see what was added
// and what was skipped and why. Each list has a downloadable template with the right columns.
//   /checkin/import/incidents      past incident reports (co-admins)
//   /checkin/import/families       families and kids for check-in (ministry leaders and up)
//   /checkin/import/leads          contacts / visitor leads, added to Website messages (co-admins)
//   /checkin/import/announcements  announcement slides (church admins and library staff)
const db = require('../db');
const { HttpError } = require('../lib/http');
const { html, raw } = require('../lib/html');
const t = require('../lib/time');
const { parseCsvObjects } = require('../lib/csv');
const { clean } = require('../routes/guards');
const D = require('./data');

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const MAX_ROWS = 3000;

// "2026-10-11", "10/11/2026", "10/11/26" → "2026-10-11"
function dateKey(s) {
  s = String(s || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}
// "6:30 PM", "18:30" → "18:30"
function timeHm(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(String(s || '').trim());
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  if (m[3]) { const pm = /p/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
const yes = (s) => /^(y|yes|true|1|x|✓)$/i.test(String(s || '').trim());
// Accept friendly column names: "First Name", "first name", "first_name" all work.
const norm = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), v]));

// ---------------------------------------------------------------- the lists
const LISTS = {
  incidents: {
    title: 'Import incident reports', back: ['/checkin/incidents', 'Incident reports'], tab: 'incidents',
    allowed: (u) => D.can(u, 'coadmin'),
    intro: 'Bring in past reports from paper forms or a spreadsheet. They’re marked as reviewed so they don’t alert anyone.',
    columns: [['date', true, 'like 2026-10-11 or 10/11/2026'], ['time', false, 'like 10:30 AM'], ['category', false, 'e.g. Injury or accident, Illness, Behavior (anything else becomes Other)'],
      ['severity', false, 'minor, moderate or serious'], ['location', false], ['people', false, 'who was involved'], ['description', true, 'what happened'],
      ['action_taken', false], ['first_aid', false, 'yes or no'], ['witnesses', false], ['parent_notified', false, 'yes or no'], ['follow_up', false], ['status', false, 'open, reviewed or closed']],
    sample: 'date,time,category,severity,location,people,description,action_taken,first_aid,witnesses,parent_notified,follow_up,status\r\n2026-09-14,10:20 AM,Injury or accident,minor,Kids room,Emma S.,Tripped on the rug and scraped her knee.,Cleaned and bandaged.,yes,Mrs. Lee,yes,,closed\r\n',
    async handle(rows, req) {
      const { CATEGORIES } = require('./safety');
      const result = { added: 0, skipped: [] };
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const date = dateKey(r.date);
        const description = clean(r.description, 4000);
        if (!date) { result.skipped.push({ row: i + 2, reason: `date “${r.date || ''}” isn’t a date` }); continue; }
        if (!description) { result.skipped.push({ row: i + 2, reason: 'missing description' }); continue; }
        const hm = timeHm(r.time) || '12:00';
        const { year, month, day } = t.parseKey(date);
        const [h, mi] = hm.split(':').map(Number);
        const when = t.zoned(year, month, day, h, mi);
        const cat = CATEGORIES.find((c) => c.toLowerCase() === String(r.category || '').trim().toLowerCase()) || (String(r.category || '').trim() ? CATEGORIES.find((c) => c.toLowerCase().startsWith(String(r.category).trim().toLowerCase().slice(0, 5))) : null) || 'Other';
        const sev = ['minor', 'moderate', 'serious'].includes(String(r.severity || '').toLowerCase()) ? r.severity.toLowerCase() : 'minor';
        const status = ['open', 'reviewed', 'closed'].includes(String(r.status || '').toLowerCase()) ? r.status.toLowerCase() : 'reviewed';
        const dup = await db.one('SELECT id FROM incidents WHERE occurred_at = $1 AND description = $2', [when, description]);
        if (dup) { result.skipped.push({ row: i + 2, reason: 'already imported' }); continue; }
        await db.query(`INSERT INTO incidents (occurred_at, location, category, severity, people_text, description, action_taken, first_aid, witnesses, parent_notified,
          follow_up, status, admin_notes, reported_by, reviewed_by, reviewed_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [when, clean(r.location, 120) || null, cat, sev, clean(r.people, 300) || null, description, clean(r.action_taken, 2000) || null, yes(r.first_aid),
          clean(r.witnesses, 300) || null, yes(r.parent_notified), clean(r.follow_up, 2000) || null, status, 'Imported from a spreadsheet', req.user.id,
          status === 'open' ? null : req.user.id, status === 'open' ? null : new Date()]);
        result.added++;
      }
      D.audit(req.user, 'import_incidents', { detail: `${result.added} added` });
      return result;
    },
  },

  families: {
    title: 'Import families', back: ['/checkin/families', 'Families'], tab: 'families',
    allowed: (u) => D.can(u, 'leader'),
    intro: 'One row per person. Rows with the same family name go into the same family. People already in that family (same first and last name) are skipped.',
    columns: [['family', true, 'e.g. The Smith Family'], ['type', true, 'adult or child'], ['first_name', true], ['last_name', true], ['birthdate', false], ['grade', false, 'kids'],
      ['allergies', false, 'kids'], ['medical_notes', false, 'kids'], ['email', false, 'adults'], ['phone', false, 'adults'], ['relationship', false, 'adults, e.g. Mom'],
      ['address', false], ['city', false], ['state', false], ['zip', false]],
    sample: 'family,type,first_name,last_name,birthdate,grade,allergies,medical_notes,email,phone,relationship,address,city,state,zip\r\nThe Smith Family,adult,Mary,Smith,,,,,mary@example.com,620-555-0101,Mom,904 Wheat Rd,Winfield,KS,67156\r\nThe Smith Family,child,Emma,Smith,2017-04-09,3rd,Peanuts,,,,,,,,\r\n',
    async handle(rows, req, { personValues, savePerson }) {
      const result = { added: 0, families: 0, skipped: [] };
      const famIds = new Map();
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const famName = clean(r.family, 120);
        const kind = /^a/i.test(String(r.type || '').trim()) ? 'adult' : /^(c|k)/i.test(String(r.type || '').trim()) ? 'child' : null;
        if (!famName) { result.skipped.push({ row: i + 2, reason: 'missing family name' }); continue; }
        if (!kind) { result.skipped.push({ row: i + 2, reason: `type “${r.type || ''}” should be adult or child` }); continue; }
        const v = personValues({ ...r, birthdate: dateKey(r.birthdate) || '' }, kind);
        if (!v.first_name || !v.last_name) { result.skipped.push({ row: i + 2, reason: 'missing first or last name' }); continue; }
        let famId = famIds.get(famName.toLowerCase());
        if (!famId) {
          const existing = await db.many('SELECT id FROM families WHERE lower(name) = lower($1) AND status <> $2', [famName, 'archived']);
          if (existing.length === 1) famId = existing[0].id;
          else {
            famId = (await db.one('INSERT INTO families (name, address, city, state, zip, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
              [famName, clean(r.address, 200) || null, clean(r.city, 80) || null, clean(r.state, 20) || null, clean(r.zip, 20) || null, req.user.id])).id;
            result.families++;
          }
          famIds.set(famName.toLowerCase(), famId);
        }
        const dup = await db.one('SELECT id FROM people WHERE family_id = $1 AND lower(first_name) = lower($2) AND lower(last_name) = lower($3)', [famId, v.first_name, v.last_name]);
        if (dup) { result.skipped.push({ row: i + 2, reason: `${v.first_name} ${v.last_name} is already in ${famName}` }); continue; }
        if (kind === 'adult') {
          const hasPrimary = await db.one("SELECT id FROM people WHERE family_id = $1 AND kind = 'adult' AND is_primary", [famId]);
          v.is_primary = !hasPrimary;
        }
        await savePerson(famId, kind, v);
        result.added++;
      }
      D.audit(req.user, 'import_families', { detail: `${result.added} people, ${result.families} families` });
      return result;
    },
  },

  leads: {
    title: 'Import contacts & leads', back: ['/checkin/inquiries', 'Messages & contacts'], tab: 'inquiries',
    allowed: (u) => D.can(u, 'coadmin'),
    intro: 'Visitor cards, sign-up sheets, event guest lists: anyone you want to follow up with. They show up in Website messages as new, ready to call or email.',
    columns: [['name', true], ['email', false], ['phone', false], ['source', false, 'e.g. Visitor card, Trunk or Treat, VBS'], ['notes', false], ['date', false]],
    sample: 'name,email,phone,source,notes,date\r\nJohn & Amy Carter,amy@example.com,620-555-0123,Visitor card,"First visit, two kids (5 and 8)",2026-10-04\r\n',
    async handle(rows, req) {
      const result = { added: 0, skipped: [] };
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = clean(r.name || [r.first_name, r.last_name].filter(Boolean).join(' '), 120);
        if (!name) { result.skipped.push({ row: i + 2, reason: 'missing name' }); continue; }
        const email = clean(r.email, 200).toLowerCase() || null;
        const phone = clean(r.phone, 40) || null;
        if (email || phone) {
          const dup = await db.one(`SELECT id FROM site_inquiries WHERE lower(name) = lower($1) AND (email = $2 OR phone = $3)`, [name, email, phone]);
          if (dup) { result.skipped.push({ row: i + 2, reason: `${name} is already in the list` }); continue; }
        }
        const d = dateKey(r.date);
        await db.query(`INSERT INTO site_inquiries (kind, name, email, phone, topic, message, created_at) VALUES ('lead', $1, $2, $3, $4, $5, COALESCE($6::date::timestamptz, now()))`,
          [name, email, phone, clean(r.source, 120) || 'Imported contact', clean(r.notes, 3000) || null, d]);
        result.added++;
      }
      return result;
    },
  },

  announcements: {
    title: 'Import announcements', back: ['/checkin/announcements', 'Announcements'], tab: 'announce',
    allowed: (u) => require('../announce').canAnnounce(u),
    intro: 'Add several announcements at once. Each becomes a slide (AI writes the slide when it’s turned on), newest at the top.',
    columns: [['title', true], ['description', false], ['date', false], ['time', false], ['when', false, 'or in words, e.g. Every Wednesday'], ['details', false]],
    sample: 'title,description,date,time,when,details\r\nFall Chili Cook-Off,Bring your best pot of chili and a friend.,2026-10-25,12:15 PM,,Fellowship Hall\r\n',
    async handle(rows, req) {
      const A = require('../announce');
      const result = { added: 0, skipped: [] };
      for (let i = 0; i < rows.length && i < 60; i++) {
        const r = rows[i];
        const title = clean(r.title, 120);
        if (!title) { result.skipped.push({ row: i + 2, reason: 'missing title' }); continue; }
        await A.createAnnouncement({ title, description: clean(r.description, 600), event_date: dateKey(r.date), event_time: timeHm(r.time), when_note: clean(r.when, 80), details: clean(r.details, 400) }, req.user.id);
        result.added++;
      }
      if (rows.length > 60) result.skipped.push({ row: 62, reason: 'only the first 60 announcements are imported at a time' });
      return result;
    },
  },
};

function page({ key, def, csrf, result }) {
  return html`
  <p class="crumb"><a href="${def.back[0]}">${def.back[1]}</a></p>
  <h1>${def.title}</h1>
  <p>${def.intro}</p>
  <p>Save your spreadsheet as <strong>CSV</strong> (in Excel or Google Sheets: File › Download / Save as › CSV) with these columns. Column names can be in any order; capital letters and spaces are fine.</p>
  <ul class="imp-cols">${def.columns.map(([c, req, hint]) => html`<li><code>${c}</code>${req ? html` <strong class="req">required</strong>` : ''}${hint ? html` <span class="muted">(${hint})</span>` : ''}</li>`)}</ul>
  <p><a class="btn btn-quiet btn-small" href="/checkin/import/${key}/template.csv" download>Download a template</a></p>
  ${result ? html`<div class="ci-card card-note" role="status"><h2>Import finished</h2>
    <p><strong>${result.added}</strong> added${result.families ? ` (${result.families} new ${result.families === 1 ? 'family' : 'families'})` : ''}${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.</p>
    ${result.skipped.length ? html`<ul class="small">${result.skipped.slice(0, 40).map((x) => html`<li>Row ${x.row}: ${x.reason}</li>`)}${result.skipped.length > 40 ? html`<li>…and ${result.skipped.length - 40} more</li>` : ''}</ul>` : ''}
    <p><a href="${def.back[0]}">Go to ${def.back[1]}</a></p></div>` : ''}
  <form method="post" action="/checkin/import/${key}" class="stack ci-form" id="import-form">${csrfField(csrf)}
    <div class="field"><label for="csv-file">CSV file</label><input type="file" id="csv-file" accept=".csv,text/csv"><p class="hint" id="csv-info"></p></div>
    <div class="field" id="csv-paste"><label for="csv-text">Or paste the rows (including the header row)</label><textarea id="csv-text" name="csv" rows="8" required placeholder="${def.columns.map((c) => c[0]).join(',')}"></textarea></div>
    <button class="btn" type="submit">Import</button>
  </form>`;
}

// A small "Import" button for list pages.
const importButton = (key, label = 'Import a list') => html`<a class="btn btn-quiet btn-small" href="/checkin/import/${key}">⇪ ${label}</a>`;

function routes(app, { render, personValues, savePerson }) {
  const get = (req) => {
    const def = LISTS[req.params.key];
    if (!def) throw new HttpError(404, 'That import was not found.');
    if (!req.user) return { def, login: true };
    if (!def.allowed(req.user)) throw new HttpError(403, 'You don’t have access to import this list.');
    return { def };
  };
  app.get('/checkin/import/:key', async (req, res) => {
    const { def, login } = get(req);
    if (login) return res.redirect(`/login?next=${encodeURIComponent(req.path)}`);
    render(req, res, page({ key: req.params.key, def, csrf: res.locals.csrf }), { title: def.title, tab: def.tab });
  });
  app.get('/checkin/import/:key/template.csv', async (req, res) => {
    const { def, login } = get(req);
    if (login) return res.redirect('/login');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}-template.csv"`);
    res.send(def.sample);
  });
  app.post('/checkin/import/:key', async (req, res) => {
    const { def, login } = get(req);
    if (login) return res.redirect('/login');
    const rows = parseCsvObjects(String(req.body.csv || '')).slice(0, MAX_ROWS).map(norm);
    const result = rows.length ? await def.handle(rows, req, { personValues, savePerson }) : { added: 0, skipped: [{ row: 1, reason: 'no rows found. Include the header row.' }] };
    render(req, res, page({ key: req.params.key, def, csrf: res.locals.csrf, result }), { title: def.title, tab: def.tab });
  });
}

module.exports = { routes, importButton, dateKey, timeHm };

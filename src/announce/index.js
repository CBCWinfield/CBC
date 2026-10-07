'use strict';
// Announcements: admins type an announcement, AI polishes the words, and it becomes a branded slide.
// Each week, one click builds a narrated "announcement reel" (title card → slides newest to oldest → end card),
// recorded into a video right in the admin's browser. An admin or the librarian approves it, and the
// website's Events & Announcements page shows it.
const db = require('../db');
const security = require('../lib/security');
const { HttpError } = require('../lib/http');
const { html, raw } = require('../lib/html');
const t = require('../lib/time');
const { intParam, clean } = require('../routes/guards');
const D = require('../checkin/data');
const ai = require('./ai');
const S = require('./slides');

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const canAnnounce = (u) => Boolean(u && (D.can(u, 'coadmin') || (u.role && u.role !== 'patron' && u.status === 'approved')));
const MAX_VIDEO = 80 * 1024 * 1024;

// ---------------------------------------------------------------- dates
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const keyOf = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
function nextSunday() {
  const today = t.dateKey(new Date());
  const wd = t.weekdayOfKey(today); // 1 = Monday … 7 = Sunday
  return t.addDaysKey(today, wd === 7 ? 0 : 7 - wd);
}
function longDate(key) {
  const { year, month, day } = t.parseKey(key);
  return `${DAYS[t.weekdayOfKey(key) - 1]}, ${MONTHS[month - 1]} ${day}, ${year}`;
}
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function spokenDate(key) {
  const { month, day } = t.parseKey(key);
  return `${DAYS[t.weekdayOfKey(key) - 1]}, ${MONTHS[month - 1]} ${ordinal(day)}`;
}
// "Sun, Oct 25 · 12:15 PM" for the slide; "Sunday, October 25th at 12:15 PM" when spoken.
function whenText(a) {
  const bits = [];
  if (a.event_date) {
    const k = keyOf(a.event_date); const { month, day } = t.parseKey(k);
    bits.push(`${DAYS[t.weekdayOfKey(k) - 1].slice(0, 3)}, ${MONTHS[month - 1].slice(0, 3)} ${day}`);
  }
  if (a.event_time) bits.push(t.fmtHm(a.event_time));
  if (a.when_note) bits.push(a.when_note);
  return bits.join(' · ');
}
function whenSpoken(a) {
  const bits = [];
  if (a.event_date) bits.push(spokenDate(keyOf(a.event_date)));
  if (a.event_time) bits.push(`at ${t.fmtHm(a.event_time)}`);
  let s = bits.join(' ');
  if (a.when_note) s = s ? `${s}, ${a.when_note}` : a.when_note;
  return s;
}
const withWhen = (a) => ({ ...a, when_text: whenText(a) });

// ---------------------------------------------------------------- data
const list = () => db.many('SELECT * FROM announcements ORDER BY created_at DESC, id DESC');
const latestReel = () => db.one(`SELECT id, service_date, approved_at, duration, video_type FROM announcement_reels
  WHERE status = 'approved' AND video IS NOT NULL ORDER BY service_date DESC, approved_at DESC LIMIT 1`);

function readForm(body) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.event_date || '') ? body.event_date : null;
  const time = /^\d{2}:\d{2}$/.test(body.event_time || '') ? body.event_time : null;
  return {
    title: clean(body.title, 120), description: clean(body.description, 600), event_date: date, event_time: time,
    when_note: clean(body.when_note, 80), details: clean(body.details, 400),
  };
}

async function polishAndSave(id, v) {
  const p = await ai.polish({ ...v, when_text: whenSpoken(v) || whenText(v) });
  await db.query(`UPDATE announcements SET headline = $2, blurb = $3, narration = $4, theme = $5, ai = $6, updated_at = now() WHERE id = $1`,
    [id, p.headline, p.blurb, p.narration, p.theme, Boolean(p.ai)]);
  return p;
}

async function createAnnouncement(v, userId) {
  const row = await db.one(`INSERT INTO announcements (title, description, event_date, event_time, when_note, details, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [v.title, v.description || null, v.event_date || null, v.event_time || null, v.when_note || null, v.details || null, userId]);
  return polishAndSave(row.id, v);
}

// ---------------------------------------------------------------- admin views
function themeOptions(cur) {
  const names = { wheat: 'Wheat field (green)', cross: 'The cross', kids: 'Central Kids', teens: 'Central Teens', missions: 'Missions', fellowship: 'Food & fellowship', worship: 'Worship & music', prayer: 'Prayer', calendar: 'Save the date', celebration: 'Celebration' };
  return Object.entries(names).map(([k, label]) => html`<option value="${k}"${k === cur ? raw(' selected') : ''}>${label}</option>`);
}

function formFields(a = {}, { edit = false } = {}) {
  const d = a.event_date ? keyOf(a.event_date) : '';
  return html`
    <div class="field"><label for="an-title">Title <span class="req">*</span></label><input id="an-title" name="title" required maxlength="120" value="${a.title || ''}" placeholder="Fall Chili Cook-Off"></div>
    <div class="field"><label for="an-desc">Description</label><textarea id="an-desc" name="description" rows="3" maxlength="600" placeholder="Bring your best pot of chili and a friend. Prizes for the top three!">${a.description || ''}</textarea></div>
    <div class="an-row">
      <div class="field"><label for="an-date">Date</label><input id="an-date" type="date" name="event_date" value="${d}"></div>
      <div class="field"><label for="an-time">Time</label><input id="an-time" type="time" name="event_time" value="${a.event_time || ''}"></div>
      <div class="field grow"><label for="an-note">Or in words</label><input id="an-note" name="when_note" maxlength="80" value="${a.when_note || ''}" placeholder="Every Wednesday in November"></div>
    </div>
    <div class="field"><label for="an-details">Notes / details</label><textarea id="an-details" name="details" rows="2" maxlength="400" placeholder="Fellowship Hall. Sign up in the foyer by Oct 18.">${a.details || ''}</textarea></div>
    ${edit ? html`<details class="an-fine"><summary>Fine-tune the slide wording and design</summary>
      <div class="field"><label for="an-head">Slide headline</label><input id="an-head" name="headline" maxlength="60" value="${a.headline || ''}"></div>
      <div class="field"><label for="an-blurb">Slide text</label><textarea id="an-blurb" name="blurb" rows="2" maxlength="160">${a.blurb || ''}</textarea></div>
      <div class="field"><label for="an-narr">What the voice says</label><textarea id="an-narr" name="narration" rows="3" maxlength="600">${a.narration || ''}</textarea></div>
      <div class="field"><label for="an-theme">Design</label><select id="an-theme" name="theme">${themeOptions(a.theme)}</select></div>
      <label class="check"><input type="checkbox" name="repolish" value="1"> Have AI rewrite the slide from the fields above</label>
    </details>` : ''}`;
}

function adminPage({ csrf, items, reels, live }) {
  const aiOn = ai.enabled();
  return html`
  <div class="ci-section-head"><div><h1>Announcements</h1>
    <p class="muted">Type an announcement and ${aiOn ? 'AI turns it into' : 'it becomes'} a slide for the website. Slides stay up until you delete them. Each week, build the narrated announcement video from all current slides, newest first.</p></div></div>
  ${aiOn ? '' : html`<p class="ci-card an-note">AI writing and the spoken voice are off. Add an <strong>OPENAI_API_KEY</strong> in Render to turn them on (about a penny or two a week). Until then, slides use your words as typed and videos have no voice.</p>`}

  <div class="an-grid">
    <section class="ci-card an-new">
      <div class="an-new-head"><h2>New announcement</h2><a class="btn btn-quiet btn-small" href="/checkin/import/announcements">⇪ Import a list</a></div>
      <form method="post" action="/checkin/announcements" class="an-form" data-busy="${aiOn ? 'Writing your slide…' : 'Making your slide…'}">${csrfField(csrf)}
        ${formFields()}
        <button class="btn" type="submit">✨ Make the slide</button>
      </form>
    </section>

    <section class="ci-card an-reel">
      <h2>Weekly announcement video</h2>
      <p class="muted">Opens with our logo and the service date, then every slide (newest first) with a spoken voiceover, and ends on the same title card.</p>
      <form method="post" action="/checkin/announcements/reels" class="an-form" data-busy="Writing the script${ai.voiceEnabled() ? ' and recording the voice' : ''}…">${csrfField(csrf)}
        <div class="field"><label for="rl-date">Service date</label><input id="rl-date" type="date" name="service_date" value="${nextSunday()}" required></div>
        <button class="btn" type="submit"${items.length ? '' : raw(' disabled')}>🎬 Build this week’s video</button>
        ${items.length ? '' : html`<p class="small muted">Add an announcement first.</p>`}
      </form>
      ${reels.length ? html`<ul class="an-reels">${reels.map((r) => html`<li>
        <a href="/checkin/announcements/reels/${r.id}"><strong>${longDate(keyOf(r.service_date))}</strong></a>
        <span class="badge ${r.status === 'approved' ? 'badge-ok' : r.status === 'ready' ? 'badge-warn' : 'badge-muted'}">${{ draft: 'Needs recording', ready: 'Waiting for approval', approved: live && live.id === r.id ? 'Live on the website' : 'Approved', archived: 'Past' }[r.status]}</span>
      </li>`)}</ul>` : ''}
    </section>
  </div>

  <section class="ci-section">
    <h2>Current slides <span class="muted small">(${items.length}, newest first, shown on the website)</span></h2>
    ${items.length ? html`<div class="an-slides">${items.map((a) => html`<article class="ci-card an-slide">
      <a href="/announcements/${a.id}/slide.svg?v=${new Date(a.updated_at).getTime()}" target="_blank" rel="noopener"><img src="/announcements/${a.id}/slide.svg?v=${new Date(a.updated_at).getTime()}" alt="${a.headline || a.title}" width="1920" height="1080" loading="lazy"></a>
      <div class="an-slide-meta"><strong>${a.title}</strong><span class="small muted">Added ${t.fmtDate(a.created_at)}${a.ai ? ' · AI-written' : ''}</span></div>
      <div class="an-slide-actions">
        <a class="btn btn-quiet btn-small" href="/checkin/announcements/${a.id}/edit">Edit</a>
        <a class="btn btn-quiet btn-small" href="/announcements/${a.id}/slide.svg" download="announcement-${a.id}.svg">Download</a>
        <form method="post" action="/checkin/announcements/${a.id}/delete" class="inline" data-confirm="Delete “${a.title}”? It comes off the website and out of future videos.">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">Delete</button></form>
      </div>
    </article>`)}</div>` : html`<div class="empty ci-card"><p><strong>No announcements yet.</strong></p><p>Your first slide will show up here and on the website’s Events &amp; Announcements page.</p></div>`}
  </section>`;
}

function editPage({ csrf, a }) {
  return html`
  <p class="crumb"><a href="/checkin/announcements">Announcements</a></p>
  <div class="ci-section-head"><div><h1>Edit announcement</h1></div></div>
  <div class="an-grid">
    <section class="ci-card"><form method="post" action="/checkin/announcements/${a.id}" class="an-form" data-busy="Saving…">${csrfField(csrf)}
      ${formFields(a, { edit: true })}
      <button class="btn" type="submit">Save slide</button> <a class="btn btn-quiet" href="/checkin/announcements">Cancel</a>
    </form></section>
    <section><img class="an-preview" src="/announcements/${a.id}/slide.svg?v=${new Date(a.updated_at).getTime()}" alt="Slide preview" width="1920" height="1080"></section>
  </div>`;
}

function reelPage({ csrf, r, user }) {
  const items = r.items || [];
  const status = { draft: 'Not recorded yet', ready: 'Recorded, waiting for approval', approved: 'Approved and on the website', archived: 'Past video' }[r.status];
  return html`
  <p class="crumb"><a href="/checkin/announcements">Announcements</a></p>
  <div class="ci-section-head"><div><h1>Announcement video · ${longDate(keyOf(r.service_date))}</h1>
    <p class="muted">${status}. ${items.length - 2} announcement${items.length - 2 === 1 ? '' : 's'}${r.voice ? ', with voiceover' : ', no voiceover'}.</p></div></div>
  <div class="an-grid an-grid-reel">
    <section class="ci-card">
      ${r.has_video ? html`
        <video class="an-video" controls playsinline preload="metadata" src="/announcements/reels/${r.id}/video?v=${r.video_size}" poster="/announcements/title.svg?date=${keyOf(r.service_date)}"></video>
        <div class="an-actions">
          ${r.status !== 'approved' ? html`<form method="post" action="/checkin/announcements/reels/${r.id}/approve" class="inline">${csrfField(csrf)}<button class="btn" type="submit">✓ Approve and put on the website</button></form>` : html`<span class="badge badge-ok">Live on the website</span>`}
          <a class="btn btn-quiet" href="/announcements/reels/${r.id}/video" download="announcements-${keyOf(r.service_date)}.${/mp4/.test(r.video_type) ? 'mp4' : 'webm'}">Download for Facebook / YouTube</a>
          <button class="btn btn-quiet" type="button" data-record>Record again</button>
        </div>`
      : html`<p>Press record and keep this tab open while it plays through. It takes about as long as the video itself (roughly ${Math.max(1, Math.round(items.reduce((s, i) => s + (i.seconds || 6), 0) / 60))} min).</p>
        <button class="btn btn-big" type="button" data-record>⏺ Record the video</button>`}
      <div class="an-stage" hidden><canvas width="1280" height="720" aria-label="Recording preview"></canvas><p class="an-progress small muted" role="status"></p></div>
      <form method="post" action="/checkin/announcements/reels/${r.id}/delete" class="an-del" data-confirm="Delete this video?">${csrfField(csrf)}<button class="btn btn-quiet btn-small" type="submit">Delete this video</button></form>
    </section>
    <section class="ci-card">
      <h2>Script</h2>
      <ol class="an-script">${items.map((i) => html`<li><img src="${i.image}" alt="" width="1920" height="1080" loading="lazy"><p>${i.say || html`<span class="muted">(no voice)</span>`}</p></li>`)}</ol>
    </section>
  </div>
  <div id="reel" data-plan="/checkin/announcements/reels/${r.id}/plan.json" data-upload="/checkin/announcements/reels/${r.id}/video" data-csrf="${csrf}"></div>
  <script src="/js/reel.js?v=1" defer></script>`;
}

// ---------------------------------------------------------------- routes
function routes(app, { render }) {
  const need = async (req, res, next) => {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || req.path)}`);
    if (!canAnnounce(req.user)) throw new HttpError(403, 'Announcements are for church admins and library staff.');
    await next();
  };

  app.get('/checkin/announcements', need, async (req, res) => {
    const [items, reels, live] = await Promise.all([list(), db.many(`SELECT id, service_date, status FROM announcement_reels ORDER BY service_date DESC, id DESC LIMIT 8`), latestReel()]);
    render(req, res, adminPage({ csrf: res.locals.csrf, items, reels, live }), { title: 'Announcements', tab: 'announce' });
  });

  app.post('/checkin/announcements', need, security.rateLimit('announce', { max: 60, windowMs: 3600000 }), async (req, res) => {
    const v = readForm(req.body);
    if (!v.title) { security.flash(req, 'error', 'Give the announcement a title.'); return res.redirect('/checkin/announcements'); }
    const p = await createAnnouncement(v, req.user.id);
    security.flash(req, 'ok', `Your slide “${p.headline}” is ready and showing on the website.`);
    res.redirect('/checkin/announcements');
  });

  app.get('/checkin/announcements/:id/edit', need, async (req, res) => {
    const a = await db.one('SELECT * FROM announcements WHERE id = $1', [intParam(req.params.id)]);
    if (!a) throw new HttpError(404, 'That announcement was not found.');
    render(req, res, editPage({ csrf: res.locals.csrf, a }), { title: 'Edit announcement', tab: 'announce' });
  });

  app.post('/checkin/announcements/:id', need, async (req, res) => {
    const id = intParam(req.params.id);
    const a = await db.one('SELECT * FROM announcements WHERE id = $1', [id]);
    if (!a) throw new HttpError(404, 'That announcement was not found.');
    const v = readForm(req.body);
    if (!v.title) { security.flash(req, 'error', 'Give the announcement a title.'); return res.redirect(`/checkin/announcements/${id}/edit`); }
    await db.query(`UPDATE announcements SET title = $2, description = $3, event_date = $4, event_time = $5, when_note = $6, details = $7, updated_at = now() WHERE id = $1`,
      [id, v.title, v.description, v.event_date, v.event_time, v.when_note, v.details]);
    const factsChanged = ['title', 'description', 'when_note', 'details', 'event_time'].some((k) => (a[k] || null) !== (v[k] || null)) || (a.event_date ? keyOf(a.event_date) : null) !== v.event_date;
    if (req.body.repolish === '1' || (factsChanged && req.body.headline === (a.headline || '') && req.body.blurb === (a.blurb || ''))) {
      await polishAndSave(id, v);
    } else {
      await db.query('UPDATE announcements SET headline = $2, blurb = $3, narration = $4, theme = $5, updated_at = now() WHERE id = $1',
        [id, clean(req.body.headline, 60) || v.title, clean(req.body.blurb, 160), clean(req.body.narration, 600), ai.THEMES.includes(req.body.theme) ? req.body.theme : a.theme]);
    }
    security.flash(req, 'ok', 'Slide saved.');
    res.redirect('/checkin/announcements');
  });

  app.post('/checkin/announcements/:id/delete', need, async (req, res) => {
    const row = await db.one('DELETE FROM announcements WHERE id = $1 RETURNING title', [intParam(req.params.id)]);
    security.flash(req, 'ok', row ? `Deleted “${row.title}”.` : 'That announcement was already deleted.');
    res.redirect('/checkin/announcements');
  });

  // ---- weekly reel
  app.post('/checkin/announcements/reels', need, security.rateLimit('announce-reel', { max: 20, windowMs: 3600000 }), async (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.service_date || '') ? req.body.service_date : nextSunday();
    const items = await list();
    if (!items.length) { security.flash(req, 'error', 'Add an announcement first.'); return res.redirect('/checkin/announcements'); }
    const title = `/announcements/title.svg?date=${date}`;
    const plan = [
      { kind: 'title', image: title, say: ai.introLine(spokenDate(date), items.length) },
      ...items.map((a) => ({ kind: 'slide', id: a.id, image: `/announcements/${a.id}/slide.svg?v=${new Date(a.updated_at).getTime()}`, say: a.narration || ai.plainCopy(withWhen(a)).narration })),
      { kind: 'end', image: title, say: ai.OUTRO },
    ];
    const voice = ai.voiceEnabled();
    const reel = await db.one(`INSERT INTO announcement_reels (service_date, items, voice, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [date, JSON.stringify(plan), voice, req.user.id]);
    if (voice) {
      try {
        // A few at a time, so a week of announcements is ready in well under a minute.
        let next = 0;
        await Promise.all(Array.from({ length: 3 }, async () => {
          while (next < plan.length) {
            const i = next++;
            const s = await ai.speak(plan[i].say);
            if (s) await db.query('INSERT INTO announcement_reel_audio (reel_id, idx, audio, type) VALUES ($1, $2, $3, $4)', [reel.id, i, s.audio, s.type]);
          }
        }));
      } catch (e) {
        console.error('Voiceover failed:', e.message);
        await db.query('DELETE FROM announcement_reel_audio WHERE reel_id = $1', [reel.id]);
        await db.query('UPDATE announcement_reels SET voice = false WHERE id = $1', [reel.id]);
        security.flash(req, 'error', 'The voiceover couldn’t be made right now, so this video has no voice. You can try building it again in a few minutes.');
      }
    }
    res.redirect(`/checkin/announcements/reels/${reel.id}`);
  });

  const getReel = async (id) => {
    const r = await db.one(`SELECT id, service_date, status, items, voice, video_type, video_size, duration, approved_at, (video IS NOT NULL) AS has_video
      FROM announcement_reels WHERE id = $1`, [id]);
    if (!r) throw new HttpError(404, 'That video was not found.');
    return r;
  };

  app.get('/checkin/announcements/reels/:id', need, async (req, res) => {
    const r = await getReel(intParam(req.params.id));
    render(req, res, reelPage({ csrf: res.locals.csrf, r, user: req.user }), { title: 'Announcement video', tab: 'announce' });
  });

  app.get('/checkin/announcements/reels/:id/plan.json', need, async (req, res) => {
    const r = await getReel(intParam(req.params.id));
    const audio = new Set((await db.many('SELECT idx FROM announcement_reel_audio WHERE reel_id = $1', [r.id])).map((x) => x.idx));
    res.json({
      id: r.id, date: keyOf(r.service_date),
      items: (r.items || []).map((i, idx) => ({ kind: i.kind, image: i.image, say: i.say, audio: audio.has(idx) ? `/checkin/announcements/reels/${r.id}/audio/${idx}` : null })),
    });
  });

  app.get('/checkin/announcements/reels/:id/audio/:idx', need, async (req, res) => {
    const a = await db.one('SELECT audio, type FROM announcement_reel_audio WHERE reel_id = $1 AND idx = $2', [intParam(req.params.id), Number(req.params.idx) || 0]);
    if (!a) throw new HttpError(404, 'No audio.');
    res.setHeader('Content-Type', a.type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(a.audio);
  });

  app.post('/checkin/announcements/reels/:id/video', need, async (req, res) => {
    const id = intParam(req.params.id);
    const type = String(req.headers['content-type'] || '').split(';')[0].trim();
    if (!/^video\/(webm|mp4)$/.test(type)) throw new HttpError(400, 'Upload a WebM or MP4 video.');
    const buf = req.rawBody;
    if (!buf || buf.length < 1000) throw new HttpError(400, 'The recording came out empty. Try recording again.');
    if (buf.length > MAX_VIDEO) throw new HttpError(413, 'That video is too large.');
    const duration = Number(req.headers['x-duration']) || null;
    const r = await db.one(`UPDATE announcement_reels SET video = $2, video_type = $3, video_size = $4, duration = $5,
      status = 'ready', approved_at = NULL, approved_by = NULL WHERE id = $1 RETURNING id`, [id, buf, type, buf.length, duration]);
    if (!r) throw new HttpError(404, 'That video was not found.');
    res.json({ ok: true, next: `/checkin/announcements/reels/${id}` });
  });

  app.post('/checkin/announcements/reels/:id/approve', need, async (req, res) => {
    const id = intParam(req.params.id);
    const r = await db.one(`UPDATE announcement_reels SET status = 'approved', approved_by = $2, approved_at = now()
      WHERE id = $1 AND video IS NOT NULL RETURNING service_date`, [id, req.user.id]);
    if (!r) { security.flash(req, 'error', 'Record the video before approving it.'); return res.redirect(`/checkin/announcements/reels/${id}`); }
    await db.query(`UPDATE announcement_reels SET status = 'archived' WHERE status = 'approved' AND id <> $1`, [id]);
    security.flash(req, 'ok', 'Approved. It’s now on the website’s Events & Announcements page.');
    res.redirect(`/checkin/announcements/reels/${id}`);
  });

  app.post('/checkin/announcements/reels/:id/delete', need, async (req, res) => {
    await db.query('DELETE FROM announcement_reels WHERE id = $1', [intParam(req.params.id)]);
    security.flash(req, 'ok', 'Video deleted.');
    res.redirect('/checkin/announcements');
  });

  // ---- public: slides and the approved video
  app.get('/announcements/:id/slide.svg', async (req, res) => {
    const a = await db.one('SELECT * FROM announcements WHERE id = $1', [intParam(req.params.id)]);
    if (!a) throw new HttpError(404, 'Not found.');
    for (const [k, v] of Object.entries(S.SVG_HEADERS)) res.setHeader(k, v);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(S.slide(withWhen(a)));
  });

  app.get('/announcements/title.svg', async (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : nextSunday();
    for (const [k, v] of Object.entries(S.SVG_HEADERS)) res.setHeader(k, v);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(S.titleCard(longDate(date)));
  });

  app.get('/announcements/reels/:id/video', async (req, res) => {
    const id = intParam(req.params.id);
    const meta = await db.one('SELECT status, video_type, video_size FROM announcement_reels WHERE id = $1 AND video IS NOT NULL', [id]);
    if (!meta || (meta.status !== 'approved' && !canAnnounce(req.user))) throw new HttpError(404, 'Not found.');
    const size = meta.video_size;
    res.setHeader('Content-Type', meta.video_type);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', meta.status === 'approved' ? 'public, max-age=3600' : 'private, no-store');
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = size - 1;
    if (m) {
      start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end || start >= size) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); return res.end(); }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    const row = await db.one('SELECT substring(video FROM $2 FOR $3) AS part FROM announcement_reels WHERE id = $1', [id, start + 1, end - start + 1]);
    res.send(row.part);
  });
}

module.exports = { routes, createAnnouncement, canAnnounce, list, latestReel, longDate, keyOf, nextSunday };

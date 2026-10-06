'use strict';
// Staff safety: required training and policies (the account stays locked until both
// are done), incident reports, and the admin dashboard that tracks it all.
const db = require('../db');
const security = require('../lib/security');
const { HttpError } = require('../lib/http');
const { html, raw, checked, selected } = require('../lib/html');
const t = require('../lib/time');
const { pushTo } = require('../notify');
const { intParam, clean } = require('../routes/guards');
const D = require('./data');
const { MODULES, MODULE, SRC, CERTIFICATION } = require('./training');

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const fullName = (u) => `${u.first_name} ${u.last_name}`.trim();
const role = (u) => (u && (u.realRole || u.checkin_role)) || null;

// ---------------------------------------------------------------- training status
const requiredPolicies = () => db.many(`SELECT id, title FROM policies WHERE requires_ack ORDER BY title`);

async function status(user) {
  const [done, policies, acks] = await Promise.all([
    db.many('SELECT module, version, completed_at FROM training_completions WHERE user_id = $1', [user.id]),
    requiredPolicies(),
    db.many('SELECT policy_id, acked_at FROM policy_acks WHERE user_id = $1', [user.id]),
  ]);
  const doneMap = new Map(done.map((d) => [d.module, d]));
  const ackMap = new Map(acks.map((a) => [a.policy_id, a]));
  const modules = MODULES.map((m) => {
    const d = doneMap.get(m.key);
    return { ...m, done: Boolean(d && d.version === m.version), completed_at: d && d.version === m.version ? d.completed_at : null };
  });
  const pols = policies.map((p) => ({ ...p, done: ackMap.has(p.id), acked_at: ackMap.get(p.id) && ackMap.get(p.id).acked_at }));
  const total = modules.length + pols.length;
  const count = modules.filter((m) => m.done).length + pols.filter((p) => p.done).length;
  return { modules, policies: pols, total, count, complete: count >= total };
}

// Staff are locked until training is complete, unless they're the primary admin or an admin waived it.
async function isLocked(user) {
  if (!user || !user.checkin_role || user.checkin_role === 'admin' || user.training_waived_at) return false;
  return !(await status(user)).complete;
}

// ---------------------------------------------------------------- formatting
// Policy text: blank line = new paragraph, "# " = heading, "- " = bullet.
function formatText(text) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n/);
  return blocks.map((b) => {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return '';
    if (lines.every((l) => /^[-*•] /.test(l))) return html`<ul>${lines.map((l) => html`<li>${l.replace(/^[-*•] /, '')}</li>`)}</ul>`;
    if (lines.length === 1 && /^#{1,3} /.test(lines[0])) return html`<h3>${lines[0].replace(/^#+ /, '')}</h3>`;
    return html`<p>${lines.map((l, i) => html`${i ? raw('<br>') : ''}${l}`)}</p>`;
  });
}

// ---------------------------------------------------------------- views
function progressBar(st) {
  const pct = st.total ? Math.round((st.count / st.total) * 100) : 100;
  return html`<div class="ci-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${st.total}" aria-valuenow="${st.count}"><span style="width:${pct}%"></span></div>
    <p class="small muted">${st.count} of ${st.total} complete</p>`;
}

function hubPage({ user, st, locked }) {
  const nextModule = st.modules.find((m) => !m.done);
  const nextPolicy = st.policies.find((p) => !p.done);
  return html`
  <div class="ci-narrow">
    <h1>Training</h1>
    ${locked ? html`<div class="ci-alert ci-alert-warn"><strong>Welcome to the team!</strong> Before you can check kids in, please read each policy and complete each training below. When everything is checked off, your account unlocks automatically.</div>`
      : st.complete ? html`<div class="ci-alert ci-alert-ok"><strong>All done. Thank you!</strong> You’ve completed every required policy and training.${role(user) === 'admin' ? '' : ''}</div>` : ''}
    ${progressBar(st)}
    ${nextModule || nextPolicy ? html`<p><a class="btn ci-big-btn" href="${nextPolicy ? `/checkin/policies/${nextPolicy.id}` : `/checkin/training/${nextModule.key}`}">${st.count ? 'Continue' : 'Start'}: ${nextPolicy ? nextPolicy.title : nextModule.title}</a></p>` : ''}
    ${st.policies.length ? html`<section class="ci-section"><h2>1. Read our policies</h2>
      <ul class="ci-train-list">${st.policies.map((p) => html`<li><a class="ci-train-item${p.done ? ' is-done' : ''}" href="/checkin/policies/${p.id}">
        <span class="ci-train-check" aria-hidden="true">${p.done ? '✓' : ''}</span>
        <span class="ci-conv-text"><span class="ci-conv-name">${p.title}</span><span class="ci-conv-last">${p.done ? `Confirmed ${t.fmtDateYear(p.acked_at)}` : 'Read and confirm'}</span></span>
      </a></li>`)}</ul></section>` : ''}
    <section class="ci-section"><h2>${st.policies.length ? '2. ' : ''}Complete each training</h2>
      <ul class="ci-train-list">${st.modules.map((m) => html`<li><a class="ci-train-item${m.done ? ' is-done' : ''}" href="/checkin/training/${m.key}">
        <span class="ci-train-check" aria-hidden="true">${m.done ? '✓' : ''}</span>
        <span class="ci-conv-text"><span class="ci-conv-name">${m.title}</span><span class="ci-conv-last">${m.done ? `Completed ${t.fmtDateYear(m.completed_at)}` : `About ${m.minutes} minutes${m.videos && m.videos.length ? ` · ${m.videos.length} video${m.videos.length === 1 ? '' : 's'}` : ''}`}</span></span>
      </a></li>`)}</ul></section>
    <p class="small muted">Lessons are drawn from the U.S. Department of Health & Human Services, the CDC, Darkness to Light, Stop It Now, the NSPCC, the National Center for Missing & Exploited Children, the FBI, RAINN, the Kansas Department for Children and Families, Scouting America Youth Protection, Southern Baptist abuse-prevention resources (ERLC Caring Well, SBC Abuse Prevention), the American Heart Association, the American Red Cross and Nicklaus Children’s Hospital. Each lesson lists its sources. For deeper, free training, see <a href="https://sbcabuseprevention.com/" target="_blank" rel="noopener">SBC Abuse Prevention’s Essentials course</a>.</p>
  </div>`;
}

function modulePage({ csrf, m, done, index }) {
  return html`
  <article class="ci-narrow ci-lesson" data-scroll-gate>
    <p class="crumb"><a href="/checkin/training">Training</a> · Lesson ${index + 1} of ${MODULES.length}</p>
    <h1>${m.title}</h1>
    <p class="ci-lede">${m.intro}</p>
    ${m.sections.map((sec) => html`<section class="ci-lesson-sec"><h2>${sec.h}</h2>
      ${(sec.p || []).map((p) => html`<p>${raw(p)}</p>`)}
      ${sec.list ? html`<ul>${sec.list.map((li) => html`<li>${raw(li)}</li>`)}</ul>` : ''}</section>`)}
    ${m.videos && m.videos.length ? html`<section class="ci-lesson-sec"><h2>Watch</h2>
      <div class="ci-videos">${m.videos.map((v) => html`<figure class="ci-video-card">
        <div class="ci-video"><iframe src="${v.host === 'vimeo' ? `https://player.vimeo.com/video/${v.id}?dnt=1&title=0&byline=0` : `https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1`}" title="${v.title}" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
        <figcaption><strong>${v.title}</strong><br><span class="small muted">${v.by}${v.minutes ? ` · about ${v.minutes} min` : ''} · <a href="${v.host === 'vimeo' ? `https://vimeo.com/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`}" target="_blank" rel="noopener">Open in a new tab</a></span></figcaption>
      </figure>`)}</div></section>` : ''}
    ${m.certification ? html`<section class="ci-lesson-sec ci-cert"><h2>Get certified</h2>
      <p>Central encourages everyone serving with children to hold a current CPR and first-aid certification. These courses are offered near Winfield and online with an in-person skills check:</p>
      <ul>${CERTIFICATION.map((c) => html`<li><a href="${c.url}" target="_blank" rel="noopener"><strong>${c.title}</strong></a><br><span class="small">${c.note}</span></li>`)}</ul></section>` : ''}
    <section class="ci-lesson-sec ci-sources"><h2>Sources</h2><ul>${m.sources.map((k) => html`<li><a href="${SRC[k].url}" target="_blank" rel="noopener">${SRC[k].title}</a></li>`)}</ul></section>
    <form method="post" action="/checkin/training/${m.key}" class="ci-card ci-confirm" data-confirm-form>
      ${csrfField(csrf)}
      <h2>Before you finish</h2>
      <p class="small muted" data-gate-note>Scroll through the whole lesson to unlock these boxes.</p>
      ${m.confirm.map((c, i) => html`<label class="ci-pref"><input type="checkbox" name="c${i}" value="1" required data-gated${checked(done)}><span>${c}</span></label>`)}
      <button class="btn ci-big-btn" type="submit" data-gated>${done ? 'Completed. Save again' : 'Complete this lesson'}</button>
    </form>
  </article>`;
}

function policyReadPage({ csrf, user, p, acked }) {
  const isPdf = /pdf/.test(p.mime || '');
  const isImg = /image/.test(p.mime || '');
  return html`
  <article class="ci-narrow ci-lesson" data-scroll-gate${p.filename && !p.body && !isPdf && !isImg ? raw(' data-needs-open') : ''}>
    <p class="crumb"><a href="${user.checkinLocked ? '/checkin/training' : '/checkin/policies'}">${user.checkinLocked ? 'Training' : 'Policies'}</a></p>
    <h1>${p.title}</h1>
    ${p.description ? html`<p class="ci-lede">${p.description}</p>` : ''}
    ${p.body ? html`<div class="ci-policy-body">${formatText(p.body)}</div>` : ''}
    ${p.filename ? (isPdf ? html`<div class="ci-pdf"><iframe src="/checkin/policies/${p.id}/file" title="${p.title}"></iframe></div><p class="small"><a href="/checkin/policies/${p.id}/file" target="_blank" rel="noopener" data-open-file>Open the PDF in a new tab</a> (easier on phones)</p>`
      : isImg ? html`<img class="ci-policy-img" src="/checkin/policies/${p.id}/file" alt="${p.title}">`
      : html`<p><a class="btn" href="/checkin/policies/${p.id}/file" target="_blank" rel="noopener" data-open-file>Open ${p.filename}</a></p><p class="small muted">Open and read the document, then come back here to confirm.</p>`) : ''}
    ${p.requires_ack ? html`<form method="post" action="/checkin/policies/${p.id}/ack" class="ci-card ci-confirm" data-confirm-form>
      ${csrfField(csrf)}
      ${acked ? html`<p class="badge badge-ok">You confirmed this on ${t.fmtDateYear(acked.acked_at)}</p>` : html`<p class="small muted" data-gate-note>Scroll to the end${p.filename && !p.body ? ' (and open the document)' : ''} to unlock the box below.</p>
      <label class="ci-pref"><input type="checkbox" name="confirm" value="1" required data-gated><span>I have read and understand “${p.title}”, and I agree to follow it.</span></label>
      <button class="btn ci-big-btn" type="submit" data-gated>Confirm</button>`}
    </form>` : ''}
  </article>`;
}

const CATEGORIES = ['Injury or accident', 'Illness', 'Allergic reaction', 'Behavior', 'Bullying or conflict between children', 'Missing or lost child', 'Unauthorized pickup attempt', 'Custody or court-order concern', 'Suspected abuse or neglect', 'Inappropriate conduct by an adult or leader', 'Facility or safety hazard', 'Other'];
const SEVERITY = [['minor', 'Minor'], ['moderate', 'Moderate'], ['serious', 'Serious']];
const STATUS = { open: 'Open', reviewed: 'Reviewed', closed: 'Closed' };

function incidentForm({ csrf, events, v = {}, error }) {
  const now = t.parts(new Date());
  const local = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}T${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;
  return html`
  <div class="ci-narrow">
    <p class="crumb"><a href="/checkin/incidents">Incident reports</a></p>
    <h1>New incident report</h1>
    <div class="ci-alert ci-alert-danger"><strong>Suspected abuse?</strong> If a child is in immediate danger, call <a href="tel:911">911</a>. Otherwise call the Kansas Protection Report Center at <a href="tel:+18009225330">1-800-922-5330</a> (24/7), tell the ministry director, then file this report. Filing here does not replace a report to authorities.</div>
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    <form method="post" action="/checkin/incidents" class="stack ci-form">
      ${csrfField(csrf)}
      <div class="row">
        <div class="field"><label for="in-when">When did it happen?</label><input id="in-when" name="occurred_at" type="datetime-local" value="${v.occurred_at || local}" required></div>
        <div class="field"><label for="in-event">Service or event</label><select id="in-event" name="event_id"><option value="">—</option>${events.map((e) => html`<option value="${e.id}"${selected(String(e.id), String(v.event_id || ''))}>${e.name} · ${t.fmtDate(t.zoned(...String(e.event_date).slice(0, 10).split('-').map(Number), 12))}</option>`)}</select></div>
      </div>
      <div class="row">
        <div class="field"><label for="in-cat">What kind of incident?</label><select id="in-cat" name="category" required><option value="">Choose…</option>${CATEGORIES.map((c) => html`<option${selected(c, v.category)}>${c}</option>`)}</select></div>
        <div class="field short"><label for="in-sev">How serious?</label><select id="in-sev" name="severity">${SEVERITY.map(([k, l]) => html`<option value="${k}"${selected(k, v.severity || 'minor')}>${l}</option>`)}</select></div>
        <div class="field"><label for="in-loc">Where?</label><input id="in-loc" name="location" value="${v.location || ''}" placeholder="e.g. Nursery, gym, parking lot"></div>
      </div>
      <div class="field"><label for="in-people">Who was involved?</label><input id="in-people" name="people_text" value="${v.people_text || ''}" placeholder="Children’s and adults’ names" data-people-search autocomplete="off"><input type="hidden" name="person_ids" value="${v.person_ids || ''}" data-people-ids><div class="ci-results" data-people-results></div><p class="hint">Start typing a name to pick from the families on file, or just type names.</p></div>
      <div class="field"><label for="in-desc">What happened?</label><textarea id="in-desc" name="description" rows="6" required placeholder="Facts only: what you saw and heard, in order. Use the child’s exact words if they told you something.">${v.description || ''}</textarea></div>
      <div class="field"><label for="in-action">What did you do?</label><textarea id="in-action" name="action_taken" rows="3" placeholder="e.g. Applied ice, separated the children, called the parent">${v.action_taken || ''}</textarea></div>
      <label class="check"><input type="checkbox" name="first_aid" value="1"${checked(v.first_aid)}> First aid was given</label>
      <div class="field"><label for="in-wit">Witnesses</label><input id="in-wit" name="witnesses" value="${v.witnesses || ''}" placeholder="Other adults who saw it"></div>
      <label class="check"><input type="checkbox" name="parent_notified" value="1"${checked(v.parent_notified)} data-toggle="#in-parent-how"> A parent or guardian was told</label>
      <div class="field" id="in-parent-how"${v.parent_notified ? '' : raw(' hidden')}><label for="in-how">Who, when and how?</label><input id="in-how" name="parent_notified_how" value="${v.parent_notified_how || ''}" placeholder="e.g. Told mom (Dana) at pickup, 10:30"></div>
      <label class="check"><input type="checkbox" name="authorities_contacted" value="1"${checked(v.authorities_contacted)} data-toggle="#in-auth"> 911, police or the Kansas Protection Report Center was contacted</label>
      <div class="field" id="in-auth"${v.authorities_contacted ? '' : raw(' hidden')}><label for="in-authd">Details</label><input id="in-authd" name="authorities_detail" value="${v.authorities_detail || ''}" placeholder="Who you called, when, and any report number"></div>
      <div class="field"><label for="in-follow">Follow-up needed?</label><textarea id="in-follow" name="follow_up" rows="2">${v.follow_up || ''}</textarea></div>
      <button class="btn ci-big-btn" type="submit">Submit report</button>
      <p class="hint">Reports go to the church admins and are kept private.</p>
    </form>
  </div>`;
}

function incidentList({ user, rows, filter }) {
  const admin = D.can(user, 'coadmin');
  return html`
  <div class="ci-section-head"><div><h1>Incident reports</h1><p class="muted">${admin ? 'All reports. Only admins see this list.' : 'Reports you’ve filed.'}</p></div>
    <div class="ci-family-tools"><a class="btn btn-small" href="/checkin/incidents/new">New report</a></div></div>
  ${admin ? html`<p class="ci-chips">${[['', 'All'], ['open', 'Open'], ['reviewed', 'Reviewed'], ['closed', 'Closed']].map(([k, l]) => html`<a class="ci-chip${filter === k ? ' is-on' : ''}" href="/checkin/incidents${k ? `?status=${k}` : ''}">${l}</a>`)}</p>` : ''}
  ${rows.length ? html`<div class="table-wrap"><table class="ci-table"><thead><tr><th>When</th><th>Type</th><th>Who</th><th>Severity</th><th>Filed by</th><th>Status</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr class="sev-${r.severity}"><td><a href="/checkin/incidents/${r.id}">${t.fmtDate(r.occurred_at)} ${t.fmtTime(r.occurred_at)}</a></td><td>${r.category}</td><td>${r.people_text || '—'}</td>
      <td><span class="badge ${r.severity === 'serious' ? 'badge-danger' : r.severity === 'moderate' ? 'badge-warn' : 'badge-muted'}">${r.severity}</span></td><td>${r.reporter || '—'}</td><td><span class="badge ${r.status === 'open' ? 'badge-info' : 'badge-ok'}">${STATUS[r.status]}</span></td></tr>`)}
  </tbody></table></div>` : html`<div class="empty"><p>No incident reports${filter ? ` marked ${filter}` : ''}.</p></div>`}`;
}

function incidentView({ csrf, user, r }) {
  const admin = D.can(user, 'coadmin');
  const row = (label, value) => (value ? html`<tr><th>${label}</th><td>${value}</td></tr>` : '');
  return html`
  <div class="ci-narrow">
    <p class="crumb"><a href="/checkin/incidents">Incident reports</a></p>
    <div class="ci-section-head"><div><h1>${r.category}</h1><p class="muted">${t.fmtLong(r.occurred_at)} at ${t.fmtTime(r.occurred_at)}${r.event_name ? ` · ${r.event_name}` : ''}</p></div>
      <span class="badge ${r.status === 'open' ? 'badge-info' : 'badge-ok'}">${STATUS[r.status]}</span></div>
    <table class="ci-detail">
      ${row('Severity', r.severity)}${row('Where', r.location)}${row('Who', r.people_text)}
      <tr><th>What happened</th><td class="pre">${r.description}</td></tr>
      ${row('Action taken', r.action_taken)}${row('First aid', r.first_aid ? 'Yes' : '')}${row('Witnesses', r.witnesses)}
      ${row('Parent told', r.parent_notified ? (r.parent_notified_how || 'Yes') : 'Not yet')}
      ${row('Authorities', r.authorities_contacted ? (r.authorities_detail || 'Contacted') : '')}
      ${row('Follow-up', r.follow_up)}
      ${row('Filed by', `${r.reporter || 'Unknown'} · ${t.fmtDateTime(r.created_at)}`)}
      ${row('Reviewed', r.reviewer ? `${r.reviewer} · ${t.fmtDateTime(r.reviewed_at)}` : '')}
    </table>
    <p><button type="button" class="btn btn-quiet btn-small" data-print-page>Print</button></p>
    ${admin ? html`<form method="post" action="/checkin/incidents/${r.id}" class="ci-card stack">
      ${csrfField(csrf)}
      <h2>Admin review</h2>
      <div class="field"><label for="ir-notes">Notes (only admins see these)</label><textarea id="ir-notes" name="admin_notes" rows="4">${r.admin_notes || ''}</textarea></div>
      <div class="field short"><label for="ir-status">Status</label><select id="ir-status" name="status">${Object.entries(STATUS).map(([k, l]) => html`<option value="${k}"${selected(k, r.status)}>${l}</option>`)}</select></div>
      <button class="btn" type="submit">Save</button>
    </form>` : ''}
  </div>`;
}

function dashboard({ csrf, team, st, incidents, broadcasts, openReports, prayers }) {
  return html`
  <div class="ci-section-head"><div><h1>Admin</h1><p class="muted">Training, policies, incidents and messages at a glance.</p></div>
    <div class="ci-family-tools"><a class="btn btn-small" href="/checkin/broadcast">Message a group</a><a class="btn btn-quiet btn-small" href="/checkin/staff">Team</a><a class="btn btn-quiet btn-small" href="/checkin/policies">Policies</a></div></div>
  <div class="ci-stats">
    <div class="ci-stat"><strong>${team.filter((u) => u.complete).length}/${team.length}</strong><small>team members fully trained</small></div>
    <div class="ci-stat"><strong>${incidents.filter((i) => i.status === 'open').length}</strong><small>open incident reports</small></div>
    <div class="ci-stat"><strong>${openReports}</strong><small>reported messages to review</small></div>
    <div class="ci-stat"><strong>${prayers}</strong><small>prayer requests this month</small></div>
  </div>
  <section class="ci-section"><h2>Team training and policies</h2>
    <div class="table-wrap"><table class="ci-table ci-compliance">
      <thead><tr><th>Name</th><th>Role</th>${st.policies.map((p) => html`<th title="${p.title}">${p.title.length > 18 ? `${p.title.slice(0, 17)}…` : p.title}</th>`)}${MODULES.map((m) => html`<th title="${m.title}">${m.title.split(' ').slice(0, 2).join(' ')}</th>`)}<th>Account</th></tr></thead>
      <tbody>${team.map((u) => html`<tr>
        <td>${fullName(u)}</td><td>${D.ROLE_LABEL[u.checkin_role]}</td>
        ${st.policies.map((p) => html`<td class="${u.acks.has(p.id) ? 'yes' : 'no'}">${u.acks.has(p.id) ? html`✓ <small>${t.fmtDate(u.acks.get(p.id))}</small>` : '—'}</td>`)}
        ${MODULES.map((m) => html`<td class="${u.mods.has(m.key) ? 'yes' : 'no'}">${u.mods.has(m.key) ? html`✓ <small>${t.fmtDate(u.mods.get(m.key))}</small>` : '—'}</td>`)}
        <td>${u.checkin_role === 'admin' ? html`<span class="badge badge-ok">Primary admin</span>` : u.training_waived_at ? html`<span class="badge badge-ok">Waived</span>` : u.complete ? html`<span class="badge badge-ok">Unlocked</span>` : html`<span class="badge badge-warn">Locked ${u.count}/${st.total}</span>
          <form method="post" action="/checkin/staff/${u.id}/waive" class="inline" data-confirm="Unlock ${fullName(u)} without finishing training? Use this only if they completed equivalent training elsewhere.">${csrfField(csrf)}<button class="linklike small" type="submit">Waive</button></form>`}</td>
      </tr>`)}</tbody>
    </table></div>
    <p class="small muted">New team members are locked out of check-in until every required policy and lesson is done. Mark a policy “Required” when you add it on the Policies page.</p>
  </section>
  <section class="ci-section"><div class="ci-section-head"><h2>Recent incident reports</h2><a class="btn btn-quiet btn-small" href="/checkin/incidents">All reports</a></div>
    ${incidents.length ? html`<div class="table-wrap"><table class="ci-table"><thead><tr><th>When</th><th>Type</th><th>Who</th><th>Severity</th><th>Status</th></tr></thead><tbody>
      ${incidents.map((r) => html`<tr><td><a href="/checkin/incidents/${r.id}">${t.fmtDate(r.occurred_at)}</a></td><td>${r.category}</td><td>${r.people_text || '—'}</td><td>${r.severity}</td><td>${STATUS[r.status]}</td></tr>`)}
    </tbody></table></div>` : html`<p class="muted">No incident reports yet.</p>`}
  </section>
  <section class="ci-section"><div class="ci-section-head"><h2>Group messages</h2><a class="btn btn-quiet btn-small" href="/checkin/broadcast">New group message</a></div>
    ${broadcasts.length ? html`<div class="table-wrap"><table class="ci-table"><thead><tr><th>Sent</th><th>Message</th><th>To</th><th>Responses</th></tr></thead><tbody>
      ${broadcasts.map((b) => html`<tr><td>${t.fmtDate(b.created_at)}</td><td><a href="/checkin/broadcast/${b.id}">${b.title || b.body.slice(0, 60)}</a></td><td>${b.total}</td>
        <td>${b.kind === 'confirm' ? html`<span class="badge badge-ok">${b.yes} ${b.yes_label || 'yes'}</span> <span class="badge badge-muted">${b.no} ${b.no_label || 'no'}</span> <span class="small muted">${b.total - b.yes - b.no} waiting</span>` : html`<span class="small muted">${b.read} read</span>`}</td></tr>`)}
    </tbody></table></div>` : html`<p class="muted">No group messages yet.</p>`}
  </section>`;
}

// ---------------------------------------------------------------- routes
function routes(app, { render, needLogin, needRole, currentEvent }) {
  const needTeam = async (req, res) => {
    if (needLogin(req, res)) return false;
    if (!D.isTeam(req.user)) throw new HttpError(403, 'Training is for the check-in team.');
    return true;
  };

  app.get('/checkin/training', async (req, res) => {
    if (!(await needTeam(req, res))) return;
    const st = await status(req.user);
    if (D.can(req.user, 'volunteer')) req.ciEvent = await currentEvent(req);
    render(req, res, hubPage({ user: req.user, st, locked: Boolean(req.user.checkinLocked) }), { title: 'Training', tab: 'training' });
  });

  app.get('/checkin/training/:key', async (req, res) => {
    if (!(await needTeam(req, res))) return;
    const m = MODULE[req.params.key];
    if (!m) throw new HttpError(404, 'That lesson was not found.');
    const done = await db.one('SELECT 1 AS x FROM training_completions WHERE user_id = $1 AND module = $2 AND version = $3', [req.user.id, m.key, m.version]);
    render(req, res, modulePage({ csrf: res.locals.csrf, m, done: Boolean(done), index: MODULES.indexOf(m) }), { title: m.title, tab: 'training' });
  });

  app.post('/checkin/training/:key', async (req, res) => {
    if (!(await needTeam(req, res))) return;
    const m = MODULE[req.params.key];
    if (!m) throw new HttpError(404, 'That lesson was not found.');
    if (!m.confirm.every((_, i) => req.body[`c${i}`] === '1')) {
      security.flash(req, 'error', 'Please tick every box at the bottom of the lesson.');
      return res.redirect(`/checkin/training/${m.key}`);
    }
    await db.query(`INSERT INTO training_completions (user_id, module, version) VALUES ($1, $2, $3)
      ON CONFLICT (user_id, module) DO UPDATE SET version = EXCLUDED.version, completed_at = now()`, [req.user.id, m.key, m.version]);
    D.audit(req.user, 'training_complete', { detail: m.key });
    const st = await status(req.user);
    if (st.complete && req.user.checkinLocked) {
      security.flash(req, 'ok', 'You’re all set! Your check-in account is now unlocked. Thank you for serving.');
      const admins = await db.many(`SELECT id FROM users WHERE checkin_role IN ('admin', 'coadmin')`);
      pushTo(admins.map((a) => a.id), { title: 'Training complete', body: `${fullName(req.user)} finished training and is unlocked.`, url: '/checkin/admin' }).catch(() => {});
      return res.redirect('/checkin');
    }
    security.flash(req, 'ok', `“${m.title}” complete. ${st.count} of ${st.total} done.`);
    const next = st.policies.find((p) => !p.done) ? `/checkin/policies/${st.policies.find((p) => !p.done).id}` : st.modules.find((x) => !x.done) ? `/checkin/training/${st.modules.find((x) => !x.done).key}` : '/checkin/training';
    res.redirect(next);
  });

  // Read one policy, then confirm.
  app.get('/checkin/policies/:id', async (req, res) => {
    if (needLogin(req, res)) return;
    const p = await db.one('SELECT id, title, description, body, filename, mime, audience, requires_ack FROM policies WHERE id = $1', [intParam(req.params.id)]);
    if (!p || (p.audience !== 'everyone' && !D.isTeam(req.user))) throw new HttpError(404, 'That policy was not found.');
    const acked = await db.one('SELECT acked_at FROM policy_acks WHERE policy_id = $1 AND user_id = $2', [p.id, req.user.id]);
    if (D.can(req.user, 'volunteer')) req.ciEvent = await currentEvent(req);
    render(req, res, policyReadPage({ csrf: res.locals.csrf, user: req.user, p, acked }), { title: p.title, tab: req.user.checkinLocked ? 'training' : 'policies' });
  });

  // ---- Admins waive training for someone trained elsewhere.
  app.post('/checkin/staff/:id/waive', needRole('coadmin'), async (req, res) => {
    const u = await db.one('UPDATE users SET training_waived_at = now(), training_waived_by = $2 WHERE id = $1 AND checkin_role IS NOT NULL RETURNING first_name, last_name', [intParam(req.params.id), req.user.id]);
    if (u) { D.audit(req.user, 'training_waived', { detail: fullName(u) }); security.flash(req, 'ok', `${fullName(u)} is unlocked.`); }
    res.redirect('/checkin/admin');
  });

  // ---- Incident reports
  app.get('/checkin/incidents', needRole('volunteer'), async (req, res) => {
    req.ciEvent = await currentEvent(req);
    const admin = D.can(req.user, 'coadmin');
    const filter = ['open', 'reviewed', 'closed'].includes(req.query.status) ? req.query.status : '';
    const params = [];
    const where = [];
    if (!admin) { params.push(req.user.id); where.push(`i.reported_by = $${params.length}`); }
    if (filter) { params.push(filter); where.push(`i.status = $${params.length}`); }
    const rows = await db.many(`SELECT i.*, u.first_name || ' ' || u.last_name AS reporter FROM incidents i LEFT JOIN users u ON u.id = i.reported_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.occurred_at DESC LIMIT 300`, params);
    render(req, res, incidentList({ user: req.user, rows, filter }), { title: 'Incident reports', tab: 'incidents' });
  });

  const recentEvents = () => db.many(`SELECT id, name, event_date FROM events WHERE event_date > CURRENT_DATE - 60 ORDER BY event_date DESC, name LIMIT 40`);

  app.get('/checkin/incidents/new', needRole('volunteer'), async (req, res) => {
    req.ciEvent = await currentEvent(req);
    render(req, res, incidentForm({ csrf: res.locals.csrf, events: await recentEvents(), v: { event_id: req.ciEvent && req.ciEvent.id } }), { title: 'New incident report', tab: 'incidents' });
  });

  app.post('/checkin/incidents', needRole('volunteer'), async (req, res) => {
    const b = req.body;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(b.occurred_at || ''));
    const v = {
      occurred_at: m ? t.zoned(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) : null,
      event_id: Number(b.event_id) || null, location: clean(b.location, 120) || null,
      category: clean(b.category, 80), severity: ['minor', 'moderate', 'serious'].includes(b.severity) ? b.severity : 'minor',
      person_ids: String(b.person_ids || '').split(',').map(Number).filter(Boolean).join(',') || null, people_text: clean(b.people_text, 400) || null,
      description: clean(b.description, 8000), action_taken: clean(b.action_taken, 4000) || null, first_aid: b.first_aid === '1',
      witnesses: clean(b.witnesses, 400) || null, parent_notified: b.parent_notified === '1', parent_notified_how: clean(b.parent_notified_how, 400) || null,
      authorities_contacted: b.authorities_contacted === '1', authorities_detail: clean(b.authorities_detail, 400) || null, follow_up: clean(b.follow_up, 2000) || null,
    };
    const error = !v.occurred_at ? 'Enter when it happened.' : !v.category ? 'Choose what kind of incident it was.' : !v.description ? 'Describe what happened.' : null;
    if (error) {
      req.ciEvent = await currentEvent(req);
      return render(req, res, incidentForm({ csrf: res.locals.csrf, events: await recentEvents(), v: { ...b }, error }), { title: 'New incident report', tab: 'incidents' });
    }
    const cols = Object.keys(v);
    const row = await db.one(`INSERT INTO incidents (${cols.join(', ')}, reported_by) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING id`, [...cols.map((c) => v[c]), req.user.id]);
    D.audit(req.user, 'incident_report', { detail: `incident ${row.id}: ${v.category}` });
    const admins = await db.many(`SELECT id FROM users WHERE checkin_role IN ('admin', 'coadmin')`);
    pushTo(admins.map((a) => a.id), { title: `${v.severity === 'serious' ? 'SERIOUS: ' : ''}Incident report`, body: `${v.category}${v.people_text ? ` · ${v.people_text}` : ''} (filed by ${req.user.first_name})`, url: `/checkin/incidents/${row.id}` }).catch(() => {});
    security.flash(req, 'ok', 'Thank you. Your report was sent to the church admins.');
    res.redirect(`/checkin/incidents/${row.id}`);
  });

  app.get('/checkin/incidents/:id', needRole('volunteer'), async (req, res) => {
    const r = await db.one(`SELECT i.*, u.first_name || ' ' || u.last_name AS reporter, v.first_name || ' ' || v.last_name AS reviewer, e.name AS event_name
      FROM incidents i LEFT JOIN users u ON u.id = i.reported_by LEFT JOIN users v ON v.id = i.reviewed_by LEFT JOIN events e ON e.id = i.event_id WHERE i.id = $1`, [intParam(req.params.id)]);
    if (!r || (!D.can(req.user, 'coadmin') && r.reported_by !== req.user.id)) throw new HttpError(404, 'That report was not found.');
    req.ciEvent = await currentEvent(req);
    if (D.can(req.user, 'coadmin')) D.audit(req.user, 'incident_view', { detail: `incident ${r.id}` });
    render(req, res, incidentView({ csrf: res.locals.csrf, user: req.user, r }), { title: 'Incident report', tab: 'incidents' });
  });

  app.post('/checkin/incidents/:id', needRole('coadmin'), async (req, res) => {
    const id = intParam(req.params.id);
    const st = ['open', 'reviewed', 'closed'].includes(req.body.status) ? req.body.status : 'open';
    await db.query(`UPDATE incidents SET admin_notes = $2, status = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1`, [id, clean(req.body.admin_notes, 8000) || null, st, req.user.id]);
    security.flash(req, 'ok', 'Saved.');
    res.redirect(`/checkin/incidents/${id}`);
  });

  // People search for incident reports (names only).
  app.get('/checkin/api/people', needRole('volunteer'), async (req, res) => {
    const q = clean(req.query.q, 60);
    res.setHeader('Cache-Control', 'no-store');
    if (!q) return res.json([]);
    const rows = await db.many(`SELECT p.id, p.first_name, p.last_name, p.kind, f.name AS family FROM people p JOIN families f ON f.id = p.family_id
      WHERE p.active AND (p.first_name || ' ' || p.last_name) ILIKE $1 ORDER BY p.first_name LIMIT 8`, [`%${q}%`]);
    res.json(rows.map((r) => ({ id: r.id, name: `${r.first_name} ${r.last_name}`, sub: `${r.kind === 'child' ? 'Child' : 'Adult'} · ${r.family}` })));
  });

  // ---- Admin dashboard
  app.get('/checkin/admin', needRole('coadmin'), async (req, res) => {
    req.ciEvent = await currentEvent(req);
    const policies = await requiredPolicies();
    const staff = await db.many(`SELECT id, first_name, last_name, checkin_role, training_waived_at FROM users WHERE checkin_role IS NOT NULL
      ORDER BY CASE checkin_role WHEN 'admin' THEN 0 WHEN 'coadmin' THEN 1 WHEN 'leader' THEN 2 ELSE 3 END, last_name, first_name`);
    const comps = await db.many('SELECT user_id, module, version, completed_at FROM training_completions');
    const acks = await db.many('SELECT policy_id, user_id, acked_at FROM policy_acks');
    const total = policies.length + MODULES.length;
    const team = staff.map((u) => {
      const mods = new Map(comps.filter((c) => c.user_id === u.id && MODULE[c.module] && MODULE[c.module].version === c.version).map((c) => [c.module, c.completed_at]));
      const ak = new Map(acks.filter((a) => a.user_id === u.id).map((a) => [a.policy_id, a.acked_at]));
      const count = mods.size + policies.filter((p) => ak.has(p.id)).length;
      return { ...u, mods, acks: ak, count, complete: u.checkin_role === 'admin' || Boolean(u.training_waived_at) || count >= total };
    });
    const incidents = await db.many('SELECT id, occurred_at, category, people_text, severity, status FROM incidents ORDER BY occurred_at DESC LIMIT 8');
    const broadcasts = await db.many(`SELECT b.*, (SELECT count(*)::int FROM broadcast_recipients r WHERE r.broadcast_id = b.id) AS total,
        (SELECT count(*)::int FROM broadcast_recipients r WHERE r.broadcast_id = b.id AND r.response = 'yes') AS yes,
        (SELECT count(*)::int FROM broadcast_recipients r WHERE r.broadcast_id = b.id AND r.response = 'no') AS no,
        (SELECT count(*)::int FROM broadcast_recipients r JOIN messages m ON m.broadcast_id = b.id AND m.conversation_id IN (SELECT conversation_id FROM conversation_members cm WHERE cm.user_id = r.user_id AND cm.last_read_at >= m.created_at) WHERE r.broadcast_id = b.id) AS read
      FROM broadcasts b ORDER BY b.created_at DESC LIMIT 8`);
    const openReports = (await db.one('SELECT count(*)::int AS n FROM message_reports WHERE resolved_at IS NULL')).n;
    const prayers = (await db.one(`SELECT count(*)::int AS n FROM prayers WHERE created_at > now() - interval '30 days'`)).n;
    render(req, res, dashboard({ csrf: res.locals.csrf, team, st: { policies, total }, incidents, broadcasts, openReports, prayers }), { title: 'Admin', tab: 'admin' });
  });
}

module.exports = { routes, status, isLocked, formatText, CATEGORIES };

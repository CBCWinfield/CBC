'use strict';
// "Ask" for Central Check-In. Self-contained: answers from this app's own data
// (who's here, allergies tonight, who's serving, pickup codes) and built-in help guides.
const db = require('../db');
const t = require('../lib/time');
const D = require('./data');

// Help guides. `who`: 'team' (check-in team), 'family' (parents) or 'all'.
// `tour` names a step-by-step walkthrough on `page`.
const TOPICS = [
  { id: 'start', who: 'team', title: 'Getting started', keys: 'start begin first new how use overview basics',
    steps: ['Pick the event at the top. Sunday and Wednesday services fill in by themselves.', 'Type a family name, a child’s name or a phone number in the big search box.', 'Tap the family, untick anyone who isn’t here, and press Check in.', 'Name tags print for each child, plus one pickup tag for the parent.'],
    page: '/checkin', tour: 'station' },
  { id: 'checkin', who: 'team', title: 'Checking a family in', keys: 'check in checkin family search tick untick box confirm sign in arrive',
    steps: ['Search the family and tap their name.', 'Everyone is ticked to start. Untick anyone who isn’t here today.', 'Red and blue tags show allergies and medical needs; a dark red tag means a custody alert, so get a leader.', 'Press Check in. The parent gets an email that their kids are checked in.'],
    page: '/checkin/f', tour: 'family' },
  { id: 'newfamily', who: 'team', title: 'Adding a new family', keys: 'new family add visitor first time guest not found register',
    steps: ['Search their name. When nothing matches, tap “Add a new family”.', 'Enter the parent’s name and phone, an emergency contact, and tick “Email the parent a link” if you have their email.', 'Add each child: name, birthday (or pick a class), allergies and medical needs.', 'Tap “Done: check them in”, then press Check in.'],
    page: '/checkin/new' },
  { id: 'guest', who: 'team', title: 'Quick guest check-in (no parent here)', keys: 'guest friend visitor alone without parent quick phone came with',
    steps: ['Search the child’s name and tap “Quick guest check-in”, or use the Quick guest button.', 'Enter their first name, class and a parent or guardian’s phone number. Ask about allergies.', 'Choose the family they came with. They share that family’s pickup code, or tick “They came on their own”.', 'Press Check in guest. Their name tag prints.'],
    page: '/checkin/guest' },
  { id: 'tags', who: 'team', title: 'Name tags and the printer', keys: 'print printer label name tag sticker brother ql 810w paper reprint barcode red mark allergy medical queue printing',
    steps: ['On the laptop plugged into the Brother QL-810W, open Printing and turn on “This device is the printer”. Tags from every phone and iPad print there.', 'The first time, choose the Brother QL-810W, paper 62mm × 100mm, landscape, margins none. Chrome remembers it.', 'Each tag shows the first name, class, check-in time and pickup code. Allergies print as red picture symbols (peanut, milk, egg, bee…); a red square cross means a medical need.', 'Printing lists every tag waiting. Tap Print or Cancel, or Reprint a child from Checked in.'],
    page: '/checkin/print-queue', tour: 'print' },
  { id: 'quick', who: 'team', title: 'Quick Check (whole family in one tap)', keys: 'quick check fast one tap whole family check in button families list arriving',
    steps: ['See the whole family arriving? Find them in the search, the recent list, or Families.', 'Press Quick Check next to the family name. No need to open the family.', 'Everyone is checked in for the service happening now (picked from the day and time), and the kids’ name tags and the parent pickup tag print.'], page: '/checkin/families', tour: 'families' },
  { id: 'pickup', who: 'team', title: 'Picking up children', keys: 'pick up pickup check out checkout scan barcode code release parent tag leave go home',
    steps: ['Open Scan. Tap “Scan a pickup tag” and hold the parent’s tag up to the camera (works on iPhone, iPad, Android and laptops), or type the 4-letter code. Handheld scanners work too.', 'If a red “Stop” box appears, don’t release the child. Get a leader.', 'Check the children going home and choose who is picking them up.', 'Press Release. The parent gets a pickup email.'],
    page: '/checkin/scan', tour: 'scan' },
  { id: 'checkoutall', who: 'team', title: 'Checking everyone out at the end', keys: 'check out all everyone end service close done finish',
    steps: ['Open Checked in.', 'Press “Check out everyone”. Kids and their parents are checked out, and every parent gets a pickup email.', 'Anyone still checked in 6 hours after a service starts is checked out automatically.'], page: '/checkin/roster', tour: 'roster' },
  { id: 'roster', who: 'team', title: 'Who’s here (roll call)', keys: 'roster roll call list who here present checked in count class',
    steps: ['Checked in lists everyone here, grouped by class: Nursery, Toddlers, Kids, Teens and Adults.', 'Type in the filter to find someone, or tap “Include picked up” to see the whole night.', 'Use Remove if someone was checked in by mistake.'], page: '/checkin/roster', tour: 'roster' },
  { id: 'event', who: 'team', title: 'Changing or adding an event', keys: 'event change service wednesday sunday special vbs new name',
    steps: ['Tap the green-dot event name at the top.', 'Choose an event, or type a new name and press Start.', 'New names are saved and offered next time.'], page: '/checkin?change=1' },
  { id: 'events', who: 'team', title: 'Events list and archiving', keys: 'events list archive hide remove old event restore rename delete',
    steps: ['Open Events (leaders and admins). Every event you’ve created is listed with how many times it was held.', 'Press Archive to take an old event (like last summer’s VBS) off the check-in screen. Its attendance stays in Reports.', 'Archived events sit at the bottom. Press Restore to bring one back.', 'Sunday School, Children’s Church and Wednesday Night Service are regular services and always stay.'], page: '/checkin/events', tour: 'events' },
  { id: 'serving', who: 'team', title: 'Serving calendar', keys: 'serve serving volunteer schedule calendar sign up nursery toddlers kids teens adults who is serving',
    steps: ['Open Serving. Each service shows five dots: Nursery, Toddlers, Kids, Teens and Adults. Green means someone is signed up.', 'Tap a service, then “Sign me up” under the area where you’ll serve.', 'Admins can add anyone by name, change the time, cancel a week, or import a spreadsheet.'], page: '/checkin/serve', tour: 'serve' },
  { id: 'training', who: 'team', title: 'Required training and policies', keys: 'training train course lesson policy policies required locked unlock new volunteer abuse grooming boundaries report',
    steps: ['New team members start locked: open More › Training.', 'Read each required policy to the end and tick “I have read and understand”.', 'Complete each of the five short lessons (with videos) and tick every box at the bottom.', 'When everything is checked off, your check-in account unlocks automatically. Admins can see everyone’s progress on More › Admin dashboard.'], page: '/checkin/training' },
  { id: 'incident', who: 'team', title: 'Filing an incident report', keys: 'incident report injury accident behavior hurt fall bite allergy reaction concern abuse form',
    steps: ['Open More › Incident reports › New report.', 'Choose the kind of incident, who was involved, and describe what happened (facts only).', 'Note first aid, witnesses and whether a parent was told, then Submit. Admins are notified right away.', 'Suspected abuse: call 911 if a child is in danger, or the Kansas Protection Report Center at 1-800-922-5330, before filing.'], page: '/checkin/incidents/new' },
  { id: 'broadcast', who: 'team', title: 'Messaging a group (admins)', keys: 'broadcast group message everyone volunteers parents announcement meeting confirm rsvp template',
    steps: ['Open More › Admin dashboard › Message a group.', 'Tap a ready-made message (like “Team meeting, click to confirm”) or write your own.', 'Choose groups (team, volunteers, parents, people serving on a date) and/or individual people, then Send.', 'Everyone gets it in their Inbox with confirm buttons; watch the responses on the dashboard.'], page: '/checkin/broadcast' },
  { id: 'prayer', who: 'all', title: 'Prayer Wall', keys: 'prayer pray request wall praying hands comment answered praise',
    steps: ['Open More › Prayer Wall.', 'Share a request (anonymously or with the church team only, if you prefer).', 'Tap “I’m praying” on others’ requests and leave an encouraging comment.', 'When God answers, open Manage on your request and share a praise report.'], page: '/checkin/prayer' },
  { id: 'policies', who: 'all', title: 'Policies', keys: 'policy policies rules safety document handbook read acknowledge upload',
    steps: ['Open Policies to read the church’s child-safety and check-in documents.', 'If a policy asks, press “I’ve read this”.', 'Admins add new policies at the bottom of the page.'], page: '/checkin/policies' },
  { id: 'families', who: 'team', title: 'Editing a family', keys: 'edit family update change allergy phone emergency contact pickup not allowed custody order',
    steps: ['Open Families and tap the family (leaders and admins).', 'Edit a child or adult, add emergency contacts and people who may pick up.', 'Tick “not allowed to pick up” for anyone under a court order. They trigger a red Stop warning at pickup.'], page: '/checkin/families' },
  { id: 'invite', who: 'team', title: 'Sending a family their sign-up link', keys: 'invite email link sign up account parent login waiver form',
    steps: ['Open the family, or Families › Email a sign-up link.', 'Enter the parent’s email and press Send link.', 'They set up their login, add details and sign the permission forms from home.'], page: '/checkin/families' },
  { id: 'team', who: 'team', title: 'Team and roles', keys: 'team role volunteer leader admin co-admin access permission add volunteer',
    steps: ['Volunteers check families in and out and see allergy and medical notes.', 'Ministry leaders also edit families and see custody details.', 'Co-admins manage volunteers and leaders. The primary admin can do everything.', 'Add people on More › Team (admins and co-admins).'], page: '/checkin/staff' },
  { id: 'reports', who: 'team', title: 'Attendance reports', keys: 'report reports attendance average weekly monthly yearly numbers stats spreadsheet',
    steps: ['Open More › Reports (admins and co-admins).', 'See each service, monthly and yearly averages, first-time guests and kids by class.', 'Choose an event or dates, and press “Download spreadsheet” for Excel.'], page: '/checkin/reports' },
  { id: 'install', who: 'all', title: 'Add the app to a phone or tablet', keys: 'install app download phone ipad iphone android home screen icon notifications',
    steps: ['iPhone/iPad: open in Safari, tap Share, then “Add to Home Screen”.', 'Android: open in Chrome, tap ⋮, then “Install app”.', 'Computer: in Chrome or Edge, click the install icon in the address bar.'], page: '/checkin/install' },
  { id: 'parent', who: 'family', title: 'Setting up your family', keys: 'set up family kids children add allergy medical emergency contact pickup form sign waiver',
    steps: ['Open My family and follow the five steps: your family, children, health & safety, emergency & pickup, permission forms.', 'You can come back anytime to update allergies, contacts or who may pick up.'], page: '/checkin/family' },
  { id: 'notices', who: 'family', title: 'Check-in emails and notifications', keys: 'email notification alert notice message checked in picked up',
    steps: ['You get an email when your children check in and when they’re picked up.', 'Add the app to your phone and turn on notifications on My family to get them there too.'], page: '/checkin/family' },
];

const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set('a an the is are do does how what where who when i we you to of for on in at with my our can please tonight today here this that it me show tell'.split(' '));

function topicsFor(user) {
  const staff = D.can(user, 'volunteer');
  return TOPICS.filter((x) => x.who === 'all' || (staff ? x.who === 'team' : x.who === 'family'));
}

function searchTopics(q, user, limit = 3) {
  const words = norm(q).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  if (!words.length) return [];
  return topicsFor(user).map((tp) => {
    const hay = norm(`${tp.title} ${tp.keys}`).split(' ');
    let score = 0;
    for (const w of words) {
      if (hay.includes(w)) score += 3;
      else if (hay.some((h) => h.startsWith(w) || (w.length > 4 && w.startsWith(h) && h.length > 3))) score += 1.5;
    }
    return { tp, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.tp);
}

// Which date does "sunday", "tonight", "next wednesday", "oct 12" mean?
function dateFrom(q) {
  const n = norm(q);
  const todayKey = t.dateKey(new Date());
  const wd = t.weekdayOfKey(todayKey);
  const DAYS = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7, wed: 3, sun: 7 };
  if (/\b(today|tonight)\b/.test(n)) return todayKey;
  if (/\btomorrow\b/.test(n)) return t.addDaysKey(todayKey, 1);
  for (const [name, d] of Object.entries(DAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(n)) {
      let add = (d - wd + 7) % 7;
      if (/\bnext\b/.test(n) && add === 0) add = 7;
      else if (/\bnext\b/.test(n)) add += add < 7 ? 7 : 0;
      if (/\blast\b/.test(n)) add -= 7;
      return t.addDaysKey(todayKey, add);
    }
  }
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(n);
  if (iso) return iso[0];
  const us = /\b(\d{1,2})\/(\d{1,2})\b/.exec(String(q));
  if (us) return `${todayKey.slice(0, 4)}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return null;
}

const nice = (key) => t.fmtLong(t.zoned(...key.split('-').map(Number), 12));

async function ask(q, user, event) {
  const text = String(q || '').trim().slice(0, 200);
  const n = norm(text);
  const out = { answer: '', items: [], topics: [] };
  if (!n) { out.answer = 'Ask how to do something, or about tonight: “who has allergies”, “who’s serving Sunday”, “is Emma here”, or type a pickup code.'; return out; }
  const staff = D.can(user, 'volunteer');

  if (staff) {
    // Pickup code like "VMD6"
    const code = /^(code\s+)?([a-z0-9]{4})$/i.exec(text.trim());
    if (code && event && /\d/.test(code[2])) {
      const rows = await db.many(`SELECT p.first_name, p.last_name, a.checked_out_at, f.name AS family_name, f.id AS family_id FROM attendance a
        JOIN people p ON p.id = a.person_id JOIN families f ON f.id = a.family_id WHERE a.event_id = $1 AND a.security_code = $2 AND p.kind = 'child'`, [event.id, code[2].toUpperCase()]);
      if (rows.length) {
        out.answer = `Code ${code[2].toUpperCase()} is ${rows[0].family_name}: ${rows.map((r) => r.first_name + (r.checked_out_at ? ' (picked up)' : '')).join(', ')}.`;
        out.items.push({ title: 'Go to pick up', sub: rows[0].family_name, url: `/checkin/scan?code=${code[2].toUpperCase()}` });
        return out;
      }
    }

    // Allergies / medical tonight
    if (/\ballerg|\bmedical|\bmedicine|\bmedication|\bepipen|\binhaler/.test(n) && event) {
      const med = !/allerg/.test(n);
      const rows = await db.many(`SELECT p.first_name, p.last_name, p.allergies, p.medical_notes, p.medications, p.birthdate::text AS birthdate, p.class_override, p.kind, f.id AS family_id
        FROM attendance a JOIN people p ON p.id = a.person_id JOIN families f ON f.id = a.family_id
        WHERE a.event_id = $1 AND a.checked_out_at IS NULL AND p.kind = 'child' AND ${med ? '(p.medical_notes IS NOT NULL OR p.medications IS NOT NULL)' : 'p.allergies IS NOT NULL'}
        ORDER BY p.first_name`, [event.id]);
      out.answer = rows.length ? `${rows.length} ${rows.length === 1 ? 'child here has' : 'children here have'} ${med ? 'medical notes' : 'allergies'} at ${event.name}:` : `No children checked in right now have ${med ? 'medical notes' : 'allergies'} on file.`;
      out.items = rows.map((r) => ({ title: `${r.first_name} ${r.last_name} · ${D.groupFor(r)}`, sub: med ? [r.medical_notes, r.medications].filter(Boolean).join(' · ') : r.allergies, url: `/checkin/f/${r.family_id}` }));
      return out;
    }

    // Who's serving?
    if (/\bserv|\bvolunteer|\bwho s on\b|\bwhos on\b|\bschedule/.test(n)) {
      const date = dateFrom(text) || t.dateKey(new Date());
      const area = ['nursery', 'toddlers', 'kids', 'teens', 'adults'].find((a) => n.includes(a.replace(/s$/, '')));
      const rows = await db.many(`SELECT s.name AS service, s.start_time, x.area, x.name FROM serve_services s JOIN serve_slots x ON x.service_id = s.id
        WHERE s.service_date = $1 AND NOT s.cancelled ${area ? 'AND lower(x.area) = $2' : ''} ORDER BY s.start_time NULLS LAST, s.name, x.area, x.name`, area ? [date, area] : [date]);
      out.answer = rows.length ? `Serving ${nice(date)}${area ? ` in ${area[0].toUpperCase()}${area.slice(1)}` : ''}:` : `No one is signed up to serve ${nice(date)}${area ? ` in ${area}` : ''} yet.`;
      const grouped = new Map();
      for (const r of rows) { const k = `${r.service} · ${r.area}`; (grouped.get(k) || grouped.set(k, []).get(k)).push(r.name); }
      out.items = [...grouped.entries()].map(([k, names]) => ({ title: k, sub: names.join(', '), url: '/checkin/serve' }));
      if (!rows.length) out.items.push({ title: 'Open the serving calendar', sub: 'Sign up or assign people', url: `/checkin/serve?month=${date.slice(0, 7)}` });
      return out;
    }

    // How many here?
    if (/\bhow many\b|\bcount\b|\battendance\b|\bheadcount\b|\bnumbers?\b/.test(n) && event) {
      const rows = await db.many(`SELECT p.kind, p.birthdate::text AS birthdate, p.class_override FROM attendance a JOIN people p ON p.id = a.person_id WHERE a.event_id = $1 AND a.checked_out_at IS NULL`, [event.id]);
      const by = {};
      for (const r of rows) { const g = D.groupFor(r); by[g] = (by[g] || 0) + 1; }
      out.answer = `${rows.length} ${rows.length === 1 ? 'person is' : 'people are'} checked in for ${event.name} right now.`;
      out.items = D.GROUP_ORDER.filter((g) => by[g]).map((g) => ({ title: `${g}: ${by[g]}`, sub: '', url: '/checkin/roster' }));
      return out;
    }

    // A person's name: are they here?
    const nameWords = n.replace(/\b(is|are|checked|check|in|here|did|has|have|where|find|look|up|for)\b/g, ' ').split(' ').filter((w) => w.length > 1);
    if (nameWords.length && nameWords.length <= 3 && !searchTopics(text, user, 1).length) {
      const like = nameWords.map((w) => `%${w}%`);
      const rows = await db.many(`SELECT p.id, p.first_name, p.last_name, p.kind, f.id AS family_id, f.name AS family_name,
          (SELECT a.checked_in_at FROM attendance a WHERE a.person_id = p.id AND a.event_id = $1 AND a.checked_out_at IS NULL) AS here_since
        FROM people p JOIN families f ON f.id = p.family_id WHERE p.active AND (p.first_name || ' ' || p.last_name || ' ' || COALESCE(p.preferred_name, '')) ILIKE ALL($2::text[])
        ORDER BY here_since NULLS LAST, p.first_name LIMIT 6`, [event ? event.id : 0, like]);
      if (rows.length) {
        out.answer = rows.length === 1
          ? `${rows[0].first_name} ${rows[0].last_name} is ${rows[0].here_since ? `checked in (since ${t.fmtTime(rows[0].here_since)})` : 'not checked in right now'}.`
          : `${rows.length} people match “${text}”:`;
        out.items = rows.map((r) => ({ title: `${r.first_name} ${r.last_name}`, sub: `${r.family_name} · ${r.here_since ? `here since ${t.fmtTime(r.here_since)}` : 'not checked in'}`, url: `/checkin/f/${r.family_id}` }));
        return out;
      }
    }
  }

  const topics = searchTopics(text, user, 3);
  if (topics.length) {
    out.answer = topics[0].steps.join(' ');
    out.topics = topics.map((tp) => ({ id: tp.id, title: tp.title }));
    out.items = topics.slice(0, 1).filter((tp) => tp.page && !/\/f$/.test(tp.page)).map((tp) => ({ title: tp.tour ? 'Show me how' : 'Go there', sub: tp.title, url: `${tp.page}${tp.tour ? `${tp.page.includes('?') ? '&' : '?'}tour=${tp.tour}` : ''}` }));
    return out;
  }
  out.answer = staff
    ? 'I couldn’t find that. Try a name (“is Emma here”), “who has allergies”, “who’s serving Sunday”, a pickup code, or a how-to like “print name tags”.'
    : 'I couldn’t find that. Try “add my children”, “permission forms” or “notifications”, or press HELP.';
  return out;
}

module.exports = { ask, topicsFor, TOPICS };

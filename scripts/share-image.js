'use strict';
// Draws the 1200x630 link-preview pictures in public/img/share/ (all, or the ones named on the command line).
// Needs Playwright: NODE_PATH=$(npm root -g) node scripts/share-image.js [visit give ...]
// After changing a picture, bump V in src/share.js so Facebook fetches the new one.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const C = require('../src/site/content');

const ROOT = path.join(__dirname, '..');
const file = (p) => `file://${path.join(ROOT, p)}`;
const font = (f) => `url('${file('public/fonts/' + f)}')`;
const wheat = fs.readFileSync(path.join(ROOT, 'src/site/wheat.html'), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CROSS = (cls = 'cross') => `<svg viewBox="0 0 400 560" class="${cls}" aria-hidden="true"><defs>
  <radialGradient id="g-${cls}" cx="200" cy="190" r="200" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F6DE9C" stop-opacity=".6"/><stop offset=".35" stop-color="#E2BE66" stop-opacity=".22"/><stop offset="1" stop-color="#E2BE66" stop-opacity="0"/></radialGradient>
  <linearGradient id="b-${cls}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6DA"/><stop offset=".55" stop-color="#EBCB7C"/><stop offset="1" stop-color="#B98F3A"/></linearGradient>
  <linearGradient id="r-${cls}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F6DE9C" stop-opacity=".5"/><stop offset="1" stop-color="#F6DE9C" stop-opacity="0"/></linearGradient></defs>
  <circle cx="200" cy="190" r="200" fill="url(#g-${cls})"/>
  <g transform="translate(200 190)" opacity=".75">${Array.from({ length: 16 }, (_, i) => `<rect x="30" y="-1" width="${i % 2 ? 150 : 210}" height="2" rx="1" fill="url(#r-${cls})" transform="rotate(${i * 22.5})"/>`).join('')}</g>
  <path d="M182 34h36v122h90v36h-90v342h-36V192H92v-36h90z" fill="url(#b-${cls})" stroke="#FFF6DA" stroke-opacity=".55" style="filter:drop-shadow(0 0 16px rgba(246,222,156,.5))"/></svg>`;
const ICON = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
};
const ic = (k, s = 26) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const TIMES = C.TIMES.filter((x) => /Sunday School|^Worship|Wednesday Night/.test(x.what));

// ---------- the art on the right of each picture ----------
const ART = {
  // the glowing cross from the homepage
  cross: () => `<div class="a-cross">${CROSS('big')}<p>The Cross is <span class="serif">Central.</span></p></div>`,
  // a stack of sermon videos
  videos: () => `<div class="stack"><div class="card c3"></div><div class="card c2"></div>
    <div class="card c1">${CROSS()}<span class="play"></span><span class="bar"><b>Sunday worship</b> · Pastor Blake Orr</span></div></div>`,
  // service times
  times: () => `<div class="panel times"><p class="p-h">${ic('clock', 24)} Service times</p>
    ${TIMES.map((t) => `<div class="row"><span class="day">${t.day}<b>${t.time}</b></span><span class="what">${esc(t.what.replace(' & Adult Study', ' & Adult Study').replace('Wednesday Night: ', ''))}</span></div>`).join('')}
    <p class="p-foot">${ic('pin', 22)} ${C.CHURCH.street} ${C.CHURCH.cityLine.replace(' 67156', '')}</p></div>`,
  // 1951 and the cross
  since: () => `<div class="panel gold"><p class="g-small">Since</p><p class="g-year">${C.CHURCH.founded}</p><p class="g-line">on Wheat Road in Winfield, Kansas</p>${CROSS('mini')}</div>`,
  // the Kids and Teens logos, and the rest
  ministries: () => `<div class="minis"><div class="logo-card"><img src="${file('public/img/central-kids.webp')}" alt=""></div>
    <div class="logo-card"><img src="${file('public/img/central-teens-clear.webp')}" alt=""></div>
    <div class="chips">${['Adult Bible study', 'Bus ministry', 'Missions', 'Worship'].map((x) => `<span>${x}</span>`).join('')}</div></div>`,
  // the rhythm of every week
  week: () => `<div class="panel cal"><div class="cal-top"><span>Every week at Central</span></div>
    ${C.TIMES.map((t) => `<div class="row"><span class="day">${t.day.slice(0, 3)}<b>${t.time}</b></span><span class="what">${esc(t.what.replace('Wednesday Night: ', ''))}</span></div>`).join('')}</div>`,
  // the staff, in a circle of faces
  people: () => {
    const keys = ['orr', 'ryker', 'norris', 'higdon', 'smith', 'caudill'];
    return `<div class="faces">${keys.map((k, i) => `<span class="face f${i}" style="background-image:url('${file(`public/img/staff/${k}.jpg`)}')"></span>`).join('')}</div>`;
  },
  // a verse, on a card
  verse: (p) => `<div class="panel verse"><span class="v-ic">${ic(p.verseIcon || 'heart', 30)}</span><p class="v-text">“${esc(p.verse)}”</p><p class="v-ref">${esc(p.ref)}</p>${p.verseNote ? `<p class="v-note">${p.verseNote}</p>` : ''}</div>`,
  // a note to the church office
  message: () => `<div class="panel note"><p class="n-h">How can we help?</p>
    <div class="n-line">${ic('phone', 24)}<span>${C.CHURCH.phone}</span></div>
    <div class="n-line">${ic('pin', 24)}<span>${C.CHURCH.street.replace(/\.$/, '')}, Winfield</span></div>
    <div class="n-line">${ic('mail', 24)}<span>Send us a note online</span></div>
    <p class="n-foot">Questions, prayer, or a first visit: our doors and hearts are open.</p></div>`,
  // ways to serve
  serve: () => `<div class="panel serve"><p class="p-h">${ic('check', 24)} Places to serve</p><div class="chips big">${C.SERVE_AREAS.filter((x) => !/Wherever/.test(x)).map((x) => `<span>${esc(x.replace(' (driving or riding along)', ''))}</span>`).join('')}</div></div>`,
  // the fellowships Central belongs to
  partners: () => `<div class="panel fam"><p class="p-h">${ic('heart', 22)} The family we belong to</p>
    ${[...C.FAMILY.filter((f) => f.key !== 'bp').map((f) => [f.level, f.name]), ['Around the world', 'International Mission Board']].map(([l, n]) => `<div class="fam-row"><span>${esc(l)}</span><b>${esc(n)}</b></div>`).join('')}</div>`,
  // the church bus
  bus: () => `<div class="photo"><img src="${file('public/img/bus.webp')}" alt=""><span class="ph-tag">${C.BUS.day}, ${C.BUS.pickup}</span></div>`,
  // a shelf of books
  books: () => {
    const spines = [['#E2BE66', 'Bible', 0], ['#2E6B3B', 'Devotional', 0], ['#F5F1E6', 'Classics', -3], ['#8C3B2E', 'Fiction', 0], ['#1F4A6B', 'Family', 0], ['#C9A24A', 'Kids', 4], ['#3C2A1E', 'DVDs', 0]];
    return `<div class="shelf">${spines.map(([c, t, r], i) => `<span class="spine s${i}" style="--c:${c};--r:${r}deg"><i>${t}</i></span>`).join('')}<span class="board"></span></div>`;
  },
  // a prayer request card
  prayer: () => `<div class="panel pray"><span class="pr-emoji">🙏</span><p class="pr-h">Prayer Wall</p>
    <p class="pr-text">Share a request, pray for one another, and see who’s praying for you.</p>
    <div class="pr-row"><span class="pr-chip">🙏 Pray</span><span class="pr-chip soft">💬 Encourage</span><span class="pr-chip gold">✨ Answered</span></div>
    <p class="pr-verse">“Pray one for another.” James 5:16</p></div>`,
};

// ---------- the pictures ----------
const PAGES = {
  home: { art: 'cross', eyebrow: `Winfield, Kansas · Since ${C.CHURCH.founded}`, title: 'A church family', accent: 'on Wheat Road.',
    lead: 'A place to know Jesus, grow in His Word, and belong to a family that will pray for you by name.', cta: 'Plan your visit', url: 'cbcwinfield.org' },
  visit: { art: 'times', eyebrow: 'Your first Sunday', title: 'We saved you', accent: 'a seat.',
    lead: 'What to expect, where to go, and what your kids will love about Sunday at Central.', cta: 'Plan your visit', url: 'cbcwinfield.org/visit' },
  about: { art: 'since', eyebrow: 'About Central', title: 'Rooted in faith, hope,', accent: 'and love.',
    lead: 'A Southern Baptist church sharing the love of Christ in Winfield through worship, fellowship, and service.', cta: 'Our story', url: 'cbcwinfield.org/about' },
  ministries: { art: 'ministries', eyebrow: 'Ministries', title: 'Every age, growing', accent: 'in Christ together.',
    lead: 'Central Kids, Central Teens, adult Bible studies, a bus ministry, and missions near and far.', cta: 'Find your place', url: 'cbcwinfield.org/ministries' },
  sermons: { art: 'videos', eyebrow: 'Sermons', title: 'Sunday’s message,', accent: 'any day of the week.',
    lead: 'Watch past sermons from Central Baptist Church in Winfield, Kansas.', cta: 'Watch the sermons', url: 'cbcwinfield.org/sermons' },
  events: { art: 'week', eyebrow: 'Events & announcements', title: 'What’s happening', accent: 'at Central.',
    lead: 'This week’s announcements, special days coming up, and the rhythm of every week.', cta: 'See what’s coming up', url: 'cbcwinfield.org/events' },
  staff: { art: 'people', eyebrow: 'Staff & leaders', title: 'The people', accent: 'who serve.',
    lead: 'Our pastors, staff, and deacons, serving our church family week in and week out.', cta: 'Meet our staff', url: 'cbcwinfield.org/staff' },
  give: { art: 'verse', eyebrow: 'Give', title: 'Generosity that reaches', accent: 'Winfield and the world.',
    lead: 'Give once or set up recurring giving through Vanco, our secure online giving partner.', cta: 'Give online', url: 'cbcwinfield.org/give',
    verse: 'Each one must give as he has decided in his heart, not reluctantly or under compulsion, for God loves a cheerful giver.', ref: '2 Corinthians 9:7',
    verseNote: `${ic('lock', 18)} Secure giving with Vanco` },
  connect: { art: 'message', eyebrow: 'Connect', title: 'We’d love to', accent: 'hear from you.',
    lead: 'A question about Sunday, a prayer request, or just someone to talk to. Our doors are open.', cta: 'Contact us', url: 'cbcwinfield.org/connect' },
  serve: { art: 'serve', eyebrow: 'Serve', title: 'Find your place', accent: 'on the team.',
    lead: 'From the nursery to the sound booth, there’s a place for you to serve at Central.', cta: 'Sign up to serve', url: 'cbcwinfield.org/serve' },
  ride: { art: 'bus', eyebrow: 'Bus ministry', title: 'Need a ride', accent: 'to church?',
    lead: 'For decades our bus and van ministry has brought kids and students to church, and to the Lord Jesus.', cta: 'Request a ride', url: 'cbcwinfield.org/ride' },
  partners: { art: 'partners', eyebrow: 'Our partners', title: 'Cooperating', accent: 'for the Gospel.',
    lead: 'Central works together with Southern Baptists across Kansas, the nation, and the world.', cta: 'Our partners', url: 'cbcwinfield.org/partners' },
  library: { art: 'books', eyebrow: 'CBC Public Christian Library', title: 'Borrow books, Bibles', accent: 'and DVDs, free.',
    lead: 'Over 3,000 carefully chosen Christian books and films. Reserve online, pick up at church.', cta: 'Browse the library', url: 'Winfield, Kansas' },
  prayer: { art: 'prayer', eyebrow: 'Central Baptist Church', title: 'Join your church family', accent: 'in prayer.',
    lead: 'Share a request, pray for one another, and see who’s praying for you.', cta: 'Open the Prayer Wall', url: 'Members of Central' },
};

// The background for a book from the library: the words on the left, a frame on the right where its cover goes
// (src/share.js puts the cover in when the link is shared).
const BOOK = { art: 'cover', eyebrow: 'From the CBC Library', title: 'A good book', accent: 'to borrow, free.',
  lead: 'Reserve it online and pick it up at Central Baptist Church in Winfield.', cta: 'Reserve this book', url: 'Winfield, Kansas' };
ART.cover = () => '<div class="cover-frame"></div>';

const CSS = `
@font-face { font-family: 'Bricolage Grotesque'; src: ${font('bricolage.woff2')} format('woff2'); font-weight: 200 800; }
@font-face { font-family: 'Instrument Sans'; src: ${font('instrument-sans.woff2')} format('woff2'); font-weight: 400 700; }
@font-face { font-family: 'Instrument Serif'; src: ${font('instrument-serif-italic.woff2')} format('woff2'); font-style: italic; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body { position: relative; color: #F5F1E6; font-family: 'Instrument Sans', sans-serif; -webkit-font-smoothing: antialiased;
  background: radial-gradient(900px 420px at 74% 96%, rgba(226,190,102,.30), transparent 62%), radial-gradient(760px 520px at 12% 0%, #24502F 0%, transparent 62%),
    linear-gradient(#132F1F 0%, #0F2719 62%, #163420 100%); }
.serif { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 400; color: #E2BE66; }
/* the wheat, a band along the bottom */
.field { position: absolute; left: -45%; right: -45%; bottom: 0; height: 190px; z-index: 1; transform: scale(.52); transform-origin: 50% 100%; }
.field .stalk { position: absolute; bottom: -8px; transform-origin: 50% 100%; transform: rotate(var(--r)); }
.field::after { content: ''; position: absolute; inset: auto 0 0; height: 120px; background: linear-gradient(transparent, rgba(10,30,18,.5)); z-index: 3; }
.logo { position: absolute; left: 64px; top: 46px; width: 168px; z-index: 4; }
.text { position: absolute; left: 64px; top: 140px; width: 610px; z-index: 4; }
.eyebrow { display: flex; align-items: center; gap: 14px; color: #E2BE66; font-weight: 700; font-size: 19px; letter-spacing: .2em; text-transform: uppercase; white-space: nowrap; }
.eyebrow::before { content: ''; width: 40px; height: 2px; background: #E2BE66; flex: none; }
h1 { margin-top: 16px; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: var(--h, 72px); line-height: .98; letter-spacing: -0.025em; }
h1 .serif { display: block; margin-top: 4px; font-size: 1.11em; letter-spacing: -0.01em; }
.lead { margin-top: 20px; font-size: 24px; line-height: 1.4; color: rgba(245,241,230,.86); max-width: 560px; }
.cta { position: absolute; left: 64px; top: 458px; z-index: 4; display: flex; align-items: center; gap: 18px; }
.btn { display: inline-flex; align-items: center; gap: 12px; height: 58px; padding: 0 28px 0 22px; border-radius: 999px; background: #E2BE66; color: #10261A;
  font-weight: 700; font-size: 22px; box-shadow: 0 14px 34px -14px rgba(226,190,102,.8); white-space: nowrap; }
.btn i { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: #10261A; }
.btn i::before { content: ''; width: 9px; height: 9px; border-top: 2.5px solid #E2BE66; border-right: 2.5px solid #E2BE66; transform: translateX(-2px) rotate(45deg); }
.btn.play-btn i::before { width: 0; height: 0; margin-left: 3px; border: 0; border-left: 11px solid #E2BE66; border-top: 7px solid transparent; border-bottom: 7px solid transparent; transform: none; }
.url { font-size: 20px; color: rgba(245,241,230,.7); white-space: nowrap; }
.art { position: absolute; right: 64px; top: 70px; width: 440px; height: 440px; z-index: 2; display: grid; place-items: center; }
/* panels */
.panel { width: 430px; border-radius: 26px; padding: 28px 30px; background: linear-gradient(160deg, rgba(255,253,247,.10), rgba(255,253,247,.04)); border: 1.5px solid rgba(245,241,230,.16);
  box-shadow: 0 30px 70px -30px rgba(0,0,0,.8); backdrop-filter: blur(2px); }
.p-h { display: flex; align-items: center; gap: 10px; color: #E2BE66; font-weight: 700; font-size: 18px; letter-spacing: .14em; text-transform: uppercase; margin-bottom: 14px; }
.row { display: grid; grid-template-columns: 138px 1fr; gap: 14px; align-items: baseline; padding: 14px 0; border-top: 1px solid rgba(245,241,230,.12); }
.day { font-size: 17px; color: rgba(245,241,230,.75); display: grid; }
.day b { font-family: 'Bricolage Grotesque', sans-serif; font-size: 27px; color: #FFF6DA; letter-spacing: -0.01em; white-space: nowrap; }
.what { font-size: 21px; line-height: 1.3; font-weight: 600; }
.p-foot { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding-top: 16px; border-top: 1px solid rgba(245,241,230,.12); font-size: 19px; color: rgba(245,241,230,.85); }
.p-foot svg { color: #E2BE66; }
/* cross */
.a-cross { text-align: center; margin-top: -46px; }
.a-cross .big { width: 290px; height: auto; display: block; margin: 0 auto -14px; }
.a-cross p { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 30px; letter-spacing: -0.01em; }
.a-cross .serif { font-size: 1.12em; }
/* since */
.panel.gold { text-align: center; background: linear-gradient(165deg, #EBCB7C, #C9A24A 70%, #B08A2E); color: #10261A; border-color: rgba(255,246,218,.6); position: relative; overflow: hidden; padding: 34px 30px 30px; }
.g-small { font-size: 22px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; }
.g-year { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 150px; line-height: .95; letter-spacing: -0.04em; }
.g-line { font-size: 22px; font-weight: 600; margin-top: 6px; }
.gold .mini { position: absolute; right: -40px; top: -30px; width: 180px; opacity: .25; }
/* ministries */
.minis { display: grid; gap: 16px; width: 430px; }
.logo-card { height: 128px; border-radius: 24px; display: grid; place-items: center; background: rgba(255,253,247,.96); box-shadow: 0 26px 60px -30px rgba(0,0,0,.8); }
.logo-card img { max-height: 100px; max-width: 340px; }
.logo-card:nth-child(2) { background: #0F2719; border: 1.5px solid rgba(245,241,230,.18); }
.chips { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.chips span { padding: 10px 18px; border-radius: 999px; border: 1.5px solid rgba(226,190,102,.55); color: #F5F1E6; font-weight: 600; font-size: 19px; background: rgba(226,190,102,.08); }
.chips.big { justify-content: flex-start; }
.chips.big span { font-size: 18px; padding: 9px 16px; }
/* week */
.cal { padding: 0 0 8px; overflow: hidden; }
.cal-top { background: #E2BE66; color: #10261A; padding: 16px 28px; font-weight: 700; font-size: 19px; letter-spacing: .14em; text-transform: uppercase; }
.cal .row { padding: 12px 28px; grid-template-columns: 122px 1fr; }
.cal .row:first-of-type { border-top: 0; }
.cal .day b { font-size: 23px; }
.cal .what { font-size: 18.5px; }
/* people */
.faces { position: relative; width: 440px; height: 440px; }
.face { position: absolute; border-radius: 50%; background-size: cover; background-position: 50% 30%; border: 4px solid #F5F1E6; box-shadow: 0 20px 44px -20px rgba(0,0,0,.85); background-color: #C9CCC8; }
.f0 { width: 230px; height: 230px; left: 105px; top: 105px; border-color: #E2BE66; z-index: 2; }
.f1 { width: 132px; height: 132px; left: 154px; top: -26px; } .f2 { width: 132px; height: 132px; right: -8px; top: 70px; }
.f3 { width: 132px; height: 132px; right: 34px; bottom: 6px; } .f4 { width: 132px; height: 132px; left: 34px; bottom: 6px; }
.f5 { width: 132px; height: 132px; left: -8px; top: 70px; }
/* verse */
.verse { position: relative; padding: 34px 34px 28px; }
.v-ic { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 18px; background: rgba(226,190,102,.16); color: #E2BE66; margin-bottom: 18px; }
.v-text { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 33px; line-height: 1.25; color: #FFF6DA; }
.v-ref { margin-top: 14px; color: #E2BE66; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; font-size: 16px; }
.v-note { display: flex; align-items: center; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(245,241,230,.12); font-size: 18px; color: rgba(245,241,230,.8); }
/* message */
.note { padding: 30px 32px; }
.n-h { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 34px; letter-spacing: -0.02em; margin-bottom: 18px; }
.n-line { display: flex; align-items: center; gap: 14px; padding: 13px 0; border-top: 1px solid rgba(245,241,230,.12); font-size: 22px; font-weight: 600; }
.n-line svg { color: #E2BE66; flex: none; }
.n-foot { margin-top: 12px; font-size: 18px; line-height: 1.4; color: rgba(245,241,230,.75); }
/* partners */
.fam-row { display: grid; gap: 2px; padding: 13px 0; border-top: 1px solid rgba(245,241,230,.12); }
.fam-row span { font-size: 15px; letter-spacing: .14em; text-transform: uppercase; color: #E2BE66; font-weight: 700; }
.fam-row b { font-size: 22px; line-height: 1.25; font-weight: 600; }
/* bus */
.photo { position: relative; width: 450px; height: 330px; border-radius: 26px; overflow: hidden; transform: rotate(1.5deg); border: 5px solid #F5F1E6; box-shadow: 0 34px 70px -28px rgba(0,0,0,.85); }
.photo img { width: 100%; height: 100%; object-fit: cover; }
.ph-tag { position: absolute; left: 16px; bottom: 16px; padding: 9px 16px; border-radius: 999px; background: #E2BE66; color: #10261A; font-weight: 700; font-size: 18px; }
/* books */
.shelf { position: relative; width: 440px; height: 360px; display: flex; align-items: flex-end; justify-content: center; gap: 8px; padding-bottom: 22px; }
.spine { position: relative; width: 52px; border-radius: 6px 6px 3px 3px; background: linear-gradient(90deg, rgba(0,0,0,.18), transparent 30%, rgba(255,255,255,.12) 50%, transparent 70%, rgba(0,0,0,.2)), var(--c);
  transform: rotate(var(--r)); transform-origin: 50% 100%; box-shadow: 0 18px 30px -16px rgba(0,0,0,.8); display: grid; place-items: center; }
.spine::before, .spine::after { content: ''; position: absolute; left: 6px; right: 6px; height: 3px; background: rgba(226,190,102,.75); }
.spine::before { top: 22px; } .spine::after { bottom: 22px; }
.spine i { writing-mode: vertical-rl; transform: rotate(180deg); font-style: normal; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 19px; letter-spacing: .04em; color: rgba(255,253,247,.92); }
.s2 i, .s0 i, .s5 i { color: #10261A; }
.s0 { height: 300px; width: 62px; } .s1 { height: 260px; } .s2 { height: 280px; width: 58px; } .s3 { height: 240px; } .s4 { height: 290px; width: 56px; } .s5 { height: 230px; } .s6 { height: 250px; width: 60px; }
.board { position: absolute; left: 0; right: 0; bottom: 0; height: 22px; border-radius: 6px; background: linear-gradient(#C9A24A, #8E6E25); box-shadow: 0 16px 30px -12px rgba(0,0,0,.8); }
/* prayer */
.pray { text-align: center; padding: 30px 32px 26px; }
.pr-emoji { display: block; font-size: 64px; line-height: 1; filter: drop-shadow(0 0 22px rgba(246,222,156,.45)); }
.pr-h { margin-top: 10px; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 38px; letter-spacing: -0.02em; }
.pr-text { margin-top: 8px; font-size: 20px; line-height: 1.4; color: rgba(245,241,230,.82); }
.pr-row { display: flex; justify-content: center; gap: 8px; margin-top: 18px; }
.pr-chip { padding: 8px 14px; border-radius: 999px; background: #2E7D32; color: #fff; font-weight: 700; font-size: 16px; white-space: nowrap; }
.pr-chip.soft { background: rgba(245,241,230,.12); } .pr-chip.gold { background: #E2BE66; color: #10261A; }
.pr-verse { margin-top: 18px; font-family: 'Instrument Serif', serif; font-style: italic; font-size: 24px; color: #E2BE66; }
/* the book cover frame (the cover itself is added on the server) */
.cover-frame { width: 300px; height: 450px; border-radius: 10px; transform: translateY(12px); box-shadow: 0 0 0 1.5px rgba(245,241,230,.16), 0 40px 80px -24px rgba(0,0,0,.9), 0 0 120px -10px rgba(226,190,102,.35); }
/* videos (sermons) */
.stack { position: relative; width: 430px; height: 300px; }
.card { position: absolute; width: 410px; aspect-ratio: 16 / 9; border-radius: 22px; overflow: hidden; background: radial-gradient(420px 240px at 50% 30%, #2D5C38, #12301E 70%); border: 1.5px solid rgba(245,241,230,.16); box-shadow: 0 30px 60px -28px rgba(0,0,0,.75); }
.card.c3 { right: -6px; top: -26px; transform: rotate(5deg); opacity: .45; } .card.c2 { right: 0; top: -12px; transform: rotate(2.5deg); opacity: .7; }
.card.c1 { left: 0; top: 18px; transform: rotate(-1.5deg); border-color: rgba(226,190,102,.5); }
.card .cross { position: absolute; left: 50%; top: 50%; width: 190px; transform: translate(-50%, -46%); opacity: .95; }
.play { position: absolute; left: 50%; top: 50%; width: 92px; height: 92px; margin: -46px 0 0 -46px; border-radius: 50%; background: rgba(16,38,26,.72); border: 2px solid rgba(255,246,218,.85); box-shadow: 0 0 0 10px rgba(226,190,102,.14), 0 16px 34px -12px rgba(0,0,0,.6); display: grid; place-items: center; }
.play::before { content: ''; margin-left: 8px; border-left: 30px solid #F6DE9C; border-top: 19px solid transparent; border-bottom: 19px solid transparent; }
.bar { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 18px; background: linear-gradient(transparent, rgba(8,22,14,.85)); font-size: 17px; font-weight: 600; color: rgba(245,241,230,.92); }
.bar b { color: #E2BE66; font-weight: 700; }
`;

function html(key, p) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body data-page="${key}">
<img class="logo" src="${file('public/img/logo-central-white.png')}" alt="">
<div class="text"><p class="eyebrow">${esc(p.eyebrow)}</p><h1>${esc(p.title)}<span class="serif">${esc(p.accent)}</span></h1><p class="lead">${esc(p.lead)}</p></div>
<div class="cta"><span class="btn${p.art === 'videos' ? ' play-btn' : ''}"><i></i>${esc(p.cta)}</span><span class="url">${esc(p.url)}</span></div>
<div class="art">${ART[p.art](p)}</div>
<div class="field">${wheat}</div>
<script>
  // the words fit their space: the title gets smaller until the text ends above the button
  const t = document.querySelector('.text'), h = document.querySelector('h1');
  let size = 72; while (t.getBoundingClientRect().bottom > 440 && size > 46) { size -= 2; h.style.setProperty('--h', size + 'px'); }
</script>
</body></html>`;
}

async function draw(tab, key, p, out) {
  const tmp = path.join(os.tmpdir(), `share-${key}.html`);
  fs.writeFileSync(tmp, html(key, p));
  await tab.goto('file://' + tmp);
  await tab.evaluate(() => document.fonts.ready);
  await tab.waitForTimeout(150);
  const fit = await tab.evaluate(() => ({ text: Math.round(document.querySelector('.text').getBoundingClientRect().bottom), h: getComputedStyle(document.querySelector('h1')).fontSize }));
  await tab.screenshot({ path: out, type: 'png' });
  console.log('wrote', path.relative(ROOT, out), Math.round(fs.statSync(out).size / 1024) + ' KB', `(title ${fit.h}, text ends at ${fit.text}px)`);
}

(async () => {
  const want = process.argv.slice(2);
  const b = await chromium.launch();
  const tab = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  fs.mkdirSync(path.join(ROOT, 'public/img/share'), { recursive: true });
  for (const [key, p] of Object.entries(PAGES)) if (!want.length || want.includes(key)) await draw(tab, key, p, path.join(ROOT, 'public/img/share', `${key}.png`));
  if (!want.length || want.includes('book')) await draw(tab, 'book', BOOK, path.join(ROOT, 'public/img/share', 'book-frame.png'));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

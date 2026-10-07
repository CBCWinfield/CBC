// Browser test for announcements + the weekly video. Run against a server started with AI_FAKE=1:
//   node test/announce-e2e.js /tmp   (needs Playwright)
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const B = 'http://localhost:3100', D = process.argv[2];
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  pg.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
  await pg.goto(B + '/login'); await pg.fill('#l-email', 'librarian@example.com'); await pg.fill('#l-pw', 'testpass123'); await pg.click('button[type=submit].btn'); await pg.waitForLoadState();
  await pg.goto(B + '/checkin/announcements');
  const add = async (title, desc, date, time, details) => {
    await pg.fill('#an-title', title); await pg.fill('#an-desc', desc);
    if (date) await pg.fill('#an-date', date); if (time) await pg.fill('#an-time', time);
    if (details) await pg.fill('#an-details', details);
    await pg.click('.an-new button[type=submit]'); await pg.waitForLoadState();
  };
  await add('Fall Chili Cook-Off', 'Bring your best pot of chili and a friend. Prizes for the top three!', '2026-10-25', '12:15', 'Fellowship Hall. Sign up in the foyer by Oct 18.');
  await add('Trunk or Treat', 'Candy, games and a hayride for the whole family.', '2026-10-31', '17:30', 'Decorate your trunk!');
  await add('Operation Christmas Child Packing Party', 'Help us pack 200 shoeboxes for children around the world.', '2026-11-11', '18:00');
  assert.strictEqual(await pg.$$eval('.an-slide', (x) => x.length), 3);
  assert.match(await pg.textContent('.an-slide:first-child'), /Operation Christmas Child/); // newest first
  await pg.screenshot({ path: D + '/an-admin.png', fullPage: true });
  // edit: change design manually
  await pg.click('.an-slide:nth-child(3) a:has-text("Edit")'); await pg.waitForLoadState();
  await pg.click('.an-fine summary'); await pg.selectOption('#an-theme', 'celebration'); await pg.click('form.an-form button[type=submit]'); await pg.waitForLoadState();
  // build reel
  await pg.fill('#rl-date', '2026-10-11'); await pg.click('.an-reel button[type=submit]'); await pg.waitForLoadState();
  assert.match(await pg.textContent('h1'), /Sunday, October 11, 2026/);
  assert.strictEqual(await pg.$$eval('.an-script li', (x) => x.length), 5);
  await pg.click('[data-record]');
  await pg.waitForURL(/reels\/\d+$/, { timeout: 120000 });
  await pg.waitForSelector('video.an-video', { timeout: 120000 });
  const dur = await pg.$eval('video.an-video', (v) => new Promise((ok) => { if (v.readyState >= 1) ok(v.duration); else v.addEventListener('loadedmetadata', () => ok(v.duration)); setTimeout(() => ok(v.duration), 8000); }));
  console.log('video duration', dur);
  await pg.screenshot({ path: D + '/an-reel.png', fullPage: true });
  // site: no video until approved, slides show
  const site = await ctx.newPage();
  await site.goto(B + '/site/events');
  assert.strictEqual(await site.$('.ann-video'), null, 'no video before approval');
  assert.strictEqual(await site.$$eval('.ann-slide', (x) => x.length), 3);
  await pg.click('button:has-text("Approve")'); await pg.waitForLoadState();
  await site.goto(B + '/site/events'); await site.waitForTimeout(1500);
  assert.ok(await site.$('.ann-video video'));
  await site.screenshot({ path: D + '/an-site.png', fullPage: true });
  // video served to anonymous visitors with range support
  const anon = await (await b.newContext()).request.get(B + (await site.getAttribute('.ann-video video', 'src')), { headers: { Range: 'bytes=0-99' } });
  assert.strictEqual(anon.status(), 206); assert.strictEqual((await anon.body()).length, 100);
  // delete an announcement
  await pg.goto(B + '/checkin/announcements'); pg.once('dialog', (d) => d.accept()); await pg.click('.an-slide:first-child button:has-text("Delete")'); await pg.waitForLoadState();
  assert.strictEqual(await pg.$$eval('.an-slide', (x) => x.length), 2);
  // mobile site
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await m.goto(B + '/site/events'); await m.waitForTimeout(1200);
  console.log('mobile scrollWidth', await m.evaluate(() => document.documentElement.scrollWidth));
  await m.screenshot({ path: D + '/an-site-m.png', fullPage: true });
  console.log('announce flow ok');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

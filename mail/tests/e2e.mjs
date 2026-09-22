// End-to-end tests: run the real app in Chromium against an in-memory Gmail.
//   npm test                      (from the mail/ folder)
//   SCREENSHOTS=/some/dir npm test  (also saves screenshots of each screen)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createMock, GIS_STUB, ME } from './mock-gmail.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SCREENSHOTS || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([true, name]); console.log('  ✓', name); }
  catch (err) { results.push([false, name, err]); console.log('  ✗', name, '\n     ', err.message.split('\n').slice(0, 4).join(' | ')); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

const browser = await chromium.launch();

async function setup({ mobile = false, dark = false, signedIn = true } = {}) {
  const mock = createMock();
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 860 },
    deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile, colorScheme: dark ? 'dark' : 'light',
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: GIS_STUB }));
  await page.route(/gmail\.googleapis\.com/, (r) => mock.handle(r));
  if (signedIn) {
    await page.addInitScript(([me]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('mail.clientId', JSON.stringify('test.apps.googleusercontent.com'));
      localStorage.setItem('mail.accounts', JSON.stringify({ [me]: { token: 'tok', exp: Date.now() + 3e6 } }));
      localStorage.setItem('mail.current', JSON.stringify(me));
    }, [ME]);
  }
  await page.goto(BASE);
  if (signedIn) {
    await page.waitForSelector('#mbList .row-wrap');
    await page.waitForSelector('#splash', { state: 'detached' });
  }
  return { page, mock, context };
}

const rowIds = (page) => page.$$eval('#mbList .row-wrap', (els) => els.map((e) => e.dataset.id));
const decodeRaw = (raw) => Buffer.from(raw, 'base64url').toString('utf8');

console.log('Mail end-to-end tests');

await test('sign-in screen → Google sign-in → inbox', async () => {
  const { page, context } = await setup({ signedIn: false });
  await page.waitForSelector('#auth');
  assert(await page.isVisible('text=Your inbox,'), 'headline missing');
  await shot(page, 'mobile-auth');
  await page.fill('#aClientId', 'test.apps.googleusercontent.com');
  await page.click('[data-a="google"]');
  await page.waitForSelector('#mbList .row-wrap');
  assert(!(await page.$('#auth')), 'auth screen should close');
  await context.close();
});

await test('inbox lists messages, unread count and attachment indicator', async () => {
  const { page, context } = await setup();
  await page.waitForTimeout(300);
  const ids = await rowIds(page);
  assert(ids.length === 8, `expected 8 inbox rows, got ${ids.length}`);
  assert(await page.$('.row-wrap[data-id="m0"] .email-row.is-unread'), 'm0 should be unread');
  assert(await page.$('.row-wrap[data-id="m0"] .row-meta .ic'), 'attachment icon missing');
  assert((await page.textContent('#navInboxCount')).trim() === '2', 'unread badge should be 2');
  await shot(page, 'desktop-inbox');
  assert(!page.errors.length, page.errors.join('; '));
  await context.close();
});

await test('opening an email shows it and marks it read; HTML emails cannot run scripts', async () => {
  const { page, mock, context } = await setup();
  await page.click('.row-wrap[data-id="m0"] .email-row');
  await page.waitForSelector('#rdSubject');
  assert((await page.textContent('#rdSubject')) === 'Project update', 'wrong subject');
  assert(await page.isVisible('text=Project Plan.pdf'), 'attachment card missing');
  await page.waitForTimeout(300);
  assert(mock.db.messages[0].labelIds.includes('UNREAD') === false, 'message should be marked read');
  assert(!(await page.$('.row-wrap[data-id="m0"] .email-row.is-unread')), 'row should no longer be unread');
  await shot(page, 'desktop-reader');
  await page.click('.row-wrap[data-id="m1"] .email-row');
  await page.waitForSelector('.msg-frame');
  await page.waitForTimeout(400);
  assert((await page.evaluate(() => window.PWNED)) === undefined, 'email script executed!');
  await context.close();
});

await test('inbox filters: Unread and Archive', async () => {
  const { page, context } = await setup();
  await page.click('[data-filter="unread"]');
  await page.waitForFunction(() => document.querySelectorAll('#mbList .row-wrap').length === 2);
  await page.click('[data-filter="archive"]');
  await page.waitForFunction(() => document.querySelector('#mbList .row-wrap')?.dataset.id === 'm8');
  assert((await rowIds(page)).length === 1, 'archive should show 1 message');
  await context.close();
});

await test('compose: Send is disabled until a valid recipient; multiple recipients, Cc/Bcc and send', async () => {
  const { page, mock, context } = await setup();
  await page.click('.sidebar [data-action="compose"]');
  await page.waitForSelector('.composer');
  assert(await page.isDisabled('#cSend'), 'send should start disabled');
  await page.fill('#cTo input', 'not-an-email');
  await page.keyboard.press('Enter');
  assert(await page.isDisabled('#cSend'), 'send should be disabled with an invalid recipient');
  await page.click('#cTo .rcpt button');
  await page.fill('#cTo input', 'a@example.com, B Person <b@example.com>,');
  await page.click('[data-c="ccbcc"] >> nth=0');
  await page.fill('#cBcc input', 'c@example.com');
  await page.fill('#cSubject', 'Hello þú');
  await page.click('#cEditor');
  await page.keyboard.type('Sounds great — takk!');
  assert(!(await page.isDisabled('#cSend')), 'send should be enabled');
  await shot(page, 'desktop-compose');
  await page.click('#cSend');
  await page.waitForSelector('.composer', { state: 'detached' });
  const raw = decodeRaw(mock.db.sent[0].raw);
  assert(/^To: a@example\.com, "B Person" <b@example\.com>/m.test(raw), 'To header wrong:\n' + raw.slice(0, 200));
  assert(/^Bcc: c@example\.com/m.test(raw), 'Bcc header missing');
  assert(raw.includes('Subject: =?UTF-8?B?'), 'non-ASCII subject should be encoded');
  assert(raw.includes('multipart/alternative'), 'should include text + html parts');
  await context.close();
});

await test('reply all fills recipients without me or duplicates and quotes the original', async () => {
  const { page, mock, context } = await setup();
  await page.click('.row-wrap[data-id="m0"] .email-row');
  await page.waitForSelector('#rdSubject');
  await page.click('[data-action="reply-all"]');
  await page.waitForSelector('.composer');
  const to = await page.$$eval('#cTo .rcpt span', (s) => s.map((x) => x.textContent));
  const cc = await page.$$eval('#cCc .rcpt span', (s) => s.map((x) => x.textContent));
  assert(JSON.stringify(to) === '["Alex Johnson"]', 'to: ' + to);
  assert(JSON.stringify(cc) === '["Sam Lee"]', 'cc: ' + cc);
  assert((await page.inputValue('#cSubject')) === 'Re: Project update', 'subject');
  assert(await page.isVisible('.c-quote'), 'quoted message missing');
  await page.click('#cEditor');
  await page.keyboard.type('Thanks!');
  await page.click('#cSend');
  await page.waitForSelector('.composer', { state: 'detached' });
  const sent = mock.db.sent[0];
  const raw = decodeRaw(sent.raw);
  assert(sent.threadId === 't0', 'reply should stay in the thread');
  assert(/^In-Reply-To: <id0@example\.com>/m.test(raw), 'In-Reply-To missing');
  await context.close();
});

await test('forward keeps the original attachment', async () => {
  const { page, mock, context } = await setup();
  await page.click('.row-wrap[data-id="m0"] .email-row');
  await page.waitForSelector('#rdSubject');
  await page.click('[data-action="forward"]');
  await page.waitForSelector('#cAttachments .attach-card:not(.is-pending)');
  await page.fill('#cTo input', 'friend@example.com');
  await page.click('#cSend');
  await page.waitForSelector('.composer', { state: 'detached' });
  const raw = decodeRaw(mock.db.sent[0].raw);
  assert(raw.includes('multipart/mixed') && raw.includes('filename="Project Plan.pdf"'), 'attachment not forwarded');
  assert(/^Subject: Fwd: Project update/m.test(raw), 'forward subject');
  await context.close();
});

await test('draft autosaves, and closing asks before discarding', async () => {
  const { page, mock, context } = await setup();
  await page.click('.sidebar [data-action="compose"]');
  await page.click('#cEditor');
  await page.keyboard.type('Unfinished thought');
  await page.waitForFunction(() => document.getElementById('cStatus')?.textContent === 'Draft saved', null, { timeout: 5000 });
  assert(mock.db.drafts.length === 1, 'draft should be created');
  await page.click('[data-c="close"]');
  await page.waitForSelector('.dialog');
  assert(await page.isVisible('text=Discard this message?'), 'confirmation missing');
  await shot(page, 'desktop-discard');
  await page.click('.dialog button:has-text("Discard")');
  await page.waitForSelector('.composer', { state: 'detached' });
  await page.waitForTimeout(200);
  assert(mock.db.drafts.length === 0, 'draft should be deleted on discard');
  // An empty composer closes without asking.
  await page.click('.sidebar [data-action="compose"]');
  await page.click('[data-c="close"]');
  await page.waitForSelector('.composer', { state: 'detached', timeout: 1000 });
  assert(!(await page.$('.dialog')), 'empty composer should not ask');
  await context.close();
});

await test('failed send keeps the message and Retry sends it', async () => {
  const { page, mock, context } = await setup();
  mock.db.failSend = true;
  await page.click('.sidebar [data-action="compose"]');
  await page.fill('#cTo input', 'x@example.com');
  await page.fill('#cSubject', 'Important');
  await page.click('#cEditor');
  await page.keyboard.type('Do not lose me');
  await page.click('#cSend');
  await page.waitForSelector('#cBanner .banner');
  assert((await page.textContent('#cBanner')).includes('Failed to send'), 'error banner missing');
  assert((await page.textContent('#cEditor')) === 'Do not lose me', 'body lost after failure');
  await shot(page, 'desktop-failed-send');
  mock.db.failSend = false;
  await page.click('#cBanner [data-action="retry"]');
  await page.waitForSelector('.composer', { state: 'detached' });
  assert(mock.db.sent.length === 1, 'retry should send');
  await context.close();
});

await test('search with filters and recent searches', async () => {
  const { page, mock, context } = await setup();
  await page.click('.desk-search .searchbar');
  await page.fill('#sInput', 'invoice');
  await page.press('#sInput', 'Enter');
  await page.waitForSelector('#sBody .row-wrap');
  const n = await page.$$eval('#sBody .row-wrap', (e) => e.length);
  assert(n === 3, `expected 3 results, got ${n}`);
  await page.click('[data-chip="attachment"]');
  await page.waitForFunction(() => document.querySelectorAll('#sBody .row-wrap').length === 1);
  assert(mock.db.calls.some((c) => c.query.includes('has%3Aattachment')), 'filter not sent to Gmail');
  await shot(page, 'desktop-search');
  await page.click('[data-s="clear"]');
  await page.click('[data-chip="all"]');
  await page.waitForSelector('[data-recent="invoice"]');
  await page.click('[data-remove-recent="invoice"]');
  assert(!(await page.$('[data-recent="invoice"]')), 'recent search not removed');
  await context.close();
});

await test('multi-select and bulk archive', async () => {
  const { page, mock, context } = await setup();
  await page.click('.row-wrap[data-id="m3"] .avatar');
  await page.click('.row-wrap[data-id="m4"] .avatar');
  assert((await page.textContent('.selection-header .count')) === '2 selected', 'selection count');
  await shot(page, 'desktop-select');
  await page.click('[data-bulk="archive"]');
  await page.waitForFunction(() => !document.querySelector('.row-wrap[data-id="m3"]'));
  assert(!mock.db.messages[3].labelIds.includes('INBOX') && !mock.db.messages[4].labelIds.includes('INBOX'), 'not archived in Gmail');
  assert(await page.isVisible('.toast >> text=Undo'), 'undo missing');
  await context.close();
});

await test('mobile: layout, open email, back, swipe right to archive', async () => {
  const { page, mock, context } = await setup({ mobile: true });
  await shot(page, 'mobile-inbox');
  assert(await page.isVisible('.tabbar'), 'tab bar missing');
  await page.click('.row-wrap[data-id="m0"] .email-row');
  await page.waitForSelector('#rdSubject');
  await page.waitForTimeout(350);
  await shot(page, 'mobile-reader');
  await page.click('[data-action="back"]');
  await page.waitForTimeout(350);
  // Simulate a touch swipe to the right on "Mom".
  const box = await page.locator('.row-wrap[data-id="m3"]').boundingBox();
  await page.evaluate(({ x, y, w }) => {
    const row = document.querySelector('.row-wrap[data-id="m3"] .email-row');
    const ev = (type, cx) => row.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: cx, clientY: y, isPrimary: true }));
    ev('pointerdown', x);
    for (let i = 1; i <= 10; i++) ev('pointermove', x + (w * 0.6 * i) / 10);
    ev('pointerup', x + w * 0.6);
  }, { x: box.x + 20, y: box.y + box.height / 2, w: box.width });
  await page.waitForFunction(() => !document.querySelector('.row-wrap[data-id="m3"]'), null, { timeout: 3000 });
  assert(!mock.db.messages[3].labelIds.includes('INBOX'), 'swipe did not archive');
  await context.close();
});

await test('mobile: compose, search and settings screens', async () => {
  const { page, context } = await setup({ mobile: true });
  await page.click('.tabbar [data-action="compose"]');
  await page.waitForSelector('.composer');
  await shot(page, 'mobile-compose');
  await page.click('[data-c="close"]');
  await page.click('.tabbar [data-screen-btn="search"]');
  await page.fill('#sInput', 'invoice');
  await page.waitForSelector('#sBody .row-wrap');
  await shot(page, 'mobile-search');
  await page.click('.tabbar [data-screen-btn="settings"]');
  await page.waitForSelector('.account-row');
  await shot(page, 'mobile-settings');
  await page.click('[data-nav="appearance"]');
  await page.click('[data-theme-choice="dark"]');
  assert((await page.getAttribute('html', 'data-theme')) === 'dark', 'theme not applied');
  await page.click('[data-nav="back"]');
  await page.click('.tabbar [data-screen-btn="mail"]');
  await page.waitForTimeout(200);
  await shot(page, 'mobile-inbox-dark');
  await page.click('.row-wrap[data-id="m0"] .email-row');
  await page.waitForSelector('#rdSubject');
  await page.waitForTimeout(350);
  await shot(page, 'mobile-reader-dark');
  assert(!page.errors.length, page.errors.join('; '));
  await context.close();
});

await test('empty inbox and offline states', async () => {
  const { page, mock, context } = await setup({ mobile: true });
  mock.db.emptyInbox = true;
  await page.evaluate(() => localStorage.removeItem('mail.listCache'));
  await page.click('[data-action="mailbox-menu"]');
  await page.click('.sheet >> text=Refresh');
  await page.waitForSelector('text=You’re all caught up!');
  await shot(page, 'mobile-empty');
  mock.db.emptyInbox = false;
  mock.db.offline = true;
  await page.click('[data-filter="unread"]');
  await page.waitForSelector('text=No connection');
  await shot(page, 'mobile-offline');
  mock.db.offline = false;
  await page.click('[data-action="retry"]');
  await page.waitForSelector('#mbList .row-wrap');
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

// App shell: boot, navigation between screens, and wiring views together.
import * as gmail from './gmail.js';
import * as outbox from './outbox.js';
import { installIcons, icon, logo } from './icons.js';
import { store } from './store.js';
import { state, on, emit, FOLDERS } from './state.js';
import { $, $$, toast, closeTopLayer, hasLayers } from './ui.js';
import { escapeHtml as e } from './format.js';
import { mountMailbox, showFolder, refresh as refreshList, isSelecting, endSelecting } from './views/mailbox.js';
import { mountReader, open as openMessage, close as closeReader } from './views/reader.js';
import { mountSearch, focusSearch } from './views/search.js';
import { mountSettings, showSettings } from './views/settings.js';
import { openComposer, isComposing, offerLocalDraft } from './views/composer.js';
import { showAuth } from './views/auth.js';
import { checkForNewMail } from './notify.js';

const REFRESH_MS = 60 * 1000;
const isMobile = () => matchMedia('(max-width: 800px)').matches;

// ---------------------------------------------------------------- appearance

function applyPrefs() {
  const p = store.prefs();
  const root = document.documentElement;
  if (p.theme === 'system') root.removeAttribute('data-theme'); else root.dataset.theme = p.theme;
  const app = document.getElementById('app');
  app?.classList.toggle('hide-previews', !p.previews);
  app?.classList.toggle('hide-avatars', !p.avatars);
  const dark = p.theme === 'dark' || (p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c0c0c' : '#ffffff');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyPrefs);

// ---------------------------------------------------------------- shell

function buildShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <aside class="sidebar" aria-label="Mailboxes">
      <div class="brand">${logo()}<span>Mail</span></div>
      <button type="button" class="btn btn-primary btn-compose" data-action="compose" aria-label="Compose">${icon('compose')}<span>Compose</span></button>
      <nav class="nav-list">
        ${Object.entries(FOLDERS).map(([key, f]) => `<button type="button" class="nav-item" data-folder="${key}" aria-label="${f.title}">${icon(f.icon)}<span class="label">${f.title}</span>${key === 'INBOX' ? '<span class="nav-count" id="navInboxCount" hidden></span>' : ''}</button>`).join('')}
      </nav>
      <div class="sidebar-foot">
        <div class="sidebar-account" id="sideAccount"></div>
        <button type="button" class="nav-item" data-screen-btn="settings" aria-label="Settings">${icon('settings')}<span class="label">Settings</span></button>
      </div>
    </aside>
    <section class="pane mailbox-pane" id="mailboxPane" aria-label="Messages"></section>
    <section class="pane search-pane" id="searchPane" aria-label="Search"></section>
    <main class="pane reader-pane is-empty" id="readerPane" aria-label="Message"></main>
    <section class="pane settings-pane" id="settingsPane" aria-label="Settings"></section>
    <button type="button" class="fab" data-action="compose" aria-label="Compose">${icon('compose')}</button>
    <nav class="tabbar" aria-label="Main">
      <button type="button" class="tab" data-screen-btn="mail">${icon('mail')}<span>Inbox</span></button>
      <button type="button" class="tab" data-screen-btn="search">${icon('search')}<span>Search</span></button>
      <button type="button" class="tab" data-action="compose">${icon('compose')}<span>Compose</span></button>
      <button type="button" class="tab" data-screen-btn="settings">${icon('settings')}<span>Settings</span></button>
    </nav>`;
  app.dataset.screen = 'mail';
  app.dataset.reading = 'false';
  mountMailbox($('#mailboxPane'));
  mountSearch($('#searchPane'));
  mountReader($('#readerPane'));
  mountSettings($('#settingsPane'));
  app.addEventListener('click', onShellClick);
}

function setScreen(screen) {
  const app = document.getElementById('app');
  if (isSelecting()) endSelecting();
  if (screen !== 'mail' && isMobile() && app.dataset.reading === 'true') closeReader();
  state.screen = screen;
  app.dataset.screen = screen;
  $$('[data-screen-btn]').forEach((b) => b.setAttribute('aria-current', b.dataset.screenBtn === screen ? 'page' : 'false'));
  $$('.sidebar [data-folder]').forEach((b) => b.setAttribute('aria-current', screen !== 'settings' && b.dataset.folder === state.folder ? 'page' : 'false'));
  if (screen === 'settings') showSettings();
  if (screen === 'search') focusSearch();
}

function onShellClick(ev) {
  const folder = ev.target.closest('.sidebar [data-folder]');
  if (folder) { setScreen('mail'); showFolder(folder.dataset.folder); return; }
  const scr = ev.target.closest('[data-screen-btn]');
  if (scr) {
    if (scr.dataset.screenBtn === 'mail' && state.screen === 'mail' && state.folder !== 'INBOX') showFolder('INBOX');
    setScreen(scr.dataset.screenBtn);
    return;
  }
  const a = ev.target.closest('[data-action]');
  if (!a) return;
  if (a.dataset.action === 'compose') openComposer();
  if (a.dataset.action === 'open-search') setScreen('search');
}

// ---------------------------------------------------------------- data refresh

async function updateUnread() {
  try {
    const label = await gmail.inboxLabel();
    state.unread = label.messagesUnread || 0;
    document.title = state.unread ? `Mail (${state.unread})` : 'Mail';
    emit('unread-count');
  } catch {}
}

async function tick() {
  if (document.visibilityState !== 'visible' || !gmail.tokenValid()) return;
  if (state.screen === 'mail' && !isSelecting()) refreshList();
  updateUnread();
  outbox.flush();
  checkForNewMail();
}

// ---------------------------------------------------------------- routing (deep links)

function routeFromHash() {
  const m = location.hash.match(/^#\/m\/(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (state.openId !== id) { setScreen('mail'); openMessage(id, 'mail'); }
  }
}

// ---------------------------------------------------------------- accounts

let started = false;

async function start() {
  state.email = gmail.currentEmail();
  if (!started) {
    started = true;
    buildShell();
    wireEvents();
    setInterval(tick, REFRESH_MS);
  }
  applyPrefs();
  $('#sideAccount').textContent = state.email;
  setScreen('mail');
  const first = showFolder('INBOX');
  updateUnread();
  checkForNewMail(); // seeds the "already seen" list
  await Promise.race([first, new Promise((r) => setTimeout(r, 1500))]);
  hideSplash();
  routeFromHash();
  outbox.flush();
  setTimeout(offerLocalDraft, 600);
}

async function signInAgain() {
  try {
    await gmail.signIn({ email: state.email });
    toast('Signed in');
    emit('refresh');
    updateUnread();
    outbox.flush();
  } catch (err) { toast(err.message); }
}

let expiredShown = false;
gmail.setAuthExpiredHandler(() => {
  if (expiredShown || !started) return;
  expiredShown = true;
  toast('Your Google sign-in expired.', { action: { label: 'Sign in', run: () => { expiredShown = false; signInAgain(); } }, duration: 60000 });
});

function wireEvents() {
  on('open-message', ({ id, from }) => openMessage(id, from));
  on('edit-draft', ({ draftId, id }) => openComposer({ mode: 'draft', draftId, messageId: id }));
  on('compose', (opts) => openComposer(opts));
  on('leave-search', () => setScreen('mail'));
  on('counts-stale', updateUnread);
  on('sent', () => { if (state.folder === 'SENT' || state.folder === 'DRAFT') refreshList(); });
  on('drafts-changed', () => { if (state.folder === 'DRAFT') refreshList(); });
  on('prefs-changed', applyPrefs);

  on('sign-out', ({ revoke }) => {
    const email = state.email;
    gmail.signOut({ revoke });
    store.removeAccount(email);
    store.clearCache();
    location.hash = '';
    location.reload();
  });
  on('remove-account', () => {
    const email = state.email;
    gmail.signOut();
    store.removeAccount(email);
    location.reload();
  });
  on('switch-account', async (email) => {
    store.setCurrent(email);
    if (store.tokenFor(email)) { location.reload(); return; }
    try { await gmail.signIn({ email }); location.reload(); }
    catch (err) { toast(err.message); store.setCurrent(state.email); }
  });
  on('add-account', async () => {
    try { await gmail.signIn({ newAccount: true }); location.reload(); }
    catch (err) { if (!/cancel/i.test(err.message)) toast(err.message); }
  });

  window.addEventListener('popstate', () => {
    if (document.getElementById('app').dataset.reading === 'true' && !history.state?.reader) closeReader({ fromHistory: true });
  });
  window.addEventListener('hashchange', routeFromHash);
  navigator.serviceWorker?.addEventListener('message', (ev) => {
    if (ev.data?.type === 'open-message' && ev.data.id) { setScreen('mail'); openMessage(ev.data.id, 'mail'); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });

  document.addEventListener('keydown', (ev) => {
    const typing = ev.target.closest('input, textarea, [contenteditable="true"]');
    if (ev.key === 'Escape') {
      if (closeTopLayer()) { ev.preventDefault(); return; }
      if (typing) { ev.target.blur(); return; }
      if (isSelecting()) { endSelecting(); return; }
      if (state.openId) { closeReader(); return; }
      if (state.screen !== 'mail') setScreen('mail');
      return;
    }
    if (typing || hasLayers() || isComposing() || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === 'c') { ev.preventDefault(); openComposer(); }
    if (ev.key === '/') { ev.preventDefault(); setScreen('search'); }
  });
}

// ---------------------------------------------------------------- boot

function hideSplash() {
  const s = document.getElementById('splash');
  if (!s || s.classList.contains('is-leaving')) return;
  s.classList.add('is-leaving');
  setTimeout(() => s.remove(), 250);
}

async function boot() {
  installIcons();
  applyPrefs();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  const email = store.currentEmail();
  if (email && store.getClientId() && (await gmail.resumeSession(email))) {
    await start();
    return;
  }
  hideSplash();
  await showAuth();
  await start();
}

boot().catch((err) => {
  console.error(err);
  hideSplash();
  document.body.insertAdjacentHTML('beforeend', `<div class="empty" style="position:fixed;inset:0">${icon('alert')}<h2>Something went wrong</h2><p>${e(err.message)}</p><button class="btn btn-primary" onclick="location.reload()">Reload</button></div>`);
});

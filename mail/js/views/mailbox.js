// Mailbox list: Inbox (with quick filters) and the other folders.
// Handles loading, paging, offline cache, empty state, swipe actions and multi-select.
import * as gmail from '../gmail.js';
import * as actions from '../actions.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { state, on, emit, FOLDERS, INBOX_FILTERS, mailboxSpec, mailboxKey, mailboxTitle } from '../state.js';
import { $, $$, emailRow, emptyState, banner, loadingBlock, sheet, haptic } from '../ui.js';
import { attachSwipe } from '../swipe.js';

let pane, listEl, statusEl, footerEl, bannerEl, headerEl, chipsEl;
let rows = [];
let nextPageToken = null;
let seq = 0;
let loading = false;
let offline = false;
const selected = new Set();
let selecting = false;

export function mountMailbox(root) {
  pane = root;
  pane.innerHTML = `
    <header class="pane-header is-mobile-only" id="mbHeader"></header>
    <div class="desk-search"><button type="button" class="searchbar" data-action="open-search" aria-label="Search emails">${icon('search')}<span>Search emails…</span></button></div>
    <div class="chips" id="mbChips" role="toolbar" aria-label="Filter inbox"></div>
    <div id="mbBanner"></div>
    <div class="pane-scroll" id="mbScroll">
      <div id="mbStatus"></div>
      <ul class="row-list" id="mbList" aria-label="Messages"></ul>
      <div class="list-footer" id="mbFooter"></div>
    </div>`;
  headerEl = $('#mbHeader', pane);
  chipsEl = $('#mbChips', pane);
  bannerEl = $('#mbBanner', pane);
  listEl = $('#mbList', pane);
  statusEl = $('#mbStatus', pane);
  footerEl = $('#mbFooter', pane);

  renderHeader();
  renderChips();

  pane.addEventListener('click', onClick);
  listEl.addEventListener('keydown', onKeyDown);
  $('#mbScroll', pane).addEventListener('scroll', onScroll, { passive: true });

  attachSwipe(listEl, {
    enabled: () => !selecting,
    describe: (id) => {
      const m = rows.find((r) => r.id === id) || { labelIds: [] };
      const inInbox = m.labelIds.includes('INBOX');
      return { unread: m.labelIds.includes('UNREAD'), starred: m.labelIds.includes('STARRED'), archivable: inInbox, archiveLabel: inInbox ? 'Archive' : 'Move to Inbox' };
    },
    onArchive: (id) => {
      const m = rows.find((r) => r.id === id);
      if (!m) return;
      if (m.labelIds.includes('INBOX')) actions.archive([id]); else actions.moveToInbox([id]);
    },
    onAction: (id, action) => rowAction(id, action),
    onLongPress: (id) => { startSelecting(); toggleSelected(id); },
  });

  on('labels-changed', onLabelsChanged);
  on('trashed', ({ ids }) => removeRows(ids));
  on('refresh', () => load({ silent: true }));
  on('unread-count', renderHeader);
  on('open-message', () => markCurrent());
}

// ---------------------------------------------------------------- header / chips

function renderHeader() {
  const sidebarBadge = $('#navInboxCount');
  if (sidebarBadge) { sidebarBadge.textContent = state.unread > 999 ? '999+' : String(state.unread); sidebarBadge.hidden = !state.unread; }
  if (selecting) {
    const allRead = [...selected].every((id) => !rows.find((r) => r.id === id)?.labelIds.includes('UNREAD'));
    const allStarred = selected.size > 0 && [...selected].every((id) => rows.find((r) => r.id === id)?.labelIds.includes('STARRED'));
    const inTrash = state.folder === 'TRASH';
    headerEl.className = 'pane-header selection-header';
    headerEl.innerHTML = `
      <button type="button" class="icon-btn" data-action="end-select" aria-label="Cancel selection">${icon('x')}</button>
      <span class="count" aria-live="polite">${selected.size} selected</span>
      ${inTrash ? `<button type="button" class="icon-btn" data-bulk="restore" aria-label="Restore" ${selected.size ? '' : 'disabled'}>${icon('undo')}</button>` : `
      <button type="button" class="icon-btn" data-bulk="archive" aria-label="Archive" ${selected.size ? '' : 'disabled'}>${icon('archive')}</button>
      <button type="button" class="icon-btn" data-bulk="${allRead ? 'unread' : 'read'}" aria-label="${allRead ? 'Mark as unread' : 'Mark as read'}" ${selected.size ? '' : 'disabled'}>${icon(allRead ? 'mail' : 'mailOpen')}</button>
      <button type="button" class="icon-btn${allStarred ? ' is-on' : ''}" data-bulk="${allStarred ? 'unstar' : 'star'}" aria-label="${allStarred ? 'Remove star' : 'Star'}" ${selected.size ? '' : 'disabled'}>${icon('star')}</button>
      <button type="button" class="icon-btn" data-bulk="delete" aria-label="Delete" ${selected.size ? '' : 'disabled'}>${icon('trash')}</button>`}`;
    return;
  }
  headerEl.className = 'pane-header is-mobile-only';
  headerEl.innerHTML = `
    <h1 class="pane-title">${mailboxTitle()}</h1>
    <button type="button" class="icon-btn" data-action="open-search" aria-label="Search">${icon('search')}</button>
    <button type="button" class="icon-btn" data-action="mailbox-menu" aria-label="Mailboxes and options">${icon('filter')}</button>`;
}

function renderChips() {
  chipsEl.hidden = state.folder !== 'INBOX' || selecting;
  chipsEl.innerHTML = Object.entries(INBOX_FILTERS)
    .map(([key, f]) => `<button type="button" class="chip" data-filter="${key}" aria-pressed="${state.filter === key}">${f.label}</button>`)
    .join('');
}

// ---------------------------------------------------------------- loading

export function showFolder(folder, filter = 'all') {
  state.folder = folder;
  state.filter = folder === 'INBOX' ? filter : 'all';
  endSelecting();
  renderHeader();
  renderChips();
  $$('[data-folder]').forEach((b) => b.setAttribute('aria-current', b.dataset.folder === folder ? 'page' : 'false'));
  rows = [];
  nextPageToken = null;
  listEl.innerHTML = '';
  $('#mbScroll', pane).scrollTop = 0;
  return load();
}

export async function load({ silent = false, append = false } = {}) {
  const my = ++seq;
  const key = mailboxKey();
  loading = true;
  if (!append && !silent) {
    const cached = store.cachedList(key);
    if (cached && !rows.length) { rows = cached; renderRows(); }
    if (!rows.length) statusEl.innerHTML = loadingBlock();
  }
  if (append) footerEl.innerHTML = '<div class="spinner" aria-label="Loading more"></div>';
  try {
    const res = await gmail.list(mailboxSpec(), { pageToken: append ? nextPageToken : undefined });
    if (my !== seq) return;
    rows = append ? rows.concat(res.rows.filter((r) => !rows.some((x) => x.id === r.id))) : res.rows;
    nextPageToken = res.nextPageToken;
    setOffline(false);
    if (!append) store.cacheList(key, rows);
    renderRows();
  } catch (err) {
    if (my !== seq) return;
    if (err instanceof gmail.NetworkError) {
      if (!rows.length) rows = store.cachedList(key) || [];
      setOffline(true);
      renderRows();
    } else if (!(err instanceof gmail.AuthError)) {
      statusEl.innerHTML = banner({ text: 'Could not load your email.', error: true, action: { id: 'retry', label: 'Try again' } });
    }
  } finally {
    if (my === seq) loading = false;
  }
}

function setOffline(v) {
  offline = v;
  state.online = !v;
  bannerEl.innerHTML = v && rows.length
    ? banner({ iconName: 'wifiOff', text: 'No connection. Showing saved emails.', action: { id: 'retry', label: 'Try again' } })
    : '';
}

function onScroll(ev) {
  const el = ev.currentTarget;
  if (nextPageToken && !loading && el.scrollTop + el.clientHeight > el.scrollHeight - 400) load({ append: true });
}

// ---------------------------------------------------------------- rendering

function renderRows() {
  const who = FOLDERS[state.folder].who || 'from';
  listEl.innerHTML = rows.map((m) => emailRow(m, { who, current: m.id === state.openId, selected: selected.has(m.id) })).join('');
  footerEl.innerHTML = nextPageToken ? '<button type="button" class="link-btn" data-action="more">Load more</button>' : '';
  if (rows.length) { statusEl.innerHTML = ''; return; }
  if (offline) {
    statusEl.innerHTML = emptyState({ iconName: 'wifiOff', title: 'No connection', text: 'Check your internet connection and try again.', action: { id: 'retry', label: 'Try again', icon: 'refresh' } });
  } else if (state.folder === 'INBOX' && state.filter === 'all') {
    statusEl.innerHTML = emptyState({ iconName: 'mail', title: 'You’re all caught up!', text: 'No new emails in your inbox.', action: { id: 'compose', label: 'Compose email', icon: 'pencil' } });
  } else {
    const what = state.folder === 'INBOX' ? INBOX_FILTERS[state.filter].label.toLowerCase() : mailboxTitle().toLowerCase();
    statusEl.innerHTML = emptyState({ iconName: FOLDERS[state.folder].icon, title: `No ${what} emails`, text: state.folder === 'TRASH' ? 'Deleted emails appear here for 30 days.' : '' });
  }
}

function markCurrent() {
  $$('.email-row', listEl).forEach((r) => {
    const current = r.closest('.row-wrap').dataset.id === state.openId;
    if (current) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
  });
}

function rerenderRow(id) {
  const m = rows.find((r) => r.id === id);
  const wrap = listEl.querySelector(`.row-wrap[data-id="${CSS.escape(id)}"]`);
  if (!m || !wrap) return;
  const who = FOLDERS[state.folder].who || 'from';
  wrap.outerHTML = emailRow(m, { who, current: m.id === state.openId, selected: selected.has(m.id) });
}

function onLabelsChanged({ ids, add, remove }) {
  const spec = mailboxSpec();
  const required = (spec.labelIds || []).filter((l) => l !== 'UNREAD'); // keep just-read rows visible until refresh
  const gone = [];
  ids.forEach((id) => {
    const m = rows.find((r) => r.id === id);
    if (!m) return;
    m.labelIds = m.labelIds.filter((l) => !remove.includes(l)).concat(add.filter((l) => !m.labelIds.includes(l)));
    if (required.some((l) => !m.labelIds.includes(l))) gone.push(id);
    else if (state.folder === 'INBOX' && state.filter === 'archive' && m.labelIds.includes('INBOX')) gone.push(id);
    else rerenderRow(id);
  });
  if (gone.length) removeRows(gone);
  if (selecting) renderHeader();
}

function removeRows(ids) {
  const set = new Set(ids);
  const wraps = $$('.row-wrap', listEl).filter((w) => set.has(w.dataset.id));
  wraps.forEach((w) => {
    w.style.transition = 'height 180ms ease, opacity 180ms ease';
    w.style.height = w.offsetHeight + 'px';
    requestAnimationFrame(() => { w.style.height = '0px'; w.style.opacity = '0'; });
  });
  setTimeout(() => {
    rows = rows.filter((r) => !set.has(r.id));
    ids.forEach((id) => selected.delete(id));
    store.cacheList(mailboxKey(), rows);
    renderRows();
    if (selecting) renderHeader();
  }, 190);
}

// ---------------------------------------------------------------- selection

function startSelecting() {
  if (selecting) return;
  selecting = true;
  document.getElementById('app').classList.add('is-selecting');
  pane.classList.add('is-selecting');
  renderChips();
  renderHeader();
}

export function endSelecting() {
  if (!selecting) return;
  selecting = false;
  selected.clear();
  document.getElementById('app').classList.remove('is-selecting');
  pane.classList.remove('is-selecting');
  renderRows();
  renderChips();
  renderHeader();
}
export const isSelecting = () => selecting;

function toggleSelected(id) {
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  haptic(5);
  rerenderRow(id);
  renderHeader();
}

function bulk(action) {
  const ids = [...selected];
  if (!ids.length) return;
  endSelecting();
  ({
    archive: () => actions.archive(ids),
    read: () => actions.setRead(ids, true),
    unread: () => actions.setRead(ids, false),
    star: () => actions.setStar(ids, true),
    unstar: () => actions.setStar(ids, false),
    delete: () => actions.trash(ids),
    restore: () => actions.restore(ids),
  })[action]();
}

function rowAction(id, action) {
  const m = rows.find((r) => r.id === id);
  if (!m) return;
  if (action === 'read') actions.setRead([id], m.labelIds.includes('UNREAD'));
  if (action === 'star') actions.setStar([id], !m.labelIds.includes('STARRED'));
  if (action === 'delete') (state.folder === 'TRASH' ? actions.restore : actions.trash)([id]);
}

// ---------------------------------------------------------------- input

function onClick(ev) {
  const t = ev.target;
  const wrap = t.closest('.row-wrap');
  if (wrap && t.closest('.email-row')) {
    if (wrap.dataset.suppressClick) { delete wrap.dataset.suppressClick; return; }
    const id = wrap.dataset.id;
    if (selecting || ev.metaKey || ev.ctrlKey || (t.closest('.avatar') && matchMedia('(hover: hover)').matches)) {
      startSelecting();
      toggleSelected(id);
      return;
    }
    const m = rows.find((r) => r.id === id);
    emit(m?.draftId ? 'edit-draft' : 'open-message', { id, draftId: m?.draftId, from: 'mail' });
    return;
  }
  const chip = t.closest('[data-filter]');
  if (chip) { if (chip.dataset.filter !== state.filter) showFolder('INBOX', chip.dataset.filter); return; }
  const bulkBtn = t.closest('[data-bulk]');
  if (bulkBtn) { bulk(bulkBtn.dataset.bulk); return; }
  const a = t.closest('[data-action]');
  if (!a) return;
  switch (a.dataset.action) {
    case 'retry': load(); break;
    case 'more': load({ append: true }); break;
    case 'end-select': endSelecting(); break;
    case 'mailbox-menu': mailboxMenu(); break;
    // 'compose' and 'open-search' bubble to the app shell
  }
}

function mailboxMenu() {
  sheet({
    title: 'Mailboxes',
    items: [
      ...Object.entries(FOLDERS).map(([key, f]) => ({ label: f.title, icon: f.icon, checked: state.folder === key, run: () => showFolder(key) })),
      '-',
      { label: 'Select messages', icon: 'checkSquare', run: startSelecting },
      { label: 'Refresh', icon: 'refresh', run: () => { load(); emit('counts-stale'); } },
    ],
  });
}

function onKeyDown(ev) {
  const row = ev.target.closest('.email-row');
  if (!row) return;
  const wrap = row.closest('.row-wrap');
  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); row.click(); }
  else if (ev.key === 'ArrowDown' || ev.key === 'j') { ev.preventDefault(); wrap.nextElementSibling?.querySelector('.email-row')?.focus(); }
  else if (ev.key === 'ArrowUp' || ev.key === 'k') { ev.preventDefault(); wrap.previousElementSibling?.querySelector('.email-row')?.focus(); }
  else if (ev.key === 'x') { startSelecting(); toggleSelected(wrap.dataset.id); }
}

export function rowById(id) { return rows.find((r) => r.id === id) || null; }
export function refresh() { return load({ silent: true }); }
export const currentRows = () => rows;

// Search: Gmail's full-text search (sender, recipients, subject and body) plus filters.
import * as gmail from '../gmail.js';
import * as actions from '../actions.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { state, emit, on } from '../state.js';
import { $, emailRow, emptyState, loadingBlock, sheet, promptSheet } from '../ui.js';
import { escapeHtml as e } from '../format.js';

const DATES = {
  '': 'Any time',
  '7d': 'Past week',
  '1m': 'Past month',
  '6m': 'Past 6 months',
  '1y': 'Past year',
};

let pane, input, chipsEl, bodyEl;
let filters = { from: '', date: '', attachment: false, unread: false };
let rows = [];
let seq = 0;
let timer = null;

export function mountSearch(root) {
  pane = root;
  pane.innerHTML = `
    <form class="search-head" role="search">
      <label class="searchbar">${icon('search')}
        <input type="search" id="sInput" placeholder="Search emails" aria-label="Search emails" autocomplete="off" enterkeyhint="search">
        <button type="button" class="icon-btn clear" data-s="clear" aria-label="Clear search" hidden>${icon('xCircle')}</button>
      </label>
      <button type="button" class="link-btn" data-s="cancel">Cancel</button>
    </form>
    <div class="chips" id="sChips" role="toolbar" aria-label="Search filters"></div>
    <div class="pane-scroll" id="sBody" aria-live="polite"></div>`;
  input = $('#sInput', pane);
  chipsEl = $('#sChips', pane);
  bodyEl = $('#sBody', pane);
  renderChips();
  renderIdle();

  input.addEventListener('input', () => {
    $('[data-s="clear"]', pane).hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(run, 350);
  });
  $('form', pane).addEventListener('submit', (ev) => {
    ev.preventDefault();
    clearTimeout(timer);
    store.addRecent(input.value);
    input.blur();
    run();
  });
  pane.addEventListener('click', onClick);
  bodyEl.addEventListener('keydown', (ev) => {
    const row = ev.target.closest('.email-row');
    if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); row.click(); }
  });
  on('labels-changed', ({ ids, add, remove }) => {
    ids.forEach((id) => {
      const m = rows.find((r) => r.id === id);
      if (m) m.labelIds = m.labelIds.filter((l) => !remove.includes(l)).concat(add.filter((l) => !m.labelIds.includes(l)));
    });
    if (rows.length) renderResults();
  });
  on('trashed', ({ ids }) => { rows = rows.filter((r) => !ids.includes(r.id)); if (hasQuery()) renderResults(); });
}

export function focusSearch() {
  setTimeout(() => input.focus(), 30);
}

const activeCount = () => (filters.from ? 1 : 0) + (filters.date ? 1 : 0) + (filters.attachment ? 1 : 0) + (filters.unread ? 1 : 0);
const hasQuery = () => !!input.value.trim() || activeCount() > 0;

function buildQuery() {
  const parts = [];
  if (input.value.trim()) parts.push(input.value.trim());
  if (filters.from) parts.push(`from:(${filters.from.replace(/[()]/g, '')})`);
  if (filters.date) parts.push(`newer_than:${filters.date}`);
  if (filters.attachment) parts.push('has:attachment');
  if (filters.unread) parts.push('is:unread');
  return parts.join(' ');
}

function renderChips() {
  const chip = (id, label, pressed, dropdown) =>
    `<button type="button" class="chip" data-chip="${id}" aria-pressed="${pressed}">${e(label)}${dropdown ? icon(pressed ? 'x' : 'chevronDown') : ''}</button>`;
  chipsEl.innerHTML = [
    chip('all', 'All', activeCount() === 0, false),
    chip('from', filters.from ? `From: ${filters.from}` : 'From', !!filters.from, true),
    chip('date', filters.date ? DATES[filters.date] : 'Date', !!filters.date, true),
    chip('attachment', 'Has attachment', filters.attachment, false),
    chip('unread', 'Unread', filters.unread, false),
  ].join('');
}

function renderIdle() {
  const recents = store.recents();
  if (!recents.length) {
    bodyEl.innerHTML = emptyState({ iconName: 'search', title: 'Search your email', text: 'Find emails by sender, recipient, subject or words in the message.' });
    return;
  }
  bodyEl.innerHTML = `<div class="recent-head"><h2>Recent searches</h2><button type="button" class="link-btn" data-s="clear-recents">Clear all</button></div>
    <ul>${recents.map((q) => `<li class="recent-item">
      <button type="button" data-recent="${e(q)}">${icon('clock')}<span>${e(q)}</span></button>
      <button type="button" class="icon-btn" data-remove-recent="${e(q)}" aria-label="Remove ${e(q)} from recent searches">${icon('x', 'ic-sm')}</button>
    </li>`).join('')}</ul>`;
}

function renderResults() {
  if (!rows.length) {
    bodyEl.innerHTML = emptyState({ iconName: 'search', title: 'No results', text: activeCount() ? 'Try removing a filter or searching for something else.' : 'Try different words.' });
    return;
  }
  const n = activeCount();
  bodyEl.innerHTML = `<p class="search-summary">${rows.length}${rows.length >= 50 ? '+' : ''} result${rows.length === 1 ? '' : 's'}${n ? ` · ${n} filter${n > 1 ? 's' : ''}` : ''}</p>
    <ul class="row-list">${rows.map((m) => emailRow(m, { current: m.id === state.openId })).join('')}</ul>`;
}

async function run() {
  renderChips();
  if (!hasQuery()) { rows = []; renderIdle(); return; }
  const my = ++seq;
  bodyEl.innerHTML = loadingBlock();
  try {
    const res = await gmail.list({ q: buildQuery() }, { pageSize: 50 });
    if (my !== seq) return;
    rows = res.rows;
    renderResults();
  } catch (err) {
    if (my !== seq) return;
    if (err instanceof gmail.NetworkError) {
      bodyEl.innerHTML = emptyState({ iconName: 'wifiOff', title: 'No connection', text: 'Search needs an internet connection.', action: { id: 'retry', label: 'Try again', icon: 'refresh' } });
    } else if (!(err instanceof gmail.AuthError)) {
      bodyEl.innerHTML = emptyState({ iconName: 'alert', title: 'Search failed', text: err.message, action: { id: 'retry', label: 'Try again' } });
    }
  }
}

async function onClick(ev) {
  const t = ev.target;
  const row = t.closest('.row-wrap');
  if (row && t.closest('[data-star]')) {
    const m = rows.find((r) => r.id === row.dataset.id);
    if (m) actions.setStar([m.id], !m.labelIds.includes('STARRED'));
    return;
  }
  if (row) {
    if (input.value.trim()) store.addRecent(input.value);
    emit('open-message', { id: row.dataset.id, from: 'search' });
    return;
  }
  const chipEl = t.closest('[data-chip]');
  if (chipEl) {
    const id = chipEl.dataset.chip;
    if (id === 'all') filters = { from: '', date: '', attachment: false, unread: false };
    if (id === 'attachment') filters.attachment = !filters.attachment;
    if (id === 'unread') filters.unread = !filters.unread;
    if (id === 'from') {
      if (filters.from) filters.from = '';
      else {
        const v = await promptSheet({ title: 'From', placeholder: 'Name or email address', submit: 'Apply' });
        if (!v) return;
        filters.from = v;
      }
    }
    if (id === 'date') {
      if (filters.date) filters.date = '';
      else {
        await new Promise((resolve) => sheet({
          title: 'Date',
          items: Object.entries(DATES).map(([k, label]) => ({ label, checked: filters.date === k, run: () => { filters.date = k; resolve(); } })),
        }));
      }
    }
    run();
    return;
  }
  const recent = t.closest('[data-recent]');
  if (recent) { input.value = recent.dataset.recent; $('[data-s="clear"]', pane).hidden = false; store.addRecent(input.value); run(); return; }
  const rm = t.closest('[data-remove-recent]');
  if (rm) { store.removeRecent(rm.dataset.removeRecent); renderIdle(); return; }
  const s = t.closest('[data-s], [data-action]');
  if (!s) return;
  switch (s.dataset.s || s.dataset.action) {
    case 'clear': input.value = ''; s.hidden = true; input.focus(); run(); break;
    case 'clear-recents': store.clearRecents(); renderIdle(); break;
    case 'cancel':
      input.value = '';
      $('[data-s="clear"]', pane).hidden = true;
      filters = { from: '', date: '', attachment: false, unread: false };
      rows = [];
      renderChips();
      renderIdle();
      emit('leave-search');
      break;
    case 'retry': run(); break;
  }
}

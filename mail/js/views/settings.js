// Settings. Every row does something real; unsupported items are marked unavailable
// or link to the place (Google Account) where that setting actually lives.
import * as gmail from '../gmail.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { state, emit } from '../state.js';
import { $, avatar, settingsSection, settingsRow, confirmDialog, toast } from '../ui.js';
import { escapeHtml as e } from '../format.js';
import { notificationStatus, enableNotifications } from '../notify.js';

let pane, scroller;
const stack = [];

const THEMES = { system: 'System', light: 'Light', dark: 'Dark' };
const HELP_URL = 'https://github.com/gardarfreyr/larplarp/blob/main/mail/README.md';

export function mountSettings(root) {
  pane = root;
  pane.innerHTML = `<div class="pane-scroll"><div class="settings-scroll" id="stScroll"></div></div>`;
  scroller = $('#stScroll', pane);
  pane.addEventListener('click', onClick);
  pane.addEventListener('change', onChange);
}

export function showSettings() {
  stack.length = 0;
  render();
}

function header(title) {
  if (!stack.length) return `<header class="pane-header"><h1 class="pane-title">Settings</h1></header>`;
  return `<div class="settings-sub-head"><button type="button" class="icon-btn" data-nav="back" aria-label="Back">${icon('chevronLeft')}</button><h1>${e(title)}</h1></div>`;
}

function render() {
  const page = stack[stack.length - 1] || 'root';
  const pages = { root, account, notifications, inbox, appearance, privacy };
  const { title, body } = pages[page]();
  scroller.innerHTML = `<div class="settings-page">${header(title)}${body}</div>`;
  scroller.closest('.pane-scroll').scrollTop = 0;
}

function root() {
  const p = store.prefs();
  const others = store.accountEmails().filter((x) => x !== state.email);
  return {
    title: 'Settings',
    body: `
      <section class="settings-section">
        <div class="settings-group">
          <button type="button" class="settings-row account-row" data-nav="account">
            ${avatar(state.email || '?', 'avatar-lg')}
            <span class="settings-label"><strong>${e((state.email || '').split('@')[0])}</strong><small>${e(state.email || '')}</small></span>
            ${icon('chevronRight', 'chev')}
          </button>
          ${others.map((x) => `<button type="button" class="settings-row" data-switch="${e(x)}">${avatar(x)}<span class="settings-label">${e(x)}<small>Switch to this account</small></span>${icon('chevronRight', 'chev')}</button>`).join('')}
        </div>
        <button type="button" class="settings-row add-account" data-act="add-account"><span class="plus">${icon('plus')}</span><span class="settings-label">Add another account</span>${icon('chevronRight', 'chev')}</button>
      </section>
      ${settingsSection('General', [
        settingsRow({ id: 'notifications', iconName: 'bell', label: 'Notifications', value: p.notify && notificationStatus() === 'granted' ? 'On' : 'Off' }),
        settingsRow({ id: 'inbox', iconName: 'mail', label: 'Inbox preferences' }),
        settingsRow({ id: 'appearance', iconName: 'palette', label: 'Appearance', value: THEMES[p.theme] }),
        settingsRow({ iconName: 'globe', label: 'Language', sub: 'Other languages aren’t available yet', value: 'English', unavailable: true }),
      ])}
      ${settingsSection('Account', [
        settingsRow({ id: 'account', iconName: 'user', label: 'Account details' }),
        settingsRow({ id: 'privacy', iconName: 'shield', label: 'Privacy & security' }),
        settingsRow({ kind: 'link', iconName: 'laptop', label: 'Devices', sub: 'Managed in your Google Account', href: 'https://myaccount.google.com/device-activity' }),
      ])}
      ${settingsSection('Support', [
        settingsRow({ kind: 'link', iconName: 'help', label: 'Help & support', href: HELP_URL }),
        settingsRow({ kind: 'link', iconName: 'fileText', label: 'Terms & privacy', href: 'privacy.html' }),
      ])}
      <section class="settings-section"><div class="settings-group">
        <button type="button" class="settings-row" data-act="sign-out">${icon('logout')}<span class="settings-label">Sign out</span>${icon('chevronRight', 'chev')}</button>
      </div></section>`,
  };
}

function account() {
  setTimeout(loadProfileStats, 0);
  return {
    title: 'Account details',
    body: `
      ${settingsSection('', [
        settingsRow({ kind: 'static', iconName: 'user', label: 'Email address', value: state.email }),
        `<div class="settings-row" id="stStats">${icon('mail')}<span class="settings-label">Mailbox</span><span class="settings-value">Loading…</span></div>`,
      ])}
      ${settingsSection('Google sign-in', [
        `<div class="settings-field"><label for="stClientId" class="muted">OAuth Client ID used by this app</label>
          <input id="stClientId" type="text" spellcheck="false" autocomplete="off" value="${e(store.getClientId())}">
          <button type="button" class="btn btn-outline" data-act="save-client">Save Client ID</button></div>`,
      ])}
      <section class="settings-section"><div class="settings-group">
        <button type="button" class="settings-row" data-act="remove-account">${icon('logout')}<span class="settings-label">Remove this account from this device</span></button>
      </div></section>`,
  };
}

async function loadProfileStats() {
  try {
    const p = await gmail.profile();
    const el = $('#stStats .settings-value', pane);
    if (el) el.textContent = `${Number(p.messagesTotal).toLocaleString()} emails · ${Number(p.threadsTotal).toLocaleString()} conversations`;
  } catch {
    const el = $('#stStats .settings-value', pane);
    if (el) el.textContent = 'Unavailable offline';
  }
}

function notifications() {
  const status = notificationStatus();
  const on = store.prefs().notify && status === 'granted';
  const note = status === 'unsupported'
    ? 'This browser doesn’t support notifications.'
    : status === 'denied'
      ? 'Notifications are blocked for this site. Allow them in your browser or system settings, then try again.'
      : 'You’ll be notified about new email in your Inbox while Mail is open, including in a background tab. Mail is a web app, so it can’t notify you after it’s closed. Tapping a notification opens the email.';
  const log = store.notifications(state.email);
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const group = (title, items) => items.length ? `<h3 class="notif-group">${title}</h3><ul>${items.map((n) => `
      <li><button type="button" class="notif-row" data-open="${e(n.id)}">
        <span class="notif-icon">${icon('mail')}</span>
        <span class="notif-text"><span class="notif-top"><strong>${e(n.from)}</strong><time>${e(ago(n.at))}</time></span>
          <span class="notif-subject">${e(n.subject)}</span><span class="notif-snippet">${e(n.snippet)}</span></span>
        ${icon('chevronRight', 'chev')}</button></li>`).join('')}</ul>` : '';
  return {
    title: 'Notifications',
    body: `${settingsSection('', [
      settingsRow({ kind: 'toggle', id: 'notify', iconName: 'bell', label: 'New email notifications', checked: on }),
    ])}<p class="settings-note">${e(note)}</p>
    <section class="settings-section notif-list">
      <div class="notif-head"><h2>Recent notifications</h2>${log.length ? '<button type="button" class="btn btn-quiet" data-act="clear-notifs">Clear all</button>' : ''}</div>
      ${log.length ? group('Today', log.filter((n) => n.at >= startOfDay)) + group('Earlier', log.filter((n) => n.at < startOfDay))
        : '<p class="settings-note" style="margin:0">Notifications you receive will appear here.</p>'}
    </section>`,
  };
}

function inbox() {
  const p = store.prefs();
  return {
    title: 'Inbox preferences',
    body: settingsSection('', [
      settingsRow({ kind: 'toggle', id: 'previews', iconName: 'fileText', label: 'Show message previews', checked: p.previews }),
      settingsRow({ kind: 'toggle', id: 'avatars', iconName: 'user', label: 'Show sender avatars', checked: p.avatars }),
    ]),
  };
}

function appearance() {
  const current = store.prefs().theme;
  return {
    title: 'Appearance',
    body: `${settingsSection('Theme', Object.entries(THEMES).map(([k, label]) =>
      `<button type="button" class="settings-row" data-theme-choice="${k}" role="radio" aria-checked="${current === k}"><span class="settings-label">${label}${k === 'system' ? '<small>Match your device</small>' : ''}</span>${current === k ? icon('check') : ''}</button>`))}`,
  };
}

function privacy() {
  return {
    title: 'Privacy & security',
    body: `
      <p class="settings-note">Mail runs entirely in your browser. Your email goes directly between this device and Google; there is no Mail server. Google sign-in lasts about an hour and is stored only on this device.</p>
      ${settingsSection('', [
        settingsRow({ kind: 'link', iconName: 'shield', label: 'Apps with access to your account', sub: 'Google Account', href: 'https://myaccount.google.com/connections' }),
        settingsRow({ kind: 'link', iconName: 'fileText', label: 'Privacy notice', href: 'privacy.html' }),
      ])}
      <section class="settings-section"><div class="settings-group">
        <button type="button" class="settings-row" data-act="clear-data">${icon('trash')}<span class="settings-label">Clear saved data on this device<small>Saved emails, recent searches and offline drafts</small></span></button>
        <button type="button" class="settings-row" data-act="revoke">${icon('logout')}<span class="settings-label" style="color:var(--danger)">Revoke access and sign out</span></button>
      </div></section>`,
  };
}

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

// ---------------------------------------------------------------- input

async function onClick(ev) {
  const nav = ev.target.closest('[data-nav]');
  if (nav) {
    if (nav.dataset.nav === 'back') stack.pop(); else stack.push(nav.dataset.nav);
    render();
    return;
  }
  const openBtn = ev.target.closest('[data-open]');
  if (openBtn) { emit('open-message', { id: openBtn.dataset.open, from: 'mail' }); return; }
  const sw = ev.target.closest('[data-switch]');
  if (sw) { emit('switch-account', sw.dataset.switch); return; }
  const theme = ev.target.closest('[data-theme-choice]');
  if (theme) { store.setPref('theme', theme.dataset.themeChoice); emit('prefs-changed'); render(); return; }
  const act = ev.target.closest('[data-act]');
  if (!act) return;
  switch (act.dataset.act) {
    case 'add-account': emit('add-account'); break;
    case 'sign-out': emit('sign-out', { revoke: false }); break;
    case 'clear-notifs': store.clearNotifications(state.email); render(); break;
    case 'save-client': {
      const v = $('#stClientId', pane).value.trim();
      if (!v) { toast('Enter a Client ID'); break; }
      store.setClientId(v);
      toast('Client ID saved');
      break;
    }
    case 'remove-account': {
      const ok = await confirmDialog({ title: 'Remove this account?', body: `${state.email} will be signed out on this device. Your email stays in Gmail.`, actions: [{ label: 'Remove', value: true, kind: 'danger' }, { label: 'Cancel', value: false }] });
      if (ok) emit('remove-account');
      break;
    }
    case 'clear-data': {
      const ok = await confirmDialog({ title: 'Clear saved data?', body: 'Emails saved for offline use, recent searches and unsent drafts on this device will be removed.', actions: [{ label: 'Clear', value: true, kind: 'danger' }, { label: 'Cancel', value: false }] });
      if (ok) { store.clearCache(); store.clearRecents(); store.setLocalDraft(null); store.clearNotifications(state.email); toast('Saved data cleared'); }
      break;
    }
    case 'revoke': {
      const ok = await confirmDialog({ title: 'Revoke access?', body: 'Mail will no longer be able to read or send your email until you sign in again.', actions: [{ label: 'Revoke', value: true, kind: 'danger' }, { label: 'Cancel', value: false }] });
      if (ok) emit('sign-out', { revoke: true });
      break;
    }
  }
}

async function onChange(ev) {
  const t = ev.target.closest('[data-toggle]');
  if (!t) return;
  const key = t.dataset.toggle;
  if (key === 'notify') {
    if (t.checked) {
      const ok = await enableNotifications();
      t.checked = ok;
      store.setPref('notify', ok);
      if (!ok) render();
    } else store.setPref('notify', false);
  } else {
    store.setPref(key, t.checked);
  }
  emit('prefs-changed');
}

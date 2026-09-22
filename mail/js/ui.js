// Shared UI primitives. Views compose these instead of writing their own markup.
import { icon } from './icons.js';
import { escapeHtml as e, initials, listDate, parseAddress, parseAddressList, displayName, fileSize, fileKind } from './format.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function html(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch {}
}

// ---------------------------------------------------------------- layers (Escape closes the top one)
const layers = [];
export function pushLayer(close) { layers.push(close); return () => { const i = layers.indexOf(close); if (i >= 0) layers.splice(i, 1); }; }
export function closeTopLayer() { const top = layers[layers.length - 1]; if (top) { top(); return true; } return false; }
export const hasLayers = () => layers.length > 0;

// ---------------------------------------------------------------- toast
export function toast(message, { action, duration } = {}) {
  let host = $('.toast-host');
  if (!host) { host = html('<div class="toast-host" role="status" aria-live="polite"></div>'); document.body.append(host); }
  host.replaceChildren();
  const t = html(`<div class="toast"><span>${e(message)}</span></div>`);
  let timer;
  const dismiss = () => { clearTimeout(timer); t.classList.add('is-leaving'); setTimeout(() => t.remove(), 200); };
  if (action) {
    const b = html(`<button type="button">${e(action.label)}</button>`);
    b.onclick = () => { dismiss(); action.run(); };
    t.append(b);
  }
  host.append(t);
  timer = setTimeout(dismiss, duration || (action ? 6000 : 2800));
  return dismiss;
}

// ---------------------------------------------------------------- dialog
/** actions: [{ label, value, kind: 'primary'|'danger'|'quiet' }] → resolves with the chosen value (or null). */
export function confirmDialog({ title, body = '', actions }) {
  return new Promise((resolve) => {
    const scrim = html(`<div class="scrim" role="presentation">
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-b">
        <h2 id="dlg-t">${e(title)}</h2>${body ? `<p id="dlg-b">${e(body)}</p>` : ''}
        <div class="dialog-actions"></div>
      </div></div>`);
    const done = (v) => { pop(); scrim.remove(); resolve(v); };
    const pop = pushLayer(() => done(null));
    actions.forEach((a) => {
      const b = html(`<button type="button" class="btn btn-block btn-${a.kind || 'quiet'}">${e(a.label)}</button>`);
      b.onclick = () => done(a.value);
      $('.dialog-actions', scrim).append(b);
    });
    scrim.addEventListener('click', (ev) => { if (ev.target === scrim) done(null); });
    document.body.append(scrim);
    $('.dialog-actions button', scrim).focus();
  });
}

// ---------------------------------------------------------------- action sheet
/** items: [{ label, icon, danger, checked, run } | '-' ] */
export function sheet({ title, items }) {
  const scrim = html(`<div class="scrim sheet-scrim" role="presentation"><div class="sheet" role="menu">${title ? `<div class="sheet-title">${e(title)}</div>` : ''}</div></div>`);
  const box = $('.sheet', scrim);
  const close = () => { pop(); scrim.remove(); };
  const pop = pushLayer(close);
  items.filter(Boolean).forEach((it) => {
    if (it === '-') { box.append(html('<div class="sheet-sep" role="separator"></div>')); return; }
    const b = html(`<button type="button" class="sheet-item${it.danger ? ' is-danger' : ''}" role="menuitem">
      ${it.icon ? icon(it.icon) : ''}<span>${e(it.label)}</span>${it.checked ? icon('check', 'check') : ''}</button>`);
    b.onclick = () => { close(); it.run(); };
    box.append(b);
  });
  scrim.addEventListener('click', (ev) => { if (ev.target === scrim) close(); });
  document.body.append(scrim);
  $('button', box)?.focus();
  return close;
}

/** A sheet with a single text field. Resolves with the text, or null if cancelled. */
export function promptSheet({ title, placeholder = '', value = '', submit = 'Apply', type = 'text' }) {
  return new Promise((resolve) => {
    const scrim = html(`<div class="scrim sheet-scrim" role="presentation"><form class="sheet" role="dialog" aria-label="${e(title)}">
      <div class="sheet-title">${e(title)}</div>
      <div class="sheet-field"><input type="${type}" placeholder="${e(placeholder)}" value="${e(value)}" autocomplete="off" spellcheck="false"><button class="btn btn-primary" type="submit">${e(submit)}</button></div>
    </form></div>`);
    const done = (v) => { pop(); scrim.remove(); resolve(v); };
    const pop = pushLayer(() => done(null));
    scrim.addEventListener('click', (ev) => { if (ev.target === scrim) done(null); });
    $('form', scrim).addEventListener('submit', (ev) => { ev.preventDefault(); done($('input', scrim).value.trim()); });
    document.body.append(scrim);
    $('input', scrim).focus();
  });
}

// ---------------------------------------------------------------- markup components
export function avatar(nameOrEmail, cls = '') {
  return `<span class="avatar ${cls}" aria-hidden="true"><span>${e(initials(nameOrEmail))}</span>${icon('check')}</span>`;
}

/** EmailRow. `who` decides whether the sender or the recipients are shown. */
export function emailRow(m, { who = 'from', current = false, selected = false } = {}) {
  let name;
  if (who === 'to') {
    const to = parseAddressList(m.to);
    name = (m.draftId ? 'Draft · ' : 'To: ') + (to.length ? to.map(displayName).join(', ') : '(no recipients)');
  } else {
    const f = parseAddress(m.from);
    name = displayName(f) || '(unknown sender)';
  }
  const unread = m.labelIds.includes('UNREAD');
  const starred = m.labelIds.includes('STARRED');
  const avatarName = who === 'to' ? (parseAddressList(m.to)[0] ? displayName(parseAddressList(m.to)[0]) : '?') : name;
  const label = `${unread ? 'Unread. ' : ''}${name}. ${m.subject || 'No subject'}. ${listDate(m.date)}`;
  return `<li class="row-wrap" data-id="${e(m.id)}">
    <div class="email-row${unread ? ' is-unread' : ''}${selected ? ' is-selected' : ''}" role="button" tabindex="0"
      aria-label="${e(label)}" ${current ? 'aria-current="true"' : ''} ${selected ? 'aria-pressed="true"' : ''}>
      ${unread ? '<span class="unread-dot" aria-hidden="true"></span>' : ''}
      ${avatar(avatarName)}
      <div class="row-main">
        <div class="row-top">
          <span class="row-from">${e(name)}</span>
          <span class="row-meta">${m.hasAttachment ? icon('clip') : ''}${starred ? icon('star', 'is-star') : ''}<time>${e(listDate(m.date))}</time></span>
        </div>
        <div class="row-subject">${e(m.subject || '(no subject)')}</div>
        <div class="row-preview">${e(m.snippet || '')}</div>
      </div>
    </div></li>`;
}

export function attachmentCard(att, index, { removable = false, pending = false, thumb = '' } = {}) {
  const kind = fileKind(att.mimeType || att.type, att.filename || att.name);
  const name = att.filename || att.name;
  const lead = thumb ? `<img class="thumb" src="${thumb}" alt="">` : icon(kind === 'image' ? 'image' : kind === 'pdf' ? 'fileText' : 'file', 'ic-type');
  const action = removable
    ? `<button type="button" class="icon-btn attach-remove" data-remove="${index}" aria-label="Remove ${e(name)}">${icon('x', 'ic-sm')}</button>`
    : `<span class="icon-btn" aria-hidden="true">${icon('download')}</span>`;
  return `<div class="attach-card${pending ? ' is-pending' : ''}" ${removable ? '' : `role="button" tabindex="0" data-attach="${index}"`}
      aria-label="${e(name)}, ${e(fileSize(att.size))}">
      ${lead}<div class="attach-info"><div class="attach-name">${e(name)}</div><div class="attach-size">${pending ? 'Loading…' : e(fileSize(att.size))}</div></div>${action}
    </div>`;
}

export function emptyState({ iconName = 'mail', title, text = '', action }) {
  return `<div class="empty">${icon(iconName)}<h2>${e(title)}</h2>${text ? `<p>${e(text)}</p>` : ''}
    ${action ? `<button type="button" class="btn btn-primary" data-action="${e(action.id)}">${action.icon ? icon(action.icon) : ''}${e(action.label)}</button>` : ''}</div>`;
}

export function banner({ text, iconName = 'alert', action, error = false }) {
  return `<div class="banner${error ? ' is-error' : ''}" role="${error ? 'alert' : 'status'}">${icon(iconName)}<span>${e(text)}</span>
    ${action ? `<button type="button" data-action="${e(action.id)}">${e(action.label)}</button>` : ''}</div>`;
}

export const loadingBlock = () => '<div class="loading-block" aria-label="Loading"><div class="spinner"></div></div>';

// ---------------------------------------------------------------- settings
export function settingsSection(title, rows) {
  return `<section class="settings-section">${title ? `<h2>${e(title)}</h2>` : ''}<div class="settings-group">${rows.join('')}</div></section>`;
}

/** kind: 'nav' (chevron) | 'toggle' | 'link' (external) | 'static' */
export function settingsRow({ id, iconName, label, sub, value, kind = 'nav', checked, href, unavailable }) {
  const lead = iconName ? icon(iconName) : '';
  const text = `<span class="settings-label">${e(label)}${sub ? `<small>${e(sub)}</small>` : ''}</span>`;
  const val = value ? `<span class="settings-value">${e(value)}</span>` : '';
  if (kind === 'toggle') {
    return `<label class="settings-row">${lead}${text}<span class="switch"><input type="checkbox" role="switch" data-toggle="${e(id)}" ${checked ? 'checked' : ''}><span></span></span></label>`;
  }
  if (kind === 'link') {
    return `<a class="settings-row" href="${e(href)}" target="_blank" rel="noopener">${lead}${text}${val}${icon('external', 'chev')}</a>`;
  }
  if (kind === 'static' || unavailable) {
    return `<div class="settings-row${unavailable ? ' is-unavailable' : ''}">${lead}${text}${val}</div>`;
  }
  return `<button type="button" class="settings-row" data-nav="${e(id)}">${lead}${text}${val}${icon('chevronRight', 'chev')}</button>`;
}

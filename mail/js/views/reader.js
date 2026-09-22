// Reading screen: one message, its attachments and Reply / Reply All / Forward.
import * as gmail from '../gmail.js';
import * as actions from '../actions.js';
import { icon, logo } from '../icons.js';
import { state, on, emit, FOLDERS } from '../state.js';
import { $, avatar, attachmentCard, emptyState, loadingBlock, sheet, toast } from '../ui.js';
import { escapeHtml as e, linkify, parseAddress, parseAddressList, displayName, fullDate, listDate } from '../format.js';
import { openAttachment, downloadAttachment, shareAttachment, canShare } from './preview.js';

let pane, scroller, current = null, from = 'mail', seq = 0;

export function mountReader(root) {
  pane = root;
  pane.innerHTML = `
    <div class="reader-toolbar">
      <button type="button" class="back-btn" data-action="back">${icon('chevronLeft')}<span id="rdBack">Inbox</span></button>
      <span class="spacer"></span>
      <button type="button" class="icon-btn" data-action="delete" id="rdDelete" aria-label="Delete">${icon('trash')}</button>
      <button type="button" class="icon-btn" data-action="toggle-read" id="rdRead" aria-label="Mark as unread">${icon('mail')}</button>
      <button type="button" class="icon-btn" data-action="more" aria-label="More actions">${icon('more')}</button>
    </div>
    <div class="pane-scroll reader-scroll" id="rdScroll"></div>`;
  scroller = $('#rdScroll', pane);
  showEmpty();
  pane.addEventListener('click', onClick);
  pane.addEventListener('keydown', (ev) => {
    const card = ev.target.closest('[data-attach]');
    if (card && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); card.click(); }
  });
  on('labels-changed', ({ ids, add, remove }) => {
    if (!current || !ids.includes(current.id)) return;
    current.labelIds = current.labelIds.filter((l) => !remove.includes(l)).concat(add.filter((l) => !current.labelIds.includes(l)));
    syncToolbar();
  });
  on('trashed', ({ ids }) => { if (current && ids.includes(current.id)) close(); });
}

function showEmpty() {
  pane.classList.add('is-empty');
  scroller.innerHTML = `<div class="reader-empty"><div>${logo()}<p>Select an email to read</p></div></div>`;
}

export function isOpen() { return !!state.openId; }

export async function open(id, origin = 'mail') {
  from = origin;
  state.openId = id;
  const my = ++seq;
  const app = document.getElementById('app');
  $('#rdBack', pane).textContent = origin === 'search' ? 'Search' : FOLDERS[state.folder].title;
  pane.classList.remove('is-empty');
  if (app.dataset.reading !== 'true') {
    app.dataset.reading = 'true';
    if (matchMedia('(max-width: 800px)').matches) history.pushState({ reader: id }, '', '#/m/' + encodeURIComponent(id));
  }
  const cached = gmail.cachedFull(id);
  if (cached) render(cached);
  else { current = null; scroller.innerHTML = loadingBlock(); }
  try {
    const m = await gmail.getFull(id);
    if (my !== seq) return;
    if (m !== cached) render(m);
    if (m.labelIds.includes('UNREAD')) actions.setRead([id], true);
  } catch (err) {
    if (my !== seq || cached) return;
    if (err instanceof gmail.NetworkError) {
      scroller.innerHTML = emptyState({ iconName: 'wifiOff', title: 'No connection', text: 'This email hasn’t been downloaded yet. Try again when you’re back online.', action: { id: 'retry', label: 'Try again', icon: 'refresh' } });
    } else if (!(err instanceof gmail.AuthError)) {
      scroller.innerHTML = emptyState({ iconName: 'alert', title: 'Couldn’t open this email', text: err.message, action: { id: 'retry', label: 'Try again' } });
    }
  }
}

export function close({ fromHistory = false } = {}) {
  const app = document.getElementById('app');
  const wasOpen = app.dataset.reading === 'true';
  app.dataset.reading = 'false';
  state.openId = null;
  current = null;
  seq++;
  emit('open-message-closed');
  setTimeout(() => { if (!state.openId) showEmpty(); }, matchMedia('(max-width: 800px)').matches ? 280 : 0);
  if (wasOpen && !fromHistory && history.state?.reader) history.back();
}

function syncToolbar() {
  if (!current) return;
  const unread = current.labelIds.includes('UNREAD');
  const inTrash = current.labelIds.includes('TRASH');
  const readBtn = $('#rdRead', pane);
  readBtn.innerHTML = icon(unread ? 'mailOpen' : 'mail');
  readBtn.setAttribute('aria-label', unread ? 'Mark as read' : 'Mark as unread');
  const del = $('#rdDelete', pane);
  del.innerHTML = icon(inTrash ? 'undo' : 'trash');
  del.setAttribute('aria-label', inTrash ? 'Restore' : 'Delete');
  const star = $('#rdStar', pane);
  if (star) {
    const on = current.labelIds.includes('STARRED');
    star.classList.toggle('is-on', on);
    star.setAttribute('aria-pressed', String(on));
    star.setAttribute('aria-label', on ? 'Remove star' : 'Star');
  }
}

function render(m) {
  current = m;
  const f = parseAddress(m.from);
  const me = (state.email || '').toLowerCase();
  const to = parseAddressList(m.to);
  const toMe = to.some((a) => a.email.toLowerCase() === me);
  const others = to.filter((a) => a.email.toLowerCase() !== me).map(displayName);
  const toText = toMe ? (others.length ? `to me and ${others.length} other${others.length > 1 ? 's' : ''}` : 'to me') : `to ${others.join(', ') || 'undisclosed recipients'}`;
  const details = [['From', m.from], ['To', m.to], ['Cc', m.cc], ['Date', fullDate(m.date)], ['Subject', m.subject]].filter((r) => r[1]);

  scroller.innerHTML = `<article class="message" aria-labelledby="rdSubject">
    <div class="msg-title-row">
      <h1 class="msg-subject" id="rdSubject">${e(m.subject || '(no subject)')}</h1>
      <button type="button" class="icon-btn" id="rdStar" data-action="star">${icon('star')}</button>
    </div>
    <div class="msg-head">
      ${avatar(displayName(f), 'avatar-lg')}
      <div class="msg-who">
        <div class="msg-from" title="${e(f.email)}">${e(displayName(f) || '(unknown sender)')}</div>
        <button type="button" class="msg-to" data-action="details" aria-expanded="false" aria-controls="rdDetails">${e(toText)}${icon('chevronDown')}</button>
      </div>
      <time class="msg-time" datetime="${new Date(m.date).toISOString()}" title="${e(fullDate(m.date))}">${e(listDate(m.date))}</time>
    </div>
    <dl class="msg-details" id="rdDetails" hidden>${details.map(([k, v]) => `<dt>${k}</dt><dd>${e(v)}</dd>`).join('')}</dl>
    <div class="msg-body" id="rdBody"></div>
    ${m.attachments.length ? `<section class="msg-attach" aria-label="Attachments">
      <div class="msg-attach-head"><span>${m.attachments.length} attachment${m.attachments.length > 1 ? 's' : ''}</span>
      ${m.attachments.length > 1 ? `<button type="button" class="link-btn dl-all" data-action="download-all">${icon('download')}<span>Download all</span></button>` : ''}</div>
      <div class="attachments">${m.attachments.map((a, i) => attachmentCard(a, i)).join('')}</div></section>` : ''}
    <div class="msg-actions">
      <button type="button" class="tile-btn" data-action="reply">${icon('reply')}<span>Reply</span></button>
      <button type="button" class="tile-btn" data-action="reply-all">${icon('replyAll')}<span>Reply All</span></button>
      <button type="button" class="tile-btn" data-action="forward">${icon('forward')}<span>Forward</span></button>
    </div>
  </article>`;
  renderBody(m, $('#rdBody', scroller));
  syncToolbar();
  scroller.scrollTop = 0;
}

function renderBody(m, target) {
  if (!m.html) {
    target.innerHTML = `<div class="msg-body-text">${linkify(e(m.text || m.snippet || ''))}</div>`;
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'msg-frame-wrap';
  const frame = document.createElement('iframe');
  frame.className = 'msg-frame';
  frame.title = 'Email content';
  // No allow-scripts: nothing inside an email can run code.
  frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
    <meta name="color-scheme" content="light">
    <style>html,body{margin:0;padding:0;background:#fff}body{display:flow-root;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;overflow-wrap:anywhere}
    img{max-width:100%!important;height:auto!important}table{max-width:100%!important}pre{white-space:pre-wrap}a{color:#111}</style>
    </head><body>${m.html}</body></html>`;
  const fit = () => {
    try { frame.style.height = Math.ceil(frame.contentDocument.body.getBoundingClientRect().height) + 'px'; } catch {}
  };
  frame.addEventListener('load', () => {
    fit();
    try {
      new ResizeObserver(fit).observe(frame.contentDocument.body);
      frame.contentDocument.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit));
    } catch {}
  });
  wrap.append(frame);
  target.append(wrap);
}

function onClick(ev) {
  const menuBtn = ev.target.closest('[data-attach-menu]');
  if (menuBtn && current) { attachmentMenu(current, current.attachments[Number(menuBtn.dataset.attachMenu)]); return; }
  const card = ev.target.closest('[data-attach]');
  if (card && current) { openAttachment(current, current.attachments[Number(card.dataset.attach)]); return; }
  const a = ev.target.closest('[data-action]');
  if (!a) return;
  const m = current;
  switch (a.dataset.action) {
    case 'back': close(); break;
    case 'retry': if (state.openId) open(state.openId, from); break;
    case 'details': {
      const d = $('#rdDetails', pane);
      d.hidden = !d.hidden;
      a.setAttribute('aria-expanded', String(!d.hidden));
      break;
    }
    case 'star': if (m) actions.setStar([m.id], !m.labelIds.includes('STARRED')); break;
    case 'toggle-read':
      if (!m) break;
      if (m.labelIds.includes('UNREAD')) actions.setRead([m.id], true);
      else { actions.setRead([m.id], false); close(); toast('Marked as unread'); }
      break;
    case 'delete':
      if (!m) break;
      (m.labelIds.includes('TRASH') ? actions.restore : actions.trash)([m.id]);
      break;
    case 'more': if (m) moreMenu(m); break;
    case 'reply': if (m) emit('compose', { mode: 'reply', message: m }); break;
    case 'reply-all': if (m) emit('compose', { mode: 'replyAll', message: m }); break;
    case 'forward': if (m) emit('compose', { mode: 'forward', message: m }); break;
    case 'download-all': if (m) downloadAll(m); break;
  }
}

function attachmentMenu(m, att) {
  sheet({
    title: att.filename,
    items: [
      { label: 'Preview', icon: 'search', run: () => openAttachment(m, att) },
      { label: 'Download', icon: 'download', run: () => downloadAttachment(m, att) },
      canShare() ? { label: 'Share', icon: 'share', run: () => shareAttachment(m, att) } : null,
    ],
  });
}

async function downloadAll(m) {
  for (const att of m.attachments) {
    await downloadAttachment(m, att);
    await new Promise((r) => setTimeout(r, 350)); // browsers throttle rapid downloads
  }
}

function moreMenu(m) {
  const inInbox = m.labelIds.includes('INBOX');
  const starred = m.labelIds.includes('STARRED');
  sheet({
    items: [
      { label: 'Reply', icon: 'reply', run: () => emit('compose', { mode: 'reply', message: m }) },
      { label: 'Reply All', icon: 'replyAll', run: () => emit('compose', { mode: 'replyAll', message: m }) },
      { label: 'Forward', icon: 'forward', run: () => emit('compose', { mode: 'forward', message: m }) },
      '-',
      inInbox
        ? { label: 'Archive', icon: 'archive', run: () => { actions.archive([m.id]); close(); } }
        : (!m.labelIds.includes('TRASH') && !m.labelIds.includes('SENT') ? { label: 'Move to Inbox', icon: 'inbox', run: () => actions.moveToInbox([m.id]) } : null),
      { label: starred ? 'Remove star' : 'Star', icon: 'star', run: () => actions.setStar([m.id], !starred) },
      { label: 'Print', icon: 'printer', run: printMessage },
    ],
  });
}

// Print CSS (layout.css) hides everything except the open message.
function printMessage() { window.print(); }

// Full-screen composer (a modal on desktop): new messages, replies, forwards and drafts.
// Drafts autosave to Gmail and are also kept on this device, so nothing is lost offline.
import * as gmail from '../gmail.js';
import * as outbox from '../outbox.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { state, emit } from '../state.js';
import { $, html, pushLayer, toast, confirmDialog, sheet, promptSheet, banner, attachmentCard } from '../ui.js';
import { escapeHtml as e, parseAddressList, fullDate, isValidEmail } from '../format.js';
import { buildMime, sanitizeHtml, htmlToText, plainTextOf } from '../mime.js';
import { recipientField } from './recipients.js';

const MAX_TOTAL = 25 * 1024 * 1024;
const AUTOSAVE_MS = 2000;

let c = null; // the open composer

const lower = (s) => String(s || '').toLowerCase();
const dedupe = (list, exclude = []) => {
  const seen = new Set(exclude.map(lower));
  return list.filter((a) => { const k = lower(a.email); if (seen.has(k)) return false; seen.add(k); return true; });
};

// ---------------------------------------------------------------- building the initial content

function quoteFor(mode, m) {
  if (!m || mode === 'new' || mode === 'draft' || mode === 'restore') return null;
  const originalHtml = m.html || e(plainTextOf(m)).replace(/\n/g, '<br>');
  const text = plainTextOf(m);
  if (mode === 'forward') {
    const head = `---------- Forwarded message ---------\nFrom: ${m.from}\nDate: ${fullDate(m.date)}\nSubject: ${m.subject}\nTo: ${m.to}${m.cc ? `\nCc: ${m.cc}` : ''}`;
    return {
      label: 'Forwarded message',
      text: `${head}\n\n${text}`,
      html: `<br><div class="gmail_quote">${e(head).replace(/\n/g, '<br>')}<br><br>${originalHtml}</div>`,
      plain: `\n\n${head}\n\n${text}`,
    };
  }
  const d = new Date(m.date);
  const sender = parseAddressList(m.from)[0];
  const intro = `On ${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}, at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, ${sender ? (sender.name || sender.email) : m.from} wrote:`;
  return {
    label: intro,
    text,
    html: `<br><div class="gmail_quote"><div>${e(intro)}</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${originalHtml}</blockquote></div>`,
    plain: `\n\n${intro}\n${text.split('\n').map((l) => '> ' + l).join('\n')}`,
  };
}

function initialFields(mode, m) {
  const me = lower(state.email);
  if (mode === 'reply' || mode === 'replyAll') {
    const fromMe = parseAddressList(m.from).some((a) => lower(a.email) === me);
    const base = fromMe ? parseAddressList(m.to) : parseAddressList(m.replyTo || m.from);
    let to = base, cc = [];
    if (mode === 'replyAll') {
      to = dedupe(base.concat(fromMe ? [] : parseAddressList(m.to)), [state.email]);
      cc = dedupe(parseAddressList(m.cc), [state.email, ...to.map((a) => a.email)]);
    }
    const subject = /^re:/i.test(m.subject || '') ? m.subject : `Re: ${m.subject || ''}`;
    return {
      to, cc, bcc: [], subject, threadId: m.threadId, inReplyTo: m.messageId,
      references: [m.references, m.messageId].filter(Boolean).join(' '),
      title: mode === 'reply' ? 'Reply' : 'Reply All',
    };
  }
  if (mode === 'forward') {
    return { to: [], cc: [], bcc: [], subject: /^fwd?:/i.test(m.subject || '') ? m.subject : `Fwd: ${m.subject || ''}`, title: 'Forward' };
  }
  return { to: [], cc: [], bcc: [], subject: '', title: 'Compose' };
}

// ---------------------------------------------------------------- open / render

export function isComposing() { return !!c; }

/**
 * @param {{mode?: 'new'|'reply'|'replyAll'|'forward'|'draft'|'restore', message?, draftId?, to?: string}} opts
 */
export async function openComposer(opts = {}) {
  if (c) { c.el.querySelector('.editor').focus(); return; }
  const mode = opts.mode || 'new';
  const m = opts.message || null;
  const f = initialFields(mode, m);
  c = {
    mode, draftId: opts.draftId || null, threadId: f.threadId || null,
    inReplyTo: f.inReplyTo || '', references: f.references || '',
    quote: quoteFor(mode, m), attachments: [], dirty: false, saving: null, saveTimer: null,
    sending: false, initial: '',
  };
  render(f.title);
  c.fields.to.set(opts.to ? parseAddressList(opts.to) : f.to);
  c.fields.cc.set(f.cc);
  c.fields.bcc.set(f.bcc);
  if (f.cc.length) showCcBcc(true);
  $('#cSubject', c.el).value = f.subject;

  if (mode === 'forward' && m?.attachments?.length) m.attachments.forEach((a) => addRemoteAttachment(m.id, a));
  if (mode === 'draft') await loadDraft(opts.draftId, opts.messageId);
  if (mode === 'restore') restoreLocal(opts.local);

  // A restored message is unsent work by definition, so closing it always asks.
  c.initial = mode === 'restore' ? '' : snapshot();
  update();
  (c.fields.to.values().length ? $('.editor', c.el) : c.fields.to.input).focus();
}

function render(title) {
  const scrim = html(`<div class="scrim composer-scrim" role="presentation">
    <form class="composer" role="dialog" aria-modal="true" aria-labelledby="cTitle" novalidate>
      <div class="composer-bar">
        <button type="button" class="icon-btn" data-c="close" aria-label="Close">${icon('x')}</button>
        <h1 id="cTitle">${e(title)}</h1>
        <button type="submit" class="icon-btn send-btn" id="cSend" aria-label="Send" disabled>${icon('send')}</button>
      </div>
      <div id="cBanner"></div>
      <div class="composer-scroll">
        <div class="c-field"><span class="c-label" id="lblTo">To</span><div id="cTo" style="flex:1;min-width:0"></div></div>
        <div class="c-field" id="cCcToggleRow"><button type="button" class="c-label" data-c="ccbcc" style="flex:1;text-align:left;width:auto">Cc/Bcc</button>
          <button type="button" class="icon-btn" data-c="ccbcc" aria-label="Add Cc or Bcc">${icon('plus')}</button></div>
        <div class="c-field" id="cCcRow" hidden><span class="c-label">Cc</span><div id="cCc" style="flex:1;min-width:0"></div></div>
        <div class="c-field" id="cBccRow" hidden><span class="c-label">Bcc</span><div id="cBcc" style="flex:1;min-width:0"></div></div>
        <div class="c-field"><label for="cSubject" class="c-label">Subject</label><input id="cSubject" type="text" autocomplete="off"></div>
        <div class="editor" id="cEditor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message" data-placeholder="Write your email…"></div>
        <div id="cQuote"></div>
        <div class="c-attachments"><div class="attachments" id="cAttachments"></div></div>
      </div>
      <div class="draft-pill" id="cStatus" aria-live="polite" hidden></div>
      <div class="format-bar" id="cFormat" hidden role="toolbar" aria-label="Formatting">
        <button type="button" class="icon-btn" data-fmt="bold" aria-label="Bold">${icon('bold')}</button>
        <button type="button" class="icon-btn" data-fmt="italic" aria-label="Italic">${icon('italic')}</button>
        <button type="button" class="icon-btn" data-fmt="underline" aria-label="Underline">${icon('underline')}</button>
        <button type="button" class="icon-btn" data-fmt="insertUnorderedList" aria-label="Bulleted list">${icon('list')}</button>
      </div>
      <div class="composer-tools" role="toolbar" aria-label="Composer tools">
        <button type="button" class="icon-btn" data-c="format" aria-label="Formatting" aria-pressed="false"><span class="aa" aria-hidden="true">Aa</span></button>
        <button type="button" class="icon-btn" data-c="attach" aria-label="Attach files">${icon('clip')}</button>
        <button type="button" class="icon-btn" data-c="image" aria-label="Attach images">${icon('image')}</button>
        <button type="button" class="icon-btn" data-c="link" aria-label="Insert link">${icon('link')}</button>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-c="more" aria-label="More options">${icon('more')}</button>
      </div>
      <input type="file" id="cFile" multiple hidden>
      <input type="file" id="cImage" multiple accept="image/*" hidden>
    </form></div>`);
  document.body.append(scrim);
  c.el = scrim;
  c.popLayer = pushLayer(requestClose);
  const changed = () => { update(); scheduleSave(); };
  c.fields = {
    to: recipientField($('#cTo', scrim), { label: 'To', onChange: changed }),
    cc: recipientField($('#cCc', scrim), { label: 'Cc', onChange: changed }),
    bcc: recipientField($('#cBcc', scrim), { label: 'Bcc', onChange: changed }),
  };
  c.fields.to.input.setAttribute('aria-labelledby', 'lblTo');
  if (c.quote) {
    $('#cQuote', scrim).innerHTML = `<div class="c-quote-head">${e(c.quote.label)}</div><div class="c-quote">${e(c.quote.text)}</div>`;
  }
  $('#cSubject', scrim).addEventListener('input', changed);
  const editor = $('#cEditor', scrim);
  editor.addEventListener('input', () => { if (editor.innerHTML === '<br>') editor.innerHTML = ''; changed(); });
  editor.addEventListener('paste', (ev) => {
    // Paste as clean formatting only.
    const htmlData = ev.clipboardData?.getData('text/html');
    const text = ev.clipboardData?.getData('text/plain');
    ev.preventDefault();
    if (htmlData) document.execCommand('insertHTML', false, sanitizeHtml(htmlData));
    else if (text) document.execCommand('insertText', false, text);
  });
  scrim.addEventListener('click', onClick);
  scrim.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); send(); }
  });
  $('form', scrim).addEventListener('submit', (ev) => { ev.preventDefault(); send(); });
  $('#cFile', scrim).addEventListener('change', (ev) => { addFiles(ev.target.files); ev.target.value = ''; });
  $('#cImage', scrim).addEventListener('change', (ev) => { addFiles(ev.target.files); ev.target.value = ''; });
  $('#cAttachments', scrim).addEventListener('click', (ev) => {
    const rm = ev.target.closest('[data-remove]');
    if (rm) { c.attachments.splice(Number(rm.dataset.remove), 1); renderAttachments(); changed(); }
  });
}

function showCcBcc(show) {
  $('#cCcRow', c.el).hidden = !show;
  $('#cBccRow', c.el).hidden = !show;
  $('#cCcToggleRow', c.el).hidden = show;
}

// ---------------------------------------------------------------- state

function editorHtml() {
  const ed = $('#cEditor', c.el);
  return ed.textContent.trim() || ed.querySelector('li') ? ed.innerHTML : '';
}

function snapshot() {
  return JSON.stringify([c.fields.to.text(), c.fields.cc.text(), c.fields.bcc.text(), $('#cSubject', c.el).value, editorHtml(), c.attachments.length]);
}

function hasContent() {
  return !!(c.fields.to.values().length || c.fields.cc.values().length || c.fields.bcc.values().length ||
    $('#cSubject', c.el).value.trim() || editorHtml() || c.attachments.length);
}

function canSend() {
  const all = [...c.fields.to.values(), ...c.fields.cc.values(), ...c.fields.bcc.values()];
  return all.length > 0 && all.every((a) => isValidEmail(a.email)) && !c.attachments.some((a) => a.pending) && !c.sending;
}

function update() {
  if (!c) return;
  $('#cSend', c.el).disabled = !canSend();
}

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m === 1) return '1 minute ago';
  if (m < 60) return `${m} minutes ago`;
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Status pill above the toolbar. `saved` shows a check and a live "saved … ago". */
function setStatus(text, { saved = false } = {}) {
  if (!c) return;
  const el = $('#cStatus', c.el);
  clearInterval(c.statusTimer);
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  if (!saved) { el.textContent = text; return; }
  const at = Date.now();
  const paint = () => { el.innerHTML = `${icon('checkCircle')}<span>${e(text)} ${ago(at)}</span>`; };
  paint();
  c.statusTimer = setInterval(paint, 30000);
}

// ---------------------------------------------------------------- attachments

function totalSize() { return c.attachments.reduce((n, a) => n + (a.size || 0), 0); }

async function addFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (totalSize() + file.size > MAX_TOTAL) { toast(`“${file.name}” is too large. Attachments are limited to 25 MB in total.`); continue; }
    const att = { name: file.name, type: file.type || 'application/octet-stream', size: file.size, pending: true };
    c.attachments.push(att);
    renderAttachments();
    try { att.bytes = new Uint8Array(await file.arrayBuffer()); }
    catch { toast(`Couldn’t read “${file.name}”.`); c.attachments.splice(c.attachments.indexOf(att), 1); }
    att.pending = false;
    if (att.type.startsWith('image/')) att.thumb = URL.createObjectURL(file);
    renderAttachments();
  }
  update();
  scheduleSave();
}

async function addRemoteAttachment(messageId, a) {
  const att = { name: a.filename, type: a.mimeType, size: a.size, pending: true };
  const mine = c;
  c.attachments.push(att);
  renderAttachments();
  try { att.bytes = await gmail.attachmentBytes(messageId, a); att.pending = false; }
  catch { if (mine === c) { mine.attachments.splice(mine.attachments.indexOf(att), 1); toast(`“${a.filename}” couldn’t be attached.`); } }
  if (mine !== c) return;
  renderAttachments();
  update();
}

function renderAttachments() {
  if (!c) return;
  $('#cAttachments', c.el).innerHTML = c.attachments
    .map((a, i) => attachmentCard({ name: a.name, type: a.type, size: a.size }, i, { removable: true, pending: a.pending, thumb: a.thumb }))
    .join('');
}

// ---------------------------------------------------------------- drafts

async function loadDraft(draftId, messageId) {
  setStatus('Loading draft…');
  try {
    const m = await gmail.getDraftMessage(draftId);
    c.threadId = m.threadId;
    c.inReplyTo = m.inReplyTo;
    c.references = m.references;
    c.fields.to.set(parseAddressList(m.to));
    c.fields.cc.set(parseAddressList(m.cc));
    c.fields.bcc.set(parseAddressList(m.bcc));
    if (m.cc || m.bcc) showCcBcc(true);
    $('#cSubject', c.el).value = m.subject;
    $('#cEditor', c.el).innerHTML = m.html ? sanitizeHtml(m.html) : e(m.text).replace(/\n/g, '<br>');
    $('#cTitle', c.el).textContent = 'Draft';
    m.attachments.forEach((a) => addRemoteAttachment(m.id || messageId, a));
    setStatus('');
  } catch (err) {
    setStatus('');
    toast(err instanceof gmail.NetworkError ? 'No connection. The draft couldn’t be opened.' : 'Couldn’t open the draft.');
  }
}

function restoreLocal(d) {
  if (!d) return;
  c.draftId = d.draftId || null;
  c.threadId = d.threadId || null;
  c.inReplyTo = d.inReplyTo || '';
  c.references = d.references || '';
  c.quote = d.quote || null;
  c.fields.to.set(parseAddressList(d.to));
  c.fields.cc.set(parseAddressList(d.cc));
  c.fields.bcc.set(parseAddressList(d.bcc));
  if (d.cc || d.bcc) showCcBcc(true);
  $('#cSubject', c.el).value = d.subject || '';
  $('#cEditor', c.el).innerHTML = sanitizeHtml(d.html || '');
  if (c.quote) $('#cQuote', c.el).innerHTML = `<div class="c-quote-head">${e(c.quote.label)}</div><div class="c-quote">${e(c.quote.text)}</div>`;
}

function saveLocal() {
  store.setLocalDraft({
    account: state.email, draftId: c.draftId, threadId: c.threadId, inReplyTo: c.inReplyTo, references: c.references,
    to: c.fields.to.text(), cc: c.fields.cc.text(), bcc: c.fields.bcc.text(),
    subject: $('#cSubject', c.el).value, html: editorHtml(), quote: c.quote, savedAt: Date.now(),
  });
}

function scheduleSave() {
  if (!c) return;
  c.dirty = snapshot() !== c.initial;
  if (!c.dirty) return;
  saveLocal();
  clearTimeout(c.saveTimer);
  c.saveTimer = setTimeout(() => saveDraft(), AUTOSAVE_MS);
}

function buildRaw() {
  const body = editorHtml();
  const q = c.quote;
  return buildMime({
    to: c.fields.to.values(),
    cc: c.fields.cc.values(),
    bcc: c.fields.bcc.values(),
    subject: $('#cSubject', c.el).value,
    html: body + (q ? q.html : ''),
    text: htmlToText(body) + (q ? q.plain : ''),
    inReplyTo: c.inReplyTo,
    references: c.references,
    attachments: c.attachments.filter((a) => a.bytes).map((a) => ({ name: a.name, type: a.type, bytes: a.bytes })),
  });
}

/** Save to Gmail Drafts. Saves never overlap; the latest content always wins. */
async function saveDraft() {
  if (!c || c.sending || !hasContent()) return;
  const mine = c;
  if (mine.saving) { mine.saveAgain = true; return mine.saving; }
  clearTimeout(mine.saveTimer);
  setStatus('Saving…');
  mine.saving = (async () => {
    try {
      const raw = buildRaw();
      const res = mine.draftId ? await gmail.updateDraft(mine.draftId, raw, mine.threadId) : await gmail.createDraft(raw, mine.threadId);
      mine.draftId = res.id;
      if (res.message?.threadId) mine.threadId = res.message.threadId;
      if (mine === c) { setStatus('Draft saved', { saved: true }); saveLocal(); }
      emit('drafts-changed');
    } catch (err) {
      if (mine === c) setStatus(err instanceof gmail.NetworkError ? 'Saved on this device' : 'Draft not saved', { saved: err instanceof gmail.NetworkError });
    } finally {
      mine.saving = null;
      if (mine.saveAgain) { mine.saveAgain = false; if (mine === c) saveDraft(); }
    }
  })();
  return mine.saving;
}

// ---------------------------------------------------------------- send

async function send() {
  if (!c || !canSend()) {
    if (c && c.fields.to.hasInvalid()) toast('Check the recipient addresses.');
    return;
  }
  const mine = c;
  mine.sending = true;
  clearTimeout(mine.saveTimer);
  $('#cSend', mine.el).innerHTML = '<span class="spinner"></span>';
  update();
  $('#cBanner', mine.el).innerHTML = '';
  if (mine.saving) await mine.saving.catch(() => {});
  const raw = buildRaw();
  try {
    await gmail.send(raw, mine.threadId);
    if (mine.draftId) gmail.deleteDraft(mine.draftId).catch(() => {});
    store.setLocalDraft(null);
    closeNow();
    toast('Message sent');
    emit('sent');
  } catch (err) {
    mine.sending = false;
    $('#cSend', mine.el).innerHTML = icon('send');
    update();
    const offline = err instanceof gmail.NetworkError;
    $('#cBanner', mine.el).innerHTML = banner({
      error: true,
      text: 'Failed to send',
      sub: offline ? 'Check your connection and try again.' : err instanceof gmail.AuthError ? 'Sign in again, then try again.' : err.message,
      action: { id: 'retry', label: 'Retry' },
    });
    if (offline) {
      $('#cBanner .banner', mine.el).insertAdjacentHTML('beforeend', '<button type="button" data-action="later">Send later</button>');
    }
    saveLocal();
  }
}

function sendLater() {
  const raw = buildRaw();
  if (!outbox.enqueue({ raw, threadId: c.threadId, draftId: c.draftId, subject: $('#cSubject', c.el).value })) {
    toast('This message is too large to keep offline. It is saved as a draft instead.');
    return;
  }
  store.setLocalDraft(null);
  closeNow();
  toast('Queued. It will be sent when you’re back online.');
}

// ---------------------------------------------------------------- closing

function closeNow() {
  if (!c) return;
  clearTimeout(c.saveTimer);
  clearInterval(c.statusTimer);
  c.attachments.forEach((a) => a.thumb && URL.revokeObjectURL(a.thumb));
  c.popLayer();
  c.el.remove();
  c = null;
}

async function discard() {
  const { draftId } = c;
  store.setLocalDraft(null);
  closeNow();
  if (draftId) {
    try { await gmail.deleteDraft(draftId); emit('drafts-changed'); } catch {}
  }
  toast('Draft discarded');
}

async function requestClose() {
  if (!c) return;
  if (c.sending) return;
  const meaningful = snapshot() !== c.initial && hasContent();
  if (!meaningful) {
    if (!hasContent() && c.draftId) return discard();
    store.setLocalDraft(null);
    return closeNow();
  }
  const choice = await confirmDialog({
    title: 'Discard draft?',
    body: 'Your draft will be permanently deleted.',
    row: true,
    actions: [
      { label: 'Cancel', value: null, kind: 'quiet' },
      { label: 'Discard', value: 'discard', kind: 'danger' },
      { label: 'Keep in Drafts', value: 'save', kind: 'link' },
    ],
  });
  if (!c) return;
  if (choice === 'discard') return discard();
  if (choice === 'save') {
    await saveDraft();
    const offline = !navigator.onLine;
    store.setLocalDraft(offline ? store.localDraft() : null);
    closeNow();
    toast(offline ? 'Saved on this device' : 'Draft saved');
  }
}

// ---------------------------------------------------------------- tools

async function insertLink() {
  const sel = window.getSelection();
  const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const editor = $('#cEditor', c.el);
  const selected = range && editor.contains(range.commonAncestorContainer) ? sel.toString() : '';
  let url = await promptSheet({ title: 'Insert link', placeholder: 'https://example.com', submit: 'Insert', type: 'url' });
  if (!url || !c) return;
  if (!/^(https?:|mailto:)/i.test(url)) url = (url.includes('@') && !url.includes('/') ? 'mailto:' : 'https://') + url;
  editor.focus();
  if (range && editor.contains(range.commonAncestorContainer)) { sel.removeAllRanges(); sel.addRange(range); }
  if (selected) document.execCommand('createLink', false, url);
  else document.execCommand('insertHTML', false, `<a href="${e(url)}">${e(url.replace(/^mailto:/, ''))}</a>&nbsp;`);
  update();
  scheduleSave();
}

function onClick(ev) {
  if (!c) return;
  const fmt = ev.target.closest('[data-fmt]');
  if (fmt) {
    ev.preventDefault();
    $('#cEditor', c.el).focus();
    document.execCommand(fmt.dataset.fmt, false);
    scheduleSave();
    return;
  }
  const a = ev.target.closest('[data-c], [data-action]');
  if (!a) return;
  switch (a.dataset.c || a.dataset.action) {
    case 'close': requestClose(); break;
    case 'ccbcc': showCcBcc(true); c.fields.cc.focus(); break;
    case 'format': {
      const bar = $('#cFormat', c.el);
      bar.hidden = !bar.hidden;
      a.setAttribute('aria-pressed', String(!bar.hidden));
      break;
    }
    case 'attach': $('#cFile', c.el).click(); break;
    case 'image': $('#cImage', c.el).click(); break;
    case 'link': insertLink(); break;
    case 'retry': send(); break;
    case 'later': sendLater(); break;
    case 'more':
      sheet({
        items: [
          { label: 'Save draft', icon: 'file', run: async () => { await saveDraft(); } },
          $('#cCcRow', c.el).hidden ? { label: 'Add Cc / Bcc', icon: 'plus', run: () => showCcBcc(true) } : null,
          { label: 'Discard', icon: 'trash', danger: true, run: discard },
        ],
      });
      break;
  }
}

/** Offer to reopen an unsent message that was kept on this device. */
const bootedAt = Date.now();

export function offerLocalDraft() {
  const d = store.localDraft();
  // Only offer work left over from an earlier visit, and never while composing.
  if (!d || c || d.account !== state.email || (d.savedAt || 0) > bootedAt) return;
  const age = Date.now() - (d.savedAt || 0);
  if (age > 14 * 86400000) { store.setLocalDraft(null); return; }
  toast('You have an unsent message', { action: { label: 'Open', run: () => openComposer({ mode: 'restore', local: d }) }, duration: 8000 });
}


// Attachment preview. Images and PDFs use the browser's own renderers (PDF pages,
// zoom and printing come from the built-in viewer); other files open with the system.
import * as gmail from '../gmail.js';
import { icon } from '../icons.js';
import { $, html, pushLayer, toast } from '../ui.js';
import { escapeHtml as e, fileKind, fileSize } from '../format.js';

async function blobFor(message, att) {
  const bytes = await gmail.attachmentBytes(message.id, att);
  return new Blob([bytes], { type: att.mimeType || 'application/octet-stream' });
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function reportError(err) {
  if (err instanceof gmail.AuthError) return;
  toast(err instanceof gmail.NetworkError ? 'No connection. The attachment couldn’t be downloaded.' : 'Couldn’t download the attachment.');
}

export const canShare = () => typeof navigator.canShare === 'function';

export async function downloadAttachment(message, att) {
  try { saveBlob(await blobFor(message, att), att.filename); } catch (err) { reportError(err); }
}

async function shareBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (!navigator.canShare?.({ files: [file] })) { toast('Sharing this file isn’t supported here. Download it instead.'); return; }
  try { await navigator.share({ files: [file], title: name }); } catch {}
}

export async function shareAttachment(message, att) {
  try { await shareBlob(await blobFor(message, att), att.filename); } catch (err) { reportError(err); }
}

export async function openAttachment(message, att) {
  const kind = fileKind(att.mimeType, att.filename);
  const view = html(`<div class="preview" role="dialog" aria-modal="true" aria-label="${e(att.filename)}">
    <div class="preview-bar">
      <button type="button" class="icon-btn" data-p="close" aria-label="Back">${icon('chevronLeft', 'ic-lg')}</button>
      <div class="preview-title"><div class="preview-name">${e(att.filename)}</div><div class="preview-size">${e(fileSize(att.size))}</div></div>
    </div>
    <div class="preview-body"><div class="spinner" aria-label="Loading"></div></div>
    <div class="preview-actions">
      ${canShare() ? `<button type="button" data-p="share" disabled>${icon('share')}<span>Share</span></button>` : ''}
      <button type="button" data-p="download" disabled>${icon('download')}<span>Download</span></button>
      <button type="button" data-p="open" disabled>${icon('external')}<span>Open in…</span></button>
      ${kind === 'pdf' ? `<button type="button" data-p="print" disabled>${icon('printer')}<span>Print</span></button>` : ''}
    </div>
  </div>`);
  let url = null;
  let blob = null;
  const close = () => { pop(); view.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const pop = pushLayer(close);
  document.body.append(view);
  $('[data-p="close"]', view).focus();

  view.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-p]');
    if (!b) return;
    if (b.dataset.p === 'close') { close(); return; }
    if (!blob) return;
    if (b.dataset.p === 'download') saveBlob(blob, att.filename);
    if (b.dataset.p === 'open') window.open(url, '_blank', 'noopener');
    if (b.dataset.p === 'share') shareBlob(blob, att.filename);
    if (b.dataset.p === 'print') {
      const frame = $('iframe', view);
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, '_blank', 'noopener'); }
    }
  });

  try {
    blob = await blobFor(message, att);
  } catch (err) {
    $('.preview-body', view).innerHTML = `<div class="empty">${icon('alert')}<h2>Couldn’t load this file</h2><p>${err instanceof gmail.NetworkError ? 'Check your connection and try again.' : e(err.message)}</p></div>`;
    return;
  }
  if (!view.isConnected) return;
  url = URL.createObjectURL(blob);
  view.querySelectorAll('.preview-actions button').forEach((b) => { b.disabled = false; });
  const body = $('.preview-body', view);
  if (kind === 'image') {
    body.innerHTML = `<img alt="${e(att.filename)}">`;
    $('img', body).src = url;
  } else if (kind === 'pdf') {
    body.innerHTML = `<iframe title="${e(att.filename)}"></iframe>`;
    $('iframe', body).src = url;
  } else {
    body.innerHTML = `<div class="empty">${icon('file')}<h2>${e(att.filename)}</h2>
      <p>This file can’t be previewed in the browser. Use “Open in…” to view it with another app, or download it.</p></div>`;
  }
}

// Attachment preview. Images and PDFs use the browser's own renderers;
// other files are opened or downloaded with the system's handlers.
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

export async function downloadAttachment(message, att) {
  try { saveBlob(await blobFor(message, att), att.filename); } catch (err) { reportError(err); }
}

const canShareFiles = (file) => !!(navigator.canShare && navigator.canShare({ files: [file] }));

export async function openAttachment(message, att) {
  const kind = fileKind(att.mimeType, att.filename);
  const view = html(`<div class="preview" role="dialog" aria-modal="true" aria-label="${e(att.filename)}">
    <div class="preview-bar">
      <button type="button" class="icon-btn" data-p="close" aria-label="Close preview">${icon('x')}</button>
      <div class="preview-name">${e(att.filename)} <span class="muted">${e(fileSize(att.size))}</span></div>
      <button type="button" class="icon-btn" data-p="share" aria-label="Share" hidden>${icon('share')}</button>
      ${kind === 'pdf' ? `<button type="button" class="icon-btn" data-p="open" aria-label="Open, print or view all pages">${icon('printer')}</button>` : ''}
      <button type="button" class="icon-btn" data-p="download" aria-label="Download">${icon('download')}</button>
    </div>
    <div class="preview-body"><div class="spinner" aria-label="Loading"></div></div>
  </div>`);
  let url = null;
  let blob = null;
  const close = () => { pop(); view.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const pop = pushLayer(close);
  document.body.append(view);
  $('[data-p="close"]', view).focus();

  view.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-p]');
    if (!b) return;
    if (b.dataset.p === 'close') close();
    if (!blob) return;
    if (b.dataset.p === 'download') saveBlob(blob, att.filename);
    if (b.dataset.p === 'open') window.open(url, '_blank', 'noopener');
    if (b.dataset.p === 'share') {
      try { await navigator.share({ files: [new File([blob], att.filename, { type: blob.type })], title: att.filename }); } catch {}
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
  if (canShareFiles(new File([blob], att.filename, { type: blob.type }))) $('[data-p="share"]', view).hidden = false;
  const body = $('.preview-body', view);
  if (kind === 'image') {
    body.innerHTML = `<img alt="${e(att.filename)}">`;
    $('img', body).src = url;
  } else if (kind === 'pdf') {
    // The browser's PDF viewer provides pages, zoom and printing.
    body.innerHTML = `<iframe title="${e(att.filename)}"></iframe>`;
    $('iframe', body).src = url;
  } else {
    body.innerHTML = `<div class="empty">${icon('file')}<h2>${e(att.filename)}</h2>
      <p>This file type can’t be previewed here. Open it with another app or download it.</p>
      <button type="button" class="btn btn-primary" data-p="open">${icon('external')}Open</button></div>`;
  }
}

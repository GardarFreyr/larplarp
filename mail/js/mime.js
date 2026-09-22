// Decoding Gmail API messages and encoding outgoing RFC 2822 / MIME messages.

export function b64urlToBytes(data) {
  let s = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const utf8 = (s) => new TextEncoder().encode(s);
export const asciiToB64Url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function decodeBytes(bytes, charset) {
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
}

function decodeEntities(s) {
  const d = new DOMParser().parseFromString('<!doctype html><body>' + s, 'text/html');
  return d.body.textContent || '';
}

export function header(headers, name) {
  const lower = name.toLowerCase();
  const h = (headers || []).find((x) => x.name.toLowerCase() === lower);
  return h ? h.value : '';
}

function charsetOf(part) {
  const m = header(part.headers, 'Content-Type').match(/charset="?([^";\s]+)"?/i);
  return m ? m[1] : 'utf-8';
}

function walk(part, out) {
  if (!part) return out;
  const mime = (part.mimeType || '').toLowerCase();
  const body = part.body || {};
  if (part.filename && (body.attachmentId || body.data)) {
    out.attachments.push({
      filename: part.filename,
      mimeType: part.mimeType || 'application/octet-stream',
      size: body.size || 0,
      attachmentId: body.attachmentId || null,
      data: body.data || null,
      contentId: header(part.headers, 'Content-ID').replace(/[<>]/g, ''),
    });
  } else if (mime === 'text/html' && body.data && !out.html) {
    out.html = decodeBytes(b64urlToBytes(body.data), charsetOf(part));
  } else if (mime === 'text/plain' && body.data && !out.text) {
    out.text = decodeBytes(b64urlToBytes(body.data), charsetOf(part));
  }
  (part.parts || []).forEach((p) => walk(p, out));
  return out;
}

function hasAttachmentHint(payload) {
  if (!payload) return false;
  if ((payload.mimeType || '').toLowerCase() === 'multipart/mixed') return true;
  return (payload.parts || []).some((p) => p.filename);
}

/** Shape shared by list rows and full messages. `date` is epoch ms so it survives JSON. */
export function parseMessage(msg, { full = false, ...extra } = {}) {
  const h = msg.payload ? msg.payload.headers : [];
  const parsed = {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds || [],
    date: Number(msg.internalDate) || Date.parse(header(h, 'Date')) || Date.now(),
    from: header(h, 'From'),
    to: header(h, 'To'),
    cc: header(h, 'Cc'),
    bcc: header(h, 'Bcc'),
    replyTo: header(h, 'Reply-To'),
    subject: header(h, 'Subject'),
    messageId: header(h, 'Message-ID') || header(h, 'Message-Id'),
    inReplyTo: header(h, 'In-Reply-To'),
    references: header(h, 'References'),
    snippet: decodeEntities(msg.snippet || ''),
    hasAttachment: hasAttachmentHint(msg.payload),
    ...extra,
  };
  if (full && msg.payload) {
    Object.assign(parsed, walk(msg.payload, { html: '', text: '', attachments: [] }));
    parsed.hasAttachment = parsed.attachments.length > 0;
    parsed.full = true;
  }
  return parsed;
}

/** Readable plain text for a message (used for quoting and forwarding). */
export function plainTextOf(m) {
  if (m.text) return m.text.replace(/\r\n/g, '\n').trim();
  if (!m.html) return m.snippet || '';
  const doc = new DOMParser().parseFromString(m.html, 'text/html');
  doc.querySelectorAll('style,script,head,title').forEach((n) => n.remove());
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  doc.querySelectorAll('p,div,tr,li,h1,h2,h3,h4,h5,h6,blockquote').forEach((n) => n.append('\n'));
  return (doc.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI', 'BLOCKQUOTE']);

/** Keep only simple formatting; used whenever stored HTML is put into the editor. */
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const clean = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); return; }
      clean(child);
      if (['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG'].includes(child.tagName)) { child.remove(); return; }
      if (!ALLOWED.has(child.tagName)) { child.replaceWith(...child.childNodes); return; }
      const href = child.tagName === 'A' ? child.getAttribute('href') : null;
      [...child.attributes].forEach((a) => child.removeAttribute(a.name));
      if (href && /^(https?:|mailto:)/i.test(href.trim())) {
        child.setAttribute('href', href.trim());
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
    });
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  doc.querySelectorAll('li').forEach((n) => n.prepend('• '));
  doc.querySelectorAll('p,div,li,blockquote').forEach((n) => n.append('\n'));
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href && href !== a.textContent) a.append(` (${href})`);
  });
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------- encoding

function encodeWord(value) {
  if (!/[^\x20-\x7E]/.test(value)) return value;
  return '=?UTF-8?B?' + bytesToB64(utf8(value)) + '?=';
}

function encodeAddressHeader(list) {
  return list.map((a) => {
    if (!a.name) return a.email;
    const n = a.name.replace(/"/g, '');
    return `${/[^\x20-\x7E]/.test(n) ? encodeWord(n) : '"' + n + '"'} <${a.email}>`;
  }).join(', ');
}

const wrap76 = (b64) => b64.replace(/.{76}/g, '$&\r\n');
const boundary = () => '=_mail_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

function textPart(type, content) {
  return `Content-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(bytesToB64(utf8(content)))}`;
}

function attachmentPart(att) {
  const name = encodeWord(att.name.replace(/"/g, ''));
  return `Content-Type: ${att.type || 'application/octet-stream'}; name="${name}"\r\n` +
    `Content-Disposition: attachment; filename="${name}"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n${wrap76(bytesToB64(att.bytes))}`;
}

/**
 * Build an RFC 2822 message. Returns an ASCII string (all non-ASCII content is base64).
 * @param {{to:Array,cc:Array,bcc:Array,subject:string,html:string,text:string,inReplyTo?:string,references?:string,attachments?:Array<{name,type,bytes:Uint8Array}>}} m
 */
export function buildMime(m) {
  const headers = [];
  if (m.to.length) headers.push('To: ' + encodeAddressHeader(m.to));
  if (m.cc.length) headers.push('Cc: ' + encodeAddressHeader(m.cc));
  if (m.bcc.length) headers.push('Bcc: ' + encodeAddressHeader(m.bcc));
  headers.push('Subject: ' + encodeWord(m.subject || ''));
  if (m.inReplyTo) headers.push('In-Reply-To: ' + m.inReplyTo);
  if (m.references) headers.push('References: ' + m.references);
  headers.push('MIME-Version: 1.0');

  const alt = boundary();
  const alternative = `Content-Type: multipart/alternative; boundary="${alt}"\r\n\r\n` +
    `--${alt}\r\n${textPart('text/plain', m.text)}\r\n` +
    `--${alt}\r\n${textPart('text/html', `<div dir="ltr">${m.html}</div>`)}\r\n--${alt}--`;

  const atts = m.attachments || [];
  if (!atts.length) return headers.join('\r\n') + '\r\n' + alternative + '\r\n';

  const mixed = boundary();
  let body = `Content-Type: multipart/mixed; boundary="${mixed}"\r\n\r\n--${mixed}\r\n${alternative}\r\n`;
  atts.forEach((a) => { body += `--${mixed}\r\n${attachmentPart(a)}\r\n`; });
  body += `--${mixed}--\r\n`;
  return headers.join('\r\n') + '\r\n' + body;
}

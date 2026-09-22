export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function linkify(escaped) {
  return escaped.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

/** Split an address header on commas that are not inside quotes or angle brackets. */
export function splitAddresses(value) {
  const out = [];
  let cur = '', q = false, a = false;
  for (const ch of String(value || '')) {
    if (ch === '"') q = !q;
    if (!q && ch === '<') a = true;
    if (!q && ch === '>') a = false;
    if ((ch === ',' || ch === ';') && !q && !a) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseAddress(value) {
  const v = String(value || '').trim();
  if (!v) return { name: '', email: '' };
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: '', email: v.replace(/^mailto:/i, '') };
}

export const parseAddressList = (value) => splitAddresses(value).map(parseAddress).filter((a) => a.email);

export const displayName = (a) => a.name || a.email;

export function isValidEmail(email) {
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(email);
}

export function formatAddress(a) {
  if (!a.name) return a.email;
  const needsQuotes = /[^\w\s.'-]/.test(a.name);
  return `${needsQuotes ? '"' + a.name.replace(/"/g, '') + '"' : a.name} <${a.email}>`;
}

export function initials(nameOrEmail) {
  const base = String(nameOrEmail || '').split('@')[0];
  const words = base.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function listDate(ms) {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const days = (now - d) / 86400000;
  if (days < 6 && days > 0) return d.toLocaleDateString([], { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fullDate(ms) {
  return new Date(ms).toLocaleString([], {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function fileSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export function fileKind(mimeType, filename) {
  const t = (mimeType || '').toLowerCase();
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (t.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return 'image';
  if (t === 'application/pdf' || ext === 'pdf') return 'pdf';
  return 'file';
}

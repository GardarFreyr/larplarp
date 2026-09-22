// New-mail notifications via the Notifications API (through the service worker when available).
// Web apps can only check for mail while they are open, so this runs from the app's refresh loop.
import * as gmail from './gmail.js';
import { store } from './store.js';
import { parseAddress, displayName } from './format.js';

let seen = null; // ids of unread inbox messages already known

export function notificationStatus() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function enableNotifications() {
  if (notificationStatus() === 'unsupported') return false;
  if (Notification.permission === 'granted') return true;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

export function resetNotifications() { seen = null; }

export async function checkForNewMail() {
  const enabled = store.prefs().notify && notificationStatus() === 'granted';
  let res;
  try { res = await gmail.list({ labelIds: ['INBOX', 'UNREAD'] }, { pageSize: 10 }); } catch { return; }
  const fresh = res.rows.filter((m) => seen && !seen.has(m.id));
  seen = new Set([...(seen || []), ...res.rows.map((m) => m.id)]);
  if (!enabled || !fresh.length) return fresh;
  const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  for (const m of fresh.slice(0, 3)) {
    const title = displayName(parseAddress(m.from)) || 'New email';
    const opts = {
      body: `${m.subject || '(no subject)'}\n${m.snippet || ''}`.slice(0, 180),
      tag: 'mail-' + m.id,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { id: m.id },
    };
    store.addNotification({ id: m.id, account: gmail.currentEmail(), from: title, subject: m.subject || '(no subject)', snippet: m.snippet || '', at: Date.now() });
    try {
      if (reg) await reg.showNotification(title, opts);
      else {
        const n = new Notification(title, opts);
        n.onclick = () => { window.focus(); location.hash = '#/m/' + encodeURIComponent(m.id); n.close(); };
      }
    } catch {}
  }
  return fresh;
}

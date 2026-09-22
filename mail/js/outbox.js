// Messages that couldn't be sent yet. They are kept on this device and sent
// automatically when the connection returns (or the app is opened again).
import * as gmail from './gmail.js';
import { store } from './store.js';
import { emit } from './state.js';
import { toast } from './ui.js';

let flushing = false;

/** Returns false if the message is too large to keep on this device. */
export function enqueue({ raw, threadId, draftId, subject }) {
  const items = store.outbox();
  items.push({ id: Date.now().toString(36), account: gmail.currentEmail(), raw, threadId, draftId, subject, queuedAt: Date.now() });
  const ok = store.setOutbox(items);
  emit('outbox-changed');
  return ok;
}

export const pending = () => store.outbox().filter((i) => i.account === gmail.currentEmail());

export async function flush() {
  if (flushing || !navigator.onLine || !gmail.tokenValid()) return;
  const mine = pending();
  if (!mine.length) return;
  flushing = true;
  let sent = 0;
  try {
    for (const item of mine) {
      try {
        await gmail.send(item.raw, item.threadId);
        if (item.draftId) gmail.deleteDraft(item.draftId).catch(() => {});
        store.setOutbox(store.outbox().filter((x) => x.id !== item.id));
        sent++;
      } catch (err) {
        if (err instanceof gmail.NetworkError || err instanceof gmail.AuthError) break;
        // Gmail rejected it: keep it out of the queue but tell the user.
        store.setOutbox(store.outbox().filter((x) => x.id !== item.id));
        toast(`“${item.subject || 'No subject'}” couldn’t be sent: ${err.message}`);
      }
    }
  } finally {
    flushing = false;
    emit('outbox-changed');
  }
  if (sent) { toast(sent === 1 ? 'Queued message sent' : `${sent} queued messages sent`); emit('sent'); }
}

window.addEventListener('online', () => setTimeout(flush, 800));

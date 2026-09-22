// Shared app state and a tiny event bus. Views read state and talk through events.

export const FOLDERS = {
  INBOX: { title: 'Inbox', icon: 'inbox', spec: { labelIds: ['INBOX'] } },
  STARRED: { title: 'Starred', icon: 'star', spec: { labelIds: ['STARRED'] } },
  SENT: { title: 'Sent', icon: 'send', spec: { labelIds: ['SENT'] }, who: 'to' },
  DRAFT: { title: 'Drafts', icon: 'file', spec: { drafts: true }, who: 'to' },
  TRASH: { title: 'Trash', icon: 'trash', spec: { labelIds: ['TRASH'], includeSpamTrash: true } },
};

// Quick filters shown above the Inbox.
export const INBOX_FILTERS = {
  all: { label: 'All', spec: { labelIds: ['INBOX'] } },
  unread: { label: 'Unread', spec: { labelIds: ['INBOX', 'UNREAD'] } },
  starred: { label: 'Starred', spec: { labelIds: ['STARRED'] } },
  archive: { label: 'Archive', spec: { q: '-in:inbox -in:sent -in:drafts -in:trash -in:spam -in:chats' } },
};

export const state = {
  email: null,
  screen: 'mail',            // 'mail' | 'search' | 'settings'
  folder: 'INBOX',
  filter: 'all',
  openId: null,              // message shown in the reader
  unread: 0,
  online: navigator.onLine,
};

export function mailboxSpec() {
  if (state.folder === 'INBOX') return INBOX_FILTERS[state.filter].spec;
  return FOLDERS[state.folder].spec;
}

export function mailboxKey() {
  return `${state.email}|${state.folder}|${state.folder === 'INBOX' ? state.filter : ''}`;
}

export function mailboxTitle() {
  return FOLDERS[state.folder].title;
}

const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}
export function emit(event, detail) {
  (listeners.get(event) || []).forEach((fn) => {
    try { fn(detail); } catch (err) { console.error(err); }
  });
}

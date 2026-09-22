// Everything the app keeps on this device lives here (localStorage, safely wrapped).
const K = {
  clientId: 'mail.clientId',
  accounts: 'mail.accounts',     // { [email]: { token, exp } }
  current: 'mail.current',       // email of the active account
  prefs: 'mail.prefs',
  recents: 'mail.recentSearches',
  outbox: 'mail.outbox',
  localDraft: 'mail.localDraft',
  listCache: 'mail.listCache',
  notifications: 'mail.notifications',
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function write(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

// Legacy keys from the first version of the app.
(function migrate() {
  try {
    const oldToken = localStorage.getItem('mail.token');
    const oldEmail = localStorage.getItem('mail.email');
    if (oldEmail && !localStorage.getItem(K.current)) {
      const t = oldToken ? JSON.parse(oldToken) : null;
      write(K.accounts, { [oldEmail]: t ? { token: t.token, exp: t.exp } : {} });
      write(K.current, oldEmail);
    }
    localStorage.removeItem('mail.token');
    localStorage.removeItem('mail.email');
    const oldId = localStorage.getItem(K.clientId);
    if (oldId && !oldId.startsWith('"')) localStorage.setItem(K.clientId, JSON.stringify(oldId));
  } catch {}
})();

export const store = {
  // --- OAuth client id
  getClientId() {
    const cfg = (window.MAIL_CONFIG && window.MAIL_CONFIG.clientId) || '';
    return String(read(K.clientId, '') || cfg).trim();
  },
  setClientId(v) { write(K.clientId, v.trim() || null); },

  // --- accounts
  accounts() { return read(K.accounts, {}); },
  accountEmails() { return Object.keys(this.accounts()); },
  currentEmail() { return read(K.current, null); },
  setCurrent(email) { write(K.current, email); },
  saveToken(email, token, exp) {
    const a = this.accounts();
    a[email] = { token, exp };
    write(K.accounts, a);
  },
  tokenFor(email) {
    const a = this.accounts()[email];
    return a && a.token && a.exp > Date.now() ? a : null;
  },
  clearToken(email) {
    const a = this.accounts();
    if (a[email]) { a[email] = {}; write(K.accounts, a); }
  },
  removeAccount(email) {
    const a = this.accounts();
    delete a[email];
    write(K.accounts, a);
    if (this.currentEmail() === email) write(K.current, Object.keys(a)[0] || null);
  },

  // --- preferences
  prefs() {
    return { theme: 'system', previews: true, avatars: true, notify: false, ...read(K.prefs, {}) };
  },
  setPref(key, value) {
    const p = this.prefs();
    p[key] = value;
    write(K.prefs, p);
  },

  // --- recent searches (most recent first)
  recents() { return read(K.recents, []); },
  addRecent(q) {
    q = q.trim();
    if (!q) return;
    write(K.recents, [q, ...this.recents().filter((x) => x !== q)].slice(0, 8));
  },
  removeRecent(q) { write(K.recents, this.recents().filter((x) => x !== q)); },
  clearRecents() { write(K.recents, []); },

  // --- outbox: raw MIME messages waiting to be sent
  outbox() { return read(K.outbox, []); },
  setOutbox(items) { return write(K.outbox, items); },

  // --- unsent composer content kept on this device
  localDraft() { return read(K.localDraft, null); },
  setLocalDraft(d) { write(K.localDraft, d); },

  // --- last list shown per view, for offline use (metadata only)
  cachedList(key) { return (read(K.listCache, {})[key]) || null; },
  cacheList(key, rows) {
    const all = read(K.listCache, {});
    all[key] = rows.slice(0, 40);
    const keys = Object.keys(all);
    if (keys.length > 12) delete all[keys[0]];
    if (!write(K.listCache, all)) write(K.listCache, { [key]: all[key] });
  },
  clearCache() { write(K.listCache, null); },

  // --- notifications this app has shown (newest first)
  notifications(account) { return read(K.notifications, []).filter((n) => n.account === account); },
  addNotification(n) { write(K.notifications, [n, ...read(K.notifications, []).filter((x) => x.id !== n.id)].slice(0, 40)); },
  clearNotifications(account) { write(K.notifications, read(K.notifications, []).filter((n) => n.account !== account)); },
};

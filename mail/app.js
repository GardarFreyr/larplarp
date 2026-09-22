/* Mail — a small Gmail client that runs entirely in the browser.
 * Auth: Google Identity Services (OAuth token flow). Data: Gmail REST API. */
(() => {
  'use strict';

  const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const SCOPES = 'https://www.googleapis.com/auth/gmail.modify';
  const PAGE_SIZE = 30;
  const REFRESH_MS = 60 * 1000;
  const LS = {
    clientId: 'mail.clientId',
    token: 'mail.token',
    email: 'mail.email',
  };

  const FOLDERS = {
    INBOX:   { title: 'Inbox',   labelIds: ['INBOX'] },
    STARRED: { title: 'Starred', labelIds: ['STARRED'] },
    SENT:    { title: 'Sent',    labelIds: ['SENT'] },
    DRAFT:   { title: 'Drafts',  drafts: true },
    TRASH:   { title: 'Trash',   labelIds: ['TRASH'], includeSpamTrash: true },
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = {
    token: null,
    tokenExpiry: 0,
    email: '',
    folder: 'INBOX',
    query: '',
    items: [],          // list rows
    nextPageToken: null,
    selectedId: null,
    current: null,      // parsed message currently shown
    loadSeq: 0,
    compose: null,      // { draftId, threadId, inReplyTo, references }
  };

  // ---------------------------------------------------------------- storage
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  function getClientId() {
    const cfg = (window.MAIL_CONFIG && window.MAIL_CONFIG.clientId) || '';
    return (store.get(LS.clientId) || cfg).trim();
  }

  // ---------------------------------------------------------------- auth
  let tokenClient = null;

  function waitForGis(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function check() {
        if (window.google && google.accounts && google.accounts.oauth2) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('Could not load Google Sign-In. Check your internet connection.'));
        setTimeout(check, 100);
      })();
    });
  }

  function initTokenClient() {
    const clientId = getClientId();
    if (!clientId) return false;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: () => {},
    });
    return true;
  }

  function requestToken(prompt) {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPES)) {
          return reject(new Error('Please allow access to Gmail so the app can read and send email.'));
        }
        setToken(resp.access_token, Number(resp.expires_in) || 3600);
        resolve();
      };
      tokenClient.error_callback = (err) => {
        reject(new Error(err && err.type === 'popup_closed' ? 'Sign-in was cancelled.' :
          (err && err.message) || 'Sign-in failed.'));
      };
      const opts = { prompt };
      const hint = store.get(LS.email);
      if (hint && prompt !== 'select_account') opts.hint = hint;
      tokenClient.requestAccessToken(opts);
    });
  }

  function setToken(token, expiresIn) {
    state.token = token;
    state.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;
    store.set(LS.token, JSON.stringify({ token, exp: state.tokenExpiry }));
  }

  function loadSavedToken() {
    try {
      const saved = JSON.parse(store.get(LS.token) || 'null');
      if (saved && saved.token && saved.exp > Date.now()) {
        state.token = saved.token;
        state.tokenExpiry = saved.exp;
        return true;
      }
    } catch {}
    return false;
  }

  function tokenValid() { return state.token && Date.now() < state.tokenExpiry; }

  function clearToken() {
    state.token = null;
    state.tokenExpiry = 0;
    store.del(LS.token);
  }

  // ---------------------------------------------------------------- api
  class AuthError extends Error {}

  async function api(path, opts = {}) {
    if (!tokenValid()) { promptReauth(); throw new AuthError('Session expired'); }
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + state.token,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { clearToken(); promptReauth(); throw new AuthError('Session expired'); }
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx], idx); } catch (e) { if (e instanceof AuthError) throw e; out[idx] = null; }
      }
    });
    await Promise.all(workers);
    return out;
  }

  // ---------------------------------------------------------------- encoding helpers
  function b64urlToBytes(data) {
    let s = data.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  const utf8 = (s) => new TextEncoder().encode(s);
  const toB64Url = (s) => bytesToB64(utf8(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function decodeBytes(bytes, charset) {
    try { return new TextDecoder(charset || 'utf-8').decode(bytes); }
    catch { return new TextDecoder('utf-8').decode(bytes); }
  }

  function encodeHeader(value) {
    if (!/[^\x20-\x7E]/.test(value)) return value;
    return '=?UTF-8?B?' + bytesToB64(utf8(value)) + '?=';
  }

  function decodeEntities(s) {
    const d = new DOMParser().parseFromString('<!doctype html><body>' + s, 'text/html');
    return d.body.textContent || '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function linkify(escaped) {
    return escaped.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g,
      (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  }

  // ---------------------------------------------------------------- message parsing
  function header(headers, name) {
    const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
    return h ? h.value : '';
  }

  function parseAddress(value) {
    if (!value) return { name: '', email: '' };
    const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() };
    return { name: value.trim(), email: value.trim() };
  }

  function firstAddress(value) {
    // Split on commas that are not inside quotes
    const parts = (value || '').match(/(?:[^,"]|"[^"]*")+/g) || [];
    return parseAddress(parts[0] || '');
  }

  function displayNames(value) {
    const parts = (value || '').match(/(?:[^,"]|"[^"]*")+/g) || [];
    return parts.map((p) => parseAddress(p).name).filter(Boolean).join(', ');
  }

  function initials(name) {
    const clean = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    const words = clean.split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  function charsetOf(part) {
    const ct = header(part.headers, 'Content-Type');
    const m = ct.match(/charset="?([^";\s]+)"?/i);
    return m ? m[1] : 'utf-8';
  }

  function walkParts(part, out) {
    if (!part) return out;
    const mime = (part.mimeType || '').toLowerCase();
    const filename = part.filename;
    if (filename && part.body && (part.body.attachmentId || part.body.data)) {
      out.attachments.push({
        filename,
        mimeType: part.mimeType,
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
        data: part.body.data,
      });
    } else if (mime === 'text/html' && part.body && part.body.data && !out.html) {
      out.html = decodeBytes(b64urlToBytes(part.body.data), charsetOf(part));
    } else if (mime === 'text/plain' && part.body && part.body.data && !out.text) {
      out.text = decodeBytes(b64urlToBytes(part.body.data), charsetOf(part));
    }
    (part.parts || []).forEach((p) => walkParts(p, out));
    return out;
  }

  function parseMessage(msg) {
    const h = msg.payload ? msg.payload.headers : [];
    const body = walkParts(msg.payload, { html: '', text: '', attachments: [] });
    return {
      id: msg.id,
      threadId: msg.threadId,
      labelIds: msg.labelIds || [],
      date: new Date(Number(msg.internalDate) || Date.parse(header(h, 'Date')) || Date.now()),
      from: header(h, 'From'),
      to: header(h, 'To'),
      cc: header(h, 'Cc'),
      replyTo: header(h, 'Reply-To'),
      subject: header(h, 'Subject'),
      messageId: header(h, 'Message-ID') || header(h, 'Message-Id'),
      references: header(h, 'References'),
      snippet: decodeEntities(msg.snippet || ''),
      ...body,
    };
  }

  function plainTextOf(m) {
    if (m.text) return m.text;
    if (!m.html) return '';
    const doc = new DOMParser().parseFromString(m.html, 'text/html');
    doc.querySelectorAll('style,script,head').forEach((n) => n.remove());
    doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    doc.querySelectorAll('p,div,tr,li,h1,h2,h3,h4').forEach((n) => n.append('\n'));
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------------------------------------------------------------- dates
  function formatListDate(d) {
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const days = (now - d) / 86400000;
    if (days < 6) return d.toLocaleDateString([], { weekday: 'short' });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatFullDate(d) {
    return d.toLocaleString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ---------------------------------------------------------------- UI helpers
  let toastTimer = null;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => { el.classList.add('hidden'); action.fn(); };
      el.appendChild(b);
    }
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), action ? 8000 : 3200);
  }

  function showError(e) {
    if (e instanceof AuthError) return;
    console.error(e);
    toast(e.message || 'Something went wrong');
  }

  let reauthShown = false;
  function promptReauth() {
    if (reauthShown) return;
    reauthShown = true;
    const el = $('#toast');
    el.innerHTML = '<span>Your session expired.</span>';
    const b = document.createElement('button');
    b.textContent = 'Reconnect';
    b.onclick = async () => {
      try {
        await requestToken('');
        reauthShown = false;
        el.classList.add('hidden');
        refreshAll();
      } catch (e) { toast(e.message); reauthShown = false; }
    };
    el.appendChild(b);
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
  }

  function icon(id, cls = 'ic') {
    return `<svg class="${cls}"><use href="#${id}"/></svg>`;
  }

  // ---------------------------------------------------------------- screens
  function showScreen(name) {
    $('#login').classList.toggle('hidden', name !== 'login');
    $('#app').classList.toggle('hidden', name !== 'app');
  }

  function hideSplash() {
    const s = $('#splash');
    s.classList.add('fade');
    setTimeout(() => s.classList.add('hidden'), 400);
  }

  function showSplash() {
    const s = $('#splash');
    s.classList.remove('hidden', 'fade');
  }

  function setupLoginScreen(errorMsg) {
    const hasId = !!getClientId();
    const known = store.get(LS.email);
    $('#clientIdBox').classList.toggle('hidden', hasId);
    $('#signInLabel').textContent = known && hasId ? 'Continue as ' + known : 'Sign in with Google';
    $('#switchAccountBtn').classList.toggle('hidden', !(known && hasId));
    const err = $('#loginError');
    err.textContent = errorMsg || '';
    err.classList.toggle('hidden', !errorMsg);
  }

  async function signIn(prompt) {
    const err = $('#loginError');
    err.classList.add('hidden');
    if (!getClientId()) {
      const val = $('#clientIdInput').value.trim();
      if (!val) { setupLoginScreen('Enter your Google OAuth Client ID first.'); $('#clientIdInput').focus(); return; }
      store.set(LS.clientId, val);
    }
    try {
      await waitForGis();
      if (!tokenClient) initTokenClient();
      await requestToken(prompt);
      showSplash();
      await startApp();
    } catch (e) {
      hideSplash();
      showScreen('login');
      setupLoginScreen(e.message);
    }
  }

  async function startApp() {
    const profile = await api('/profile');
    state.email = profile.emailAddress;
    store.set(LS.email, state.email);
    $('#accountEmail').textContent = state.email;
    showScreen('app');
    await selectFolder('INBOX', { force: true });
    hideSplash();
    updateUnreadCount();
  }

  function signOut() {
    const token = state.token;
    clearToken();
    store.del(LS.email);
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      google.accounts.oauth2.revoke(token, () => {});
    }
    closeOverlays();
    state.items = [];
    state.current = null;
    $('#messageList').innerHTML = '';
    showScreen('login');
    setupLoginScreen();
  }

  // ---------------------------------------------------------------- folder + list
  async function selectFolder(folder, { force = false } = {}) {
    if (state.folder === folder && !force && !state.query) {
      $('#listScroll').scrollTop = 0;
      return loadList();
    }
    state.folder = folder;
    $$('[data-folder]').forEach((b) => b.classList.toggle('active', b.dataset.folder === folder));
    $('#mobileTitle').textContent = folder === 'INBOX' ? 'Mail' : FOLDERS[folder].title;
    state.items = [];
    state.nextPageToken = null;
    $('#messageList').innerHTML = '';
    $('#listScroll').scrollTop = 0;
    closeReader(true);
    await loadList();
  }

  async function loadList({ append = false, silent = false } = {}) {
    const seq = ++state.loadSeq;
    const f = FOLDERS[state.folder];
    const status = $('#listStatus');
    if (!append && !silent) status.textContent = 'Loading…';
    $('#loadMoreBtn').classList.add('hidden');

    try {
      const params = new URLSearchParams({ maxResults: PAGE_SIZE });
      if (state.query) params.set('q', state.query);
      if (append && state.nextPageToken) params.set('pageToken', state.nextPageToken);

      let refs; let nextPageToken;
      if (f.drafts) {
        const res = await api('/drafts?' + params);
        refs = (res.drafts || []).map((d) => ({ id: d.message.id, draftId: d.id }));
        nextPageToken = res.nextPageToken;
      } else {
        f.labelIds.forEach((l) => params.append('labelIds', l));
        if (f.includeSpamTrash) params.set('includeSpamTrash', 'true');
        const res = await api('/messages?' + params);
        refs = (res.messages || []).map((m) => ({ id: m.id }));
        nextPageToken = res.nextPageToken;
      }
      if (seq !== state.loadSeq) return;

      const meta = '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date';
      const msgs = await mapLimit(refs, 10, (r) => api('/messages/' + r.id + meta));
      if (seq !== state.loadSeq) return;

      const rows = msgs.map((m, i) => (m ? { ...parseMessage(m), draftId: refs[i].draftId } : null)).filter(Boolean);
      state.items = append ? state.items.concat(rows) : rows;
      state.nextPageToken = nextPageToken || null;
      renderList();
      status.textContent = state.items.length ? '' : (state.query ? 'No results' : 'No messages');
      $('#loadMoreBtn').classList.toggle('hidden', !state.nextPageToken);
    } catch (e) {
      if (seq !== state.loadSeq) return;
      if (!silent) status.textContent = e instanceof AuthError ? '' : 'Could not load messages.';
      showError(e);
    }
  }

  function renderList() {
    const ul = $('#messageList');
    const frag = document.createDocumentFragment();
    const showTo = state.folder === 'SENT' || state.folder === 'DRAFT';
    for (const m of state.items) {
      const li = document.createElement('li');
      li.className = 'message-item';
      li.dataset.id = m.id;
      li.tabIndex = 0;
      const unread = m.labelIds.includes('UNREAD');
      if (unread) li.classList.add('unread');
      if (m.id === state.selectedId) li.classList.add('selected');

      if (unread) { const dot = document.createElement('span'); dot.className = 'dot'; li.appendChild(dot); }

      const top = document.createElement('div'); top.className = 'mi-top';
      const from = document.createElement('div'); from.className = 'mi-from';
      if (showTo) from.textContent = (state.folder === 'DRAFT' ? 'Draft' : 'To') + ': ' + (displayNames(m.to) || '(no recipient)');
      else from.textContent = firstAddress(m.from).name || '(unknown sender)';
      top.appendChild(from);
      if (m.labelIds.includes('STARRED')) top.insertAdjacentHTML('beforeend', icon('i-star', 'mi-star'));
      const time = document.createElement('div'); time.className = 'mi-time'; time.textContent = formatListDate(m.date);
      top.appendChild(time);

      const subj = document.createElement('div'); subj.className = 'mi-subject'; subj.textContent = m.subject || '(no subject)';
      const snip = document.createElement('div'); snip.className = 'mi-snippet'; snip.textContent = m.snippet;

      li.append(top, subj, snip);
      frag.appendChild(li);
    }
    ul.innerHTML = '';
    ul.appendChild(frag);
  }

  async function updateUnreadCount() {
    try {
      const label = await api('/labels/INBOX');
      const n = label.messagesUnread || 0;
      const badge = $('#inboxBadge');
      badge.textContent = n > 999 ? '999+' : String(n);
      badge.classList.toggle('hidden', n === 0);
      document.title = n ? `Mail (${n})` : 'Mail';
    } catch (e) { /* non-critical */ }
  }

  function refreshAll() {
    loadList({ silent: true });
    updateUnreadCount();
  }

  // ---------------------------------------------------------------- reader
  async function openMessage(id) {
    const row = state.items.find((x) => x.id === id);
    if (row && row.draftId) return openDraft(row);

    state.selectedId = id;
    $$('.message-item').forEach((li) => li.classList.toggle('selected', li.dataset.id === id));
    const view = $('#messageView');
    $('#readerEmpty').classList.add('hidden');
    $('#reader').classList.remove('empty');
    view.classList.remove('hidden');
    view.innerHTML = '<div class="reader-loading"><div class="spinner"></div></div>';
    $('#readerScroll').scrollTop = 0;
    const app = $('#app');
    if (!app.classList.contains('reading')) {
      app.classList.add('reading');
      if (isMobile()) history.pushState({ reader: true }, '');
    }

    try {
      const msg = await api('/messages/' + id + '?format=full');
      if (state.selectedId !== id) return;
      const m = parseMessage(msg);
      state.current = m;
      renderMessage(m);
      if (m.labelIds.includes('UNREAD')) {
        setLabels(m, [], ['UNREAD']).then(updateUnreadCount).catch(showError);
      }
    } catch (e) {
      if (state.selectedId === id) view.innerHTML = '<p class="muted">Could not open this email.</p>';
      showError(e);
    }
  }

  function renderMessage(m) {
    const view = $('#messageView');
    const from = firstAddress(m.from);
    const toMe = state.email && m.to.toLowerCase().includes(state.email.toLowerCase());
    const starred = m.labelIds.includes('STARRED');
    const toLabel = toMe ? 'to me' : 'to ' + (displayNames(m.to) || 'undisclosed recipients');

    view.innerHTML = `
      <h1 class="msg-subject"></h1>
      <div class="msg-head">
        <div class="avatar"></div>
        <div class="msg-meta">
          <div class="msg-from"></div>
          <button class="msg-to" data-action="toggle-details"><span></span>${icon('i-chevron')}</button>
        </div>
        <div class="msg-time"></div>
        <button class="icon-btn star-btn ${starred ? 'on' : ''}" data-action="star" aria-label="Star">${icon('i-star')}</button>
      </div>
      <div class="msg-details hidden"></div>
      <div class="msg-body"></div>
      <div class="msg-attach"></div>
      <div class="msg-actions">
        <button class="btn btn-ghost" data-action="reply">${icon('i-reply')}<span>Reply</span></button>
        <button class="btn btn-ghost" data-action="forward">${icon('i-forward')}<span>Forward</span></button>
      </div>`;
    view.querySelector('.msg-subject').textContent = m.subject || '(no subject)';
    view.querySelector('.avatar').textContent = initials(from.name || from.email);
    view.querySelector('.msg-from').textContent = from.name || from.email;
    view.querySelector('.msg-from').title = from.email;
    view.querySelector('.msg-to span').textContent = toLabel;
    view.querySelector('.msg-time').textContent = formatListDate(m.date);
    view.querySelector('.msg-time').title = formatFullDate(m.date);

    const details = view.querySelector('.msg-details');
    const rows = [['From', m.from], ['To', m.to], ['Cc', m.cc], ['Date', formatFullDate(m.date)]].filter((r) => r[1]);
    rows.forEach(([k, v]) => {
      const d = document.createElement('div');
      const b = document.createElement('b'); b.textContent = k + ': ';
      d.append(b, document.createTextNode(v));
      details.appendChild(d);
    });

    const bodyEl = view.querySelector('.msg-body');
    if (m.html) {
      const frame = document.createElement('iframe');
      frame.className = 'msg-frame';
      // No allow-scripts: email content can never run JavaScript.
      frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>html,body{margin:0;padding:0}body{display:flow-root}body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;word-wrap:break-word;overflow-wrap:anywhere}
        img{max-width:100%!important;height:auto!important}table{max-width:100%!important}pre{white-space:pre-wrap}a{color:#111}</style>
        </head><body>${m.html}</body></html>`;
      const fit = () => {
        try {
          const doc = frame.contentDocument;
          if (!doc || !doc.body) return;
          frame.style.height = Math.ceil(doc.body.getBoundingClientRect().height) + 'px';
        } catch {}
      };
      frame.addEventListener('load', () => {
        fit();
        try {
          new ResizeObserver(fit).observe(frame.contentDocument.body);
          frame.contentDocument.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit));
        } catch {}
      });
      bodyEl.appendChild(frame);
    } else {
      const div = document.createElement('div');
      div.className = 'msg-body-text';
      div.innerHTML = linkify(escapeHtml(m.text || m.snippet || ''));
      bodyEl.appendChild(div);
    }

    const attachEl = view.querySelector('.msg-attach');
    m.attachments.forEach((a) => {
      const chip = document.createElement('button');
      chip.className = 'attach-chip';
      chip.innerHTML = icon('i-clip');
      const name = document.createElement('span');
      name.textContent = a.filename + (a.size ? ` (${formatSize(a.size)})` : '');
      chip.appendChild(name);
      chip.onclick = () => downloadAttachment(m, a);
      attachEl.appendChild(chip);
    });

    // Trash view: offer restore instead of delete
    const inTrash = m.labelIds.includes('TRASH');
    $('[data-action="trash"]').setAttribute('aria-label', inTrash ? 'Restore' : 'Delete');
    $('[data-action="trash"]').innerHTML = icon(inTrash ? 'i-restore' : 'i-trash');
  }

  function formatSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  async function downloadAttachment(m, a) {
    try {
      let data = a.data;
      if (!data) {
        toast('Downloading ' + a.filename + '…');
        const res = await api(`/messages/${m.id}/attachments/${a.attachmentId}`);
        data = res.data;
      }
      const blob = new Blob([b64urlToBytes(data)], { type: a.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { showError(e); }
  }

  function closeReader(skipHistory) {
    const app = $('#app');
    const wasReading = app.classList.contains('reading');
    app.classList.remove('reading');
    state.selectedId = null;
    state.current = null;
    $$('.message-item.selected').forEach((li) => li.classList.remove('selected'));
    $('#messageView').classList.add('hidden');
    $('#messageView').innerHTML = '';
    $('#readerEmpty').classList.remove('hidden');
    $('#reader').classList.add('empty');
    if (wasReading && !skipHistory && isMobile() && history.state && history.state.reader) history.back();
  }

  function isMobile() { return window.matchMedia('(max-width: 800px)').matches; }

  async function setLabels(m, add, remove) {
    const res = await api(`/messages/${m.id}/modify`, { method: 'POST', body: { addLabelIds: add, removeLabelIds: remove } });
    const labels = res && res.labelIds ? res.labelIds : m.labelIds.filter((l) => !remove.includes(l)).concat(add);
    m.labelIds = labels;
    const row = state.items.find((x) => x.id === m.id);
    if (row) row.labelIds = labels;
    renderList();
    return labels;
  }

  async function toggleStar() {
    const m = state.current; if (!m) return;
    const on = m.labelIds.includes('STARRED');
    const btn = $('.star-btn');
    btn.classList.toggle('on', !on);
    try {
      await setLabels(m, on ? [] : ['STARRED'], on ? ['STARRED'] : []);
      if (state.folder === 'STARRED' && on) removeRow(m.id);
    } catch (e) { btn.classList.toggle('on', on); showError(e); }
  }

  async function markUnread() {
    const m = state.current; if (!m) return;
    try {
      await setLabels(m, ['UNREAD'], []);
      closeReader();
      updateUnreadCount();
      toast('Marked as unread');
    } catch (e) { showError(e); }
  }

  function removeRow(id) {
    state.items = state.items.filter((x) => x.id !== id);
    renderList();
    if (!state.items.length) $('#listStatus').textContent = 'No messages';
  }

  async function trashCurrent() {
    const m = state.current; if (!m) return;
    const inTrash = m.labelIds.includes('TRASH');
    try {
      await api(`/messages/${m.id}/${inTrash ? 'untrash' : 'trash'}`, { method: 'POST' });
      closeReader();
      removeRow(m.id);
      updateUnreadCount();
      if (inTrash) toast('Moved to Inbox');
      else toast('Moved to Trash', { label: 'Undo', fn: async () => {
        try { await api(`/messages/${m.id}/untrash`, { method: 'POST' }); refreshAll(); } catch (e) { showError(e); }
      } });
    } catch (e) { showError(e); }
  }

  async function archiveCurrent() {
    const m = state.current; if (!m) return;
    try {
      await setLabels(m, [], ['INBOX']);
      closeReader();
      if (state.folder === 'INBOX') removeRow(m.id);
      updateUnreadCount();
      toast('Archived');
    } catch (e) { showError(e); }
  }

  // ---------------------------------------------------------------- compose
  function openCompose(opts = {}) {
    state.compose = {
      draftId: opts.draftId || null,
      threadId: opts.threadId || null,
      inReplyTo: opts.inReplyTo || '',
      references: opts.references || '',
    };
    $('#composeTitle').textContent = opts.title || 'New message';
    $('#cTo').value = opts.to || '';
    $('#cCc').value = opts.cc || '';
    $('#ccRow').classList.toggle('hidden', !opts.cc);
    $('#cSubject').value = opts.subject || '';
    $('#cBody').value = opts.body || '';
    $('#sendBtn').disabled = false;
    $('#composeOverlay').classList.remove('hidden');
    setTimeout(() => {
      const target = !opts.to ? $('#cTo') : $('#cBody');
      target.focus();
      if (target === $('#cBody')) target.setSelectionRange(0, 0);
    }, 50);
  }

  function composeDirty() {
    return $('#cTo').value.trim() || $('#cSubject').value.trim() || $('#cBody').value.trim();
  }

  function closeCompose() {
    $('#composeOverlay').classList.add('hidden');
    state.compose = null;
  }

  function quote(m) {
    const who = m.from || 'someone';
    const text = plainTextOf(m).split('\n').map((l) => '> ' + l).join('\n');
    return `\n\nOn ${formatFullDate(m.date)}, ${who} wrote:\n${text}`;
  }

  function replyTo(m) {
    const fromMe = state.email && m.from.toLowerCase().includes(state.email.toLowerCase());
    const to = fromMe ? m.to : (m.replyTo || m.from);
    const subject = /^re:/i.test(m.subject) ? m.subject : 'Re: ' + (m.subject || '');
    openCompose({
      title: 'Reply',
      to,
      subject,
      body: quote(m),
      threadId: m.threadId,
      inReplyTo: m.messageId,
      references: [m.references, m.messageId].filter(Boolean).join(' '),
    });
  }

  function forward(m) {
    const subject = /^fwd?:/i.test(m.subject) ? m.subject : 'Fwd: ' + (m.subject || '');
    const body = `\n\n---------- Forwarded message ---------\nFrom: ${m.from}\nDate: ${formatFullDate(m.date)}\nSubject: ${m.subject}\nTo: ${m.to}\n\n${plainTextOf(m)}`;
    openCompose({ title: 'Forward', subject, body });
  }

  async function openDraft(row) {
    try {
      const msg = await api('/messages/' + row.id + '?format=full');
      const m = parseMessage(msg);
      openCompose({
        title: 'Edit draft',
        draftId: row.draftId,
        threadId: m.threadId,
        to: m.to, cc: m.cc, subject: m.subject,
        body: plainTextOf(m),
        inReplyTo: header(msg.payload.headers, 'In-Reply-To'),
        references: m.references,
      });
    } catch (e) { showError(e); }
  }

  function buildRaw() {
    const c = state.compose || {};
    const to = $('#cTo').value.trim();
    const cc = $('#cCc').value.trim();
    const subject = $('#cSubject').value;
    const body = $('#cBody').value.replace(/\r?\n/g, '\r\n');
    const lines = [];
    if (to) lines.push('To: ' + to);
    if (cc) lines.push('Cc: ' + cc);
    lines.push('Subject: ' + encodeHeader(subject));
    if (c.inReplyTo) lines.push('In-Reply-To: ' + c.inReplyTo);
    if (c.references) lines.push('References: ' + c.references);
    lines.push('MIME-Version: 1.0');
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    const encodedBody = bytesToB64(utf8(body)).replace(/.{76}/g, '$&\r\n');
    const raw = lines.join('\r\n') + '\r\n\r\n' + encodedBody;
    const message = { raw: toB64Url(raw) };
    if (c.threadId) message.threadId = c.threadId;
    return message;
  }

  async function send(e) {
    e.preventDefault();
    const to = $('#cTo').value.trim();
    if (!to) { $('#cTo').focus(); return; }
    const btn = $('#sendBtn');
    btn.disabled = true;
    try {
      const message = buildRaw();
      const c = state.compose || {};
      if (c.draftId) {
        await api('/drafts/' + c.draftId, { method: 'PUT', body: { id: c.draftId, message } });
        await api('/drafts/send', { method: 'POST', body: { id: c.draftId } });
      } else {
        await api('/messages/send', { method: 'POST', body: message });
      }
      const wasDraft = !!c.draftId;
      closeCompose();
      toast('Message sent');
      if (state.folder === 'SENT' || (wasDraft && state.folder === 'DRAFT')) loadList({ silent: true });
    } catch (err) {
      btn.disabled = false;
      showError(err);
    }
  }

  async function saveDraft() {
    if (!composeDirty()) { closeCompose(); return; }
    try {
      const message = buildRaw();
      const c = state.compose || {};
      if (c.draftId) await api('/drafts/' + c.draftId, { method: 'PUT', body: { id: c.draftId, message } });
      else await api('/drafts', { method: 'POST', body: { message } });
      closeCompose();
      toast('Draft saved');
      if (state.folder === 'DRAFT') loadList({ silent: true });
    } catch (e) { showError(e); }
  }

  async function discardCompose() {
    const c = state.compose || {};
    if (c.draftId) {
      if (!confirm('Delete this draft?')) return;
      try {
        await api('/drafts/' + c.draftId, { method: 'DELETE' });
        if (state.folder === 'DRAFT') loadList({ silent: true });
      } catch (e) { showError(e); return; }
    } else if (composeDirty() && !confirm('Discard this message?')) return;
    closeCompose();
  }

  function requestCloseCompose() {
    if (composeDirty()) {
      openSheet([
        { label: 'Save draft', icon: 'i-file', fn: saveDraft },
        { label: 'Discard', icon: 'i-trash', danger: true, fn: () => { closeCompose(); } },
        { label: 'Keep editing', icon: 'i-pencil', fn: () => {} },
      ], 'Close this message?');
    } else closeCompose();
  }

  // ---------------------------------------------------------------- menus & settings
  function openSheet(items, title) {
    const sheet = $('#sheet');
    sheet.innerHTML = '';
    if (title) { const t = document.createElement('div'); t.className = 'sheet-title'; t.textContent = title; sheet.appendChild(t); }
    items.forEach((it) => {
      if (it === '-') { sheet.appendChild(document.createElement('hr')); return; }
      const b = document.createElement('button');
      if (it.danger) b.className = 'danger';
      b.innerHTML = icon(it.icon);
      const s = document.createElement('span'); s.textContent = it.label; b.appendChild(s);
      b.onclick = () => { closeSheet(); it.fn(); };
      sheet.appendChild(b);
    });
    $('#sheetOverlay').classList.remove('hidden');
  }

  function closeSheet() { $('#sheetOverlay').classList.add('hidden'); }

  function openMainMenu() {
    openSheet([
      { label: 'Refresh', icon: 'i-refresh', fn: () => { loadList(); updateUnreadCount(); } },
      { label: 'Inbox', icon: 'i-inbox', fn: () => selectFolder('INBOX') },
      { label: 'Trash', icon: 'i-trash', fn: () => selectFolder('TRASH') },
      '-',
      { label: 'Settings', icon: 'i-settings', fn: openSettings },
      { label: 'Sign out', icon: 'i-logout', danger: true, fn: signOut },
    ]);
  }

  function openReaderMenu() {
    const m = state.current; if (!m) return;
    const items = [
      { label: 'Reply', icon: 'i-reply', fn: () => replyTo(m) },
      { label: 'Forward', icon: 'i-forward', fn: () => forward(m) },
    ];
    if (m.labelIds.includes('INBOX')) items.push({ label: 'Archive', icon: 'i-archive', fn: archiveCurrent });
    items.push({ label: m.labelIds.includes('STARRED') ? 'Remove star' : 'Star', icon: 'i-star', fn: toggleStar });
    openSheet(items);
  }

  function openSettings() {
    $('#settingsEmail').textContent = state.email || '—';
    $('#settingsClientId').value = getClientId();
    $('#settingsOverlay').classList.remove('hidden');
  }

  function closeOverlays() {
    closeSheet();
    $('#settingsOverlay').classList.add('hidden');
    $('#composeOverlay').classList.add('hidden');
  }

  // ---------------------------------------------------------------- events
  function bindEvents() {
    $('#signInBtn').addEventListener('click', () => signIn(store.get(LS.email) ? '' : 'select_account'));
    $('#switchAccountBtn').addEventListener('click', () => { store.del(LS.email); signIn('select_account'); });
    $('#clientIdInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn('select_account'); });

    document.addEventListener('click', (e) => {
      const folderBtn = e.target.closest('[data-folder]');
      if (folderBtn) { selectFolder(folderBtn.dataset.folder); return; }
      const item = e.target.closest('.message-item');
      if (item) { openMessage(item.dataset.id); return; }
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const m = state.current;
      switch (actionEl.dataset.action) {
        case 'compose': openCompose(); break;
        case 'menu': openMainMenu(); break;
        case 'settings': openSettings(); break;
        case 'back': closeReader(); break;
        case 'trash': trashCurrent(); break;
        case 'unread': markUnread(); break;
        case 'reader-menu': openReaderMenu(); break;
        case 'star': toggleStar(); break;
        case 'reply': if (m) replyTo(m); break;
        case 'forward': if (m) forward(m); break;
        case 'toggle-details': $('.msg-details').classList.toggle('hidden'); break;
        case 'close-compose': requestCloseCompose(); break;
        case 'save-draft': saveDraft(); break;
        case 'discard': discardCompose(); break;
        case 'close-settings': $('#settingsOverlay').classList.add('hidden'); break;
        case 'signout': signOut(); break;
        case 'save-client-id': {
          const v = $('#settingsClientId').value.trim();
          if (v) { store.set(LS.clientId, v); tokenClient = null; if (window.google && google.accounts) initTokenClient(); toast('Client ID saved'); }
          break;
        }
      }
    });

    $('#messageList').addEventListener('keydown', (e) => {
      const item = e.target.closest('.message-item');
      if (item && e.key === 'Enter') openMessage(item.dataset.id);
    });

    $('#loadMoreBtn').addEventListener('click', () => loadList({ append: true }));

    let searchTimer = null;
    $('#searchInput').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = e.target.value.trim();
        state.nextPageToken = null;
        closeReader(true);
        loadList();
      }, 400);
    });

    $('#composeForm').addEventListener('submit', send);
    $('#ccToggle').addEventListener('click', () => { $('#ccRow').classList.toggle('hidden'); $('#cCc').focus(); });
    $('#composeOverlay').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('#composeForm').requestSubmit();
    });

    $('#sheetOverlay').addEventListener('click', (e) => { if (e.target.id === 'sheetOverlay') closeSheet(); });
    $('#settingsOverlay').addEventListener('click', (e) => { if (e.target.id === 'settingsOverlay') $('#settingsOverlay').classList.add('hidden'); });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#sheetOverlay').classList.contains('hidden')) return closeSheet();
      if (!$('#settingsOverlay').classList.contains('hidden')) return $('#settingsOverlay').classList.add('hidden');
      if (!$('#composeOverlay').classList.contains('hidden')) return requestCloseCompose();
      if (state.current) closeReader();
    });

    window.addEventListener('popstate', () => {
      if ($('#app').classList.contains('reading')) closeReader(true);
    });

    setInterval(() => {
      if (document.visibilityState !== 'visible' || !tokenValid() || $('#app').classList.contains('hidden')) return;
      if (state.folder === 'INBOX' && !state.query) loadList({ silent: true });
      updateUnreadCount();
    }, REFRESH_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && tokenValid() && !$('#app').classList.contains('hidden')) refreshAll();
    });
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    bindEvents();
    const minSplash = new Promise((r) => setTimeout(r, 900));

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    let gisError = null;
    try { await waitForGis(); if (getClientId()) initTokenClient(); }
    catch (e) { gisError = e; }

    if (!gisError && loadSavedToken()) {
      try {
        await minSplash;
        await startApp();
        return;
      } catch (e) {
        if (!(e instanceof AuthError)) console.error(e);
        clearToken();
        reauthShown = false;
        $('#toast').classList.add('hidden');
      }
    }

    await minSplash;
    showScreen('login');
    setupLoginScreen(gisError ? gisError.message : '');
    hideSplash();
  }

  boot();
})();

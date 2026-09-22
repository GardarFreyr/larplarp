// Google sign-in (Google Identity Services token flow) and the Gmail REST API.
import { store } from './store.js';
import { parseMessage, asciiToB64Url, b64urlToBytes } from './mime.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const UPLOAD = 'https://gmail.googleapis.com/upload/gmail/v1/users/me';
export const SCOPES = 'https://www.googleapis.com/auth/gmail.modify';
const META = 'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date';

export class AuthError extends Error {}
export class NetworkError extends Error {}

const session = { email: null, token: null, exp: 0 };
let onAuthExpired = () => {};
export function setAuthExpiredHandler(fn) { onAuthExpired = fn; }
export const currentEmail = () => session.email;

// ---------------------------------------------------------------- sign-in

export function waitForGis(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new NetworkError('Could not reach Google sign-in. Check your connection.'));
      setTimeout(check, 80);
    })();
  });
}

let tokenClient = null;
let tokenClientId = null;

function getTokenClient() {
  const clientId = store.getClientId();
  if (!clientId) throw new Error('Add your Google OAuth Client ID first.');
  if (!tokenClient || tokenClientId !== clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPES, callback: () => {} });
    tokenClientId = clientId;
  }
  return tokenClient;
}

/** Opens Google's consent/account popup. Must be called from a user gesture. */
function requestToken({ prompt = '', hint } = {}) {
  return new Promise((resolve, reject) => {
    const client = getTokenClient();
    client.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPES)) {
        return reject(new Error('Allow access to Gmail so the app can read and send your email.'));
      }
      resolve({ token: resp.access_token, exp: Date.now() + ((Number(resp.expires_in) || 3600) - 60) * 1000 });
    };
    client.error_callback = (err) => reject(new Error(
      err?.type === 'popup_closed' ? 'Sign-in was cancelled.' :
      err?.type === 'popup_failed_to_open' ? 'Allow pop-ups for this site to sign in.' :
      err?.message || 'Sign-in failed.'));
    const opts = { prompt };
    if (hint) opts.hint = hint;
    client.requestAccessToken(opts);
  });
}

async function adopt(token, exp) {
  session.token = token;
  session.exp = exp;
  const profile = await api('/profile');
  session.email = profile.emailAddress;
  store.saveToken(session.email, token, exp);
  store.setCurrent(session.email);
  return profile;
}

/** Sign in (or add another account when `newAccount` is true). */
export async function signIn({ email, newAccount = false } = {}) {
  await waitForGis();
  const t = await requestToken({ prompt: newAccount || !email ? 'select_account' : '', hint: newAccount ? undefined : email });
  return adopt(t.token, t.exp);
}

/** Use a still-valid saved token without any UI. Returns false if the user must sign in. */
export async function resumeSession(email) {
  const saved = email && store.tokenFor(email);
  if (!saved) return false;
  session.email = email;
  session.token = saved.token;
  session.exp = saved.exp;
  try {
    await api('/profile');
    return true;
  } catch (e) {
    if (e instanceof NetworkError) return true; // offline: continue with cached data
    return false;
  }
}

export function tokenValid() { return !!session.token && Date.now() < session.exp; }

export function signOut({ revoke = false } = {}) {
  const { token, email } = session;
  if (revoke && token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  if (email) store.clearToken(email);
  session.token = null; session.exp = 0; session.email = null;
}

// ---------------------------------------------------------------- transport

async function request(url, { method = 'GET', body, headers = {} } = {}) {
  if (!tokenValid()) { onAuthExpired(); throw new AuthError('Your session expired.'); }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + session.token, ...headers },
      body,
    });
  } catch {
    throw new NetworkError('No connection');
  }
  if (res.status === 401) {
    store.clearToken(session.email);
    session.token = null;
    onAuthExpired();
    throw new AuthError('Your session expired.');
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j.error?.message) msg = j.error.message; } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function api(path, { method, json } = {}) {
  return request(API + path, {
    method,
    body: json ? JSON.stringify(json) : undefined,
    headers: json ? { 'Content-Type': 'application/json' } : {},
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); }
      catch (e) { if (e instanceof AuthError || e instanceof NetworkError) throw e; out[idx] = null; }
    }
  }));
  return out;
}

// ---------------------------------------------------------------- reading

export const profile = () => api('/profile');
export const inboxLabel = () => api('/labels/INBOX');

/**
 * List messages. `spec` is { labelIds?, q?, drafts?, includeSpamTrash? }.
 * Returns { rows, nextPageToken }.
 */
export async function list(spec, { pageToken, pageSize = 30 } = {}) {
  const params = new URLSearchParams({ maxResults: pageSize });
  if (spec.q) params.set('q', spec.q);
  if (pageToken) params.set('pageToken', pageToken);
  let refs, next;
  if (spec.drafts) {
    const res = await api('/drafts?' + params);
    refs = (res.drafts || []).map((d) => ({ id: d.message.id, draftId: d.id }));
    next = res.nextPageToken;
  } else {
    (spec.labelIds || []).forEach((l) => params.append('labelIds', l));
    if (spec.includeSpamTrash) params.set('includeSpamTrash', 'true');
    const res = await api('/messages?' + params);
    refs = (res.messages || []).map((m) => ({ id: m.id }));
    next = res.nextPageToken;
  }
  const msgs = await mapLimit(refs, 8, (r) => api(`/messages/${r.id}?${META}`));
  const rows = msgs.map((m, i) => (m ? parseMessage(m, refs[i].draftId ? { draftId: refs[i].draftId } : {}) : null)).filter(Boolean);
  return { rows, nextPageToken: next || null };
}

const fullCache = new Map();
export async function getFull(id) {
  if (fullCache.has(id)) return fullCache.get(id);
  const msg = parseMessage(await api(`/messages/${id}?format=full`), { full: true });
  fullCache.set(id, msg);
  if (fullCache.size > 60) fullCache.delete(fullCache.keys().next().value);
  return msg;
}
export const cachedFull = (id) => fullCache.get(id) || null;
export function updateCachedLabels(id, labelIds) {
  const m = fullCache.get(id);
  if (m) m.labelIds = labelIds;
}

export async function attachmentBytes(messageId, att) {
  let data = att.data;
  if (!data) data = (await api(`/messages/${messageId}/attachments/${att.attachmentId}`)).data;
  return b64urlToBytes(data);
}

// ---------------------------------------------------------------- changing

export async function modify(id, add = [], remove = []) {
  const res = await api(`/messages/${id}/modify`, { method: 'POST', json: { addLabelIds: add, removeLabelIds: remove } });
  if (res?.labelIds) updateCachedLabels(id, res.labelIds);
  return res?.labelIds || null;
}
export const batchModify = (ids, add = [], remove = []) =>
  api('/messages/batchModify', { method: 'POST', json: { ids, addLabelIds: add, removeLabelIds: remove } });
export const trash = (id) => api(`/messages/${id}/trash`, { method: 'POST' });
export const untrash = (id) => api(`/messages/${id}/untrash`, { method: 'POST' });
export const trashMany = (ids) => mapLimit(ids, 6, trash);
export const untrashMany = (ids) => mapLimit(ids, 6, untrash);

// ---------------------------------------------------------------- sending & drafts

const SMALL = 4.5 * 1024 * 1024;

/** Upload a raw MIME message. Small messages use JSON; large ones use the media upload endpoint. */
function sendMessage(path, raw, meta) {
  if (raw.length < SMALL) {
    return request(API + path, {
      method: meta.method || 'POST',
      body: JSON.stringify(meta.wrap({ raw: asciiToB64Url(raw), ...(meta.threadId ? { threadId: meta.threadId } : {}) })),
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const b = 'mail_upload_' + Date.now().toString(36);
  const metaJson = JSON.stringify(meta.wrap(meta.threadId ? { threadId: meta.threadId } : {}));
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n` +
    `--${b}\r\nContent-Type: message/rfc822\r\n\r\n${raw}\r\n--${b}--`;
  return request(UPLOAD + path + '?uploadType=multipart', {
    method: meta.method || 'POST',
    body,
    headers: { 'Content-Type': `multipart/related; boundary=${b}` },
  });
}

export const send = (raw, threadId) => sendMessage('/messages/send', raw, { threadId, wrap: (m) => m });
export const createDraft = (raw, threadId) => sendMessage('/drafts', raw, { threadId, wrap: (m) => ({ message: m }) });
export const updateDraft = (draftId, raw, threadId) =>
  sendMessage(`/drafts/${draftId}`, raw, { threadId, method: 'PUT', wrap: (m) => ({ id: draftId, message: m }) });
export const sendDraft = (draftId) => api('/drafts/send', { method: 'POST', json: { id: draftId } });
export const deleteDraft = (draftId) => api(`/drafts/${draftId}`, { method: 'DELETE' });
export async function getDraftMessage(draftId) {
  const d = await api(`/drafts/${draftId}?format=full`);
  return parseMessage(d.message, { full: true, draftId });
}

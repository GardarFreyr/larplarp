// In-memory Gmail API used by the end-to-end tests (served through Playwright routing).
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const H = 3600e3, D = 24 * H;

export const ME = 'me@gmail.com';

function seed(now) {
  const data = [
    { from: 'Alex Johnson <alex@example.com>', to: ME, cc: 'Sam Lee <sam@example.com>', subject: 'Project update', ago: 0.2 * H, unread: true,
      text: "Hi,\n\nHere's the latest on the project. Everything is on track and we're expecting to hit the next milestone next week.\n\nLet me know if you have any questions.\n\nBest,\nAlex",
      attach: { name: 'Project Plan.pdf', type: 'application/pdf', body: '%PDF-1.4 test' } },
    { from: 'Notion <team@notion.so>', to: ME, subject: 'Weekly digest', ago: 2 * H, unread: true, starred: true,
      html: '<h2>Weekly digest</h2><p>Hello <b>there</b>, here is <a href="https://notion.so">what\'s new</a>.</p><img src="x" onerror="parent.PWNED=1"><script>parent.PWNED=1</script>' },
    { from: 'Acme Co. <billing@acme.co>', to: ME, subject: 'Invoice #1042', ago: 1.5 * D, text: 'Attached is the invoice for last month.',
      attach: { name: 'invoice-1042.pdf', type: 'application/pdf', body: '%PDF-1.4 invoice' } },
    { from: 'Mom <mom@example.com>', to: ME, subject: 'Dinner this weekend?', ago: 1.6 * D, text: 'Are you free on Saturday?' },
    { from: 'Tom Smith <tom@example.com>', to: ME, subject: 'Re: Invoice', ago: 2.5 * D, text: 'Sounds good, thank you.' },
    { from: 'Airbnb <a@airbnb.com>', to: ME, subject: 'Your upcoming trip', ago: 2.6 * D, text: 'Find details about your reservation.' },
    { from: 'LinkedIn <l@linkedin.com>', to: ME, subject: 'You have 2 new messages', ago: 3.5 * D, text: 'See what people are saying.' },
    { from: 'Apple <no_reply@apple.com>', to: ME, subject: 'Your receipt', ago: 4.5 * D, text: 'Thanks for your purchase.' },
    { from: 'Old Newsletter <news@old.example>', to: ME, subject: 'Archived thing', ago: 20 * D, text: 'This one is archived.', archived: true },
    { from: `Me <${ME}>`, to: 'Julia Sørensen <julia@example.com>', subject: 'Re: Invoice', ago: 5 * D, text: 'I’ve updated the invoice accordingly.', sent: true },
  ];
  return data.map((d, i) => {
    const headers = [
      { name: 'From', value: d.from }, { name: 'To', value: d.to }, { name: 'Subject', value: d.subject },
      { name: 'Message-ID', value: `<id${i}@example.com>` },
      ...(d.cc ? [{ name: 'Cc', value: d.cc }] : []),
    ];
    const bodyPart = d.html ? { mimeType: 'text/html', body: { data: b64(d.html), size: d.html.length } } : { mimeType: 'text/plain', body: { data: b64(d.text), size: d.text.length } };
    const payload = d.attach
      ? { mimeType: 'multipart/mixed', headers, parts: [bodyPart, { mimeType: d.attach.type, filename: d.attach.name, headers: [], body: { attachmentId: 'att' + i, size: 2_400_000 } }] }
      : { ...bodyPart, headers };
    const labels = d.sent ? ['SENT'] : [...(d.archived ? [] : ['INBOX']), ...(d.unread ? ['UNREAD'] : []), ...(d.starred ? ['STARRED'] : [])];
    return { id: 'm' + i, threadId: 't' + i, internalDate: String(now - d.ago), labelIds: labels, snippet: (d.text || 'Weekly digest').slice(0, 60), payload, _attach: d.attach };
  });
}

export function createMock() {
  const db = { messages: seed(Date.now()), drafts: [], sent: [], calls: [], offline: false, failSend: false, emptyInbox: false };

  function matches(m, q) {
    const hay = JSON.stringify(m.payload.headers).toLowerCase() + ' ' + m.snippet.toLowerCase();
    for (const tok of q.match(/\S+\([^)]*\)|\S+/g) || []) {
      if (tok === 'has:attachment') { if (!m._attach) return false; continue; }
      if (tok === 'is:unread') { if (!m.labelIds.includes('UNREAD')) return false; continue; }
      if (tok.startsWith('newer_than:')) continue;
      if (tok === '-in:inbox') { if (m.labelIds.includes('INBOX')) return false; continue; }
      if (tok.startsWith('-in:')) { const l = tok.slice(4).toUpperCase().replace('DRAFTS', 'DRAFT'); if (m.labelIds.includes(l)) return false; continue; }
      const from = tok.match(/^from:\((.*)\)$/);
      if (from) { if (!m.payload.headers.find((h) => h.name === 'From').value.toLowerCase().includes(from[1].toLowerCase())) return false; continue; }
      if (!hay.includes(tok.toLowerCase())) return false;
    }
    return true;
  }

  function meta(m) {
    return { id: m.id, threadId: m.threadId, labelIds: m.labelIds, snippet: m.snippet, internalDate: m.internalDate,
      payload: { mimeType: m.payload.mimeType, headers: m.payload.headers, parts: m.payload.parts?.map((p) => ({ mimeType: p.mimeType, filename: p.filename || '' })) } };
  }

  function draftMessage(d) {
    const raw = Buffer.from(d.raw, 'base64url').toString('utf8');
    const header = (n) => (raw.match(new RegExp(`^${n}: (.*)$`, 'mi')) || [])[1] || '';
    return { id: d.messageId, threadId: 'td' + d.id, labelIds: ['DRAFT'], snippet: 'Draft', internalDate: String(Date.now()),
      payload: { mimeType: 'text/plain', headers: [{ name: 'To', value: header('To') }, { name: 'Subject', value: header('Subject') }], body: { data: b64('draft body') } } };
  }

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/(upload\/)?gmail\/v1\/users\/me/, '');
    const method = req.method();
    db.calls.push({ method, path, query: url.search, body: req.postData() });
    if (db.offline) return route.abort('internetdisconnected');
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    const body = () => JSON.parse(req.postData() || '{}');
    let m;

    if (path === '/profile') return json({ emailAddress: ME, messagesTotal: db.messages.length, threadsTotal: db.messages.length });
    if (path === '/labels/INBOX') return json({ messagesUnread: db.messages.filter((x) => x.labelIds.includes('INBOX') && x.labelIds.includes('UNREAD')).length });
    if (path === '/messages' && method === 'GET') {
      const labels = url.searchParams.getAll('labelIds');
      const q = url.searchParams.get('q') || '';
      let list = db.messages.filter((x) => labels.every((l) => x.labelIds.includes(l)) && (!q || matches(x, q)));
      if (!labels.includes('TRASH')) list = list.filter((x) => !x.labelIds.includes('TRASH'));
      if (db.emptyInbox && labels.includes('INBOX')) list = [];
      return json({ messages: list.map((x) => ({ id: x.id, threadId: x.threadId })) });
    }
    if (path === '/messages/send') {
      if (db.failSend) return route.abort('internetdisconnected');
      db.sent.push(body());
      return json({ id: 'sent' + db.sent.length, threadId: body().threadId || 'tnew' });
    }
    if (path === '/messages/batchModify') {
      const b = body();
      b.ids.forEach((id) => { const x = db.messages.find((y) => y.id === id); x.labelIds = x.labelIds.filter((l) => !b.removeLabelIds.includes(l)).concat(b.addLabelIds); });
      return route.fulfill({ status: 204, body: '' });
    }
    if ((m = path.match(/^\/messages\/(\w+)\/modify$/))) {
      const x = db.messages.find((y) => y.id === m[1]); const b = body();
      x.labelIds = x.labelIds.filter((l) => !b.removeLabelIds.includes(l)).concat(b.addLabelIds.filter((l) => !x.labelIds.includes(l)));
      return json({ id: x.id, labelIds: x.labelIds });
    }
    if ((m = path.match(/^\/messages\/(\w+)\/(trash|untrash)$/))) {
      const x = db.messages.find((y) => y.id === m[1]);
      x.labelIds = m[2] === 'trash' ? ['TRASH'] : ['INBOX'];
      return json({ id: x.id, labelIds: x.labelIds });
    }
    if ((m = path.match(/^\/messages\/(\w+)\/attachments\/(\w+)$/))) {
      const x = db.messages.find((y) => y.id === m[1]);
      return json({ data: b64(x._attach.body), size: x._attach.body.length });
    }
    if ((m = path.match(/^\/messages\/(\w+)$/))) {
      const x = db.messages.find((y) => y.id === m[1]);
      if (!x) { const d = db.drafts.find((y) => y.messageId === m[1]); return d ? json(draftMessage(d)) : json({ error: { message: 'Not found' } }, 404); }
      return json(url.searchParams.get('format') === 'metadata' ? meta(x) : x);
    }
    if (path === '/drafts' && method === 'GET') return json({ drafts: db.drafts.map((d) => ({ id: d.id, message: { id: d.messageId } })) });
    if (path === '/drafts' && method === 'POST') {
      const d = { id: 'd' + (db.drafts.length + 1), messageId: 'dm' + (db.drafts.length + 1), raw: body().message.raw };
      db.drafts.push(d);
      return json({ id: d.id, message: { id: d.messageId, threadId: 'td' + d.id } });
    }
    if ((m = path.match(/^\/drafts\/(\w+)$/))) {
      const d = db.drafts.find((y) => y.id === m[1]);
      if (method === 'PUT') { d.raw = body().message.raw; return json({ id: d.id, message: { id: d.messageId } }); }
      if (method === 'DELETE') { db.drafts = db.drafts.filter((y) => y !== d); return route.fulfill({ status: 204, body: '' }); }
      return json({ id: d.id, message: draftMessage(d) });
    }
    return json({ error: { message: 'Unhandled ' + method + ' ' + path } }, 404);
  }

  return { db, handle };
}

export const GIS_STUB = `
window.google = { accounts: { oauth2: {
  initTokenClient(c) {
    const tc = { callback: c.callback, requestAccessToken() { setTimeout(() => tc.callback({ access_token: 'tok', expires_in: 3600, scope: c.scope }), 30); } };
    return tc;
  },
  hasGrantedAllScopes() { return true; },
  revoke(t, cb) { cb && cb(); },
} } };`;

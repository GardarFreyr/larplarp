// App shell cache (network-first so updates arrive immediately) and notification clicks.
// Gmail data is never cached here.
const CACHE = 'mail-shell-v2';
const SHELL = [
  './', 'index.html', 'config.js', 'privacy.html', 'manifest.webmanifest',
  'css/tokens.css', 'css/base.css', 'css/components.css', 'css/layout.css',
  'js/main.js', 'js/state.js', 'js/store.js', 'js/format.js', 'js/mime.js', 'js/icons.js', 'js/gmail.js',
  'js/ui.js', 'js/swipe.js', 'js/actions.js', 'js/outbox.js', 'js/notify.js',
  'js/views/mailbox.js', 'js/views/reader.js', 'js/views/preview.js', 'js/views/composer.js',
  'js/views/recipients.js', 'js/views/search.js', 'js/views/settings.js', 'js/views/auth.js',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Tapping a new-mail notification opens that email.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  const target = new URL('./' + (id ? '#/m/' + encodeURIComponent(id) : ''), self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        if (id) w.postMessage({ type: 'open-message', id });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

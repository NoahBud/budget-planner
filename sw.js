/* Notre budget : garde l'appli (pas les données) en cache pour qu'elle s'ouvre vite, même avec un réseau faible.
   Les données passent toujours par Supabase. Changez VERSION à chaque mise en ligne d'une nouvelle version. */
const VERSION = 'nb-2026-10-23c';
const SHELL = ['./', 'index.html', 'budget.html', 'commun.html', 'config.js', 'app/app.js', 'app/login.js', 'app/style.css', 'app/supabase.js', 'app/qrcode.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase : jamais en cache
  // Réseau d'abord (pour avoir la dernière version), cache si hors ligne.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});

/* Notre budget : garde l'appli (pas les données) en cache pour qu'elle s'ouvre vite, même avec un réseau faible.
   Les données passent toujours par Supabase. Changez VERSION à chaque mise en ligne d'une nouvelle version :
   les appareils la récupèrent et l'appli se recharge toute seule. */
const VERSION = 'nb-2026-10-24b';
const SHELL = ['./', 'index.html', 'budget.html', 'commun.html', 'config.js', 'app/app.js', 'app/login.js', 'app/style.css', 'app/supabase.js', 'app/qrcode.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon.svg'];

self.addEventListener('install', e => {
  // cache: 'reload' : on télécharge vraiment les fichiers, sans reprendre une copie gardée par le navigateur
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// GitHub Pages autorise les navigateurs à garder les fichiers 10 minutes : « no-cache » leur fait toujours
// demander au serveur si le fichier a changé (réponse très légère s'il n'a pas changé).
const fresh = req => fetch(req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' }));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase : jamais en cache
  // Réseau d'abord (pour avoir la dernière version), cache si hors ligne.
  e.respondWith(
    fresh(e.request).then(res => {
      if (res.redirected && e.request.mode === 'navigate') return Response.redirect(res.url, 302);
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});

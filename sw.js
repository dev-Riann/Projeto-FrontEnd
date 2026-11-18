// Service worker do Tasky: guarda as telas para abrir rápido e funcionar sem internet.
// Ao publicar mudanças no site, aumente o número da versão abaixo.
const VERSAO = 'tasky-v1';
const ARQUIVOS = [
  './', './inicial.html', './dashboard.html',
  './src/css/style-inicial.css', './src/css/style-dashboard.css',
  './src/javascript/script.js', './src/javascript/firebase-config.js',
  './imagens/favicon.ico', './imagens/icon-192.png', './imagens/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Só arquivos do próprio site: tenta a rede primeiro (pega atualizações) e cai no cache se estiver offline.
// Firebase, fontes e CDNs passam direto, sem interferência.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copia = res.clone(); caches.open(VERSAO).then(c => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./inicial.html')))
  );
});

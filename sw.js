// Service worker: deixa o app abrir mesmo sem internet.
// Arquivos do app: tenta a rede primeiro (para pegar atualizações) e usa o cache se estiver offline.
const CACHE = "cuidados-v3";
const ARQUIVOS = [
  "./", "./index.html", "./app.js", "./store.js", "./config.js", "./styles.css",
  "./manifest.webmanifest", "./icon-192.png", "./apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// ---------- Avisos (notificações enviadas pelo vigia) ----------
self.addEventListener("push", (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { notification: { body: e.data && e.data.text() } }; }
  const n = p.notification || p.data || {};
  const titulo = n.title || "Cuidados da Vó";
  e.waitUntil(self.registration.showNotification(titulo, {
    body: n.body || "",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: n.tag || undefined,
    data: { url: (p.data && p.data.url) || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of abertas) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow(e.notification.data?.url || "./");
  })());
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // Biblioteca do Firebase (versão fixa): cache primeiro
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
      const copia = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia));
      return resp;
    })));
    return;
  }

  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

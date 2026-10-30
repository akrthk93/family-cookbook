// Offline support. App shell is cache-first; the recipe list is network-first
// so new recipes show up as soon as you're online; fonts are cached on first use.
const VERSION = "__VERSION__";
const SHELL = `shell-${VERSION}`;
const DATA = "data";
const FONTS = "fonts";
const SHELL_FILES = ["./", "./index.html", "./plan.js", "./kitchen.js", "./manifest.webmanifest", "./icon.svg", "./apple-touch-icon.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("shell-") && k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith("/kitchen.json")) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put("kitchen.json", copy)); }
        return res;
      }).catch(() => caches.open(DATA).then(c => c.match("kitchen.json")))
    );
    return;
  }
  if (url.pathname.endsWith("/recipes.json")) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put("recipes.json", copy)); }
        return res;
      }).catch(() => caches.open(DATA).then(c => c.match("recipes.json")))
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).catch(() =>
      req.mode === "navigate" ? caches.match("./index.html") : undefined))
  );
});

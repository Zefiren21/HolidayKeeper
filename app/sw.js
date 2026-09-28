// Offline support. Network first, so a new version shows up as soon as you're online;
// falls back to the last copy saved on the phone when there's no connection.

const CACHE = "holidaykeeper-v1";
const SHELL = [
  "./", "index.html", "share.html", "styles.css", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png",
  "js/app.js", "js/calendar-view.js", "js/core.js", "js/importers.js", "js/render-image.js", "js/share.js",
  "js/share-page.js", "js/store.js", "js/ui.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || (request.mode === "navigate" ? caches.match("index.html") : Response.error()))),
  );
});

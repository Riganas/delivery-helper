const CACHE = "delivery-helper-v25-2";

const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=25-2",
  "./app.js?v=25-2",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_ASSETS))
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") {
    return;
  }

  const url =
    new URL(event.request.url);

  const sameOrigin =
    url.origin ===
    self.location.origin;

  // App files: network first so new GitHub releases appear quickly.
  if (sameOrigin) {
    event.respondWith(
      fetch(
        event.request,
        { cache: "no-store" }
      )
        .then(response => {
          const copy =
            response.clone();

          caches.open(CACHE)
            .then(cache =>
              cache.put(
                event.request,
                copy
              )
            );

          return response;
        })
        .catch(() =>
          caches.match(
            event.request
          )
        )
    );

    return;
  }

  // External map/library assets: normal network with cache fallback.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy =
          response.clone();

        caches.open(CACHE)
          .then(cache =>
            cache.put(
              event.request,
              copy
            )
          );

        return response;
      })
      .catch(() =>
        caches.match(
          event.request
        )
      )
  );
});

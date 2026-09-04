// Service worker — the reason an installed MuhdGaming opens instantly
// instead of waiting on the network every single launch.
//
// Before this existed, tapping the Home Screen icon meant re-fetching three
// Firebase scripts from Google's CDN, the Google Fonts stylesheet, and this
// site's own CSS/JS over whatever signal the phone happened to have. On a
// weak connection there was nothing cached to fall back on, so the app just
// sat there — which is exactly what the "stuck on loading" reports looked
// like.
//
// Deliberately narrow: it caches the app's *shell* (its own static files
// and the third-party libraries it boots from), and never touches Firestore
// data. Live data stays live — every game, vote and session still comes
// straight from the network, so nothing here can serve a stale crew list.

// Bump this whenever the cached shell needs to be rebuilt from scratch.
// Old caches are deleted on activate, so a bump is the clean way to evict
// everything at once.
const CACHE = 'muhdgaming-shell-v1';

// The app's own files. Everything here is same-origin and versionless, so
// each is handled stale-while-revalidate below: served from cache instantly,
// refreshed in the background for next time.
const SHELL = [
  './',
  './index.html',
  './games.html',
  './game.html',
  './watchlist.html',
  './calendar.html',
  './crew.html',
  './changelog.html',
  './profile.html',
  './assets/styles.css',
  './assets/app.js',
  './assets/hero.js',
  './assets/changelog.js',
  './assets/img/mascot-logo-nav.png',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// Third-party origins worth caching: the Firebase SDK (pinned to an exact
// version in every page's script tags, so a cached copy can't drift) and
// the font files. Google's *stylesheet* is deliberately included too — it's
// small and it blocks rendering, so a cache hit is the difference between
// text appearing now and text appearing after a round trip.
const CACHEABLE_HOSTS = [
  'https://www.gstatic.com/firebasejs/',
  'https://fonts.googleapis.com/',
  'https://fonts.gstatic.com/',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // addAll fails the whole install if any single file 404s, which would
    // leave the app with no cache at all. Each file is added on its own so
    // one bad path can't take the rest down with it.
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function isCacheable(url) {
  if (url.origin === self.location.origin) return true;
  return CACHEABLE_HOSTS.some((prefix) => url.href.startsWith(prefix));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything that isn't the shell — every Firestore and Firebase Auth call,
  // the Steam worker, Steam's own images — goes straight to the network,
  // untouched. Live data must never come out of a cache.
  if (!isCacheable(url)) return;

  // Stale-while-revalidate: answer from cache immediately when there is a
  // copy, and refresh it in the background regardless. The tradeoff, stated
  // plainly: after deploying a change, the first launch still shows the
  // previous version and the one after it is current. That's the price of
  // an instant cold start, and pull-to-refresh gives a way to hurry it
  // along. Bumping CACHE above forces everyone onto a new copy at once.
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            // Opaque cross-origin responses (status 0) can't be inspected,
            // and an error page is not worth persisting over a good copy.
            if (response && response.status === 200) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached); // offline: the cached copy is the answer

        return cached || network;
      })
    )
  );
});

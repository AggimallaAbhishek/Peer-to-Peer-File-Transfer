// A version for your cache. Change this whenever you update the assets.
const CACHE_NAME = 'directdrop-v1';

// A list of all the essential files your app needs to load offline.
const URLS_TO_CACHE = [
  '/',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://placehold.co/192x192/4f46e5/ffffff?text=DD',
  'https://placehold.co/512x512/4f46e5/ffffff?text=DD'
];

// Event listener for when the service worker is installed.
self.addEventListener('install', (event) => {
  // waitUntil() ensures the service worker doesn't install until the code inside has finished.
  event.waitUntil(
    // Open the cache.
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        // Add all the specified URLs to the cache.
        return cache.addAll(URLS_TO_CACHE);
      })
  );
});

// Event listener for when the service worker is activated.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Get all the cache names.
    caches.keys().then((cacheNames) => {
      return Promise.all(
        // Filter out and delete any old caches that don't match the current CACHE_NAME.
        cacheNames.filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      );
    })
  );
});

// Event listener for every network request.
self.addEventListener('fetch', (event) => {
  // respondWith() hijacks the request and lets us control the response.
  event.respondWith(
    // Try to find a matching response in the cache first.
    caches.match(event.request)
      .then((response) => {
        // If a cached response is found, return it.
        if (response) {
          return response;
        }
        // If not found in cache, fetch it from the network.
        return fetch(event.request);
      })
  );
});

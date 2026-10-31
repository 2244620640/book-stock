/*!
 * 仓储图书库存 · Service Worker
 * 策略：同源资源 stale-while-revalidate，保证弱网/断网也能打开；跨域请求（云端同步）直接放行不缓存。
 */
var CACHE = 'bookstock-v2';
var ASSETS = [
  './index.html',
  './shop.html',
  './manifest.webmanifest',
  './assets/app.css',
  './assets/shop.css',
  './assets/store.js',
  './assets/cloud.js',
  './assets/app.js',
  './assets/shop.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS).catch(function () { /* 个别资源缺失不影响安装 */ });
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') { return; }
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) { return; }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return hit || caches.match('./index.html');
      });
      return hit || network;
    })
  );
});

/*!
 * 仓储图书库存 · Service Worker
 * 策略：同源资源 stale-while-revalidate，保证弱网/断网也能打开；跨域请求（云端同步）直接放行不缓存。
 */
var CACHE = 'bookstock-v24';
var ASSETS = [
  './index.html',
  './shop.html',
  './manifest.webmanifest',
  './assets/app.css?v=20261101y',
  './assets/shop.css?v=20261101y',
  './assets/store.js?v=20261101y',
  './assets/cloud.js?v=20261101y',
  './assets/app.js?v=20261101y',
  './assets/shop.js?v=20261101y',
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

  // 配置和上架快照必须拿最新的，不能走缓存
  if (/\/config\.json$|\/catalog\.json$/.test(url.pathname)) {
    e.respondWith(fetch(req).catch(function () { return caches.match(req); }));
    return;
  }

  // 页面本身走「网络优先」：改了代码，刷新就能拿到新版；断网时退回缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

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

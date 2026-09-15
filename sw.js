/**
 * Service Worker：让「添加到主屏幕」之后的游戏能离线打开。
 *
 * 策略：
 *   - 安装时预缓存整个应用外壳（预缓存失败的文件不影响安装）；
 *   - 导航请求走「网络优先」，保证一联网就能拿到新版本；
 *   - 其它静态资源走「stale-while-revalidate」：先用缓存秒开，后台再更新。
 *
 * 注意：新增文件时记得加进 SHELL；原生壳（Capacitor）里不会注册本文件。
 */
const VERSION = 'plane-td-v2';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/main.js',
  './src/config.js',
  './src/utils.js',
  './src/levels.js',
  './src/audio.js',
  './src/entities.js',
  './src/game.js',
  './src/render.js',
  './src/ui.js',
  './src/input.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-64.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // 逐个添加：个别文件缺失不应该让整个 SW 安装失败
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，离线时回退到缓存的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 静态资源：先给缓存，再后台更新
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

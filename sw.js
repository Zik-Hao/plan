// Service worker для офлайн-работы приложения.
// Стратегия: при установке заранее кладём в кэш все свои файлы и (по возможности)
// внешние библиотеки; во время работы — «кэш, а если нет, то сеть», и всё удачно
// загруженное само добавляется в кэш, включая шрифты и сторонние CDN-скрипты.
// После первого успешного запуска онлайн приложение полностью работает офлайн.

const CACHE_NAME = "travel-planner-v3";

// Собственные файлы приложения — обязательны для офлайн-запуска.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/registry.js",
  "./js/storage.js",
  "./js/pdf-font.js",
  "./js/pdf-export.js",
  "./js/app.js",
  "./js/vendor/pdf.min.mjs",
  "./js/vendor/pdf.worker.min.mjs",
  "./js/cities/manifest.json",
  "./js/cities/spb.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Внешние библиотеки и шрифты, которые желательно закэшировать сразу,
// чтобы экспорт в PDF и иконки/шрифты работали офлайн без предварительного
// использования. Если какой-то ресурс недоступен (нет сети при установке),
// это не должно ломать установку — просто попробуем закэшировать его позже,
// при первом успешном онлайн-запросе (см. обработчик fetch ниже).
const THIRD_PARTY_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      // Best-effort: сторонние ресурсы кэшируем по отдельности, чтобы сбой
      // загрузки одного (например, офлайн-установка) не сорвал всю установку.
      await Promise.allSettled(
        THIRD_PARTY_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { mode: "cors" });
            if (response && response.ok) await cache.put(url, response);
          } catch (e) {
            // Нет сети при установке — ничего страшного, догрузим при первом онлайн-визите.
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Запросы к самому Chrome DevTools и т.п. пропускаем.
  if (!event.request.url.startsWith("http")) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // Кэшируем любой успешно загруженный GET-ответ — как свои файлы,
          // так и сторонние (шрифты Google Fonts, скрипты с CDN) — чтобы после
          // первого онлайн-запуска всё это было доступно офлайн.
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});

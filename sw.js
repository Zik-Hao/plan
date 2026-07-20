// Service worker для офлайн-работы приложения.
// Стратегия — «stale-while-revalidate»: отвечаем из кэша сразу (мгновенно,
// работает офлайн), а параллельно в фоне идём в сеть и обновляем кэш свежей
// версией на СЛЕДУЮЩИЙ раз. Так новый город или правки в коде подтягиваются
// уже при следующем открытии приложения, а не зависают в кэше навсегда.

const CACHE_NAME = "travel-planner-v5";

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
  "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap",
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
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
  // Запросы к самому браузеру/расширениям и т.п. пропускаем.
  if (!event.request.url.startsWith("http")) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);

      // Идём в сеть в любом случае — если получилось, кладём свежий ответ
      // в кэш для следующего открытия приложения.
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => null);

      // Не даём браузеру «убить» воркер, пока фоновое обновление кэша не завершится,
      // даже если мы уже ответили пользователю из кэша ниже.
      event.waitUntil(networkFetch);

      if (cached) {
        // Отдаём то, что уже есть, не дожидаясь сети — быстро и работает офлайн.
        return cached;
      }

      // В кэше пока ничего нет — ждём сеть один раз (например, самый первый запуск).
      const fromNetwork = await networkFetch;
      return fromNetwork || new Response("Нет соединения, и этот файл ещё не сохранён офлайн.", {
        status: 503,
        statusText: "Offline"
      });
    })
  );
});

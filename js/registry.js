// Реестр городов + автозагрузка файлов из js/cities/.
//
// Как добавить новый город без правки index.html:
//   1) Скопируйте js/cities/spb.js в js/cities/<ваш-город>.js и заполните данными
//      (внутри файл вызывает registerCity({...}) — именно так город регистрируется).
//   2) Добавьте имя файла в список js/cities/manifest.json, например:
//      ["spb.js", "kazan.js"]
// Файл подхватится автоматически при следующей загрузке страницы.

window.CITIES_REGISTRY = window.CITIES_REGISTRY || {};

function registerCity(city) {
  if (!city || !city.id) return;
  window.CITIES_REGISTRY[city.id] = city;
}

function loadCityScript(src) {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve(true);
    s.onerror = () => {
      console.warn("Не удалось загрузить файл города:", src);
      resolve(false);
    };
    document.head.appendChild(s);
  });
}

// Промис, который резолвится, когда все города из манифеста загружены
// (или не удалось их загрузить — приложение всё равно продолжит работу).
// Экраны, которым нужен список городов, должны сначала дождаться его:
//   await window.citiesReady;
window.citiesReady = (async function loadAllCities() {
  try {
    const res = await fetch("js/cities/manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error("manifest.json недоступен (код " + res.status + ")");
    const files = await res.json();
    if (!Array.isArray(files)) throw new Error("manifest.json должен содержать список имён файлов");
    await Promise.all(files.map((name) => loadCityScript("js/cities/" + name)));
  } catch (e) {
    // Частый случай — страница открыта напрямую двойным кликом (file://),
    // без локального веб-сервера: fetch локальных файлов там заблокирован браузером.
    console.warn("Не удалось загрузить список городов из manifest.json:", e.message || e);
  }
})();

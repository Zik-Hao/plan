// Вся работа с localStorage сосредоточена здесь.
// Ключи:
//   tp_routes            — массив сохранённых маршрутов
//   tp_custom_city_ids    — массив id городов, добавленных пользователем
//   tp_city:<cityId>      — данные конкретного города (категории + места),
//                           материализуются один раз из реестра, дальше редактируются

// icon — имя иконки из шрифта Material Symbols (Google), см. js/icons.js
const DEFAULT_CATEGORIES = [
  { id: "museums", name: "Музеи", icon: "museum" },
  { id: "architecture", name: "Архитектура", icon: "account_balance" },
  { id: "parks", name: "Парки", icon: "park" },
  { id: "viewpoints", name: "Смотровые площадки", icon: "visibility" },
  { id: "restaurants", name: "Рестораны", icon: "restaurant" },
  { id: "cafes", name: "Кафе", icon: "local_cafe" },
  { id: "suburbs", name: "Пригороды", icon: "train" },
  { id: "shopping", name: "Магазины", icon: "shopping_bag" },
  { id: "custom", name: "Другое", icon: "push_pin" }
];

function uid(prefix) {
  const rnd = Math.random().toString(36).slice(2, 9);
  const t = Date.now().toString(36);
  return (prefix ? prefix + "-" : "") + t + rnd;
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error("Ошибка чтения хранилища", key, e);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error("Ошибка записи хранилища", key, e);
    return false;
  }
}

const Storage = {
  // ---------- Города и места ----------
  listCities() {
    const builtInIds = Object.keys(window.CITIES_REGISTRY || {});
    const customIds = readJSON("tp_custom_city_ids", []);
    const ids = [...builtInIds, ...customIds];
    return ids.map((id) => this.getCity(id)).filter(Boolean);
  },

  getCity(cityId) {
    const saved = readJSON("tp_city:" + cityId, null);
    if (saved) return saved;

    const base = window.CITIES_REGISTRY && window.CITIES_REGISTRY[cityId];
    if (!base) return null;

    // Материализуем встроенный город в localStorage при первом обращении,
    // чтобы дальнейшие правки не трогали исходный файл города.
    const materialized = JSON.parse(JSON.stringify(base));
    writeJSON("tp_city:" + cityId, materialized);
    return materialized;
  },

  saveCity(city) {
    writeJSON("tp_city:" + city.id, city);
  },

  addCustomCity(name) {
    const id = uid("city");
    const city = {
      id,
      name: name.trim(),
      emoji: "🧭",
      cover: "linear-gradient(135deg, #2b3a55 0%, #3f6f76 55%, #5fb3a3 100%)",
      categories: DEFAULT_CATEGORIES.filter((c) => c.id !== "custom").map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        places: []
      })).concat([{ id: "custom", name: "Другое", icon: "📌", places: [] }])
    };
    this.saveCity(city);
    const customIds = readJSON("tp_custom_city_ids", []);
    customIds.push(id);
    writeJSON("tp_custom_city_ids", customIds);
    return city;
  },

  isCustomCity(cityId) {
    return readJSON("tp_custom_city_ids", []).includes(cityId);
  },

  addCategory(cityId, name, icon) {
    const city = this.getCity(cityId);
    if (!city) return null;
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const category = { id: uid("cat"), name: trimmed, icon: icon || "category", places: [] };
    city.categories.push(category);
    this.saveCity(city);
    return category;
  },

  addPlace(cityId, categoryId, place) {
    const city = this.getCity(cityId);
    if (!city) return null;
    let category = city.categories.find((c) => c.id === categoryId);
    if (!category) {
      const def = DEFAULT_CATEGORIES.find((c) => c.id === categoryId) || DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1];
      category = { id: def.id, name: def.name, icon: def.icon, places: [] };
      city.categories.push(category);
    }
    const newPlace = Object.assign(
      { id: uid("place"), name: "", description: "", hours: "", price: "", mapLink: "", officialSite: "", note: "" },
      place
    );
    category.places.push(newPlace);
    this.saveCity(city);
    return newPlace;
  },

  updatePlace(cityId, placeId, patch) {
    const city = this.getCity(cityId);
    if (!city) return null;
    for (const category of city.categories) {
      const place = category.places.find((p) => p.id === placeId);
      if (place) {
        Object.assign(place, patch);
        this.saveCity(city);
        return place;
      }
    }
    return null;
  },

  deletePlace(cityId, placeId) {
    const city = this.getCity(cityId);
    if (!city) return;
    for (const category of city.categories) {
      const idx = category.places.findIndex((p) => p.id === placeId);
      if (idx !== -1) {
        category.places.splice(idx, 1);
        this.saveCity(city);
        return;
      }
    }
  },

  findPlace(cityId, placeId) {
    const city = this.getCity(cityId);
    if (!city) return null;
    for (const category of city.categories) {
      const place = category.places.find((p) => p.id === placeId);
      if (place) return { place, category };
    }
    return null;
  },

  // ---------- Маршруты ----------
  listRoutes() {
    return readJSON("tp_routes", []);
  },

  getRoute(routeId) {
    return this.listRoutes().find((r) => r.id === routeId) || null;
  },

  saveRoute(route) {
    const routes = this.listRoutes();
    const idx = routes.findIndex((r) => r.id === route.id);
    route.updatedAt = Date.now();
    if (idx === -1) {
      routes.push(route);
    } else {
      routes[idx] = route;
    }
    writeJSON("tp_routes", routes);
    return route;
  },

  deleteRoute(routeId) {
    const routes = this.listRoutes().filter((r) => r.id !== routeId);
    writeJSON("tp_routes", routes);
  },

  createRoute(cityId, cityName, name) {
    const route = {
      id: uid("route"),
      cityId,
      cityName,
      name: name || (cityName + " — новая поездка"),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      days: []
    };
    this.saveRoute(route);
    return route;
  }
};

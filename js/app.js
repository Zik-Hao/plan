"use strict";

// ---------------------------------------------------------------------------
// Общее состояние приложения
// ---------------------------------------------------------------------------
let screenStack = ["screen-home"];
let currentRoute = null;
let activeDayId = null;
let placeCtx = null; // { mode: 'view'|'edit'|'create', cityId, placeId, defaultCategoryId }
let customItemCtx = null; // { dayId, itemId }
let pickedPlaceForItem = null; // { placeId, categoryId, name }
let itemModalMode = "existing";

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function iconSpan(name, extraClass) {
  return `<span class="material-symbols-outlined ${extraClass || ""}">${name}</span>`;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------------------------------------------------------------------------
// Навигация между экранами
// ---------------------------------------------------------------------------
function showScreenEl(id) {
  $all(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function goTo(id) {
  screenStack.push(id);
  showScreenEl(id);
}

async function goBack() {
  if (screenStack.length > 1) {
    screenStack.pop();
    const prev = screenStack[screenStack.length - 1];
    if (prev === "screen-my-routes") renderMyRoutes();
    if (prev === "screen-city-select") await renderCitySelect();
    showScreenEl(prev);
  }
}

function goHome() {
  screenStack = ["screen-home"];
  showScreenEl("screen-home");
}

// ---------------------------------------------------------------------------
// Модалки
// ---------------------------------------------------------------------------
function openModal(id) {
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}
function closeAllModals() {
  $all(".modal-overlay").forEach((m) => m.classList.remove("open"));
}

// ---------------------------------------------------------------------------
// Главный экран / список моих маршрутов
// ---------------------------------------------------------------------------
function renderMyRoutes() {
  const routes = Storage.listRoutes().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const list = document.getElementById("routes-list");
  const empty = document.getElementById("routes-empty");

  if (routes.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = routes.map((r) => {
    const dayCount = (r.days || []).length;
    const placeCount = (r.days || []).reduce((sum, d) => sum + (d.items || []).length, 0);
    return `
      <div class="route-row" data-route-id="${r.id}">
        <div class="route-row-main">
          <div class="route-row-title">${escapeHtml(r.name)}</div>
          <div class="route-row-sub">${escapeHtml(r.cityName)} · ${dayCount} дн. · ${placeCount} мест</div>
        </div>
        <button class="icon-btn route-delete" data-route-delete="${r.id}" title="Удалить">${iconSpan("delete")}</button>
      </div>`;
  }).join("");

  $all(".route-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-route-delete]")) return;
      openRoute(row.dataset.routeId);
    });
  });
  $all("[data-route-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("Удалить этот маршрут без возможности восстановления?")) {
        Storage.deleteRoute(btn.dataset.routeDelete);
        renderMyRoutes();
        toast("Маршрут удалён");
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Выбор города
// ---------------------------------------------------------------------------
async function renderCitySelect() {
  await window.citiesReady;
  const cities = Storage.listCities();
  const grid = document.getElementById("city-grid");
  grid.innerHTML = cities.map((c, i) => `
    <div class="city-card city-card-tone-${i % 6}" data-city-id="${c.id}">
      <span class="city-card-emoji">${c.emoji || "🧭"}</span>
      <span class="city-card-name">${escapeHtml(c.name)}</span>
    </div>
  `).join("") + `
    <div class="city-card city-card-add" id="city-card-add">
      <span class="material-symbols-outlined" style="font-size:32px">add</span>
      <span class="city-card-name">Добавить свой город</span>
    </div>
  `;

  $all(".city-card[data-city-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const city = Storage.getCity(card.dataset.cityId);
      const route = Storage.createRoute(city.id, city.name);
      openRoute(route.id);
    });
  });
  document.getElementById("city-card-add").addEventListener("click", () => {
    document.getElementById("input-city-name").value = "";
    openModal("modal-add-city");
  });
}

document.getElementById("btn-confirm-add-city").addEventListener("click", () => {
  const name = document.getElementById("input-city-name").value.trim();
  if (!name) { toast("Введите название города"); return; }
  const city = Storage.addCustomCity(name);
  closeModal("modal-add-city");
  const route = Storage.createRoute(city.id, city.name);
  openRoute(route.id);
});

// ---------------------------------------------------------------------------
// Открытие маршрута → экран планировщика
// ---------------------------------------------------------------------------
async function openRoute(routeId) {
  await window.citiesReady;
  currentRoute = Storage.getRoute(routeId);
  if (!currentRoute) { toast("Маршрут не найден"); return; }

  // Если города нет в хранилище (например, импортирован на новом устройстве) — создаём заглушку.
  if (!Storage.getCity(currentRoute.cityId)) {
    const stub = {
      id: currentRoute.cityId,
      name: currentRoute.cityName || "Импортированный город",
      emoji: "🧭",
      cover: "linear-gradient(135deg,#2b3a55,#5fb3a3)",
      categories: DEFAULT_CATEGORIES.map((c) => ({ id: c.id, name: c.name, icon: c.icon, places: [] }))
    };
    Storage.saveCity(stub);
    const ids = JSON.parse(localStorage.getItem("tp_custom_city_ids") || "[]");
    ids.push(stub.id);
    localStorage.setItem("tp_custom_city_ids", JSON.stringify(ids));
  }

  activeDayId = currentRoute.days.length ? currentRoute.days[0].id : null;
  document.getElementById("route-name-input").value = currentRoute.name;
  placesSearchQuery = "";
  placesCategoryFilter = null;
  document.getElementById("places-search").value = "";
  switchTab("tab-planner");
  renderPlanner();
  renderPlacesTab();
  goTo("screen-planner");
}

document.getElementById("route-name-input").addEventListener("blur", (e) => {
  if (!currentRoute) return;
  currentRoute.name = e.target.value.trim() || currentRoute.name;
  Storage.saveRoute(currentRoute);
});

document.getElementById("btn-export-pdf").addEventListener("click", async () => {
  if (!currentRoute) return;
  closeExportMenu();
  try {
    await exportRouteToPDF(currentRoute);
    toast("PDF сохранён");
  } catch (e) {
    console.error(e);
    toast("Не удалось экспортировать PDF");
  }
});

document.getElementById("btn-export-json").addEventListener("click", () => {
  if (!currentRoute) return;
  closeExportMenu();
  try {
    exportRouteToJSON(currentRoute);
    toast("Файл маршрута сохранён");
  } catch (e) {
    console.error(e);
    toast("Не удалось сохранить файл");
  }
});

// ---- Меню «⋮» (экспорт) ----
function closeExportMenu() { document.getElementById("export-menu").classList.remove("open"); }
document.getElementById("btn-more-menu").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("export-menu").classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu-wrap")) closeExportMenu();
});

// ---- Экспорт / импорт в виде обычного файла (JSON) ----
function exportRouteToJSON(route) {
  const blob = new Blob([JSON.stringify(route, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const fileName = (route.name || "route").replace(/[^\p{L}\p{N}_\- ]/gu, "").trim() || "route";
  a.download = fileName + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importRouteFromJSONFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("Файл повреждён или это не JSON с маршрутом");
  }
  if (!data || typeof data !== "object" || !data.cityId || !Array.isArray(data.days)) {
    throw new Error("В файле нет данных маршрута в ожидаемом формате");
  }
  data.id = uid("route");
  data.updatedAt = Date.now();
  return data;
}

// ---------------------------------------------------------------------------
// Вкладки
// ---------------------------------------------------------------------------
function switchTab(tabId) {
  $all(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
  $all(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === tabId));
}
$all(".tab-btn").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

// ---------------------------------------------------------------------------
// Планировщик: дни и пункты
// ---------------------------------------------------------------------------
function sortedDays() {
  return (currentRoute.days || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

function renderPlanner() {
  const days = sortedDays();
  const list = document.getElementById("days-list");
  const empty = document.getElementById("days-empty");
  const select = document.getElementById("active-day-select");

  empty.hidden = days.length > 0;
  list.hidden = days.length === 0;

  select.innerHTML = days.map((d, i) => `<option value="${d.id}">День ${i + 1} — ${ruDate(d.date)}</option>`).join("");
  if (activeDayId && days.some((d) => d.id === activeDayId)) {
    select.value = activeDayId;
  } else if (days.length) {
    activeDayId = days[0].id;
    select.value = activeDayId;
  }

  list.innerHTML = days.map((day, idx) => renderDayCardHtml(day, idx)).join("");

  $all(".day-card").forEach((card) => {
    const dayId = card.dataset.dayId;
    card.querySelector(".day-header").addEventListener("click", (e) => {
      if (e.target.closest("[data-day-action]")) return;
      const day = currentRoute.days.find((d) => d.id === dayId);
      day.expanded = !day.expanded;
      activeDayId = dayId;
      document.getElementById("active-day-select").value = dayId;
      Storage.saveRoute(currentRoute);
      renderPlanner();
    });
    card.querySelectorAll("[data-day-action='edit']").forEach((btn) =>
      btn.addEventListener("click", (e) => { e.stopPropagation(); openEditDay(dayId); })
    );
    card.querySelectorAll("[data-day-action='delete']").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("Удалить этот день вместе со всеми пунктами?")) {
          currentRoute.days = currentRoute.days.filter((d) => d.id !== dayId);
          Storage.saveRoute(currentRoute);
          if (activeDayId === dayId) activeDayId = currentRoute.days[0] ? currentRoute.days[0].id : null;
          renderPlanner();
        }
      })
    );
    card.querySelectorAll("[data-day-action='add-item']").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        activeDayId = dayId;
        document.getElementById("active-day-select").value = dayId;
        openAddItemModal();
      })
    );
    card.querySelectorAll(".item-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest("[data-item-delete]") || e.target.closest("[data-item-edit]")) return;
        openItemPlaceCard(dayId, row.dataset.itemId);
      });
    });
    card.querySelectorAll("[data-item-edit]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openItemDetail(dayId, btn.dataset.itemEdit);
      })
    );
    card.querySelectorAll("[data-item-delete]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("Удалить этот пункт из плана?")) {
          const day = currentRoute.days.find((d) => d.id === dayId);
          day.items = day.items.filter((it) => it.id !== btn.dataset.itemDelete);
          Storage.saveRoute(currentRoute);
          renderPlanner();
        }
      })
    );
  });
}

function renderDayCardHtml(day, idx) {
  const items = (day.items || []).slice().sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const itemsHtml = items.map((it) => `
    <div class="item-row" data-item-id="${it.id}">
      <span class="item-time">${escapeHtml(it.time || "--:--")}</span>
      <div class="item-body">
        <span class="item-title">${escapeHtml(it.title || "Без названия")}</span>
        ${it.note ? `<span class="item-note">${escapeHtml(it.note)}</span>` : ""}
      </div>
      <button class="icon-btn item-edit-btn" data-item-edit="${it.id}" title="Изменить время и заметку">${iconSpan("edit")}</button>
      <button class="icon-btn item-delete-btn" data-item-delete="${it.id}" title="Удалить">${iconSpan("close")}</button>
    </div>
  `).join("") || `<div class="day-empty-note">В этот день пока ничего не запланировано</div>`;

  return `
    <div class="day-card ${day.expanded ? "expanded" : ""}" data-day-id="${day.id}">
      <div class="day-header">
        <span class="day-chevron">${iconSpan("expand_more")}</span>
        <div class="day-header-text">
          <span class="day-title">День ${idx + 1}</span>
          <span class="day-date">${ruDate(day.date)}</span>
        </div>
        <span class="day-count-badge">${(day.items || []).length}</span>
        <button class="icon-btn" data-day-action="edit" title="Изменить дату">${iconSpan("edit_calendar")}</button>
        <button class="icon-btn" data-day-action="delete" title="Удалить день">${iconSpan("delete")}</button>
      </div>
      <div class="day-body">
        ${itemsHtml}
        <button class="btn btn-outline btn-sm day-add-item-btn" data-day-action="add-item">${iconSpan("add")} Добавить место</button>
      </div>
    </div>
  `;
}

// ---- Добавление / редактирование дня ----
let editingDayId = null;
document.getElementById("btn-add-day").addEventListener("click", () => {
  editingDayId = null;
  document.getElementById("input-day-date").value = "";
  openModal("modal-add-day");
});
function openEditDay(dayId) {
  editingDayId = dayId;
  const day = currentRoute.days.find((d) => d.id === dayId);
  document.getElementById("input-day-date").value = day.date || "";
  openModal("modal-add-day");
}
document.getElementById("btn-confirm-add-day").addEventListener("click", () => {
  const date = document.getElementById("input-day-date").value;
  if (!date) { toast("Выберите дату"); return; }
  if (editingDayId) {
    const day = currentRoute.days.find((d) => d.id === editingDayId);
    day.date = date;
  } else {
    const day = { id: uid("day"), date, expanded: true, items: [] };
    currentRoute.days.push(day);
    activeDayId = day.id;
  }
  Storage.saveRoute(currentRoute);
  closeModal("modal-add-day");
  renderPlanner();
});

document.getElementById("active-day-select").addEventListener("change", (e) => {
  activeDayId = e.target.value;
});

// ---- Добавление пункта в план ----
document.getElementById("btn-add-item").addEventListener("click", () => {
  if (!activeDayId) { toast("Сначала добавьте день"); return; }
  openAddItemModal();
});

function openAddItemModal() {
  pickedPlaceForItem = null;
  document.getElementById("picked-place-preview").hidden = true;
  document.getElementById("input-custom-title").value = "";
  document.getElementById("input-item-time").value = "";
  document.getElementById("input-item-note").value = "";
  setItemMode("existing");
  populateCustomCategorySelect();
  openModal("modal-add-item");
}

function setItemMode(mode) {
  itemModalMode = mode;
  $all(".segmented-btn").forEach((b) => b.classList.toggle("active", b.dataset.itemMode === mode));
  document.getElementById("item-mode-existing").hidden = mode !== "existing";
  document.getElementById("item-mode-custom").hidden = mode !== "custom";
}
$all(".segmented-btn").forEach((b) => b.addEventListener("click", () => setItemMode(b.dataset.itemMode)));

function populateCustomCategorySelect() {
  const city = Storage.getCity(currentRoute.cityId);
  const sel = document.getElementById("input-custom-category");
  sel.innerHTML = city.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
}

document.getElementById("btn-pick-place").addEventListener("click", () => openPlacePicker());

document.getElementById("btn-confirm-add-item").addEventListener("click", () => {
  const day = currentRoute.days.find((d) => d.id === activeDayId);
  if (!day) { toast("Сначала добавьте день"); return; }
  const time = document.getElementById("input-item-time").value;
  const note = document.getElementById("input-item-note").value.trim();

  let item;
  if (itemModalMode === "existing") {
    if (!pickedPlaceForItem) { toast("Выберите место из базы"); return; }
    item = {
      id: uid("item"),
      time, note,
      title: pickedPlaceForItem.name,
      categoryId: pickedPlaceForItem.categoryId,
      placeId: pickedPlaceForItem.placeId
    };
  } else {
    const title = document.getElementById("input-custom-title").value.trim();
    if (!title) { toast("Введите название"); return; }
    item = {
      id: uid("item"),
      time, note, title,
      categoryId: document.getElementById("input-custom-category").value,
      placeId: null
    };
  }
  day.items.push(item);
  Storage.saveRoute(currentRoute);
  closeModal("modal-add-item");
  renderPlanner();
  toast("Добавлено в план");
});

// ---------------------------------------------------------------------------
// Выбор места из базы (пикер)
// ---------------------------------------------------------------------------
function openPlacePicker() {
  renderPickerList("");
  document.getElementById("picker-search").value = "";
  openModal("modal-place-picker");
}
document.getElementById("picker-search").addEventListener("input", (e) => renderPickerList(e.target.value));

function renderPickerList(query) {
  const city = Storage.getCity(currentRoute.cityId);
  const q = query.trim().toLowerCase();
  const list = document.getElementById("picker-list");
  let html = "";
  city.categories.forEach((cat) => {
    const places = cat.places.filter((p) => !q || (p.name + " " + p.description).toLowerCase().includes(q));
    if (places.length === 0) return;
    html += `<div class="picker-category-label">${iconSpan(cat.icon)} ${escapeHtml(cat.name)}</div>`;
    html += places.map((p) => `
      <div class="picker-row" data-place-id="${p.id}" data-category-id="${cat.id}" data-name="${escapeHtml(p.name)}">
        <span class="picker-row-name">${escapeHtml(p.name)}</span>
        <span class="picker-row-hours">${escapeHtml(p.hours || "")}</span>
      </div>
    `).join("");
  });
  list.innerHTML = html || `<div class="empty-state-inline">Ничего не найдено</div>`;
  $all(".picker-row").forEach((row) => {
    row.addEventListener("click", () => {
      pickedPlaceForItem = { placeId: row.dataset.placeId, categoryId: row.dataset.categoryId, name: row.dataset.name };
      const preview = document.getElementById("picked-place-preview");
      preview.hidden = false;
      preview.textContent = "Выбрано: " + row.dataset.name;
      closeModal("modal-place-picker");
    });
  });
}

// ---------------------------------------------------------------------------
// Детали пункта плана (клик по строке в дне)
// ---------------------------------------------------------------------------
// Клик по самому пункту плана — открыть карточку места (если он на него ссылается).
// Для «своих» пунктов без привязки к базе карточки нет — открываем редактор времени/заметки.
function openItemPlaceCard(dayId, itemId) {
  const day = currentRoute.days.find((d) => d.id === dayId);
  const item = day.items.find((it) => it.id === itemId);
  const found = item.placeId ? Storage.findPlace(currentRoute.cityId, item.placeId) : null;
  if (found) {
    openPlaceDetail(currentRoute.cityId, item.placeId);
  } else {
    openItemDetail(dayId, itemId);
  }
}

function openItemDetail(dayId, itemId) {
  const day = currentRoute.days.find((d) => d.id === dayId);
  const item = day.items.find((it) => it.id === itemId);

  const found = item.placeId ? Storage.findPlace(currentRoute.cityId, item.placeId) : null;
  customItemCtx = { dayId, itemId, placeId: found ? item.placeId : null };

  const placeInfo = document.getElementById("item-place-info");
  const titleField = document.getElementById("item-title-field");

  if (found) {
    // Пункт привязан к месту из базы: название синхронизировано с карточкой,
    // но время и заметку по-прежнему можно менять здесь же.
    placeInfo.hidden = false;
    document.getElementById("item-place-info-name").textContent = found.place.name;
    titleField.hidden = true;
  } else {
    // Свой пункт (или место, которое позже удалили из базы) — название редактируется вручную.
    placeInfo.hidden = true;
    titleField.hidden = false;
    document.getElementById("ci-title").value = item.title || "";
  }

  document.getElementById("ci-time").value = item.time || "";
  document.getElementById("ci-note").value = item.note || "";
  openModal("modal-custom-item");
}

document.getElementById("btn-open-place-from-item").addEventListener("click", () => {
  const cityId = currentRoute.cityId;
  const placeId = customItemCtx.placeId;
  closeModal("modal-custom-item");
  openPlaceDetail(cityId, placeId);
});

document.getElementById("btn-save-custom-item").addEventListener("click", () => {
  const day = currentRoute.days.find((d) => d.id === customItemCtx.dayId);
  const item = day.items.find((it) => it.id === customItemCtx.itemId);
  if (!customItemCtx.placeId) {
    const title = document.getElementById("ci-title").value.trim();
    if (!title) { toast("Введите название"); return; }
    item.title = title;
  }
  item.time = document.getElementById("ci-time").value;
  item.note = document.getElementById("ci-note").value.trim();
  Storage.saveRoute(currentRoute);
  closeModal("modal-custom-item");
  renderPlanner();
  toast("Изменения сохранены");
});
document.getElementById("btn-delete-custom-item").addEventListener("click", () => {
  if (!confirm("Удалить этот пункт?")) return;
  const day = currentRoute.days.find((d) => d.id === customItemCtx.dayId);
  day.items = day.items.filter((it) => it.id !== customItemCtx.itemId);
  Storage.saveRoute(currentRoute);
  closeModal("modal-custom-item");
  renderPlanner();
});

// ---------------------------------------------------------------------------
// Вкладка «Места»
// ---------------------------------------------------------------------------
let placesSearchQuery = "";
let placesCategoryFilter = null; // null = показывать все категории

function renderPlacesTab() {
  const city = Storage.getCity(currentRoute.cityId);
  renderPlacesCategoryFilter(city);

  const q = placesSearchQuery.trim().toLowerCase();
  const wrap = document.getElementById("places-categories");
  const categories = placesCategoryFilter
    ? city.categories.filter((c) => c.id === placesCategoryFilter)
    : city.categories;

  wrap.innerHTML = categories.map((cat) => {
    const places = cat.places.filter((p) => !q || (p.name + " " + p.description).toLowerCase().includes(q));
    if (places.length === 0) return "";
    return `
      <div class="places-category">
        <h3 class="places-category-title">${iconSpan(cat.icon)} ${escapeHtml(cat.name)}</h3>
        <div class="places-grid">
          ${places.map((p) => placeCardHtml(p, cat.id)).join("")}
        </div>
      </div>
    `;
  }).join("") || `<div class="empty-state-inline">Ничего не найдено</div>`;

  $all(".place-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-stop]")) return;
      openPlaceDetail(currentRoute.cityId, card.dataset.placeId);
    });
    card.querySelectorAll("[data-add-to-day]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!activeDayId) { toast("Сначала добавьте день в планировщик"); return; }
        const day = currentRoute.days.find((d) => d.id === activeDayId);
        const found = Storage.findPlace(currentRoute.cityId, card.dataset.placeId);
        if (!found) return;
        day.items.push({
          id: uid("item"), time: "", note: "",
          title: found.place.name, categoryId: found.category.id, placeId: found.place.id
        });
        Storage.saveRoute(currentRoute);
        renderPlanner();
        toast("Добавлено в план дня «" + (day.date ? ruDate(day.date) : "без даты") + "»");
      })
    );
  });
}

function renderPlacesCategoryFilter(city) {
  const wrap = document.getElementById("places-category-filter");
  const chips = [{ id: "", name: "Все", icon: "apps" }]
    .concat(city.categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon })));

  wrap.innerHTML = chips.map((c) => `
    <button class="filter-chip ${(!placesCategoryFilter && c.id === "") || placesCategoryFilter === c.id ? "active" : ""}" data-filter-cat="${c.id}">
      ${iconSpan(c.icon, "chip-icon")} ${escapeHtml(c.name)}
    </button>
  `).join("");

  wrap.querySelectorAll("[data-filter-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      placesCategoryFilter = btn.dataset.filterCat || null;
      renderPlacesTab();
    });
  });
}

function placeCardHtml(p, categoryId) {
  return `
    <div class="place-card" data-place-id="${p.id}" data-category-id="${categoryId}">
      <div class="place-card-name">${escapeHtml(p.name)}</div>
      <div class="place-card-desc">${escapeHtml(p.description || "")}</div>
      <div class="place-card-meta">
        ${p.hours ? `<span>${iconSpan("schedule")} ${escapeHtml(p.hours)}</span>` : ""}
        ${p.price ? `<span>${iconSpan("payments")} ${escapeHtml(p.price)}</span>` : ""}
      </div>
      <div class="place-card-actions">
        <button class="btn btn-accent btn-sm" data-add-to-day data-stop>${iconSpan("add")} В план</button>
      </div>
    </div>
  `;
}

document.getElementById("places-search").addEventListener("input", (e) => {
  placesSearchQuery = e.target.value;
  renderPlacesTab();
});

document.getElementById("btn-add-place").addEventListener("click", () => {
  openPlaceCreate(currentRoute.cityId);
});

// ---------------------------------------------------------------------------
// Модалка места: просмотр / редактирование / создание
// ---------------------------------------------------------------------------
function fillCategorySelect(selectEl, cityId, selectedId) {
  const city = Storage.getCity(cityId);
  selectEl.innerHTML = city.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  if (selectedId) selectEl.value = selectedId;
}

function openPlaceDetail(cityId, placeId) {
  const found = Storage.findPlace(cityId, placeId);
  if (!found) { toast("Место не найдено"); return; }
  placeCtx = { mode: "view", cityId, placeId };
  const { place } = found;

  document.getElementById("place-modal-title").textContent = place.name;
  document.getElementById("place-view-description").textContent = place.description || "Описание пока не добавлено.";
  document.getElementById("place-view-hours").textContent = place.hours || "—";
  document.getElementById("place-view-price").textContent = place.price || "—";
  const noteEl = document.getElementById("place-view-note");
  noteEl.textContent = place.note ? "📝 " + place.note : "";
  noteEl.hidden = !place.note;

  const mapEl = document.getElementById("place-view-map");
  mapEl.href = place.mapLink || mapLink(place.name);
  const siteEl = document.getElementById("place-view-site");
  if (place.officialSite) { siteEl.hidden = false; siteEl.href = place.officialSite; } else { siteEl.hidden = true; }

  document.getElementById("place-view-mode").hidden = false;
  document.getElementById("place-edit-mode").hidden = true;
  document.getElementById("btn-edit-place").hidden = false;
  document.getElementById("btn-save-place").hidden = true;
  document.getElementById("btn-delete-place").hidden = false;

  openModal("modal-place");
}

function openPlaceCreate(cityId, defaultCategoryId) {
  placeCtx = { mode: "create", cityId };
  document.getElementById("place-modal-title").textContent = "Новое место";
  document.getElementById("place-view-mode").hidden = true;
  document.getElementById("place-edit-mode").hidden = false;
  document.getElementById("btn-edit-place").hidden = true;
  document.getElementById("btn-save-place").hidden = false;
  document.getElementById("btn-delete-place").hidden = true;

  document.getElementById("edit-place-name").value = "";
  document.getElementById("edit-place-description").value = "";
  document.getElementById("edit-place-hours").value = "";
  document.getElementById("edit-place-price").value = "";
  document.getElementById("edit-place-map").value = "";
  document.getElementById("edit-place-site").value = "";
  document.getElementById("edit-place-note").value = "";
  const catSel = document.getElementById("edit-place-category");
  fillCategorySelect(catSel, cityId, defaultCategoryId);
  catSel.disabled = false;
  document.getElementById("new-category-row").hidden = false;
  document.getElementById("new-category-input-row").hidden = true;
  document.getElementById("input-new-category-name").value = "";

  openModal("modal-place");
}

document.getElementById("btn-edit-place").addEventListener("click", () => {
  const found = Storage.findPlace(placeCtx.cityId, placeCtx.placeId);
  if (!found) return;
  const { place, category } = found;
  placeCtx.mode = "edit";

  document.getElementById("edit-place-name").value = place.name || "";
  document.getElementById("edit-place-description").value = place.description || "";
  document.getElementById("edit-place-hours").value = place.hours || "";
  document.getElementById("edit-place-price").value = place.price || "";
  document.getElementById("edit-place-map").value = place.mapLink || "";
  document.getElementById("edit-place-site").value = place.officialSite || "";
  document.getElementById("edit-place-note").value = place.note || "";
  const catSel = document.getElementById("edit-place-category");
  fillCategorySelect(catSel, placeCtx.cityId, category.id);
  catSel.disabled = true; // смена категории при редактировании не поддерживается, чтобы не терять ссылки из плана
  document.getElementById("new-category-row").hidden = true;

  document.getElementById("place-view-mode").hidden = true;
  document.getElementById("place-edit-mode").hidden = false;
  document.getElementById("btn-edit-place").hidden = true;
  document.getElementById("btn-save-place").hidden = false;
});

document.getElementById("btn-toggle-new-category").addEventListener("click", () => {
  const row = document.getElementById("new-category-input-row");
  row.hidden = !row.hidden;
  if (!row.hidden) document.getElementById("input-new-category-name").focus();
});

document.getElementById("btn-confirm-new-category").addEventListener("click", () => {
  const name = document.getElementById("input-new-category-name").value.trim();
  if (!name) { toast("Введите название категории"); return; }
  const category = Storage.addCategory(placeCtx.cityId, name);
  if (!category) { toast("Не удалось создать категорию"); return; }
  const catSel = document.getElementById("edit-place-category");
  fillCategorySelect(catSel, placeCtx.cityId, category.id);
  document.getElementById("new-category-input-row").hidden = true;
  document.getElementById("input-new-category-name").value = "";
  toast("Категория «" + category.name + "» добавлена");
});

document.getElementById("btn-save-place").addEventListener("click", () => {
  const name = document.getElementById("edit-place-name").value.trim();
  if (!name) { toast("Введите название места"); return; }
  const patch = {
    name,
    description: document.getElementById("edit-place-description").value.trim(),
    hours: document.getElementById("edit-place-hours").value.trim(),
    price: document.getElementById("edit-place-price").value.trim(),
    mapLink: document.getElementById("edit-place-map").value.trim() || mapLink(name),
    officialSite: document.getElementById("edit-place-site").value.trim(),
    note: document.getElementById("edit-place-note").value.trim()
  };

  if (placeCtx.mode === "create") {
    const categoryId = document.getElementById("edit-place-category").value;
    Storage.addPlace(placeCtx.cityId, categoryId, patch);
    toast("Место добавлено");
  } else {
    Storage.updatePlace(placeCtx.cityId, placeCtx.placeId, patch);
    syncItemTitlesForPlace(placeCtx.placeId, name);
    toast("Изменения сохранены");
  }
  closeModal("modal-place");
  renderPlacesTab();
});

document.getElementById("btn-delete-place").addEventListener("click", () => {
  if (!confirm("Удалить это место из базы? Пункты плана, уже созданные на его основе, останутся с сохранённым названием.")) return;
  Storage.deletePlace(placeCtx.cityId, placeCtx.placeId);
  closeModal("modal-place");
  renderPlacesTab();
  toast("Место удалено");
});

// Если название места изменили — обновим отображаемый заголовок в уже добавленных пунктах плана.
function syncItemTitlesForPlace(placeId, newName) {
  if (!currentRoute) return;
  let changed = false;
  currentRoute.days.forEach((day) => {
    day.items.forEach((item) => {
      if (item.placeId === placeId) { item.title = newName; changed = true; }
    });
  });
  if (changed) Storage.saveRoute(currentRoute);
}

// ---------------------------------------------------------------------------
// Импорт / экспорт PDF из списка маршрутов
// ---------------------------------------------------------------------------
document.getElementById("btn-import-route").addEventListener("click", () => {
  document.getElementById("import-route-input").click();
});
document.getElementById("import-route-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const isJson = file.name.toLowerCase().endsWith(".json") || file.type === "application/json";
  try {
    const route = isJson ? await importRouteFromJSONFile(file) : await importRouteFromPDFFile(file);
    Storage.saveRoute(route);
    toast("Маршрут импортирован");
    openRoute(route.id);
  } catch (err) {
    console.error(err);
    toast(err.message || "Не удалось импортировать файл");
  }
});

// ---------------------------------------------------------------------------
// Общие обработчики: назад, закрытие модалок, стартовые кнопки
// ---------------------------------------------------------------------------
$all("[data-back]").forEach((b) => b.addEventListener("click", goBack));
$all("[data-close-modal]").forEach((b) => b.addEventListener("click", () => closeAllModals()));
$all(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeAllModals(); });
});

document.getElementById("btn-plan-route").addEventListener("click", async () => {
  await renderCitySelect();
  goTo("screen-city-select");
});
document.getElementById("btn-my-routes").addEventListener("click", () => {
  renderMyRoutes();
  goTo("screen-my-routes");
});
document.getElementById("btn-empty-plan").addEventListener("click", async () => {
  await renderCitySelect();
  goTo("screen-city-select");
});

// ---------------------------------------------------------------------------
// Service worker (PWA)
// ---------------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

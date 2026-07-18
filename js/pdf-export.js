// Экспорт маршрута в красиво оформленный PDF и обратный импорт.
// Хитрость: помимо человекочитаемого текста, весь маршрут в виде JSON
// сохраняется в служебном поле метаданных PDF (Keywords), закодированный в base64.
// Поэтому тот же файл можно impортировать обратно без потери структуры данных.

const PDF_DATA_PREFIX = "TPDATA1:";

function ruDate(iso) {
  if (!iso) return "Дата не указана";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

async function exportRouteToPDF(route) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  // jsPDF по умолчанию умеет только латиницу (стандартные PDF-шрифты вроде
  // helvetica не содержат кириллицу) — поэтому встраиваем шрифт с поддержкой
  // русского языка. Без этого в PDF вместо текста появляются «кракозябры».
  doc.addFileToVFS("DejaVuSans.ttf", PDF_FONT_REGULAR_BASE64);
  doc.addFont("DejaVuSans.ttf", "DejaVuSans", "normal");
  doc.addFileToVFS("DejaVuSans-Bold.ttf", PDF_FONT_BOLD_BASE64);
  doc.addFont("DejaVuSans-Bold.ttf", "DejaVuSans", "bold");

  const marginX = 48;
  let y = 64;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();

  function ensureSpace(h) {
    if (y + h > pageHeight - 56) {
      doc.addPage();
      y = 64;
    }
  }

  doc.setFont("DejaVuSans", "bold");
  doc.setFontSize(22);
  doc.setTextColor(20, 60, 62);
  doc.text(route.name || "Мой маршрут", marginX, y);
  y += 26;

  doc.setFont("DejaVuSans", "normal");
  doc.setFontSize(12);
  doc.setTextColor(90, 90, 90);
  doc.text("Город: " + (route.cityName || ""), marginX, y);
  y += 30;

  const days = (route.days || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  days.forEach((day, dayIdx) => {
    ensureSpace(40);
    doc.setDrawColor(220, 220, 220);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 20;

    doc.setFont("DejaVuSans", "bold");
    doc.setFontSize(14);
    doc.setTextColor(30, 100, 100);
    doc.text("День " + (dayIdx + 1) + " — " + ruDate(day.date), marginX, y);
    y += 20;

    const items = (day.items || []).slice().sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    if (items.length === 0) {
      doc.setFont("DejaVuSans", "normal");
      doc.setFontSize(11);
      doc.setTextColor(140, 140, 140);
      ensureSpace(18);
      doc.text("Пока ничего не запланировано", marginX + 10, y);
      y += 18;
    }

    items.forEach((item) => {
      ensureSpace(46);
      doc.setFont("DejaVuSans", "bold");
      doc.setFontSize(11);
      doc.setTextColor(20, 20, 20);
      const title = (item.time ? item.time + " · " : "") + (item.title || "Без названия");
      doc.text(title, marginX + 10, y);
      y += 15;

      if (item.note) {
        doc.setFont("DejaVuSans", "normal");
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        const lines = doc.splitTextToSize(item.note, pageWidth - marginX * 2 - 20);
        lines.forEach((line) => {
          ensureSpace(13);
          doc.text(line, marginX + 14, y);
          y += 13;
        });
      }
      y += 8;
    });
    y += 6;
  });

  // Служебная страница с данными маршрута для последующего импорта.
  const payload = PDF_DATA_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(route))));
  doc.setProperties({
    title: route.name || "Маршрут",
    subject: "Планировщик путешествий — данные маршрута",
    creator: "Travel Planner PWA",
    keywords: payload
  });

  const fileName = (route.name || "route").replace(/[^\p{L}\p{N}_\- ]/gu, "").trim() || "route";
  doc.save(fileName + ".pdf");
}

async function importRouteFromPDFFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const meta = await pdf.getMetadata();
  const keywords = meta && meta.info && meta.info.Keywords;
  if (!keywords || keywords.indexOf(PDF_DATA_PREFIX) === -1) {
    throw new Error("В этом PDF не найдены данные маршрута. Убедитесь, что файл был создан этим приложением.");
  }
  const b64 = keywords.slice(keywords.indexOf(PDF_DATA_PREFIX) + PDF_DATA_PREFIX.length);
  const json = decodeURIComponent(escape(atob(b64)));
  const route = JSON.parse(json);
  // Новый id, чтобы не конфликтовать с уже сохранёнными маршрутами.
  route.id = uid("route");
  route.updatedAt = Date.now();
  return route;
}

"use strict";

/* ============ Резервная копия ============ */
const BACKUP_VERSION = 1;

function buildBackup() {
  return {
    app: "filmder",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      liked: state.liked,
      watched: state.watched,
      urls: state.urls,
      multiGenres: state.multiGenres,
      passed: [...passed],
    },
  };
}

async function exportBackup() {
  const json = JSON.stringify(buildBackup(), null, 2);
  const name = `filmder-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: "application/json" });

  // На iPhone (особенно в PWA) надёжнее системное меню «Поделиться» → «Сохранить в Файлы»
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Filmder — копия данных" });
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return; // пользователь закрыл меню
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast({ sub: "Копия сохранена", title: name });
}

// Приводим запись из файла к безопасному виду
function cleanEntry(m) {
  if (!m || !Number.isFinite(+m.id)) return null;
  const e = snap(Object.assign({}, m, { id: +m.id, genres: Array.isArray(m.genres) ? m.genres : [] }));
  if (Number.isFinite(+m.watchedAt) && +m.watchedAt > 0) e.watchedAt = +m.watchedAt;
  return e;
}

// Объединение, а не замена: ничего из текущих списков не теряется
function importBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return showToast({ sub: "Ошибка", title: "Файл не читается как JSON" }); }
  const d = raw && raw.app === "filmder" ? raw.data : null;
  if (!d) return showToast({ sub: "Ошибка", title: "Это не копия Filmder" });

  let addedQ = 0, addedW = 0;
  const impLiked = (Array.isArray(d.liked) ? d.liked : []).map(cleanEntry).filter(Boolean);
  const impWatched = (Array.isArray(d.watched) ? d.watched : []).map(cleanEntry).filter(Boolean);

  for (const m of impWatched) {
    if (isWatched(m.id)) continue;
    state.liked = state.liked.filter(x => x.id !== m.id); // просмотренное важнее «к просмотру»
    state.watched.push(m);
    addedW++;
  }
  state.watched.sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0));

  for (const m of impLiked) {
    if (isLiked(m.id) || isWatched(m.id)) continue;
    state.liked.push(m);
    addedQ++;
  }
  if (d.urls && typeof d.urls === "object") {
    for (const [id, u] of Object.entries(d.urls)) {
      if (!state.urls[id] && typeof u === "string" && validUrl(u)) state.urls[id] = u;
    }
  }
  if (Array.isArray(d.passed)) d.passed.forEach(id => { if (Number.isFinite(+id)) passed.add(+id); });

  deck = deck.filter(m => !isSeen(m.id));
  save();
  renderAll();
  showToast({ sub: "Копия загружена", title: `+${addedQ} к просмотру, +${addedW} просмотрено` });
}

(function bindBackup() {
  const inp = $("#import-file");
  if (inp) inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    inp.value = "";
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return showToast({ sub: "Ошибка", title: "Файл слишком большой" });
    try { importBackup(await f.text()); } catch (e) { showToast({ sub: "Ошибка", title: "Не удалось прочитать файл" }); }
  });
  // Просим браузер не вычищать хранилище при нехватке места или долгом неиспользовании
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
})();

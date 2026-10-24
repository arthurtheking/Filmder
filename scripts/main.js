"use strict";

/* ============ Туториал ============ */
const tutorialSteps = [
  { title: "Добро пожаловать в Filmder!", text: "Удобный способ находить фильмы на вечер с друзьями или в одиночку." },
  { title: "Как свайпать", text: "Свайп вправо добавляет фильм в «Мой вечер», свайп влево — пропускает его. Нажмите на карточку, чтобы посмотреть трейлер." },
  { title: "Жанры и фильтры", text: "Настраивайте мультивыбор жанров через кнопку «Фильтры» в правом верхнем углу." },
  { title: "Мой вечер", text: "Здесь хранятся выбранные фильмы по категориям. Смахните фильм влево, чтобы удалить его." },
  { title: "Просмотренные", text: "Посмотрели фильм — смахните его вправо. Он переедет в отдельный список «Просмотрено» и больше не появится в свайпах. Нажали «Смотреть» — после возвращения в приложение мы сами предложим отметить фильм." },
];
let tutorialStep = 0;

function checkTutorial() {
  if (ls.get(TUTORIAL_KEY)) return;
  showTutorialStep(0);
  $("#tutorial").hidden = false;
}
function finishTutorial() { $("#tutorial").hidden = true; ls.set(TUTORIAL_KEY, "true"); }
function showTutorialStep(step) {
  tutorialStep = step;
  if (step >= tutorialSteps.length) return finishTutorial();
  $("#tutorial-step-counter").textContent = `Шаг ${step + 1} из ${tutorialSteps.length}`;
  $("#tutorial-title").textContent = tutorialSteps[step].title;
  $("#tutorial-text").textContent = tutorialSteps[step].text;
  $("#tutorial-next").textContent = step === tutorialSteps.length - 1 ? "Начать" : "Далее";
  if (step > 0) anim($("#tutorial-card"), FX_IN, { duration: 400 });
}

/* ============ События ============ */
document.addEventListener("click", e => {
  // Ссылка «Смотреть»: запоминаем фильм, чтобы по возвращении предложить отметить его просмотренным
  const link = e.target.closest("a[data-watch]");
  if (link) { rememberPending(+link.dataset.watch); return; }

  const t = e.target.closest("button, [data-open], [data-related-id], .backdrop");
  if (!t) return;

  switch (t.id) {
    case "tab-swipe": return setTab("swipe");
    case "tab-list": return setTab("list");
    case "seg-queue": return setListMode("queue");
    case "seg-watched": return setListMode("watched");
    case "btn-like": return swipeButton(1);
    case "btn-nope": return swipeButton(-1);
    case "btn-undo": return undo();
    case "btn-open-filters": return openFiltersModal();
    case "btn-apply-filters": return applyFiltersModal();
    case "btn-reset-filters": $("#filter-grid").querySelectorAll("input").forEach(i => (i.checked = false)); return;
    case "tutorial-next": return showTutorialStep(tutorialStep + 1);
    case "tutorial-skip": return finishTutorial();
    case "btn-retry": if (!genres.length) return boot(); paging = newPaging(); return refill("init");
    case "btn-reset": passed.clear(); history_ = []; save(); paging = newPaging(); return refill("filter");
    case "src-save": return saveSrc();
    case "btn-sync": return syncDialog();
    case "btn-export": return exportBackup();
    case "btn-import": { const f = $("#import-file"); if (f) f.click(); return; }
  }

  if ("undo" in t.dataset) { const f = toastUndoFn; hideToast(); if (f) f(); return; }
  if ("watched" in t.dataset) {
    const m = sheetMovie;
    if (m) { if (isWatched(m.id)) unmarkWatched(m.id); else markWatched(m); }
    return;
  }
  if (t.dataset.play) { const mm = $("#sheet-media"); if (mm) mm.innerHTML = playerHtml(t.dataset.play); return; }
  if (t.dataset.open) { const m = findMovie(+t.dataset.open); if (m) openSheet(m); return; }
  if (t.dataset.relatedId) {
    const id = +t.dataset.relatedId, m = findMovie(id);
    if (m) openSheet(m); else TMDB.details(id).then(openSheet).catch(() => {});
    return;
  }
  if (t.dataset.addSrc) { const m = findMovie(+t.dataset.addSrc) || sheetMovie; if (m) openSheet(m, true); return; }
  if ("toggle" in t.dataset) return toggleLike(findMovie(+t.dataset.toggle) || sheetMovie);
  if ("close" in t.dataset) return closeLayer();
  if (t.classList.contains("backdrop") && e.target === t) closeLayer();
});

document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") {
    if (e.key === "Enter" && e.target.id === "src-input") saveSrc();
    if (e.key === "Escape") e.target.blur();
    return;
  }
  if (e.key === "Escape") return closeLayer();
  const free = $("#overlay").hidden && $("#filters-overlay").hidden && $("#tutorial").hidden && $("#splash") === null && !$("#view-swipe").hidden;
  if (!free) return;
  if (e.key === "ArrowRight") swipeButton(1);
  if (e.key === "ArrowLeft") swipeButton(-1);
});

window.addEventListener("online", () => {
  if (!deck.length && paging.error && appStarted) { if (!genres.length) boot(); else { paging = newPaging(); refill("init"); } }
});

/* ============ Вкладки и общий рендер ============ */
function setTab(name) {
  const next = $(name === "swipe" ? "#view-swipe" : "#view-list");
  const changed = next.hidden;
  $("#view-swipe").hidden = name !== "swipe";
  $("#view-list").hidden = name !== "list";
  $("#tab-swipe").setAttribute("aria-selected", name === "swipe");
  $("#tab-list").setAttribute("aria-selected", name === "list");
  $("#tab-ind").classList.toggle("right", name === "list");
  if (!changed) return;
  if (name === "list" && listDirty) { listDirty = false; renderList(); }
  next.classList.remove("enter"); void next.offsetWidth; next.classList.add("enter");
  if (name === "list") {
    const l = $("#list");
    l.classList.add("enter");
    setTimeout(() => l.classList.remove("enter"), 1200);
  }
}

let prevLiked = state.liked.length;
function updateBadge() {
  const b = $("#badge");
  b.textContent = state.liked.length;
  b.hidden = state.liked.length === 0;
  if (state.liked.length > prevLiked) bump(b);
  prevLiked = state.liked.length;
  $("#seg-queue-n").textContent = state.liked.length;
  $("#seg-watched-n").textContent = state.watched.length;
}
let listDirty = false;
function refreshList() {
  updateBadge();
  syncSheetButtons();
  if ($("#view-list").hidden) listDirty = true; else { listDirty = false; renderList(); }
}
function renderAll(mode, undoDir) { renderSwipe(mode, undoDir); refreshList(); }

/* ============ Запуск ============ */
/* ============ Версия приложения ============ */
(function showVersion() {
  const el = $("#app-version");
  if (!el) return;
  const v = window.APP_VERSION;
  if (!v || !v.version || v.version === "dev") { el.textContent = "dev"; return; }
  el.textContent = `v${v.version}${v.sha ? " · " + v.sha : ""}`;
  if (v.date) el.title = "Обновлено " + v.date;
  // Диагностика: тап по версии показывает размеры окна (для поиска проблемы с нижним краем), ещё тап — возвращает версию
  const base = el.textContent;
  let dbg = false;
  el.style.pointerEvents = "auto";
  el.addEventListener("click", () => {
    dbg = !dbg;
    if (!dbg) { el.textContent = base; el.style.whiteSpace = ""; return; }
    const p = document.createElement("div");
    p.style.cssText = "position:fixed;left:0;bottom:0;height:env(safe-area-inset-bottom,0px);width:1px;visibility:hidden";
    document.body.appendChild(p);
    const sab = Math.round(p.getBoundingClientRect().height);
    p.remove();
    const vv = window.visualViewport;
    el.style.whiteSpace = "normal";
    el.textContent = `inner ${innerWidth}×${innerHeight} · screen ${screen.width}×${screen.height} · vv ${vv ? Math.round(vv.height) : "-"} · client ${document.documentElement.clientHeight} · safe-bottom ${sab} · standalone ${navigator.standalone} · dpr ${devicePixelRatio}`;
  });
})();

let appStarted = false;
let splashResolve;
const splashDone = new Promise(r => (splashResolve = r));

async function boot() {
  try {
    paging = newPaging();
    genres = await TMDB.genres();
  } catch (e) {
    paging.error = e.message;
    renderSwipe();
    return;
  }
  updateFilterBadge();
  renderAll("init");
  await fillDeck(8);
  await splashDone;
  renderSwipe("init");
  checkTutorial();
  checkPending();
  syncRun();
  duelResume();
}

function startApp() {
  if (appStarted) return;
  appStarted = true;
  if (!(CONFIG.PROXY_URL || "").trim() && !(CONFIG.TMDB_KEY || "").trim()) { $("#setup").hidden = false; return; }
  boot();
}

async function runSplash() {
  const sp = $("#splash");
  startApp();
  const animated = !RM() && !!sp.animate;
  try {
    if (animated) {
      const mark = $("#mark"), word = $("#word"), dot = $("#sdot");
      sp.addEventListener("click", () => {
        try { sp.getAnimations({ subtree: true }).forEach(a => a.finish()); } catch (e) {}
      });
      try { await Promise.race([document.fonts.ready, wait(700)]); } catch (e) {}
      const glow = "rgba(255, 122, 92, ";
      dot.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: 450, easing: SPRING, fill: "forwards" });
      [300, 800].forEach(delay => dot.animate([
        { transform: "scale(1)", boxShadow: `0 0 0 0 ${glow}.55)` },
        { transform: "scale(1.5)", boxShadow: `0 0 0 0 ${glow}.45)`, offset: 0.4 },
        { transform: "scale(1)", boxShadow: `0 0 0 18px ${glow}0)` },
      ], { duration: 650, delay, easing: "ease-out" }));
      const shift = (word.getBoundingClientRect().width + 8) / 2;
      const opt = { duration: 850, delay: 900, easing: EASE, fill: "both" };
      mark.animate([{ transform: `translateX(${-shift}px)` }, { transform: "translateX(0)" }], opt);
      const reveal = word.animate([{ clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0%)" }], opt);
      await reveal.finished;
      await wait(150);
    }
    startApp();
    splashResolve();
    if (animated) await sp.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, fill: "forwards", easing: EASE }).finished;
  } catch (e) {
    startApp();
  }
  splashResolve();
  sp.remove();
}
runSplash();

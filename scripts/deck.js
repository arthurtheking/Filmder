"use strict";

/* ============ Колода ============ */
async function fillDeck(min = 8) {
  const p = paging;
  if (p.loading) return;
  p.loading = true;
  p.error = null;
  try {
    let extra = 0;
    while (p.page <= p.total && deck.length < min && (deck.length === 0 || extra++ < 4)) {
      const data = await TMDB.discover(state.multiGenres, p.page);
      if (p !== paging) return;
      p.total = data.totalPages;
      for (const m of data.items) {
        if (m.poster && !isSeen(m.id) && !deck.some(d => d.id === m.id)) deck.push(m);
      }
      p.page++;
    }
  } catch (e) {
    if (p === paging) p.error = e.message;
  }
  if (p !== paging) return;
  p.loading = false;
  preloadDeck();
}

function topUp() {
  if (deck.length >= 6 || paging.page > paging.total || paging.loading) return;
  const p = paging;
  fillDeck(10).then(() => {
    if (p !== paging) return;
    const shown = $("#stage").querySelectorAll(".card").length;
    if (shown < Math.min(3, deck.length)) renderSwipe("fill");
  });
}

async function refill(mode) {
  const p = paging;
  renderSwipe();
  await fillDeck(8);
  if (p === paging) renderSwipe(mode || "init");
}

const tf = i => `translateY(${i * 10}px) scale(${1 - i * 0.04})`;
const dim = i => i * 0.22;

function cardHtml(m) {
  const sub = m.orig && m.orig !== m.title ? `${esc(m.orig)} · ${m.year}` : m.year;
  return `${posterHtml(m.poster, CARD_IMG, m.title)}<div class="shade"></div>
    <div class="tap-hint">${ICON_PLAY}Трейлер</div>
    <div class="rate">★ ${(m.rating || 0).toFixed(1)}</div>
    <div class="info">
      <div class="t">${esc(m.title)}</div>
      <div class="o">${sub}</div>
      <div class="tags">${m.genres.slice(0, 3).map(x => `<span class="tag">${esc(x)}</span>`).join("")}</div>
    </div>
    <div class="stamp like">В ВЕЧЕР</div><div class="stamp nope">МИМО</div>`;
}

function renderSwipe(mode, undoDir) {
  const stage = $("#stage");
  if (!stage) return;
  $("#btn-undo").disabled = history_.length === 0;
  $("#btn-nope").disabled = $("#btn-like").disabled = deck.length === 0;

  if (!deck.length) {
    let key, html;
    if (paging.loading || (!paging.error && paging.page <= paging.total)) {
      key = "loading";
      html = `<div class="empty"><div class="spinner"></div><h2>Ищу фильмы…</h2></div>`;
    } else if (paging.error) {
      key = "error";
      const text = paging.error === "BAD_KEY" ? "TMDB не принял ключ. Проверьте его в файле config.js." : "Не удалось связаться с TMDB. Проверьте интернет.";
      html = `<div class="empty"><h2>Что-то пошло не так</h2><p>${text}</p><button class="btn primary" id="btn-retry">Повторить</button></div>`;
    } else {
      key = "done" + passed.size;
      html = `<div class="empty">
        <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 4v5M16 4v5"/></svg>
        <h2>Фильмы по вашему запросу закончились</h2><p>Выберите другие жанры${passed.size ? " или верните пропущенные" : ""}.</p>
        ${passed.size ? `<button class="btn primary" id="btn-reset">Показать пропущенные снова</button>` : ""}</div>`;
    }
    if (stage.dataset.empty === key) return;
    stage.dataset.empty = key;
    stage.innerHTML = html;
    return;
  }

  delete stage.dataset.empty;
  const top = deck.slice(0, 3);

  // Если на сцене уже лежит ровно эта стопка — ничего не пересоздаём.
  // Раньше любой renderAll() (например, из шторки) сносил карточки и грузил постеры заново — отсюда мерцание.
  if (!mode || mode === "fill") {
    const cur = [...stage.querySelectorAll(".card")].map(c => +c.dataset.id).reverse();
    if (cur.length === top.length && cur.every((id, i) => id === top[i].id)) return;
  }

  stage.innerHTML = "";
  for (let i = top.length - 1; i >= 0; i--) {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.id = top[i].id;
    el.innerHTML = cardHtml(top[i]);
    el.style.transform = tf(i);
    el.style.setProperty("--dim", dim(i));
    if (i === 0) bindDrag(el, top[i]); else el.style.pointerEvents = "none";
    stage.appendChild(el);

    if (mode === "init" || mode === "filter") {
      anim(el, [
        { opacity: 0, transform: `translateY(${70 + i * 14}px) scale(.92)` },
        { opacity: 1, transform: tf(i) },
      ], { duration: mode === "init" ? 800 : 520, delay: (top.length - 1 - i) * 90, easing: SPRING });
    } else if (mode === "fly" && i === 2) {
      anim(el, [{ opacity: 0, transform: "translateY(40px) scale(.88)" }, { opacity: 1, transform: tf(2) }], { duration: 450 });
    } else if (mode === "undo" && i === 0) {
      const dir = undoDir || 1;
      anim(el, [
        { transform: `translateX(${dir * 120}%) rotate(${dir * 16}deg)`, opacity: 0 },
        { transform: tf(0), opacity: 1 },
      ], { duration: 520, easing: SPRING });
    }
    if (mode === "init" && i === 0) hint(el);
  }
}

function hint(el, delay = 1600) {
  el._hint = anim(el, [
    { transform: tf(0) },
    { transform: "translateX(26px) rotate(3deg)", offset: 0.3 },
    { transform: "translateX(-26px) rotate(-3deg)", offset: 0.65 },
    { transform: tf(0) },
  ], { duration: 1300, delay, fill: "none", easing: "ease-in-out" });
}

/* ============ Подсказки при бездействии ============ */
const IDLE_MS = 7000;
let lastInput = performance.now();
["pointerdown", "keydown", "wheel", "touchstart"].forEach(ev =>
  addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true, capture: true }));

function cancelRowHint(row) {
  (row._hints || []).forEach(a => { try { a.cancel(); } catch (e) {} });
  row._hints = null;
}

// Строка списка чуть уезжает вправо («Просмотрено»), затем влево («Удалить»), приоткрывая плашки
function hintRow(row) {
  const c = row.closest(".row-container");
  if (!c || c.classList.contains("gone") || c.classList.contains("dragging")) return;
  const w = c.querySelector(".row-watch-bg"), d = c.querySelector(".row-delete-bg");
  const o = { duration: 1500, fill: "none", easing: "ease-in-out" };
  const list = [
    anim(row, [
      { transform: "translateX(0)" },
      { transform: "translateX(52px)", offset: 0.28 },
      { transform: "translateX(0)", offset: 0.5 },
      { transform: "translateX(-52px)", offset: 0.76 },
      { transform: "translateX(0)" },
    ], o),
    anim(w, [{ width: "0px" }, { width: "52px", offset: 0.28 }, { width: "0px", offset: 0.5 }, { width: "0px" }], o),
    anim(d, [{ width: "0px" }, { width: "0px", offset: 0.5 }, { width: "52px", offset: 0.76 }, { width: "0px" }], o),
  ].filter(Boolean);
  row._hints = list;
}

function idleTick() {
  if (document.hidden || busy || performance.now() - lastInput < IDLE_MS) return;
  if (!$("#overlay").hidden || !$("#filters-overlay").hidden || (document.getElementById("wheel-overlay") && !document.getElementById("wheel-overlay").hidden) || !$("#tutorial").hidden || $("#splash") || appStarted === false) return;
  if (!$("#view-swipe").hidden) {
    const card = $("#stage .card:last-child");
    if (card && !card.style.transform.includes("translate3d")) { if (card._hint) card._hint.cancel(); hint(card, 0); }
  } else if (!$("#view-list").hidden) {
    const row = document.querySelector("#list .row-container:not(.gone) .row");
    if (row) hintRow(row);
  }
  lastInput = performance.now(); // следующая подсказка — после очередной паузы
}
setInterval(idleTick, 1000);

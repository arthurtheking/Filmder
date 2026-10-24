"use strict";

const $ = sel => document.querySelector(sel);

/* ============ Константы и утилиты ============ */
const STORE_KEY = "filmder-tmdb-v2";
const THEME_KEY = "filmder-theme";
const TUTORIAL_KEY = "filmder-tutorial-shown";
const PENDING_KEY = "filmder-pending-watch";
const HISTORY_LIMIT = 30;
const PASSED_LIMIT = 3000;

// true  — трейлер стартует сам при открытии карточки (как раньше)
// false — показывается кнопка ▶, плеер создаётся только по тапу (самый лёгкий режим для iPhone)
const TRAILER_AUTOPLAY = true;

const EASE = "cubic-bezier(.16,1,.3,1)";
const SPRING = "cubic-bezier(.34,1.56,.64,1)";
const FX_IN = [
  { opacity: 0, transform: "translateY(22px) scale(.96)" },
  { opacity: 1, transform: "none" },
];
const CARD_IMG = "w500";

const RMQ = matchMedia("(prefers-reduced-motion: reduce)");
const RM = () => RMQ.matches;
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const wait = ms => new Promise(r => setTimeout(r, ms));
const ls = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};
// Тактильный отклик. Android: Vibration API. iOS (17.4+): Safari «тикает» при переключении
// <input type="checkbox" switch>, поэтому программно кликаем по скрытому переключателю.
let tickLabel = null;
function iosTick() {
  try {
    if (!tickLabel) {
      tickLabel = document.createElement("label");
      tickLabel.setAttribute("aria-hidden", "true");
      tickLabel.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.setAttribute("switch", "");
      inp.tabIndex = -1;
      tickLabel.appendChild(inp);
      document.body.appendChild(tickLabel);
    }
    tickLabel.click();
  } catch (e) {}
}
// ms — число (одиночный импульс) или массив-паттерн [вибро, пауза, вибро…]
const haptic = (ms = 8) => {
  try { if (navigator.vibrate && navigator.vibrate(ms)) return; } catch (e) {}
  if (!IS_IOS) return;
  if (Array.isArray(ms)) {
    let t = 0;
    ms.forEach((d, i) => { if (i % 2 === 0) setTimeout(iosTick, t); t += d; });
  } else iosTick();
};

function dur(min) {
  if (!min) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}
function plural(n) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? "фильм" : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? "фильма" : "фильмов";
}
const fmtDate = ts => { try { return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); } catch (e) { return ""; } };
const ICON_PLAY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>`;
const ICON_CLOSE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const ICON_CHECK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const youtubeSearch = m => "https://www.youtube.com/results?search_query=" + encodeURIComponent(`${m.title} ${m.year} официальный трейлер`);
const validUrl = u => /^https?:\/\/\S+$/i.test(u);

function anim(el, keyframes, options) {
  if (!el || RM() || !el.animate) return null;
  return el.animate(keyframes, Object.assign({ fill: "backwards", easing: EASE, duration: 450 }, options));
}
const bump = el => anim(el, [{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 400, easing: SPRING });

/* ============ Состояние ============ */
let state = { liked: [], watched: [], urls: {}, multiGenres: [] };
const passed = new Set();
try {
  const saved = JSON.parse(ls.get(STORE_KEY) || "null");
  if (saved && typeof saved === "object") {
    if (Array.isArray(saved.liked)) state.liked = saved.liked.filter(m => m && m.id);
    if (Array.isArray(saved.watched)) state.watched = saved.watched.filter(m => m && m.id);
    if (saved.urls && typeof saved.urls === "object") state.urls = saved.urls;
    if (Array.isArray(saved.multiGenres)) state.multiGenres = saved.multiGenres;
    else if (saved.genre) state.multiGenres = [saved.genre];
    if (Array.isArray(saved.passed)) saved.passed.forEach(id => passed.add(id));
  }
} catch (e) {}

const saveNow = () => ls.set(STORE_KEY, JSON.stringify({
  liked: state.liked, watched: state.watched, urls: state.urls, multiGenres: state.multiGenres,
  passed: [...passed].slice(-PASSED_LIMIT),
}));
let saveTimer = 0;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); };
addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });

const isLiked = id => state.liked.some(m => m.id === id);
const isWatched = id => state.watched.some(m => m.id === id);
const isSeen = id => passed.has(id) || isLiked(id) || isWatched(id);
const findStored = id => state.liked.find(m => m.id === id) || state.watched.find(m => m.id === id);

function categoryOf(m) {
  if (m.category) return m.category;
  const g = m.genres || [];
  return g.find(x => x === "Мультфильмы" || x === "Аниме") || g[0] || "Другое";
}
const snap = m => ({
  id: m.id, title: m.title, orig: m.orig, year: m.year, rating: m.rating || 0,
  poster: m.poster, runtime: m.runtime || 0, genres: m.genres || [], category: categoryOf(m),
});

let genres = [];
let deck = [];
let paging = newPaging();
let history_ = [];
let busy = false;
let sheetMovie = null;
let listMode = "queue"; // "queue" | "watched"

function newPaging() { return { page: 1, total: 1, loading: false, error: null }; }

/* ============ Тема ============ */
const themeInput = $("#theme-switch-input");
let themeMeta = document.querySelector('meta[name="theme-color"]');

// Цвета строки состояния / safe-зон (должны совпадать с --bg в CSS)
const THEME_RGB = { dark: [10, 10, 13], light: [234, 236, 236] };
const rgbHex = c => "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
let metaNow = null;
let metaRaf = 0;

// Плавно меняет theme-color синхронно с анимацией темы, чтобы safe-зоны не «щёлкали»
function tweenMeta(light, ms) {
  if (!themeMeta) return;
  cancelAnimationFrame(metaRaf);
  const to = THEME_RGB[light ? "light" : "dark"];
  if (!metaNow) metaNow = THEME_RGB[light ? "dark" : "light"];
  if (!ms || RM()) { metaNow = to; themeMeta.content = rgbHex(to); return; }
  const from = metaNow, t0 = performance.now();
  const tick = now => {
    const k = Math.min((now - t0) / ms, 1);
    const e = 1 - Math.pow(1 - k, 3);
    metaNow = from.map((v, i) => v + (to[i] - v) * e);
    themeMeta.content = rgbHex(metaNow);
    if (k < 1) metaRaf = requestAnimationFrame(tick);
  };
  metaRaf = requestAnimationFrame(tick);
}

// Жёстко выставляет цвет safe-зон по текущей теме. Safari иногда «залипает» на промежуточном цвете или
// на цвете уехавшего тоста, поэтому тег theme-color пересоздаём заново, а не просто меняем content.
function syncBars() {
  const light = document.documentElement.classList.contains("light");
  const hex = rgbHex(THEME_RGB[light ? "light" : "dark"]);
  metaNow = THEME_RGB[light ? "light" : "dark"];
  document.documentElement.style.backgroundColor = "";
  const old = document.querySelectorAll('meta[name="theme-color"]');
  const fresh = document.createElement("meta");
  fresh.name = "theme-color";
  fresh.content = hex;
  document.head.appendChild(fresh);
  old.forEach(m => m.remove());
  themeMeta = fresh;
}
let syncTimer = 0;
const syncBarsSoon = (ms = 60) => { clearTimeout(syncTimer); syncTimer = setTimeout(syncBars, ms); };
addEventListener("pageshow", () => syncBarsSoon(0));
addEventListener("resize", () => syncBarsSoon(150));
document.addEventListener("visibilitychange", () => { if (!document.hidden) syncBarsSoon(0); });

function paintTheme(light, ms = 0) {
  document.documentElement.classList.toggle("light", light);
  if (themeInput) themeInput.checked = light;
  tweenMeta(light, ms);
  if (ms) syncBarsSoon(ms + 80); // после анимации — точное финальное значение
}

function setTheme(light) {
  ls.set(THEME_KEY, light ? "light" : "dark");
  const root = document.documentElement;

  if (RM()) return paintTheme(light);
  if (!document.startViewTransition) {
    root.classList.add("theme-fade");
    paintTheme(light, 450);
    setTimeout(() => root.classList.remove("theme-fade"), 500);
    return;
  }

  const sw = document.querySelector(".ios-switch");
  const r = sw ? sw.getBoundingClientRect() : { left: innerWidth - 60, top: 30, width: 0, height: 0 };
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

  const vt = document.startViewTransition(() => paintTheme(light, 450));
  vt.ready.then(() => root.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
    { duration: 450, easing: EASE, pseudoElement: "::view-transition-new(root)" }
  )).catch(() => {});
}

(() => {
  const saved = ls.get(THEME_KEY);
  const light = saved ? saved === "light" : matchMedia("(prefers-color-scheme: light)").matches;
  paintTheme(light);
})();
if (themeInput) themeInput.addEventListener("change", () => setTheme(themeInput.checked));

/* ============ Эффекты ============ */
function burst(origin, color, count) {
  if (RM()) return;
  const r = origin.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    const s = 4 + Math.random() * 5;
    p.style.cssText = `position:fixed;left:${cx - s / 2}px;top:${cy - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;background:${color};pointer-events:none;z-index:4000;will-change:transform,opacity;`;
    document.body.appendChild(p);
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.6, d = 42 + Math.random() * 45;
    const an = p.animate([
      { transform: "translate(0,0) scale(.4)", opacity: 0 },
      { transform: `translate(${Math.cos(a) * d * 0.4}px, ${Math.sin(a) * d * 0.4 - 8}px) scale(1.2)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d - 16}px) scale(0)`, opacity: 0 },
    ], { duration: 550 + Math.random() * 250, easing: "cubic-bezier(.1,.7,.3,1)" });
    an.onfinish = () => p.remove();
  }
}

/* ============ Постеры ============ */
function posterHtml(path, size, alt) {
  const src = TMDB.img(path, size);
  const decoding = size === CARD_IMG ? "sync" : "async"; // карточки колоды не должны «доезжать» после вставки
  return `<div class="poster">${src ? `<img src="${src}" alt="${esc(alt || "")}" draggable="false"${size === "w185" ? ' loading="lazy"' : ""} decoding="${decoding}">` : ""}</div>`;
}

// Держим ссылки на предзагруженные картинки: иначе браузер выбрасывает декодированный
// битмап, и при вставке новой карточки постер мигает пустым градиентом.
const imgKeep = new Map();
function keepImage(url) {
  if (imgKeep.has(url)) return;
  const im = new Image();
  im.decoding = "async";
  im.src = url;
  imgKeep.set(url, im);
  if (im.decode) im.decode().catch(() => {});
  if (imgKeep.size > 16) imgKeep.delete(imgKeep.keys().next().value);
}
function preloadDeck() {
  deck.slice(0, 6).forEach(m => { if (m.poster) keepImage(TMDB.img(m.poster, CARD_IMG)); });
}

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

/* ============ Свайп карточки ============ */
function bindDrag(el, m) {
  let s = null, raf = 0;
  const likeStamp = el.querySelector(".stamp.like"), nopeStamp = el.querySelector(".stamp.nope");

  el.addEventListener("pointerdown", e => {
    if (busy || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (el._hint) el._hint.cancel();
    s = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false, lx: e.clientX, lt: performance.now(), vx: 0 };
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    el.style.transition = "none";
  });

  el.addEventListener("pointermove", e => {
    if (!s) return;
    s.dx = e.clientX - s.x;
    s.dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(s.dx, s.dy) > 6) s.moved = true;

    const now = performance.now(), dt = now - s.lt;
    if (dt > 8) { s.vx = 0.6 * s.vx + 0.4 * ((e.clientX - s.lx) / dt); s.lx = e.clientX; s.lt = now; }

    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!s) return;
      el.style.transform = `translate3d(${s.dx}px, ${s.dy}px, 0) rotate(${s.dx / 18}deg)`;
      const k = Math.min(Math.abs(s.dx) / 100, 1);
      likeStamp.style.opacity = s.dx > 0 ? k : 0;
      nopeStamp.style.opacity = s.dx < 0 ? k : 0;
    });
  });

  const end = e => {
    if (!s) return;
    cancelAnimationFrame(raf); raf = 0;
    const d = s; s = null;
    el.style.transition = "";

    if (!d.moved) {
      if (e.type === "pointerup") openSheet(m);
      return;
    }
    const fling = Math.abs(d.vx) > 0.6 && Math.abs(d.dx) > 40;
    if (d.dx > 90 || (fling && d.vx > 0)) fly(el, m, 1);
    else if (d.dx < -90 || (fling && d.vx < 0)) fly(el, m, -1);
    else {
      el.style.transition = `transform .5s ${SPRING}`;
      el.style.transform = tf(0);
      likeStamp.style.opacity = nopeStamp.style.opacity = 0;
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

function fly(el, m, dir) {
  if (busy) return;
  busy = true;
  haptic();
  const cards = [...$("#stage").querySelectorAll(".card")];
  cards.forEach((c, k) => {
    const i = cards.length - 1 - k;
    if (i > 0) {
      c.style.transition = `transform .4s ${EASE}`;
      c.style.transform = tf(i - 1);
      c.style.setProperty("--dim", dim(i - 1));
    }
  });
  el.style.transition = "transform .38s cubic-bezier(.5,0,.9,.4), opacity .38s ease-in";
  el.style.transform = `translate(${dir * (innerWidth + 200)}px, ${dir > 0 ? -30 : 30}px) rotate(${dir * 26}deg)`;
  el.style.opacity = "0";
  setTimeout(() => { busy = false; decide(m, dir); }, 340);
}

function swipeButton(dir) {
  if (busy || !deck.length) return;
  const el = $("#stage .card:last-child");
  if (!el) return;
  if (el._hint) el._hint.cancel();
  const btn = $(dir > 0 ? "#btn-like" : "#btn-nope");
  btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop");
  const stamp = el.querySelector(dir > 0 ? ".stamp.like" : ".stamp.nope");
  anim(stamp, [
    { opacity: 0, transform: `rotate(${dir * -12}deg) scale(.6)` },
    { opacity: 1, transform: `rotate(${dir * -12}deg) scale(1)` },
  ], { duration: 240, fill: "forwards", easing: SPRING });
  fly(el, deck[0], dir);
}

function advanceStack() {
  const stage = $("#stage");
  const cards = stage.querySelectorAll(".card");
  if (!deck.length || !cards.length) return renderSwipe("fly");
  cards[cards.length - 1].remove();
  const left = stage.querySelectorAll(".card");
  const top = left[left.length - 1];
  if (!top || +top.dataset.id !== deck[0].id) return renderSwipe("fly");
  top.style.pointerEvents = "";
  bindDrag(top, deck[0]);
  if (deck.length >= 3 && left.length < 3) {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.id = deck[2].id;
    el.innerHTML = cardHtml(deck[2]);
    el.style.transform = tf(2);
    el.style.setProperty("--dim", dim(2));
    el.style.pointerEvents = "none";
    stage.prepend(el);
    anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  }
  $("#btn-undo").disabled = history_.length === 0;
  $("#btn-nope").disabled = $("#btn-like").disabled = deck.length === 0;
}

function decide(m, dir) {
  deck = deck.filter(d => d.id !== m.id);
  if (dir > 0) {
    state.liked.push(snap(m));
    burst($("#btn-like"), "var(--like)", 8);
    loadRuntime(m.id);
  } else {
    passed.add(m.id);
    burst($("#btn-nope"), "var(--nope)", 4);
  }
  history_.push({ movie: m, dir });
  if (history_.length > HISTORY_LIMIT) history_.shift();
  save();
  advanceStack();
  refreshList();
  if (dir > 0) showToast({ sub: "Добавлено в мой вечер", title: m.title, id: m.id, undo });
  preloadDeck();
  topUp();
}

function loadRuntime(id) {
  TMDB.details(id, true).then(d => {
    const s = findStored(id);
    if (!s) return;
    if (d.runtime) s.runtime = d.runtime;
    if (d.genres && d.genres.length) s.genres = d.genres;
    if (!s.category || s.category === "Другое") s.category = categoryOf(Object.assign({}, s, { category: null }));
    save();
    refreshList();
  }).catch(() => {});
}

function undo() {
  const last = history_.pop();
  if (!last) return;
  const id = last.movie.id;
  state.liked = state.liked.filter(m => m.id !== id);
  passed.delete(id);
  deck = deck.filter(d => d.id !== id);
  deck.unshift(last.movie);
  save();
  hideToast();
  haptic();
  renderAll("undo", last.dir);
}

/* ============ Просмотрено ============ */
// Фильм может быть в одном из трёх состояний: ничего / «К просмотру» (liked) / «Просмотрено» (watched).
// Просмотренный фильм не показывается в колоде и живёт в отдельном списке.
function markWatched(m) {
  if (!m || isWatched(m.id)) return;
  const id = m.id;
  const likedIdx = state.liked.findIndex(x => x.id === id);
  const prev = likedIdx >= 0 ? state.liked.splice(likedIdx, 1)[0] : null;
  const entry = Object.assign(prev || snap(m), { watchedAt: Date.now() });
  if (!entry.runtime && m.runtime) entry.runtime = m.runtime;
  state.watched.unshift(entry);
  passed.delete(id);
  const wasInDeck = deck.some(d => d.id === id);
  deck = deck.filter(d => d.id !== id);
  history_ = history_.filter(h => h.movie.id !== id);
  if (!entry.runtime) loadRuntime(id);
  save();
  haptic();
  renderAll();
  showToast({
    sub: "Отмечено просмотренным", title: entry.title,
    undo: () => {
      const i = state.watched.findIndex(x => x.id === id);
      if (i >= 0) state.watched.splice(i, 1);
      delete entry.watchedAt;
      if (prev) state.liked.splice(Math.min(likedIdx, state.liked.length), 0, prev);
      else if (wasInDeck) deck.unshift(m);
      save();
      renderAll();
    },
  });
}

function unmarkWatched(id) {
  const i = state.watched.findIndex(x => x.id === id);
  if (i < 0) return;
  const entry = state.watched.splice(i, 1)[0];
  const copy = Object.assign({}, entry);
  delete copy.watchedAt;
  state.liked.push(copy);
  passed.delete(id);
  save();
  haptic();
  renderAll();
  showToast({
    sub: "Вернули в «Мой вечер»", title: entry.title,
    undo: () => {
      const j = state.liked.findIndex(x => x.id === id);
      if (j >= 0) state.liked.splice(j, 1);
      state.watched.splice(Math.min(i, state.watched.length), 0, entry);
      save();
      renderAll();
    },
  });
}

function deleteLiked(id) {
  const idx = state.liked.findIndex(x => x.id === id);
  if (idx < 0) return;
  const removed = state.liked.splice(idx, 1)[0];
  save();
  refreshList();
  showToast({
    sub: "Удалено из вечера", title: removed.title,
    undo: () => { state.liked.splice(Math.min(idx, state.liked.length), 0, removed); save(); refreshList(); },
  });
}

function deleteWatched(id) {
  const idx = state.watched.findIndex(x => x.id === id);
  if (idx < 0) return;
  const removed = state.watched.splice(idx, 1)[0];
  save();
  refreshList();
  showToast({
    sub: "Удалено из просмотренных", title: removed.title,
    undo: () => { state.watched.splice(Math.min(idx, state.watched.length), 0, removed); save(); refreshList(); },
  });
}

// dir < 0 — смахнули влево (удалить), dir > 0 — вправо (просмотрено / вернуть в вечер)
function commitRow(dir, id) {
  if (listMode === "queue") {
    if (dir < 0) deleteLiked(id);
    else markWatched(state.liked.find(x => x.id === id));
  } else {
    if (dir < 0) deleteWatched(id);
    else unmarkWatched(id);
  }
}

/* Пользователь нажал «Смотреть» → при возвращении в приложение предлагаем отметить фильм просмотренным */
function rememberPending(id) {
  const m = findMovie(id) || sheetMovie;
  if (m && m.id === id && !isWatched(id)) ls.set(PENDING_KEY, JSON.stringify(snap(m)));
}
function checkPending() {
  let p = null;
  try { p = JSON.parse(ls.get(PENDING_KEY) || "null"); } catch (e) {}
  if (!p || !p.id) return;
  ls.set(PENDING_KEY, "");
  if (isWatched(p.id)) return;
  showToast({
    sub: "Посмотрели фильм?", title: p.title, ms: 8000, actionLabel: "Просмотрено",
    undo: () => markWatched(findMovie(p.id) || p),
  });
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(checkPending, 600); });

/* ============ Тост ============ */
let toastTimer = null;
let toastUndoFn = null;
let toastDismissTimer = null;
let toastMs = 3500;

function showToast({ sub, title, id, undo: undoFn, actionLabel, ms }) {
  const t = $("#toast");
  toastUndoFn = undoFn || null;
  toastMs = ms || 3500;
  clearTimeout(toastDismissTimer);
  t.classList.remove("dismissing");
  t.style.transform = ""; t.style.opacity = ""; t.style.transition = "";
  t.style.setProperty("--toast-ms", toastMs + "ms");
  t.innerHTML = `<span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    <div class="tmain" ${id ? `data-open="${id}"` : ""}><small>${esc(sub)}</small><b>${esc(title)}</b></div>
    ${undoFn ? `<button class="tundo" data-undo>${esc(actionLabel || "Отменить")}</button>` : ""}<i class="bar"></i>`;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, toastMs);
}

function hideToast() {
  clearTimeout(toastTimer);
  $("#toast").classList.remove("show");
  syncBarsSoon(900); // когда тост полностью уехал — вернуть safe-зону к цвету фона
}

/* Свайп вверх закрывает уведомление */
(function bindToastDrag() {
  const t = $("#toast");
  let s = null;

  t.addEventListener("pointerdown", e => {
    if (!t.classList.contains("show") || (e.pointerType === "mouse" && e.button !== 0)) return;
    s = { id: e.pointerId, x: e.clientX, y: e.clientY, dy: 0, drag: false, ly: e.clientY, lt: performance.now(), vy: 0 };
  });

  t.addEventListener("pointermove", e => {
    if (!s) return;
    const dy = e.clientY - s.y, dx = e.clientX - s.x;
    if (!s.drag) {
      if (Math.abs(dy) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) { s = null; return; }
      s.drag = true;
      try { t.setPointerCapture(s.id); } catch (err) {}
      // Пока палец на уведомлении — не закрываем его по таймеру
      clearTimeout(toastTimer);
      const bar = t.querySelector(".bar");
      if (bar) bar.style.animationPlayState = "paused";
      t.style.transition = "none";
    }
    s.dy = dy;
    const now = performance.now(), dt = now - s.lt;
    if (dt > 8) { s.vy = 0.6 * s.vy + 0.4 * ((e.clientY - s.ly) / dt); s.ly = e.clientY; s.lt = now; }
    const y = dy < 0 ? dy : dy * 0.15;
    t.style.transform = `translate(-50%, ${y}px)`;
    t.style.opacity = String(Math.max(0.25, 1 + Math.min(dy, 0) / 110));
  });

  const end = () => {
    if (!s) return;
    const d = s; s = null;
    if (!d.drag) return;
    const bar = t.querySelector(".bar");
    t.style.transition = "";
    if (d.dy < -32 || d.vy < -0.45) {
      haptic();
      t.classList.add("dismissing");
      t.style.transform = ""; t.style.opacity = "";
      hideToast();
      clearTimeout(toastDismissTimer);
      toastDismissTimer = setTimeout(() => { t.classList.remove("dismissing"); syncBarsSoon(0); }, 450);
    } else {
      t.style.transform = ""; t.style.opacity = "";
      if (bar) { bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = ""; bar.style.animationPlayState = ""; }
      clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, toastMs);
    }
  };
  t.addEventListener("pointerup", end);
  t.addEventListener("pointercancel", end);
})();

/* ============ Кнопка «Смотреть» ============ */
function watchButton(m, cls) {
  const url = state.urls[m.id];
  if (url && validUrl(url)) return `<a class="btn ${cls}" data-watch="${m.id}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ICON_PLAY}Смотреть</a>`;
  return `<button class="btn ${cls}" data-add-src="${m.id}">${ICON_PLAY}Смотреть</button>`;
}

/* ============ Список «Мой вечер» ============ */
let categoryOrder = [];

function rowHtml(m, i, watchedMode) {
  const meta = [m.year, dur(m.runtime), `★ ${(m.rating || 0).toFixed(1)}`].filter(Boolean).join(" · ");
  const date = watchedMode && m.watchedAt ? `<div class="row-date">Просмотрено ${esc(fmtDate(m.watchedAt))}</div>` : "";
  return `<div class="row-container" data-id="${m.id}" style="--i:${Math.min(i, 8)}">
    <div class="row-watch-bg" aria-hidden="true"><span>${watchedMode ? "В вечер" : "Просмотрено"}</span></div>
    <div class="row-delete-bg" aria-hidden="true"><span>Удалить</span></div>
    <div class="row">
      <div class="thumb">${posterHtml(m.poster, "w185", m.title)}</div>
      <div class="row-main">
        <div class="row-title">${esc(m.title)}</div>
        <div class="row-meta">${meta}</div>
        ${date}
      </div>
    </div>
  </div>`;
}

function renderList() {
  const list = $("#list");
  const watchedMode = listMode === "watched";
  const items = watchedMode ? state.watched : state.liked;

  if (!items.length) {
    if (!watchedMode) categoryOrder = [];
    list.innerHTML = watchedMode
      ? `<div class="empty" style="position:static;flex:1">
          <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>
          <h2>Пока ничего не просмотрено</h2><p>Смахните фильм вправо в списке «К просмотру» или нажмите «Отметить просмотренным» в карточке фильма.</p></div>`
      : `<div class="empty" style="position:static;flex:1">
          <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.6 4.5 6.4 4.5c2.2 0 3.6 1.2 4.6 2.7h2c1-1.5 2.4-2.7 4.6-2.7 3.8 0 5.5 3.9 4 7.3C19.5 16.4 12 21 12 21z"/></svg>
          <h2>Вечер пока пуст</h2><p>Свайпайте вправо фильмы, которые хочется посмотреть. Они появятся здесь.</p></div>`;
    return;
  }

  const known = items.filter(m => m.runtime);
  const total = known.reduce((s, m) => s + m.runtime, 0);
  const totalText = known.length
    ? (watchedMode ? `Всего ${known.length < items.length ? "около " : ""}${dur(total)} кино` : `Всего ${known.length < items.length ? "около " : ""}${dur(total)} без перерывов`)
    : "Считаю длительность…";

  const scroll = list.scrollTop;
  let html = `<div class="summary" style="--i:0"><b>${items.length} ${plural(items.length)}</b><span>${totalText}</span></div>`;
if (!watchedMode && items.length >= 2) html += wheelCtaHtml(items, 1);
  let idx = 2;

  if (watchedMode) {
    html += `<div class="category-section">`;
    for (const m of items) html += rowHtml(m, idx++, true);
    html += `</div>`;
  } else {
    const groups = {};
    items.forEach(m => {
      const cat = (m.category = categoryOf(m));
      (groups[cat] = groups[cat] || []).push(m);
    });
    const current = Object.keys(groups);
    categoryOrder = categoryOrder.filter(c => current.includes(c));
    current.forEach(c => { if (!categoryOrder.includes(c)) categoryOrder.push(c); });
    for (const cat of categoryOrder) {
      html += `<div class="category-section" data-category="${esc(cat)}"><div class="list-category-title">${esc(cat)}</div>`;
      for (const m of groups[cat]) html += rowHtml(m, idx++, false);
      html += `</div>`;
    }
  }

  list.innerHTML = html;
  list.scrollTop = scroll;
  bindRowSwipe();
}

function setListMode(mode) {
  if (mode === listMode) return;
  listMode = mode;
  $("#seg-queue").setAttribute("aria-selected", mode === "queue");
  $("#seg-watched").setAttribute("aria-selected", mode === "watched");
  const l = $("#list");
  renderList();
  l.scrollTop = 0;
  l.classList.remove("enter"); void l.offsetWidth; l.classList.add("enter");
  setTimeout(() => l.classList.remove("enter"), 1200);
}

/* Плавное удаление / перенос: строка уезжает с места пальца до конца,
   потом блок схлопывается по высоте, и только после этого обновляются данные. */
// Ширина плашки = открытая часть под сдвинутой строкой (dx > 0 — «Просмотрено», dx < 0 — «Удалить»)
function setPlates(container, dx) {
  const w = container.querySelector(".row-watch-bg"), d = container.querySelector(".row-delete-bg");
  if (w) w.style.width = dx > 0 ? dx + "px" : "0px";
  if (d) d.style.width = dx < 0 ? -dx + "px" : "0px";
}

async function removeRow(row, container, section, fromX, dir, commit) {
  if (container.classList.contains("gone")) return;
  haptic();
  container.classList.remove("dragging");
  container.classList.add("gone");
  void container.offsetWidth;
  setPlates(container, dir * container.offsetWidth); // плашка плавно растёт вслед за уезжающей строкой

  const siblings = section ? section.querySelectorAll(".row-container:not(.gone)").length : 1;
  const target = section && siblings === 0 ? section : container;

  if (!RM() && row.animate) {
    const w = row.offsetWidth || innerWidth;
    row.style.transition = "none";
    const remaining = Math.max(0, w - dir * fromX) / w;
    const slide = row.animate(
      [{ transform: `translateX(${fromX}px)`, opacity: 1 }, { transform: `translateX(${dir * w}px)`, opacity: 0 }],
      { duration: 200 + remaining * 160, easing: "cubic-bezier(.3,.6,.35,1)", fill: "forwards" }
    );
    try { await slide.finished; } catch (e) {}

    const h = target.offsetHeight;
    target.style.overflow = "hidden";
    const collapse = target.animate(
      [{ height: h + "px", opacity: 1, marginTop: "0px" }, { height: "0px", opacity: 0, marginTop: "-8px" }],
      { duration: 380, easing: EASE, fill: "forwards" }
    );
    try { await collapse.finished; } catch (e) {}
  }
  commit();
}

function bindRowSwipe() {
  document.querySelectorAll("#list .row").forEach(row => {
    let startX = 0, startY = 0, dx = 0, dragging = false, locked = false, moved = false;
    const container = row.closest(".row-container");
    const section = row.closest(".category-section");
    const id = +container.dataset.id;
    const clearDir = () => { container.classList.remove("dragging"); setPlates(container, 0); };

    row.addEventListener("pointerdown", e => {
      cancelRowHint(row);
      if (container.classList.contains("gone")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY; dx = 0;
      dragging = true; locked = false; moved = false;
      row.style.transition = "none";
      try { row.setPointerCapture(e.pointerId); } catch (err) {}
    });

    row.addEventListener("pointermove", e => {
      if (!dragging) return;
      dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;

      if (!locked) {
        if (Math.abs(dy) > Math.abs(dx) + 2) {
          dragging = false;
          clearDir();
          row.style.transition = "";
          row.style.transform = "";
          return;
        }
        if (Math.abs(dx) > 6) { locked = true; container.classList.add("dragging"); }
      }
      if (locked) {
        row.style.transform = `translateX(${dx}px)`;
        setPlates(container, dx);
      }
    });

    const finish = () => {
      if (!dragging && !locked) { clearDir(); row.style.transition = ""; return; }
      dragging = false;

      if (locked && Math.abs(dx) > 70) {
        const from = dx, dir = dx < 0 ? -1 : 1;
        locked = false; dx = 0;
        removeRow(row, container, section, from, dir, () => commitRow(dir, id));
        return;
      }

      row.style.transition = "";
      row.style.transform = "";
      clearDir();
      if (!moved) { const m = findMovie(id); if (m) openSheet(m); }
      locked = false; dx = 0;
    };
    row.addEventListener("pointerup", finish);
    row.addEventListener("pointercancel", finish);
  });
}

function findMovie(id) {
  return deck.find(m => m.id === id)
    || state.liked.find(m => m.id === id)
    || state.watched.find(m => m.id === id)
    || history_.map(h => h.movie).find(m => m.id === id)
    || (sheetMovie && sheetMovie.related && sheetMovie.related.find(m => m.id === id));
}

/* ============ Слои (шторки) + кнопка «Назад» ============ */
let layerPushed = false;
let pendingBack = 0;
let sheetTimer = null, filtersTimer = null;

function pushLayer() {
  if (layerPushed) return;
  try { history.pushState({ layer: 1 }, ""); layerPushed = true; } catch (e) {}
}
// Шторка закрывается сразу, а history.back() вызывается «вслепую» и его popstate игнорируется.
// Раньше быстрое закрыть → открыть приводило к тому, что запоздавший popstate закрывал уже новую шторку.
function closeLayer() {
  const rv = document.getElementById("wheel-reveal");
  if (rv && !rv.classList.contains("out")) return hideReveal();
  const w = document.getElementById("wheel-overlay"), ov = $("#overlay");
  if (w && !w.hidden && !w.classList.contains("closing") && !ov.hidden && !ov.classList.contains("closing")) return closeSheetUI();
  hideLayers();
  if (layerPushed) {
    layerPushed = false;
    pendingBack++;
    try { history.back(); } catch (e) { pendingBack--; }
  }
}
window.addEventListener("popstate", () => {
  if (pendingBack > 0) { pendingBack--; return; }
  layerPushed = false;
  hideLayers();
});

// Жёстко убиваем YouTube-плеер: iframe с видео — самая тяжёлая часть шторки,
// и если его не удалять из DOM сразу, iOS копит память и убивает вкладку.
function killPlayer() {
  const frame = document.querySelector("#overlay iframe");
  if (!frame) return;
  try { frame.src = "about:blank"; } catch (e) {}
  frame.remove();
}

function closeSheetUI() {
  const o = $("#overlay");
  if (o.hidden) return;
  sheetMovie = null;
  killPlayer();
  o.classList.add("closing");
  const sheet = $("#sheet-element");
  if (sheet) sheet.classList.add("dismissing");
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(() => { o.hidden = true; o.innerHTML = ""; o.classList.remove("closing"); }, 340);
}

function closeFiltersUI() {
  const o = $("#filters-overlay");
  if (o.hidden) return;
  o.classList.add("closing");
  const sheet = $("#filters-sheet-element");
  if (sheet) sheet.classList.add("dismissing");
  clearTimeout(filtersTimer);
  filtersTimer = setTimeout(() => {
    o.hidden = true;
    o.classList.remove("closing");
    if (sheet) { sheet.classList.remove("dismissing"); sheet.style.transform = ""; }
    o.style.opacity = "";
  }, 340);
}

/* Свайп шторки вниз (touch-события, чтобы не конфликтовать со скроллом) */
function bindSheetDrag(sheet, overlay) {
  if (!sheet) return;
  let startY = 0, startX = 0, dy = 0, tracking = false, dragging = false, lastY = 0, lastT = 0, vy = 0, startTarget = null;

  // Прокручен ли вниз хоть один элемент от касания до шторки (сама шторка или вложенный список, например сетка жанров)
  const scrolledInside = el => {
    for (let n = el; n; n = n.parentElement) {
      if (n.scrollTop > 0) return true;
      if (n === sheet) break;
    }
    return false;
  };

  sheet.addEventListener("touchstart", e => {
    if (e.touches.length !== 1 || scrolledInside(e.target) || e.target.closest("input, iframe, .related-scroll, .wheel-stage")) { tracking = false; return; }
    startTarget = e.target;
    const t = e.touches[0];
    startY = lastY = t.clientY; startX = t.clientX; lastT = performance.now();
    tracking = true; dragging = false; dy = 0; vy = 0;
  }, { passive: true });

  sheet.addEventListener("touchmove", e => {
    if (!tracking) return;
    const t = e.touches[0];
    dy = t.clientY - startY;
    const dx = t.clientX - startX;
    if (!dragging) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { tracking = false; return; }
      if (dy < -8 || scrolledInside(startTarget)) { tracking = false; return; } // это прокрутка содержимого, а не закрытие
      if (dy > 8) { dragging = true; sheet.style.transition = "none"; }
      else return;
    }
    e.preventDefault();
    const now = performance.now();
    if (now - lastT > 8) { vy = (t.clientY - lastY) / (now - lastT); lastY = t.clientY; lastT = now; }
    const y = Math.max(0, dy);
    sheet.style.transform = `translateY(${y}px)`;
    overlay.style.opacity = Math.max(0.2, 1 - y / 400);
  }, { passive: false });

  const end = () => {
    if (!tracking) return;
    tracking = false;
    if (!dragging) return;
    dragging = false;
    if (dy > 110 || vy > 0.6) {
      overlay.style.transition = "";
      closeLayer();
    } else {
      sheet.style.transition = `transform .5s ${SPRING}`;
      sheet.style.transform = "";
      overlay.style.transition = "opacity .4s ease";
      overlay.style.opacity = "";
    }
  };
  sheet.addEventListener("touchend", end);
  sheet.addEventListener("touchcancel", end);
}

/* ============ Шторка фильма ============ */
function mediaHtml(m) {
  const back = TMDB.img(m.backdrop, "w780") || TMDB.img(m.poster, "w780");
  return `${back ? `<img src="${back}" alt="">` : ""}<div class="spinner"></div>`;
}
function playerHtml(key) {
  const mute = IS_IOS ? "&mute=1" : "";
  return `<iframe src="https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0&playsinline=1${mute}" title="Трейлер"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}
function showTrailer(key) {
  const mm = $("#sheet-media");
  if (!mm) return;
  if (TRAILER_AUTOPLAY) { mm.innerHTML = playerHtml(key); return; }
  const sp = mm.querySelector(".spinner"); if (sp) sp.remove();
  mm.insertAdjacentHTML("beforeend", `<button class="play-btn" data-play="${esc(key)}" aria-label="Смотреть трейлер">${ICON_PLAY}</button>`);
}

const toggleLabel = m => isLiked(m.id) ? "Убрать из вечера" : isWatched(m.id) ? "Убрать из просмотренных" : "В мой вечер";
const watchedInner = m => isWatched(m.id) ? `${ICON_CHECK}Просмотрено · вернуть в вечер` : `${ICON_CHECK}Отметить просмотренным`;

// Нижняя панель действий — внизу экрана, в зоне большого пальца
function actionsHtml(m) {
  const mid = sheetFromWheel
    ? `<button class="btn" data-respin>${ICON_DICE}Крутить ещё</button>`
    : `<button class="btn" data-toggle="${m.id}"><span class="btn-label fade-in">${toggleLabel(m)}</span></button>`;
  return `<button class="btn icon" data-close aria-label="Закрыть">${ICON_CLOSE}</button>
    ${watchButton(m, "primary")}${mid}`;
}

// Обновляет кнопки открытой шторки после любого изменения списков
function syncSheetButtons() {
  if (!sheetMovie) return;
  const label = document.querySelector("#sheet-actions [data-toggle] .btn-label");
  if (label) label.textContent = toggleLabel(sheetMovie);
  const w = $("#sheet-watched");
  if (w) { w.innerHTML = watchedInner(sheetMovie); w.classList.toggle("on", isWatched(sheetMovie.id)); }
}

function openSheet(m, focusSrc) {
  hideToast();
  killPlayer(); // если открываем «похожий фильм» поверх другой шторки
  const o = $("#overlay");
  clearTimeout(sheetTimer);
  sheetMovie = Object.assign({}, m);
  const id = m.id;
  const url = state.urls[id] || "";

  sheetFromWheel = wheelNext; wheelNext = false;
  o.classList.remove("closing");
  o.style.opacity = "";
  o.innerHTML = `<div class="sheet movie-sheet" role="dialog" aria-modal="true" aria-label="${esc(m.title)}" id="sheet-element">
    <div class="sheet-media" id="sheet-media">${mediaHtml(m)}</div>
    <button class="close" data-close aria-label="Закрыть"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="sheet-body">
      <div class="sheet-title"><h2>${esc(m.title)}</h2><div class="o" id="sheet-sub"></div></div>
      <div class="tags" id="sheet-tags"></div>
      <p id="sheet-overview"></p>
      <dl class="facts" id="sheet-facts"></dl>
      <button class="btn watched-btn ${isWatched(id) ? "on" : ""}" id="sheet-watched" data-watched>${watchedInner(m)}</button>
      <div class="src">
        <label for="src-input">Ссылка на ваш файл с фильмом</label>
        <div class="src-row"><input id="src-input" type="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://… (ваш сервер или Google Drive)" value="${esc(url)}"><button class="btn" id="src-save">Сохранить</button></div>
        <small id="src-note">${url ? "Ссылка сохранена. Кнопка «Смотреть» откроет её в новой вкладке." : "Вставьте ссылку один раз, дальше «Смотреть» будет открывать фильм сразу."}</small>
      </div>
      <div class="related-section" id="related-section"></div>
      <div class="sheet-actions" id="sheet-actions">${actionsHtml(m)}</div>
    </div></div>`;
  o.hidden = false;
  pushLayer();
  fillSheetInfo(sheetMovie);
  if (focusSrc) {
    $("#src-input").focus();
    $("#src-note").textContent = "Сначала добавьте ссылку на этот фильм, потом «Смотреть» заработает.";
  }
  bindSheetDrag($("#sheet-element"), o);

  TMDB.details(id).then(d => {
    if (!sheetMovie || sheetMovie.id !== id) return;
    sheetMovie = Object.assign(sheetMovie, d);
    fillSheetInfo(sheetMovie);

    const stored = findStored(id);
    if (stored && (!stored.runtime || !stored.genres.length)) {
      if (d.runtime) stored.runtime = d.runtime;
      if (d.genres.length) stored.genres = d.genres;
      save(); refreshList();
    }

    const media = $("#sheet-media");
    if (media) {
      if (d.trailerKey) setTimeout(() => {
        if (!sheetMovie || sheetMovie.id !== id) return;
        showTrailer(d.trailerKey);
      }, 450);
      else {
        const sp = media.querySelector(".spinner"); if (sp) sp.remove();
        media.insertAdjacentHTML("beforeend", `<div class="no-trailer"><span>Трейлер не найден</span><a class="btn" href="${youtubeSearch(sheetMovie)}" target="_blank" rel="noopener noreferrer">Искать на YouTube</a></div>`);
      }
    }
    renderRelated(d.related);
  }).catch(() => {
    if (!sheetMovie || sheetMovie.id !== id) return;
    const media = $("#sheet-media");
    if (media) {
      const sp = media.querySelector(".spinner"); if (sp) sp.remove();
      media.insertAdjacentHTML("beforeend", `<div class="no-trailer"><span>Не удалось загрузить трейлер</span><a class="btn" href="${youtubeSearch(sheetMovie)}" target="_blank" rel="noopener noreferrer">YouTube</a></div>`);
    }
  });
}

function fillSheetInfo(m) {
  $("#sheet-sub").textContent = [m.orig && m.orig !== m.title ? m.orig : "", m.year, dur(m.runtime)].filter(Boolean).join(" · ");
  $("#sheet-tags").innerHTML = (m.genres || []).map(x => `<span class="tag">${esc(x)}</span>`).join("");
  $("#sheet-overview").textContent = m.overview || (m.runtime ? "У этого фильма пока нет описания на выбранном языке." : "");
  const facts = [["Рейтинг", m.rating ? `★ ${m.rating.toFixed(1)}` : ""], ["Режиссёр", m.director], ["В ролях", (m.cast || []).join(", ")]].filter(f => f[1]);
  $("#sheet-facts").innerHTML = facts.map(f => `<dt>${f[0]}</dt><dd>${esc(f[1])}</dd>`).join("");
}

function renderRelated(related) {
  const sec = $("#related-section");
  if (!sec || !related || !related.length) return;
  sec.innerHTML = `<div class="related-title">Похожие фильмы</div>
    <div class="related-scroll">${related.slice(0, 8).map(r => `
      <div class="related-card" data-related-id="${r.id}">
        <div class="related-poster">${r.poster ? `<img src="${TMDB.img(r.poster, "w185")}" alt="${esc(r.title)}" loading="lazy" decoding="async">` : ""}</div>
        <div class="related-name">${esc(r.title)}</div>
      </div>`).join("")}</div>`;
  anim(sec, FX_IN);
}

function saveSrc() {
  if (!sheetMovie) return;
  const id = sheetMovie.id;
  const v = $("#src-input").value.trim();
  if (v && !validUrl(v)) { $("#src-note").textContent = "Ссылка должна начинаться с http:// или https://"; return; }
  if (v) state.urls[id] = v; else delete state.urls[id];
  save();
  $("#sheet-actions").innerHTML = actionsHtml(sheetMovie);
  $("#src-note").textContent = v ? "Ссылка сохранена. Кнопка «Смотреть» откроет её в новой вкладке." : "Ссылка удалена.";
}

let toggling = false;
function toggleLike(m) {
  if (!m || toggling) return;
  toggling = true;
  const wasLiked = isLiked(m.id);
  const wasWatched = isWatched(m.id);
  const btn = document.querySelector("#sheet-actions [data-toggle]");
  const label = btn ? btn.querySelector(".btn-label") : null;
  const removing = wasLiked || wasWatched;

  if (btn) {
    btn.classList.remove("pop-stroke-red", "pop-stroke-green");
    void btn.offsetWidth;
    btn.classList.add(removing ? "pop-stroke-red" : "pop-stroke-green");
    burst(btn, removing ? "var(--nope)" : "var(--user-accent)", 10);
    haptic();
    if (label) { label.classList.remove("fade-in"); label.classList.add("fade-out"); }
  }

  setTimeout(() => {
    if (wasLiked) {
      state.liked = state.liked.filter(x => x.id !== m.id);
    } else if (wasWatched) {
      state.watched = state.watched.filter(x => x.id !== m.id);
    } else {
      state.liked.push(snap(m));
      passed.delete(m.id);
      deck = deck.filter(d => d.id !== m.id);
      if (!m.runtime) loadRuntime(m.id);
    }
    save();
    renderAll();
    if (sheetMovie && sheetMovie.id === m.id) {
      if (label && label.isConnected) {
        label.textContent = toggleLabel(m);
        label.classList.remove("fade-out");
        label.classList.add("fade-in");
      } else $("#sheet-actions").innerHTML = actionsHtml(sheetMovie);
    }
    toggling = false;
  }, 200);
}

/* ============ Фильтры ============ */
function updateFilterBadge() {
  const b = $("#filter-count");
  b.textContent = state.multiGenres.length;
  b.hidden = !state.multiGenres.length;
}

function openFiltersModal() {
  const sel = new Set(state.multiGenres.map(String));
  $("#filter-grid").innerHTML = genres.map(g => `
    <label class="filter-item">
      <input type="checkbox" value="${g.id}" ${sel.has(String(g.id)) ? "checked" : ""}>
      <span>${esc(g.name)}</span>
    </label>`).join("");
  const o = $("#filters-overlay");
  clearTimeout(filtersTimer);
  o.classList.remove("closing");
  o.style.opacity = "";
  $("#filters-sheet-element").classList.remove("dismissing");
  o.hidden = false;
  pushLayer();
  bindFilterDragOnce();
}

let filterDragBound = false;
function bindFilterDragOnce() {
  if (filterDragBound) return;
  filterDragBound = true;
  bindSheetDrag($("#filters-sheet-element"), $("#filters-overlay"));
}

function applyFiltersModal() {
  state.multiGenres = [...$("#filter-grid").querySelectorAll("input:checked")]
    .map(i => (i.value === "anime" || isNaN(i.value) ? i.value : +i.value));
  save();
  updateFilterBadge();
  closeLayer();
  deck = []; history_ = []; paging = newPaging();
  refill("filter");
}

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

/* ============ Колесо на вечер ============ */
// Вставить в app.js ПЕРЕД блоком «/* ============ Запуск ============ */»

const ICON_DICE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="8.5" cy="15.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="15.5" r=".9" fill="currentColor"/></svg>`;
const WHEEL_TIMES = [[0, "Любое время"], [90, "до 1,5 ч"], [120, "до 2 ч"], [150, "до 2,5 ч"]];

let wheelNext = false;       // «следующая шторка открыта из колеса»
let sheetFromWheel = false;  // текущая шторка открыта из колеса (меняет нижнюю панель)
const wheelOpts = { maxRt: 0, genre: "" };
const wheelRejected = new Set(); // отклонённые в этой сессии колеса («Крутить ещё»)
let wheelCurrent = null;     // фильм в центре окна
let wheelWon = false;
let wheelSpinning = false;
let wheelRaf = 0, wheelOpenTimer = 0, wheelCloseTimer = 0;

const wheelEl = () => document.getElementById("wheel-overlay");

function wheelPool() {
  const { maxRt, genre } = wheelOpts;
  return state.liked.filter(m =>
    (!maxRt || (m.runtime && m.runtime <= maxRt)) &&
    (!genre || (m.genres || []).includes(genre) || m.category === genre));
}

/* ---------- Карусель на весь экран (2D) ---------- */
const WHEEL_BASE = "#07080c";   // фон экрана; им же красим safe-зоны
const WHEEL_COLORS = ["#2fb3a8", "#e8683f", "#7c4dff", "#e8a317", "#d63384", "#2f6fe0", "#2bb673", "#d9413d", "#12a8c9", "#7fb71a", "#c05bd6", "#e07b28"];
const WHEEL_MAX = 24;           // больше постеров в карусели не держим — берём случайную выборку
const ICON_SPIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>`;

let wheelSegs = [];      // фильмы в карусели
let wheelEls = [];       // карточки
let wheelBgs = [];       // размытые фоны под каждым постером
let wheelDots = [];      // точки-индикаторы
let wheelPos = 0;        // позиция в «карточках»: карточка i по центру, когда wheelPos ≡ i (mod n)
let wheelPitch = 140;    // шаг между центрами карточек, px
let wheelWinIdx = -1;
let wheelLastIdx = -1;
let wheelLastTick = 0;
let wheelDragging = false;
let wheelSwallow = false; // после «зажать и отпустить» глушим следующий click

const mod = (a, n) => ((a % n) + n) % n;
const easeOut = (t, p = 3) => 1 - Math.pow(1 - t, p);
function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const wheelIdxAt = pos => (wheelSegs.length ? mod(Math.round(pos), wheelSegs.length) : 0);

/* ---------- Кнопка-вход в «Мой вечер» ---------- */
let ctaKey = "", ctaPicks = [];
function wheelCtaHtml(items, i) {
  // Веер постеров стабилен, пока не изменился состав списка (иначе картинки мигали бы при каждой перерисовке)
  const key = items.map(m => m.id).join(",");
  if (key !== ctaKey) { ctaKey = key; ctaPicks = shuffleArr(items.filter(m => m.poster)).slice(0, 3); }
  const c = ctaPicks.length, mid = (c - 1) / 2;
  const fan = ctaPicks.map((m, k) => ({ m, k }))
    .sort((a, b) => Math.abs(b.k - mid) - Math.abs(a.k - mid)) // центральный — сверху
    .map(({ m, k }) => `<i style="--k:${k};--c:${c};background-image:url('${TMDB.img(m.poster, "w185")}')"></i>`).join("");
  return `<button class="wheel-cta" id="btn-wheel" style="--i:${i}">
    <span class="cta-fan" aria-hidden="true">${fan}</span>
    <span class="cta-text">
      <b>Что смотрим сегодня?</b>
      <small>Случайный фильм из ${items.length}</small>
      <span class="cta-go">${ICON_DICE}Выбрать за меня</span>
    </span>
  </button>`;
}

/* ---------- Открытие / закрытие ---------- */
function openWheel() {
  if (!state.liked.length) return;
  let o = wheelEl();
  if (!o) {
    o = document.createElement("div");
    o.className = "backdrop wheel-backdrop";
    o.id = "wheel-overlay";
    o.hidden = true;
    o.addEventListener("click", wheelClick);
    document.body.appendChild(o);
  }
  cancelAnimationFrame(wheelRaf);
  wheelRejected.clear();
  wheelCurrent = null; wheelWon = false; wheelSpinning = false; wheelWinIdx = -1; wheelLastIdx = -1; wheelPos = 0; wheelDragging = false;
  wheelOpts.maxRt = 0; wheelOpts.genre = "";
  hideToast();
  clearTimeout(wheelCloseTimer);
  o.innerHTML = `<div class="wheel-fs" id="wheel-fs" role="dialog" aria-modal="true" aria-label="Что смотрим сегодня">
    <div class="wf-bgs" id="wf-bgs" aria-hidden="true"></div>
    <div class="wf-top">
      <button class="wf-x" data-close aria-label="Закрыть">${ICON_CLOSE}</button>
      <h2 class="wf-title">Что смотрим сегодня?</h2>
      <span class="wf-sp"></span>
    </div>
    <div class="wf-filters">
      <div class="wheel-chips" id="wheel-times"></div>
      <div class="wheel-chips" id="wheel-genres"></div>
    </div>
    <div class="car" id="wheel-stage"><div class="car-track" id="wheel-track"></div></div>
    <div class="wf-dots" id="wf-dots" aria-hidden="true"></div>
    <div class="wheel-now" id="wheel-now"></div>
    <div class="wheel-status" id="wheel-status"></div>
    <div class="wheel-actions">
      <button class="btn glass" id="wheel-open" hidden>Подробнее</button>
      <button class="btn primary" id="wheel-spin"></button>
    </div></div>`;
  o.classList.remove("closing");
  o.style.opacity = "";
  o.hidden = false;
  pushLayer();
  revealBarsOn(WHEEL_BASE);
  bindWheelStage();
  bindWheelCharge();
  wheelRender(true);
}

function closeWheelUI() {
  const o = wheelEl();
  if (!o || o.hidden) return;
  cancelAnimationFrame(wheelRaf);
  clearTimeout(wheelOpenTimer);
  wheelSpinning = false; wheelDragging = false;
  o.classList.add("closing");
  clearTimeout(wheelCloseTimer);
  wheelCloseTimer = setTimeout(() => { o.hidden = true; o.classList.remove("closing"); o.innerHTML = ""; o.style.opacity = ""; revealBarsOff(); }, 340);
}

function wheelClick(e) {
  if (e.target.id === "wheel-reveal") return hideReveal();
  const b = e.target.closest("button");
  if (!b || wheelSpinning) return;
  if (b.id === "reveal-more") { hideReveal(); setTimeout(() => wheelSpin(), 200); return; }
  if (b.id === "reveal-watch" || b.id === "reveal-card") { hideReveal(); openWheelPick(); return; }
  if (b.dataset.wtime !== undefined) { wheelOpts.maxRt = +b.dataset.wtime; wheelWon = false; wheelRender(); }
  else if (b.dataset.wgenre !== undefined) { wheelOpts.genre = b.dataset.wgenre; wheelWon = false; wheelRender(); }
  else if (b.id === "wheel-spin") { if (wheelSwallow) { wheelSwallow = false; return; } wheelSpin(); }
  else if (b.id === "wheel-open") openWheelPick();
}

// «Крутить ещё» в шторке фильма
document.addEventListener("click", e => {
  if (e.target.closest("[data-respin]")) { closeSheetUI(); wheelSpin(); }
});
// Кнопка-вход в списке «К просмотру»
$("#list").addEventListener("click", e => { if (e.target.closest("#btn-wheel")) openWheel(); });
addEventListener("resize", () => { if ($("#wheel-stage")) wheelLayout(); });

/* ---------- Содержимое и фильтры ---------- */
function wheelRender(intro) {
  if (!$("#wheel-fs")) return;
  const cnt = {};
  state.liked.forEach(m => (m.genres || []).forEach(g => (cnt[g] = (cnt[g] || 0) + 1)));
  const gl = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, 8);
  if (wheelOpts.genre && !gl.includes(wheelOpts.genre)) wheelOpts.genre = "";

  $("#wheel-times").innerHTML = WHEEL_TIMES.map(([v, l]) =>
    `<button class="wchip" data-wtime="${v}" aria-pressed="${wheelOpts.maxRt === v}">${l}</button>`).join("");
  $("#wheel-genres").innerHTML =
    `<button class="wchip" data-wgenre="" aria-pressed="${!wheelOpts.genre}">Любой жанр</button>` +
    gl.map(g => `<button class="wchip" data-wgenre="${esc(g)}" aria-pressed="${wheelOpts.genre === g}">${esc(g)}</button>`).join("");

  cancelAnimationFrame(wheelRaf);
  clearTimeout(wheelOpenTimer);
  const token = ++wheelIntroToken;
  wheelCurrent = null; wheelWinIdx = -1;
  wheelBuildCards();
  wheelUpdateUi();

  // Появление: карусель «заезжает» слева и мягко тормозит на первом постере.
  // Старт — только после декодирования постеров и пока шторка закончила открываться, без тактильных «тиков».
  if (intro && !RM() && wheelSegs.length > 1) {
    wheelPos = -2.8;
    wheelApply(false);
    const imgs = [...document.querySelectorAll("#wheel-track img")].map(im => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()));
    Promise.race([Promise.all(imgs), wait(700)]).then(() => wait(120)).then(() => {
      if (token !== wheelIntroToken || !$("#wheel-fs") || wheelSpinning || wheelDragging) return;
      requestAnimationFrame(() => wheelTween(0, 1400, t => easeOut(t, 3), null, false));
    });
  }
}

// Набор постеров: весь пул, если он влезает, иначе случайная выборка из ещё не отклонённых
// Отклонённые фильмы (с крестиком) остаются в карусели и крутятся вместе с остальными
function wheelBuildSegs() {
  const pool = wheelPool();
  let cands = pool.filter(m => !wheelRejected.has(m.id));
  if (!cands.length) { wheelRejected.clear(); cands = pool; }
  if (pool.length <= WHEEL_MAX) { wheelSegs = shuffleArr(pool); return; }
  const rej = pool.filter(m => wheelRejected.has(m.id)).slice(0, 6);
  wheelSegs = shuffleArr(shuffleArr(cands).slice(0, WHEEL_MAX - rej.length).concat(rej));
}

function wheelBuildCards() {
  wheelBuildSegs();
  const track = $("#wheel-track"), bgs = $("#wf-bgs"), dots = $("#wf-dots");
  if (!track) return;
  track.innerHTML = wheelSegs.map((m, i) => {
    const src = m.poster ? TMDB.img(m.poster, "w342") : null;
    return `<div class="cc" data-i="${i}"><div class="cc-face">
      ${src ? `<img src="${src}" alt="" draggable="false" decoding="async">` : `<span class="cc-ph">${esc((m.title || "?").charAt(0).toUpperCase())}</span>`}
      <span class="cc-shade"></span><span class="cc-out">✕</span></div></div>`;
  }).join("");
  wheelEls = [...track.children];
  wheelEls.forEach(el => { el._shade = el.querySelector(".cc-shade"); });

  // Размытый фон: всего два слоя, которые плавно сменяют друг друга
  wheelBgUrls = wheelSegs.map(m => (m.poster ? TMDB.img(m.poster, "w185") : null));
  wheelBgUrls.forEach(u => { if (u) { const im = new Image(); im.src = u; } });
  bgs.innerHTML = `<i></i><i></i>`;
  wheelBgs = [...bgs.children];
  wheelBgIdx = -1; wheelBgFlip = 0; clearTimeout(wheelBgTimer);
  dots.innerHTML = wheelSegs.length > 1 ? wheelSegs.map(() => "<i></i>").join("") : "";
  wheelDots = [...dots.children];

  wheelPos = 0;
  wheelLastIdx = -1;
  wheelLayout();
  wheelMarkRejected();
  wheelApply(false);
}

function wheelLayout() {
  const st = $("#wheel-stage");
  if (!st) return;
  const w = st.clientWidth, h = st.clientHeight;
  const cw = Math.max(96, Math.min(w * 0.56, (h - 34) / 1.5, 300));
  wheelPitch = cw * 0.76;
  st.style.setProperty("--cw", cw.toFixed(1) + "px");
  if (wheelSegs.length) wheelApply(false);
}

function wheelMarkRejected() {
  wheelEls.forEach((c, i) => {
    const out = !!wheelSegs[i] && wheelRejected.has(wheelSegs[i].id);
    c.classList.toggle("out", out);
    if (wheelDots[i]) wheelDots[i].classList.toggle("out", out);
  });
}

function wheelSetNow(m, win) {
  const el = $("#wheel-now");
  if (!el) return;
  el.classList.toggle("win", !!win);
  if (!m) { el.innerHTML = "<b>Нет фильмов под эти условия</b>"; return; }
  const meta = [m.year, dur(m.runtime), `★ ${(m.rating || 0).toFixed(1)}`].filter(Boolean).join(" · ");
  el.innerHTML = `<b>${esc(m.title)}</b><span>${esc(meta)}</span>`;
}

/* ---------- Раскладка карточек по позиции ---------- */
function wheelApply(live) {
  const n = wheelSegs.length;
  if (!n) return;
  for (let i = 0; i < n; i++) {
    const el = wheelEls[i];
    let d = i - wheelPos;
    d -= n * Math.round(d / n);                 // ближайшее смещение от центра, с зацикливанием
    const a = Math.abs(d);
    if (a > 3) { if (!el._h) { el.style.visibility = "hidden"; el._h = true; } continue; }
    if (el._h) { el.style.visibility = ""; el._h = false; }
    const s = 1 - 0.2 * Math.min(a, 1.6);
    el.style.transform = `translate3d(${(d * wheelPitch).toFixed(1)}px,0,0) scale(${s.toFixed(3)})`;
    el.style.opacity = Math.max(0, Math.min(1, 1.3 - 0.42 * a)).toFixed(2);
    el.style.zIndex = 50 - Math.round(a * 10);
    el._shade.style.opacity = Math.min(0.62, a * 0.34).toFixed(2);
  }
  const k = wheelIdxAt(wheelPos);
  if (k === wheelLastIdx) return;
  wheelLastIdx = k;
  wheelEls.forEach((c, i) => c.classList.toggle("front", i === k));
  wheelShowBg(k);
  wheelDots.forEach((d, i) => d.classList.toggle("on", i === k));
  const fs = $("#wheel-fs");
  if (fs) fs.style.setProperty("--glow", WHEEL_COLORS[k % WHEEL_COLORS.length]);
  wheelSetNow(wheelSegs[k], false);
  if (live) {
    const now = performance.now();
    if (now - wheelLastTick > 55) { wheelLastTick = now; haptic(5); }
  }
}

let wheelBgUrls = [], wheelBgIdx = -1, wheelBgFlip = 0, wheelBgTimer = 0, wheelBgLast = 0, wheelIntroToken = 0;

// Меняет фон-размытие не чаще раза в ~140 мс, чтобы быстрая прокрутка не дёргала GPU
function wheelShowBg(k) {
  if (wheelBgs.length < 2) return;
  clearTimeout(wheelBgTimer);
  const go = () => {
    if (wheelBgIdx === k) return;
    wheelBgIdx = k;
    wheelBgFlip ^= 1;
    const on = wheelBgs[wheelBgFlip], off = wheelBgs[wheelBgFlip ^ 1];
    on.style.backgroundImage = wheelBgUrls[k] ? `url('${wheelBgUrls[k]}')` : "none";
    on.classList.add("on");
    off.classList.remove("on");
    wheelBgLast = performance.now();
  };
  const gap = performance.now() - wheelBgLast;
  if (gap >= 140) go(); else wheelBgTimer = setTimeout(go, 140 - gap);
}

// Универсальная анимация позиции: to — конечная позиция, ease — функция 0..1
function wheelTween(to, ms, ease, done, live = true) {
  cancelAnimationFrame(wheelRaf);
  if (RM()) { wheelPos = to; wheelApply(false); if (done) done(); return; }
  const from = wheelPos, t0 = performance.now();
  const step = now => {
    const t = Math.min((now - t0) / ms, 1);
    wheelPos = from + (to - from) * ease(t);
    wheelApply(live);
    if (t < 1) wheelRaf = requestAnimationFrame(step);
    else if (done) done();
  };
  wheelRaf = requestAnimationFrame(step);
}

// Подвести к ближайшему к index положению (по кратчайшему пути)
function wheelGlideTo(index) {
  const n = wheelSegs.length;
  if (!n) return;
  let delta = index - wheelPos;
  delta -= n * Math.round(delta / n);
  if (Math.abs(delta) < 0.001) return;
  wheelTween(wheelPos + delta, 260 + Math.min(Math.abs(delta), 3) * 80, t => easeOut(t, 3));
}

function wheelUpdateUi() {
  const fs = $("#wheel-fs");
  if (!fs) return;
  const pool = wheelPool();
  let txt = pool.length ? `Подходит: ${pool.length} ${plural(pool.length)}` : "Попробуйте другие условия";
  const rej = pool.filter(m => wheelRejected.has(m.id)).length;
  if (rej) txt += ` · отклонено: ${rej}`;
  const unk = wheelOpts.maxRt ? state.liked.filter(m => !m.runtime).length : 0;
  if (unk) txt += ` · ${unk} без длительности не учтены`;
  if (pool.length > 1 && !wheelWon && !wheelSpinning) txt = "Листай постеры или нажми «Крутить»";
  $("#wheel-status").textContent = txt;
  fs.classList.toggle("spinning", wheelSpinning);
  fs.classList.toggle("won", wheelWon && !wheelSpinning);
  fs.classList.toggle("empty", !pool.length);
  const spin = $("#wheel-spin");
  spin.disabled = wheelSpinning || !pool.length;
  if (!spin.classList.contains("charging")) spin.innerHTML = `<span class="lbl">${ICON_SPIN}${wheelWon ? "Крутить ещё" : "Крутить"}</span>`;
  $("#wheel-open").hidden = !(wheelWon && wheelCurrent);
  if (!pool.length) wheelSetNow(null, false);
}

/* ---------- Жесты ---------- */
// Свайп: карточки едут за пальцем, резкий бросок запускает прокрутку, тап по боковой карточке — подводит её в центр,
// тап по центральной — открывает подробности
function bindWheelStage() {
  const st = $("#wheel-stage");
  if (!st) return;
  let d = null;

  st.addEventListener("pointerdown", e => {
    if (wheelSpinning || !wheelSegs.length) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelAnimationFrame(wheelRaf);
    const card = e.target.closest(".cc");
    d = { x: e.clientX, sx: e.clientX, sy: e.clientY, moved: false, v: 0, t: performance.now(), idx: card ? +card.dataset.i : -1 };
    try { st.setPointerCapture(e.pointerId); } catch (err) {}
  });
  st.addEventListener("pointermove", e => {
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8 || wheelSegs.length < 2) return;
      d.moved = true; d.x = e.clientX; d.t = performance.now();
      wheelDragging = true;
      if (wheelWon) { wheelWon = false; wheelWinIdx = -1; hideReveal(); clearTimeout(wheelOpenTimer); wheelUpdateUi(); }
      st.classList.add("dragging");
      return;
    }
    const dx = e.clientX - d.x;
    d.x = e.clientX;
    const dp = -dx / wheelPitch;
    const now = performance.now(), dt = Math.max(now - d.t, 1);
    d.t = now;
    d.v = 0.7 * d.v + 0.3 * (dp / dt * 1000);   // скорость, карточек в секунду
    wheelPos += dp;
    wheelApply(true);
  });
  const end = e => {
    if (!d) return;
    const s = d; d = null;
    wheelDragging = false;
    st.classList.remove("dragging");
    if (!s.moved) {
      if (e.type !== "pointerup" || s.idx < 0) return;
      if (s.idx === wheelIdxAt(wheelPos)) { wheelCurrent = wheelSegs[s.idx]; openWheelPick(); }
      else wheelGlideTo(s.idx);
      return;
    }
    const v = performance.now() - s.t > 90 ? 0 : s.v;
    if (Math.abs(v) > 2.4) wheelSpin({ dir: Math.sign(v), power: Math.min(1, (Math.abs(v) - 2.4) / 9) });
    else wheelGlideTo(Math.round(wheelPos));
  };
  st.addEventListener("pointerup", end);
  st.addEventListener("pointercancel", end);
}

/* Зажми кнопку — шкала силы ходит туда-сюда, отпусти в нужный момент: чем сильнее, тем дольше крутится */
function bindWheelCharge() {
  const btn = $("#wheel-spin");
  if (!btn) return;
  let t0 = 0, raf = 0, power = 0, active = false;
  const tri = ms => { const p = (ms % 1500) / 1500; return p < 0.5 ? p * 2 : 2 - p * 2; };
  const tick = () => {
    power = tri(performance.now() - t0 - 220);
    btn.style.setProperty("--p", power.toFixed(3));
    raf = requestAnimationFrame(tick);
  };
  const start = () => {
    if (btn.disabled || wheelSpinning) return;
    active = true; t0 = performance.now();
    setTimeout(() => {
      if (!active) return;
      btn.classList.add("charging");
      btn.innerHTML = `<span class="lbl">Отпусти в нужный момент</span>`;
      raf = requestAnimationFrame(tick);
    }, 220);
  };
  const stop = fire => {
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
    const charged = btn.classList.contains("charging");
    btn.classList.remove("charging");
    btn.style.removeProperty("--p");
    if (charged) {
      wheelSwallow = true;
      setTimeout(() => { wheelSwallow = false; }, 400);
      wheelUpdateUi();
      if (fire) { haptic(12); wheelSpin({ power }); }
    }
  };
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", () => stop(true));
  btn.addEventListener("pointerleave", () => stop(false));
  btn.addEventListener("pointercancel", () => stop(false));
  btn.addEventListener("contextmenu", e => e.preventDefault());
}

/* ---------- Прокрутка ---------- */
// opts.power 0..1 — сколько карточек пролистать; opts.dir ±1 — направление.
// Победитель выбирается случайно и заранее, а карусель плавно тормозит ровно на нём.
function wheelSpin(opts) {
  if (wheelSpinning) return;
  const { power = 0.25 + Math.random() * 0.6, dir = 1 } = opts || {};
  const pool = wheelPool();
  if (!pool.length) return;
  clearTimeout(wheelOpenTimer);
  hideReveal();
  if (wheelWon && wheelCurrent) wheelRejected.add(wheelCurrent.id); // «Крутить ещё» = прошлый вариант отклонён
  wheelWon = false; wheelWinIdx = -1;
  if (pool.every(m => wheelRejected.has(m.id))) wheelRejected.clear();
  // Карусель пересобираем только если живых вариантов в ней почти не осталось — иначе она не «прыгает»
  const alive = wheelSegs.filter(m => !wheelRejected.has(m.id)).length;
  if (pool.length > WHEEL_MAX && alive < 3) wheelBuildCards();
  else wheelMarkRejected();

  const n = wheelSegs.length;
  const cands = wheelSegs.map((m, i) => i).filter(i => !wheelRejected.has(wheelSegs[i].id));
  const k = cands[Math.floor(Math.random() * cands.length)];
  wheelSpinning = true;
  wheelUpdateUi();

  if (n < 2 || RM()) {
    wheelPos = k;
    wheelApply(false);
    return wheelFinish(k);
  }
  const T = 18 + power * 20;                                  // минимум карточек, которые промелькнут
  let delta = dir > 0 ? mod(k - wheelPos, n) : mod(wheelPos - k, n);
  while (delta < T) delta += n;
  wheelTween(wheelPos + dir * delta, 2400 + T * 45, t => easeOut(t, 3.4), () => wheelFinish(k));
}

function wheelFinish(k) {
  const m = wheelSegs[k];
  wheelSpinning = false;
  wheelCurrent = m;
  wheelWon = true;
  wheelWinIdx = k;
  wheelLastIdx = -1;
  wheelApply(false);
  wheelSetNow(m, true);
  wheelUpdateUi();
  const st = $("#wheel-stage");
  if (st) burst(st, "var(--user-accent)", 18);
  haptic([20, 40, 30]);
  wheelOpenTimer = setTimeout(wheelReveal, 900);
}

/* ---------- Выход победителя ---------- */

/* ---------- Случайный фон победного экрана ---------- */
// [основа, акцент 1, акцент 2, акцент 3]
const RV_PALETTES = [
  ["#04090a", "#3CBBB1", "#46e0a0", "#2a7fb8"],
  ["#0d0608", "#ff7a5c", "#ff4d8d", "#ffb347"],
  ["#08060f", "#8b5cf6", "#ec4899", "#38bdf8"],
  ["#040a14", "#2563eb", "#06b6d4", "#a5b4fc"],
  ["#070a05", "#a3e635", "#22d3ee", "#facc15"],
  ["#0c0405", "#ef4444", "#f97316", "#fb7185"],
  ["#0a0803", "#f59e0b", "#fde68a", "#ea580c"],
  ["#060a09", "#34d399", "#f472b6", "#60a5fa"],
  ["#0a0510", "#d946ef", "#6366f1", "#22d3ee"],
  ["#030a0c", "#14b8a6", "#0ea5e9", "#a78bfa"],
];
const RV_PATTERNS = ["rays", "aurora", "mesh", "grid", "floor", "dots", "stripes", "checker", "sonar", "beams", "bokeh"];
let rvLast = { pattern: "", palette: -1 };
const rvRand = (a, b) => a + Math.random() * (b - a);
const rvInt = (a, b) => Math.floor(rvRand(a, b + 1));

function rvPick(list, lastVal, get) {
  let v, t = 0;
  do { v = list[Math.floor(Math.random() * list.length)]; } while (get(v) === lastVal && list.length > 1 && ++t < 20);
  return v;
}

// Возвращает { base, vars, html }: каждый раз новый узор + палитра + скорость/размер/угол
function buildRevealBg() {
  const pattern = rvPick(RV_PATTERNS, rvLast.pattern, x => x);
  let pi;
  do { pi = rvInt(0, RV_PALETTES.length - 1); } while (pi === rvLast.palette);
  rvLast = { pattern, palette: pi };
  const [base, c1, c2, c3] = RV_PALETTES[pi];
  const rev = Math.random() < 0.5 ? "reverse" : "normal";
  const vars = { "--rv-base": base, "--c1": c1, "--c2": c2, "--c3": c3, "--dur": rvRand(14, 34).toFixed(1) + "s", "--dir": rev };
  let inner = "";

  switch (pattern) {
    case "rays":
      vars["--w"] = rvRand(3, 9).toFixed(1);
      inner = `<i class="l"></i><i class="l l2"></i>`;
      break;
    case "aurora":
      vars["--dur"] = rvRand(9, 18).toFixed(1) + "s";
      inner = `<i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i>`;
      break;
    case "mesh":
      vars["--dur"] = rvRand(22, 50).toFixed(1) + "s";
      inner = `<i class="l"></i>`;
      break;
    case "grid":
      vars["--sz"] = rvInt(34, 70) + "px";
      vars["--ang"] = rvInt(-35, 35) + "deg";
      inner = `<i class="glow"></i><i class="l"></i>`;
      break;
    case "floor":
      vars["--sz"] = rvInt(46, 80) + "px";
      inner = `<i class="sun"></i><i class="l"></i>`;
      break;
    case "dots":
      vars["--sz"] = rvInt(22, 42) + "px";
      vars["--r"] = rvInt(2, 5) + "px";
      inner = `<i class="glow"></i><i class="l"></i><i class="l l2"></i>`;
      break;
    case "stripes":
      vars["--w"] = rvInt(14, 38) + "px";
      vars["--ang"] = rvInt(-60, 60) + "deg";
      inner = `<div class="st"><i class="s1"></i><i class="s2"></i></div>`;
      break;
    case "checker":
      vars["--sz"] = rvInt(60, 110) + "px";
      inner = `<div class="st"><i class="l"></i></div>`;
      break;
    case "sonar":
      vars["--dur"] = rvRand(5, 9).toFixed(1) + "s";
      inner = `<i class="glow"></i>` + [0, 1, 2, 3, 4].map(i => `<i class="ring" style="--i:${i}"></i>`).join("");
      break;
    case "beams": {
      vars["--dur"] = rvRand(5, 9).toFixed(1) + "s";
      const cols = [c1, c2, c3, c1];
      const n = rvInt(3, 4);
      inner = `<i class="glow"></i>`;
      for (let i = 0; i < n; i++) {
        const spread = rvRand(18, 38), off = (i - (n - 1) / 2) * rvRand(14, 24);
        const a0 = (off - spread).toFixed(0) + "deg", a1 = (off + spread).toFixed(0) + "deg";
        const bc = `color-mix(in srgb, ${cols[i]} 55%, transparent)`;
        inner += `<i class="beam" style="--a0:${i % 2 ? a1 : a0};--a1:${i % 2 ? a0 : a1};--bc:${bc};animation-delay:${(-i * rvRand(0.8, 2)).toFixed(1)}s;animation-duration:${rvRand(4, 9).toFixed(1)}s"></i>`;
      }
      break;
    }
    case "bokeh": {
      const cols = [c1, c2, c3];
      inner = `<i class="glow"></i>`;
      for (let i = 0; i < rvInt(16, 24); i++) {
        const s = rvRand(6, 22).toFixed(1);
        inner += `<i class="bk" style="left:${rvRand(-2, 98).toFixed(1)}%;width:${s}vmin;height:${s}vmin;--o:${rvRand(.25, .7).toFixed(2)};background:radial-gradient(circle,${cols[i % 3]},transparent 70%);filter:blur(${rvRand(0, 6).toFixed(1)}px);animation-duration:${rvRand(8, 18).toFixed(1)}s;animation-delay:${(-rvRand(0, 14)).toFixed(1)}s"></i>`;
      }
      break;
    }
  }
  return { base, vars, html: `<div class="reveal-bg rb-${pattern}" aria-hidden="true">${inner}</div>` };
}

// Safe-зоны (вырез / home-индикатор) красим в цвет победного экрана, пока он открыт
function revealBarsOn(base) {
  const root = document.documentElement;
  root.style.setProperty("--rv-base", base);
  root.classList.add("rv-open");
  if (themeMeta) themeMeta.content = base;
}
function revealBarsOff() {
  const root = document.documentElement;
  if (!root.classList.contains("rv-open")) return;
  root.classList.remove("rv-open");
  root.style.removeProperty("--rv-base");
  syncBars();
}

const wheelRevealEl = () => document.getElementById("wheel-reveal");

function hideReveal() {
  const r = wheelRevealEl();
  if (!r || r.classList.contains("out")) return;
  const fs = document.getElementById("wheel-fs");
  if (fs) fs.classList.remove("lift");
  r.classList.add("out");
  setTimeout(() => {
    r.remove();
    if (wheelRevealEl()) return;
    const w = wheelEl(); // под победным экраном осталась карусель — safe-зоны возвращаем к её цвету
    if (w && !w.hidden && !w.classList.contains("closing")) revealBarsOn(WHEEL_BASE); else revealBarsOff();
  }, 280);
}

function wheelConfetti(host, cx, cy) {
  if (RM()) return;
  const colors = ["#3CBBB1", "#46e0a0", "#ffd166", "#ff7a5c", "#ff6b81", "#ffffff"];
  for (let i = 0; i < 46; i++) {
    const p = document.createElement("i");
    const w = 5 + Math.random() * 5, h = 8 + Math.random() * 8;
    p.className = "confetti";
    p.style.cssText = `left:${cx}px;top:${cy}px;width:${w}px;height:${h}px;background:${colors[i % colors.length]};`;
    host.appendChild(p);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
    const d = 140 + Math.random() * 230;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const rot = (Math.random() - 0.5) * 900;
    p.animate([
      { transform: "translate(0,0) rotate(0deg) scale(.4)", opacity: 1 },
      { transform: `translate(${x}px,${y}px) rotate(${rot * 0.6}deg) scale(1)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x * 1.15}px,${y + 260 + Math.random() * 160}px) rotate(${rot}deg) scale(.9)`, opacity: 0 },
    ], { duration: 1500 + Math.random() * 900, easing: "cubic-bezier(.2,.7,.4,1)", delay: Math.random() * 120 }).onfinish = () => p.remove();
  }
}

function wheelReveal() {
  const o = wheelEl();
  if (!o || o.hidden || !wheelCurrent || wheelRevealEl()) return;
  const m = findMovie(wheelCurrent.id) || wheelCurrent;
  const url = state.urls[m.id];
  const poster = TMDB.img(m.poster, "w500");
  const meta = [m.year, dur(m.runtime), `★ ${(m.rating || 0).toFixed(1)}`].filter(Boolean).join(" · ");
  // Постер «вылетает» из центральной карточки карусели
  const fc = document.querySelector("#wheel-track .cc.front .cc-face");
  const sr = fc ? fc.getBoundingClientRect() : null;
  const from = sr ? { left: sr.left, top: sr.top, width: sr.width, height: sr.height } : null;
  const fsEl = document.getElementById("wheel-fs");
  if (fsEl) fsEl.classList.add("lift"); // карточка в карусели скрывается — вместо неё летит копия

  const r = document.createElement("div");
  r.id = "wheel-reveal";
  r.className = "reveal";
  const bg = buildRevealBg();
  Object.entries(bg.vars).forEach(([k, v]) => r.style.setProperty(k, v));
  r.innerHTML = `${bg.html}
    <div class="reveal-tag">Сегодня смотрим</div>
    <button class="reveal-card" id="reveal-card" aria-label="Подробнее о фильме">
      <span class="reveal-tilt">${poster ? `<img src="${poster}" alt="" draggable="false">` : ""}<span class="reveal-shine"></span></span>
    </button>
    <div class="reveal-info">
      <h3>${esc(m.title)}</h3>
      <p>${esc(meta)}</p>
    </div>
    <div class="reveal-actions">
      <button class="btn primary" id="reveal-watch">${ICON_PLAY}К просмотру</button>
      <button class="btn glass" id="reveal-more">${ICON_DICE}Крутить ещё</button>
    </div>`;
  o.appendChild(r);
  revealBarsOn(bg.base);

  haptic([18, 50, 28]);

  const card = r.querySelector("#reveal-card");
  const rect = card.getBoundingClientRect();
  const host = r.getBoundingClientRect();
  if (!RM() && card.animate) {
    if (from && from.width) {
      const dx = from.left + from.width / 2 - (rect.left + rect.width / 2);
      const dy = from.top + from.height / 2 - (rect.top + rect.height / 2);
      const s = from.width / rect.width;
      card.animate([
        { transform: `translate(${dx}px,${dy}px) scale(${s})` },
        { transform: "translate(0,0) scale(1)" },
      ], { duration: 900, easing: "cubic-bezier(.25,.85,.3,1)", fill: "backwards" });
    } else anim(card, FX_IN, { duration: 700 });
    setTimeout(() => {
      if (wheelRevealEl() !== r) return;
      wheelConfetti(r, rect.left + rect.width / 2 - host.left, rect.top + rect.height / 2 - host.top);
      haptic(15);
    }, 700);
  }

  // Лёгкий 3D-наклон постера за пальцем / курсором
  const tilt = card.querySelector(".reveal-tilt");
  const setTilt = e => {
    const b = card.getBoundingClientRect();
    const nx = (e.clientX - b.left) / b.width - 0.5, ny = (e.clientY - b.top) / b.height - 0.5;
    tilt.style.transform = `rotateY(${(nx * 22).toFixed(1)}deg) rotateX(${(-ny * 22).toFixed(1)}deg)`;
  };
  card.addEventListener("pointermove", setTilt);
  ["pointerleave", "pointerup", "pointercancel"].forEach(ev => card.addEventListener(ev, () => { tilt.style.transform = ""; }));
}

function openWheelPick() {
  const o = wheelEl();
  if (!wheelCurrent || !o || o.hidden) return;
  const m = findMovie(wheelCurrent.id) || wheelCurrent;
  wheelNext = true;
  openSheet(m);
}

function hideLayers() { closeSheetUI(); closeFiltersUI(); closeWheelUI(); }

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
}

function startApp() {
  if (appStarted) return;
  appStarted = true;
  if (!(CONFIG.TMDB_KEY || "").trim()) { $("#setup").hidden = false; return; }
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
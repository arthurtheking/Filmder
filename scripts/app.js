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
const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

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
const themeMeta = document.querySelector('meta[name="theme-color"]');

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

function paintTheme(light, ms = 0) {
  document.documentElement.classList.toggle("light", light);
  if (themeInput) themeInput.checked = light;
  tweenMeta(light, ms);
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

function hint(el) {
  el._hint = anim(el, [
    { transform: tf(0) },
    { transform: "translateX(26px) rotate(3deg)", offset: 0.3 },
    { transform: "translateX(-26px) rotate(-3deg)", offset: 0.65 },
    { transform: tf(0) },
  ], { duration: 1300, delay: 1600, fill: "none", easing: "ease-in-out" });
}

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
      toastDismissTimer = setTimeout(() => t.classList.remove("dismissing"), 450);
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
  const check = watchedMode ? "" : `<button class="row-check" data-mark="${m.id}" aria-label="Отметить просмотренным">${ICON_CHECK}</button>`;
  return `<div class="row-container" data-id="${m.id}" style="--i:${Math.min(i, 8)}">
    <div class="row-watch-bg">${watchedMode ? "В вечер" : "Просмотрено"}</div>
    <div class="row-delete-bg">Удалить</div>
    <div class="row">
      <div class="thumb">${posterHtml(m.poster, "w185", m.title)}</div>
      <div class="row-main">
        <div class="row-title">${esc(m.title)}</div>
        <div class="row-meta">${meta}</div>
        ${date}
      </div>
      ${check}
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
          <h2>Пока ничего не просмотрено</h2><p>Отметьте фильм галочкой, смахните его вправо в списке «К просмотру» или нажмите «Отметить просмотренным» в карточке фильма.</p></div>`
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
  let idx = 1;

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
  $("#seg-ind").classList.toggle("right", mode === "watched");
  const l = $("#list");
  renderList();
  l.scrollTop = 0;
  l.classList.remove("enter"); void l.offsetWidth; l.classList.add("enter");
  setTimeout(() => l.classList.remove("enter"), 1200);
}

/* Плавное удаление / перенос: строка уезжает с места пальца до конца,
   потом блок схлопывается по высоте, и только после этого обновляются данные. */
async function removeRow(row, container, section, fromX, dir, commit) {
  if (container.classList.contains("gone")) return;
  haptic();
  container.classList.remove(dir > 0 ? "dir-l" : "dir-r");
  container.classList.add("swiping", "gone", dir > 0 ? "dir-r" : "dir-l");

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
    const clearDir = () => container.classList.remove("swiping", "dir-l", "dir-r");

    row.addEventListener("pointerdown", e => {
      if (e.target.closest(".row-check")) return; // кнопка-галочка обрабатывается кликом
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
        if (Math.abs(dx) > 6) { locked = true; container.classList.add("swiping"); }
      }
      if (locked) {
        container.classList.toggle("dir-l", dx < 0);
        container.classList.toggle("dir-r", dx > 0);
        row.style.transform = `translateX(${dx}px)`;
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
      setTimeout(clearDir, 300);
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
  hideLayers();
  if (layerPushed) {
    layerPushed = false;
    pendingBack++;
    try { history.back(); } catch (e) { pendingBack--; }
  }
}
function hideLayers() { closeSheetUI(); closeFiltersUI(); }
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
  let startY = 0, startX = 0, dy = 0, tracking = false, dragging = false, lastY = 0, lastT = 0, vy = 0;

  sheet.addEventListener("touchstart", e => {
    if (e.touches.length !== 1 || sheet.scrollTop > 0 || e.target.closest("input, iframe, .related-scroll")) { tracking = false; return; }
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
      if (dy > 8 && sheet.scrollTop <= 0) { dragging = true; sheet.style.transition = "none"; }
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
  return `<button class="btn icon" data-close aria-label="Закрыть">${ICON_CLOSE}</button>
    ${watchButton(m, "primary")}<button class="btn" data-toggle="${m.id}"><span class="btn-label fade-in">${toggleLabel(m)}</span></button>`;
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
  { title: "Просмотренные", text: "Посмотрели фильм — отметьте его галочкой или смахните вправо. Он переедет в отдельный список «Просмотрено» и больше не появится в свайпах. Нажали «Смотреть» — после возвращения в приложение мы сами предложим отметить фильм." },
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
  if (t.dataset.mark) {
    const id = +t.dataset.mark;
    const c = document.querySelector(`#list .row-container[data-id="${id}"]`);
    if (c) removeRow(c.querySelector(".row"), c, c.closest(".category-section"), 0, 1, () => commitRow(1, id));
    return;
  }
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
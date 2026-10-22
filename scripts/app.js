"use strict";

const $ = sel => document.querySelector(sel);

/* ============ Константы и утилиты ============ */
const STORE_KEY = "filmder-tmdb-v2";
const THEME_KEY = "filmder-theme";
const TUTORIAL_KEY = "filmder-tutorial-shown";
const HISTORY_LIMIT = 30;
const PASSED_LIMIT = 3000;

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
const ICON_PLAY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>`;
const youtubeSearch = m => "https://www.youtube.com/results?search_query=" + encodeURIComponent(`${m.title} ${m.year} официальный трейлер`);
const validUrl = u => /^https?:\/\/\S+$/i.test(u);

function anim(el, keyframes, options) {
  if (!el || RM() || !el.animate) return null;
  return el.animate(keyframes, Object.assign({ fill: "backwards", easing: EASE, duration: 450 }, options));
}
const bump = el => anim(el, [{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 400, easing: SPRING });

/* ============ Состояние ============ */
let state = { liked: [], urls: {}, multiGenres: [] };
const passed = new Set();
try {
  const saved = JSON.parse(ls.get(STORE_KEY) || "null");
  if (saved && typeof saved === "object") {
    if (Array.isArray(saved.liked)) state.liked = saved.liked.filter(m => m && m.id);
    if (saved.urls && typeof saved.urls === "object") state.urls = saved.urls;
    if (Array.isArray(saved.multiGenres)) state.multiGenres = saved.multiGenres;
    else if (saved.genre) state.multiGenres = [saved.genre];
    if (Array.isArray(saved.passed)) saved.passed.forEach(id => passed.add(id));
  }
} catch (e) {}

const saveNow = () => ls.set(STORE_KEY, JSON.stringify({
  liked: state.liked, urls: state.urls, multiGenres: state.multiGenres,
  passed: [...passed].slice(-PASSED_LIMIT),
}));
let saveTimer = 0;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); };
addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });

const isLiked = id => state.liked.some(m => m.id === id);
const isSeen = id => passed.has(id) || isLiked(id);

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

function newPaging() { return { page: 1, total: 1, loading: false, error: null }; }

/* ============ Тема ============ */
const themeInput = $("#theme-switch-input");
const themeMeta = document.querySelector('meta[name="theme-color"]');

function paintTheme(light) {
  document.documentElement.classList.toggle("light", light);
  if (themeInput) themeInput.checked = light;
  if (themeMeta) themeMeta.content = light ? "#EAECEC" : "#0a0a0d";
}

function setTheme(light) {
  ls.set(THEME_KEY, light ? "light" : "dark");
  const root = document.documentElement;

  if (RM()) return paintTheme(light);
  if (!document.startViewTransition) {
    root.classList.add("theme-fade");
    paintTheme(light);
    setTimeout(() => root.classList.remove("theme-fade"), 500);
    return;
  }

  const sw = document.querySelector(".ios-switch");
  const r = sw ? sw.getBoundingClientRect() : { left: innerWidth - 60, top: 30, width: 0, height: 0 };
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

  const vt = document.startViewTransition(() => paintTheme(light));
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
  return `<div class="poster">${src ? `<img src="${src}" alt="${esc(alt || "")}" draggable="false"${size === "w185" ? ' loading="lazy"' : ""} decoding="async">` : ""}</div>`;
}
function preloadDeck() {
  deck.slice(0, 5).forEach(m => { if (m.poster) new Image().src = TMDB.img(m.poster, CARD_IMG); });
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
    const s = state.liked.find(x => x.id === id);
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

/* ============ Тост ============ */
let toastTimer = null;
let toastUndoFn = null;

function showToast({ sub, title, id, undo: undoFn }) {
  const t = $("#toast");
  toastUndoFn = undoFn || null;
  t.innerHTML = `<span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    <div class="tmain" ${id ? `data-open="${id}"` : ""}><small>${esc(sub)}</small><b>${esc(title)}</b></div>
    ${undoFn ? `<button class="tundo" data-undo>Отменить</button>` : ""}<i class="bar"></i>`;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3500);
}

function hideToast() {
  clearTimeout(toastTimer);
  $("#toast").classList.remove("show");
}

/* ============ Кнопка «Смотреть» ============ */
function watchButton(m, cls) {
  const url = state.urls[m.id];
  if (url && validUrl(url)) return `<a class="btn ${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ICON_PLAY}Смотреть</a>`;
  return `<button class="btn ${cls}" data-add-src="${m.id}">${ICON_PLAY}Смотреть</button>`;
}

/* ============ Список «Мой вечер» ============ */
let categoryOrder = [];

function renderList() {
  const list = $("#list");
  const items = state.liked;
  if (!items.length) {
    categoryOrder = [];
    list.innerHTML = `<div class="empty" style="position:static;flex:1">
      <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.6 4.5 6.4 4.5c2.2 0 3.6 1.2 4.6 2.7h2c1-1.5 2.4-2.7 4.6-2.7 3.8 0 5.5 3.9 4 7.3C19.5 16.4 12 21 12 21z"/></svg>
      <h2>Вечер пока пуст</h2><p>Свайпайте вправо фильмы, которые хочется посмотреть. Они появятся здесь.</p></div>`;
    return;
  }

  const known = items.filter(m => m.runtime);
  const total = known.reduce((s, m) => s + m.runtime, 0);
  const totalText = known.length ? `Всего ${known.length < items.length ? "около " : ""}${dur(total)} без перерывов` : "Считаю длительность…";

  const groups = {};
  items.forEach(m => {
    const cat = (m.category = categoryOf(m));
    (groups[cat] = groups[cat] || []).push(m);
  });

  const current = Object.keys(groups);
  categoryOrder = categoryOrder.filter(c => current.includes(c));
  current.forEach(c => { if (!categoryOrder.includes(c)) categoryOrder.push(c); });

  const scroll = list.scrollTop;
  let html = `<div class="summary" style="--i:0"><b>${items.length} ${plural(items.length)}</b><span>${totalText}</span></div>`;
  let idx = 1;
  for (const cat of categoryOrder) {
    html += `<div class="category-section" data-category="${esc(cat)}"><div class="list-category-title">${esc(cat)}</div>`;
    for (const m of groups[cat]) {
      html += `<div class="row-container" data-id="${m.id}" style="--i:${Math.min(idx++, 8)}">
        <div class="row-delete-bg">Удалить</div>
        <div class="row">
          <div class="thumb">${posterHtml(m.poster, "w185", m.title)}</div>
          <div class="row-main">
            <div class="row-title">${esc(m.title)}</div>
            <div class="row-meta">${[m.year, dur(m.runtime), `★ ${(m.rating || 0).toFixed(1)}`].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      </div>`;
    }
    html += `</div>`;
  }
  list.innerHTML = html;
  list.scrollTop = scroll;
  bindRowSwipe();
}

function bindRowSwipe() {
  document.querySelectorAll("#list .row").forEach(row => {
    let startX = 0, startY = 0, dx = 0, dragging = false, locked = false, moved = false;
    const container = row.closest(".row-container");
    const section = row.closest(".category-section");
    const id = +container.dataset.id;

    row.addEventListener("pointerdown", e => {
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
          container.classList.remove("swiping");
          row.style.transition = "";
          row.style.transform = "";
          return;
        }
        if (Math.abs(dx) > 6) { locked = true; container.classList.add("swiping"); }
      }
      if (locked && dx < 0) row.style.transform = `translateX(${dx}px)`;
    });

    const finish = () => {
      if (!dragging && !locked) { container.classList.remove("swiping"); row.style.transition = ""; return; }
      dragging = false;
      row.style.transition = "";

      if (locked && dx < -70) {
        row.style.transform = "translateX(-120%)";
        row.style.opacity = "0";
        haptic();
        container.classList.add("removing");
        if (section && !section.querySelectorAll(".row-container:not(.removing)").length) section.classList.add("removing");

        setTimeout(() => {
          const idx = state.liked.findIndex(x => x.id === id);
          if (idx < 0) return;
          const removed = state.liked.splice(idx, 1)[0];
          save();
          refreshList();
          showToast({
            sub: "Удалено из вечера", title: removed.title,
            undo: () => { state.liked.splice(Math.min(idx, state.liked.length), 0, removed); save(); refreshList(); },
          });
        }, 380);
      } else {
        row.style.transform = "";
        setTimeout(() => container.classList.remove("swiping"), 300);
        if (!moved) { const m = findMovie(id); if (m) openSheet(m); }
      }
      locked = false; dx = 0;
    };
    row.addEventListener("pointerup", finish);
    row.addEventListener("pointercancel", finish);
  });
}

function findMovie(id) {
  return deck.find(m => m.id === id)
    || state.liked.find(m => m.id === id)
    || history_.map(h => h.movie).find(m => m.id === id)
    || (sheetMovie && sheetMovie.related && sheetMovie.related.find(m => m.id === id));
}

/* ============ Слои (шторки) + кнопка «Назад» ============ */
let layerPushed = false;
let sheetTimer = null, filtersTimer = null;

function pushLayer() {
  if (layerPushed) return;
  try { history.pushState({ layer: 1 }, ""); layerPushed = true; } catch (e) {}
}
function closeLayer() {
  if (layerPushed) { layerPushed = false; try { history.back(); return; } catch (e) {} }
  hideLayers();
}
function hideLayers() { closeSheetUI(); closeFiltersUI(); }
window.addEventListener("popstate", () => { layerPushed = false; hideLayers(); });

function closeSheetUI() {
  const o = $("#overlay");
  if (o.hidden) return;
  sheetMovie = null;
  const frame = o.querySelector("iframe");
  if (frame) frame.src = "about:blank";
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
function actionsHtml(m) {
  const text = isLiked(m.id) ? "Убрать из вечера" : "В мой вечер";
  return `${watchButton(m, "primary")}<button class="btn" data-toggle="${m.id}"><span class="btn-label fade-in">${text}</span></button>`;
}

function openSheet(m, focusSrc) {
  hideToast();
  const o = $("#overlay");
  clearTimeout(sheetTimer);
  sheetMovie = Object.assign({}, m);
  const id = m.id;
  const url = state.urls[id] || "";

  o.classList.remove("closing");
  o.style.opacity = "";
  o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(m.title)}" id="sheet-element">
    <div class="sheet-media" id="sheet-media">${mediaHtml(m)}</div>
    <button class="close" data-close aria-label="Закрыть"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="sheet-body">
      <div class="sheet-title"><h2>${esc(m.title)}</h2><div class="o" id="sheet-sub"></div></div>
      <div class="tags" id="sheet-tags"></div>
      <p id="sheet-overview"></p>
      <dl class="facts" id="sheet-facts"></dl>
      <div class="src">
        <label for="src-input">Ссылка на ваш файл с фильмом</label>
        <div class="src-row"><input id="src-input" type="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://… (ваш сервер или Google Drive)" value="${esc(url)}"><button class="btn" id="src-save">Сохранить</button></div>
        <small id="src-note">${url ? "Ссылка сохранена. Кнопка «Смотреть» откроет её в новой вкладке." : "Вставьте ссылку один раз, дальше «Смотреть» будет открывать фильм сразу."}</small>
      </div>
      <div class="sheet-actions" id="sheet-actions">${actionsHtml(m)}</div>
      <div class="related-section" id="related-section"></div>
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

    const stored = state.liked.find(x => x.id === id);
    if (stored && (!stored.runtime || !stored.genres.length)) {
      if (d.runtime) stored.runtime = d.runtime;
      if (d.genres.length) stored.genres = d.genres;
      save(); refreshList();
    }

    const media = $("#sheet-media");
    if (media) {
      if (d.trailerKey) setTimeout(() => {
        if (!sheetMovie || sheetMovie.id !== id) return;
        const mm = $("#sheet-media");
        if (mm) mm.innerHTML = playerHtml(d.trailerKey);
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
        <div class="related-poster">${r.poster ? `<img src="${TMDB.img(r.poster, "w342")}" alt="${esc(r.title)}" loading="lazy" decoding="async">` : ""}</div>
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
  const btn = document.querySelector("#sheet-actions [data-toggle]");
  const label = btn ? btn.querySelector(".btn-label") : null;

  if (btn) {
    btn.classList.remove("pop-stroke-red", "pop-stroke-green");
    void btn.offsetWidth;
    btn.classList.add(wasLiked ? "pop-stroke-red" : "pop-stroke-green");
    burst(btn, wasLiked ? "var(--nope)" : "var(--user-accent)", 10);
    haptic();
    if (label) { label.classList.remove("fade-in"); label.classList.add("fade-out"); }
  }

  setTimeout(() => {
    if (wasLiked) {
      state.liked = state.liked.filter(x => x.id !== m.id);
    } else {
      state.liked.push(snap(m));
      passed.delete(m.id);
      deck = deck.filter(d => d.id !== m.id);
      if (!m.runtime) loadRuntime(m.id);
    }
    save();
    renderAll();
    if (sheetMovie && sheetMovie.id === m.id) {
      const text = isLiked(m.id) ? "Убрать из вечера" : "В мой вечер";
      if (label && label.isConnected) {
        label.textContent = text;
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
  const t = e.target.closest("button, [data-open], [data-related-id], .backdrop");
  if (!t) return;

  switch (t.id) {
    case "tab-swipe": return setTab("swipe");
    case "tab-list": return setTab("list");
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
}
let listDirty = false;
function refreshList() {
  updateBadge();
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
/* ============================================================
   FILMDER: интерфейс приложения.
   Данные о фильмах приходят из tmdb.js, а здесь всё, что видит и нажимает человек.

   Разделы файла:
     1. Состояние и сохранение
     2. Мелкие помощники и анимации
     3. Колода: подгрузка фильмов из TMDB
     4. Лента жанров
     5. Экран «Свайп»: карточки и перетаскивание
     6. Уведомление сверху
     7. Экран «Мой вечер»
     8. Окно фильма с трейлером
     9. Обработчики нажатий
    10. Запуск и заставка
   ============================================================ */

const $ = sel => document.querySelector(sel);

/* ------------------------------------------------------------
   1. СОСТОЯНИЕ И СОХРАНЕНИЕ
   Всё важное хранится в localStorage браузера и переживает перезапуск.
   liked  : фильмы «на вечер». Храним краткий снимок (название, постер...), чтобы список открывался без запросов.
   passed : номера фильмов, которые вы свайпнули влево.
   urls   : ваши ссылки «Смотреть» (на сервер на ПК или Google Drive) по номеру фильма.
   genre  : выбранный жанр (0 = все).
   ------------------------------------------------------------ */
const STORE_KEY = "filmder-tmdb-v1";
let state = { liked: [], passed: [], urls: {}, genre: 0 };
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  if (saved) state = Object.assign(state, saved);
} catch (e) { /* хранилище может быть недоступно, тогда просто работаем без сохранения */ }
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} };

const isLiked = id => state.liked.some(m => m.id === id);
const isSeen = id => isLiked(id) || state.passed.includes(id);
const snap = m => ({ id: m.id, title: m.title, orig: m.orig, year: m.year, rating: m.rating, poster: m.poster, runtime: m.runtime || 0 });

let genres = [];        // список жанров из TMDB
let deck = [];          // очередь фильмов для свайпа (верхняя карточка это deck[0])
let paging = newPaging();   // на какой странице TMDB мы остановились
let history = [];       // что вы свайпали, нужно для кнопки «вернуть»
let busy = false;       // true, пока карточка улетает
let sheetMovie = null;  // фильм, открытый в окне с трейлером

function newPaging() { return { page: 0, total: 1, loading: false, error: null }; }

/* ------------------------------------------------------------
   2. МЕЛКИЕ ПОМОЩНИКИ И АНИМАЦИИ
   ------------------------------------------------------------ */
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;   // человек просит поменьше анимаций
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const wait = ms => new Promise(r => setTimeout(r, ms));
function dur(min) { if (!min) return ""; const h = Math.floor(min / 60), m = min % 60; return h ? `${h} ч ${m} мин` : `${m} мин`; }
function plural(n) { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? "фильм" : (a >= 2 && a <= 4 && (b < 10 || b >= 20)) ? "фильма" : "фильмов"; }
const ICON_PLAY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>`;
const youtubeSearch = m => "https://www.youtube.com/results?search_query=" + encodeURIComponent(`${m.title} ${m.year} официальный трейлер`);

/* Короткая анимация через встроенный Web Animations API */
function anim(el, keyframes, options) {
  if (!el || RM || !el.animate) return null;
  return el.animate(keyframes, Object.assign({ fill: "backwards", easing: "cubic-bezier(.2,.9,.25,1)" }, options));
}
const bump = el => anim(el, [{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 380 });

/* Картинки появляются плавно, когда загрузились */
document.addEventListener("load", e => { if (e.target.tagName === "IMG") e.target.classList.add("ready"); }, true);

function posterHtml(path, size, alt) {
  const src = TMDB.img(path, size);
  return `<div class="poster">${src ? `<img src="${src}" alt="${esc(alt || "")}" draggable="false" decoding="async">` : ""}</div>`;
}

/* Брызги частиц вокруг кнопки */
function burst(btn, color, count) {
  if (RM) return;
  const r = btn.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    const s = 4 + Math.random() * 4;
    p.style.cssText = `position:fixed;left:${cx - s / 2}px;top:${cy - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;background:${color};pointer-events:none;z-index:40`;
    document.body.appendChild(p);
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.6, d = 46 + Math.random() * 40;
    const an = p.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d - 14}px) scale(0)`, opacity: 0 }
    ], { duration: 600 + Math.random() * 250, easing: "cubic-bezier(.1,.7,.3,1)" });
    an.onfinish = () => p.remove();
  }
}

/* ------------------------------------------------------------
   3. КОЛОДА: ПОДГРУЗКА ФИЛЬМОВ ИЗ TMDB
   Мы не грузим всё сразу, а берём страницу за страницей (по 20 фильмов)
   и докладываем в колоду, когда она подходит к концу.
   ------------------------------------------------------------ */
async function fillDeck(min = 8) {
  const p = paging;
  if (p.loading) return;
  p.loading = true; p.error = null;
  try {
    let guard = 0;   // защита: не делаем больше 6 запросов за раз
    while (deck.length < min && p.page < p.total && guard++ < 6) {
      p.page++;
      const data = await TMDB.discover(state.genre, p.page);
      if (p !== paging) return;   // пока ждали, вы сменили жанр, этот ответ уже не нужен
      p.total = Math.min(data.totalPages, 40);
      for (const m of data.items) {
        if (m.poster && !isSeen(m.id) && !deck.some(d => d.id === m.id)) deck.push(m);
      }
    }
  } catch (e) {
    if (p === paging) p.error = e.message;
  }
  p.loading = false;
}

/* Дозагрузка в фоне, пока вы свайпаете */
function topUp() {
  if (deck.length >= 6 || paging.page >= paging.total || paging.loading) return;
  const p = paging;
  fillDeck(10).then(() => {
    if (p !== paging) return;
    const shown = $("#stage").querySelectorAll(".card").length;
    if (shown < Math.min(3, deck.length)) renderSwipe("fill");   // на экране не хватало карточек, добавляем
  });
}

/* Заново наполнить колоду (после смены жанра, ошибки и так далее) */
async function refill(mode) {
  const p = paging;
  renderSwipe();                   // покажет «Ищу фильмы…»
  await fillDeck(8);
  if (p === paging) renderSwipe(mode || "init");
}

/* ------------------------------------------------------------
   4. ЛЕНТА ЖАНРОВ
   Прокручивается пальцем, колёсиком и перетаскиванием мышью.
   ------------------------------------------------------------ */
function renderChips() {
  const all = [{ id: 0, name: "Все" }, ...genres];   // «Все» первым, остальные уже отсортированы по алфавиту
  if (!all.some(g => g.id === state.genre)) state.genre = 0;
  $("#chips").innerHTML = all.map((g, i) =>
    `<button class="chip" style="--i:${i}" data-genre="${g.id}" aria-pressed="${g.id === state.genre}">${esc(g.name)}</button>`).join("");
}

/* Затухание по краям ленты показываем только там, где есть что прокручивать */
function updateFade() {
  const c = $("#chips");
  const max = c.scrollWidth - c.clientWidth;
  c.style.setProperty("--fl", c.scrollLeft > 4 ? "28px" : "0px");
  c.style.setProperty("--fr", c.scrollLeft < max - 4 ? "28px" : "0px");
}
function centerChip(chip, smooth) {
  const c = $("#chips");
  const cr = c.getBoundingClientRect(), tr = chip.getBoundingClientRect();
  c.scrollTo({ left: c.scrollLeft + (tr.left - cr.left) - (cr.width - tr.width) / 2, behavior: smooth && !RM ? "smooth" : "auto" });
}
(function bindChips() {
  const c = $("#chips");
  let d = null, moved = false;
  c.addEventListener("pointerdown", e => { if (e.pointerType === "mouse") { d = { x: e.clientX, s: c.scrollLeft }; moved = false; } });
  window.addEventListener("pointermove", e => {
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) moved = true;
    if (moved) c.scrollLeft = d.s - dx;
  });
  window.addEventListener("pointerup", () => { d = null; });
  // если ленту тянули мышью, это не нажатие на жанр
  c.addEventListener("click", e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  c.addEventListener("wheel", e => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { c.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  c.addEventListener("scroll", updateFade, { passive: true });
  window.addEventListener("resize", updateFade);
})();

function selectGenre(id, chip) {
  state.genre = id; save();
  $("#chips").querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", +c.dataset.genre === id));
  if (chip) centerChip(chip, true);
  deck = []; history = []; paging = newPaging();
  refill("filter");
}

/* ------------------------------------------------------------
   5. ЭКРАН «СВАЙП»
   Положение карточек в стопке: чем глубже, тем ниже, меньше и темнее.
   ------------------------------------------------------------ */
const tf = i => `translateY(${i * 10}px) scale(${1 - i * 0.04})`;
const fl = i => `brightness(${1 - i * 0.22})`;

function cardHtml(m) {
  const sub = m.orig && m.orig !== m.title ? `${esc(m.orig)} · ${m.year}` : m.year;
  return `${posterHtml(m.poster, "w500", m.title)}<div class="shade"></div>
    <div class="tap-hint">${ICON_PLAY}Трейлер</div>
    <div class="rate">★ ${m.rating.toFixed(1)}</div>
    <div class="info">
      <div class="t">${esc(m.title)}</div>
      <div class="o">${sub}</div>
      <div class="tags">${m.genres.slice(0, 3).map(x => `<span class="tag">${esc(x)}</span>`).join("")}</div>
    </div>
    <div class="stamp like">В ВЕЧЕР</div><div class="stamp nope">МИМО</div>`;
}

/* mode: "init" при запуске, "filter" при смене жанра, "fly" после свайпа, "undo" при возврате, "fill" при дозагрузке */
function renderSwipe(mode, undoDir) {
  const stage = $("#stage");
  $("#btn-undo").disabled = history.length === 0;
  $("#btn-nope").disabled = $("#btn-like").disabled = deck.length === 0;

  if (!deck.length) {
    let html;
    if (paging.loading || (!paging.error && paging.page < paging.total)) {
      html = `<div class="empty"><div class="spinner"></div><h2>Ищу фильмы…</h2></div>`;
    } else if (paging.error) {
      const text = paging.error === "BAD_KEY" ? "TMDB не принял ключ. Проверьте его в файле config.js." : "Не удалось связаться с TMDB. Проверьте интернет.";
      html = `<div class="empty"><h2>Что-то пошло не так</h2><p>${text}</p><button class="btn primary" id="btn-retry">Повторить</button></div>`;
    } else {
      html = `<div class="empty">
        <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 4v5M16 4v5"/></svg>
        <h2>Фильмы в этом жанре закончились</h2><p>Выберите другой жанр сверху${state.passed.length ? " или верните пропущенные" : ""}.</p>
        ${state.passed.length ? `<button class="btn primary" id="btn-reset">Показать пропущенные снова</button>` : ""}</div>`;
    }
    stage.innerHTML = html;
    anim(stage.firstElementChild, [{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 450 });
    return;
  }

  const top = deck.slice(0, 3);
  stage.innerHTML = "";
  // Рисуем с конца, чтобы верхняя карточка оказалась сверху в DOM
  for (let i = top.length - 1; i >= 0; i--) {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.id = top[i].id;
    el.innerHTML = cardHtml(top[i]);
    el.style.transform = tf(i);
    el.style.filter = fl(i);
    if (i === 0) bindDrag(el, top[i]); else el.style.pointerEvents = "none";
    stage.appendChild(el);

    if (mode === "init" || mode === "filter") {
      anim(el, [
        { opacity: 0, transform: `translateY(${70 + i * 14}px) scale(.9)`, filter: "blur(6px)" },
        { opacity: 1, transform: tf(i), filter: fl(i) }
      ], { duration: mode === "init" ? 800 : 520, delay: (top.length - 1 - i) * 90, easing: "cubic-bezier(.2,1.1,.3,1)" });
    } else if (mode === "fly" && i === 2) {
      anim(el, [{ opacity: 0, transform: "translateY(40px) scale(.88)" }, { opacity: 1, transform: tf(2) }], { duration: 450 });
    } else if (mode === "undo" && i === 0) {
      const dir = undoDir || 1;
      anim(el, [
        { transform: `translateX(${dir * 120}%) rotate(${dir * 16}deg)`, opacity: 0 },
        { transform: tf(0), opacity: 1 }
      ], { duration: 520, easing: "cubic-bezier(.2,1.1,.3,1)" });
    }
    if (mode === "init" && i === 0) hint(el);
  }
}

/* Подсказка при первом запуске: карточка слегка качнётся */
function hint(el) {
  el._hint = anim(el, [
    { transform: tf(0) },
    { transform: "translateX(26px) rotate(3deg)", offset: .3 },
    { transform: "translateX(-26px) rotate(-3deg)", offset: .65 },
    { transform: tf(0) }
  ], { duration: 1300, delay: 1600, fill: "none", easing: "ease-in-out" });
}

/* Перетаскивание верхней карточки. Короткое касание без движения открывает окно с трейлером. */
function bindDrag(el, m) {
  let start = null;
  const likeStamp = el.querySelector(".stamp.like"), nopeStamp = el.querySelector(".stamp.nope");
  const pos = el.querySelector(".poster");
  el.addEventListener("pointerdown", e => {
    if (busy) return;
    if (el._hint) el._hint.cancel();
    start = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
    el.setPointerCapture(e.pointerId);
    el.style.transition = "none";
    pos.style.transition = "none";
  });
  el.addEventListener("pointermove", e => {
    if (!start) return;
    start.dx = e.clientX - start.x; start.dy = e.clientY - start.y;
    if (Math.abs(start.dx) > 6 || Math.abs(start.dy) > 6) start.moved = true;
    el.style.transform = `translate(${start.dx}px, ${start.dy}px) rotate(${start.dx / 18}deg)`;
    pos.style.transform = `translateX(${start.dx * 0.07}px) scale(1.1)`;   // лёгкий параллакс постера
    const k = Math.min(Math.abs(start.dx) / 100, 1);
    likeStamp.style.opacity = start.dx > 0 ? k : 0;
    nopeStamp.style.opacity = start.dx < 0 ? k : 0;
    likeStamp.style.transform = `rotate(-12deg) scale(${0.7 + 0.3 * k})`;
    nopeStamp.style.transform = `rotate(12deg) scale(${0.7 + 0.3 * k})`;
  });
  const end = () => {
    if (!start) return;
    const s = start; start = null;
    pos.style.transition = "";
    if (!s.moved) { el.style.transition = ""; pos.style.transform = ""; openSheet(m); return; }   // касание: открыть трейлер
    if (s.dx > 90) fly(el, m, 1);
    else if (s.dx < -90) fly(el, m, -1);
    else {   // не дотянули до порога: возвращаем пружиной
      el.style.transition = "transform .5s cubic-bezier(.3,1.5,.4,1)";
      el.style.transform = tf(0);
      pos.style.transform = "";
      likeStamp.style.opacity = nopeStamp.style.opacity = 0;
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

/* Карточка улетает вправо (dir = 1) или влево (dir = -1), остальные подъезжают вперёд */
function fly(el, m, dir) {
  if (busy) return;
  busy = true;
  const cards = [...$("#stage").querySelectorAll(".card")];
  cards.forEach((c, k) => {
    const i = cards.length - 1 - k;   // 0 это верхняя
    if (i > 0) {
      c.style.transition = "transform .45s cubic-bezier(.2,.9,.25,1), filter .45s";
      c.style.transform = tf(i - 1);
      c.style.filter = fl(i - 1);
    }
  });
  el.style.transition = "transform .45s cubic-bezier(.4,0,.8,.6), opacity .45s ease-in";
  el.style.transform = `translate(${dir * (window.innerWidth + 200)}px, ${dir > 0 ? -30 : 30}px) rotate(${dir * 26}deg)`;
  el.style.opacity = "0";
  setTimeout(() => { busy = false; decide(m, dir); }, 380);
}

/* То же самое, но по нажатию на кнопки внизу или стрелки на клавиатуре */
function swipeButton(dir) {
  if (busy || !deck.length) return;
  const el = $("#stage .card:last-child");
  if (!el) return;
  if (el._hint) el._hint.cancel();
  const btn = $(dir > 0 ? "#btn-like" : "#btn-nope");
  btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop");
  const stamp = el.querySelector(dir > 0 ? ".stamp.like" : ".stamp.nope");
  anim(stamp, [{ opacity: 0, transform: `rotate(${dir * -12}deg) scale(.6)` }, { opacity: 1, transform: `rotate(${dir * -12}deg) scale(1)` }], { duration: 220, fill: "forwards" });
  fly(el, deck[0], dir);
}

/* Решение принято: запоминаем и показываем следующую карточку */
function decide(m, dir) {
  deck = deck.filter(d => d.id !== m.id);
  if (dir > 0) {
    state.liked.push(snap(m));
    burst($("#btn-like"), "var(--like)", 12);
    loadRuntime(m.id);
  } else {
    state.passed.push(m.id);
    burst($("#btn-nope"), "var(--nope)", 6);
  }
  history.push({ movie: m, dir });
  save(); renderAll("fly");
  if (dir > 0) showToast(m);
  topUp();
}

/* Длительность есть только в подробностях, поэтому для понравившегося фильма докачиваем её в фоне */
function loadRuntime(id) {
  TMDB.details(id).then(d => {
    const s = state.liked.find(x => x.id === id);
    if (s && d.runtime) { s.runtime = d.runtime; save(); renderList(); }
  }).catch(() => {});
}

/* Вернуть последнее действие */
function undo() {
  const last = history.pop();
  if (!last) return;
  const id = last.movie.id;
  state.liked = state.liked.filter(m => m.id !== id);
  state.passed = state.passed.filter(x => x !== id);
  deck.unshift(last.movie);
  save(); hideToast(); renderAll("undo", last.dir);
}

/* ------------------------------------------------------------
   6. УВЕДОМЛЕНИЕ СВЕРХУ
   ------------------------------------------------------------ */
let toastTimer = null;
function showToast(m) {
  const t = $("#toast");
  t.innerHTML = `<span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    <div class="tmain" data-open="${m.id}"><small>Добавлено в мой вечер</small><b>${esc(m.title)}</b></div>
    <button class="tundo" data-undo>Отменить</button><i class="bar"></i>`;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3300);
}
function hideToast() { clearTimeout(toastTimer); $("#toast").classList.remove("show"); }

/* ------------------------------------------------------------
   7. ЭКРАН «МОЙ ВЕЧЕР»
   ------------------------------------------------------------ */
const validUrl = u => /^https?:\/\/\S+$/i.test(u);

function watchButton(m, cls) {
  const url = state.urls[m.id];
  if (url && validUrl(url)) return `<a class="btn ${cls}" href="${esc(url)}" target="_blank" rel="noopener">${ICON_PLAY}Смотреть</a>`;
  return `<button class="btn ${cls}" data-add-src="${m.id}">${ICON_PLAY}Смотреть</button>`;
}

function renderList() {
  const list = $("#list");
  const items = state.liked;
  if (!items.length) {
    list.innerHTML = `<div class="empty" style="position:static;flex:1">
      <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.6 4.5 6.4 4.5c2.2 0 3.6 1.2 4.6 2.7h2c1-1.5 2.4-2.7 4.6-2.7 3.8 0 5.5 3.9 4 7.3C19.5 16.4 12 21 12 21z"/></svg>
      <h2>Вечер пока пуст</h2><p>Свайпайте вправо фильмы, которые хочется посмотреть. Они появятся здесь.</p></div>`;
    return;
  }
  const known = items.filter(m => m.runtime), total = known.reduce((s, m) => s + m.runtime, 0);
  const totalText = known.length ? `Всего ${known.length < items.length ? "около " : ""}${dur(total)} без перерывов` : "Считаю длительность…";
  list.innerHTML = `<div class="summary" style="--i:0"><b>${items.length} ${plural(items.length)}</b><span>${totalText}</span></div>` +
    items.map((m, i) => `<div class="row" style="--i:${i + 1}" data-row="${m.id}">
      <div class="thumb" data-open="${m.id}">${posterHtml(m.poster, "w185", m.title)}</div>
      <div class="row-main">
        <button class="row-title" data-open="${m.id}">${esc(m.title)}</button>
        <div class="row-meta">${[m.year, dur(m.runtime), `★ ${m.rating.toFixed(1)}`].filter(Boolean).join(" · ")}</div>
        <div class="row-actions">${watchButton(m, "primary")}<button class="btn ghost" data-remove="${m.id}">Убрать</button></div>
      </div></div>`).join("");
}

/* ------------------------------------------------------------
   8. ОКНО ФИЛЬМА С ТРЕЙЛЕРОМ
   Сначала сразу показываем то, что уже знаем (название, постер, описание),
   а подробности и трейлер догружаем и подставляем, как только они придут.
   ------------------------------------------------------------ */
function findMovie(id) {
  return deck.find(m => m.id === id) || state.liked.find(m => m.id === id) || history.map(h => h.movie).find(m => m.id === id);
}

function closeOverlay() {
  const o = $("#overlay");
  if (o.hidden) return;
  o.classList.remove("static");
  o.classList.add("closing");
  sheetMovie = null;
  // убираем содержимое после анимации: так плеер выключается и трейлер перестаёт играть
  setTimeout(() => { if (!sheetMovie) { o.hidden = true; o.innerHTML = ""; } o.classList.remove("closing"); }, RM ? 0 : 240);
}

function mediaHtml(m) {
  const back = TMDB.img(m.backdrop, "w780") || TMDB.img(m.poster, "w500");
  return `${back ? `<img src="${back}" alt="">` : ""}<div class="spinner"></div>`;
}

function playerHtml(key) {
  // На iPhone видео со звуком само не стартует, поэтому запускаем без звука. Звук включается в плеере.
  const mute = IS_IOS ? "&mute=1" : "";
  return `<iframe src="https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0&playsinline=1${mute}" title="Трейлер"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

function actionsHtml(m) {
  return `${watchButton(m, "primary")}<button class="btn" data-toggle>${isLiked(m.id) ? "Убрать из вечера" : "В мой вечер"}</button>`;
}

function openSheet(m, focusSrc) {
  hideToast();
  const o = $("#overlay");
  const wasOpen = !o.hidden && !o.classList.contains("closing");   // если окно уже открыто, не проигрываем анимацию заново
  sheetMovie = Object.assign({}, m);
  const id = m.id;
  const url = state.urls[id] || "";
  o.classList.remove("closing");
  o.classList.toggle("static", wasOpen);
  o.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(m.title)}">
    <div class="sheet-media" id="sheet-media">${mediaHtml(m)}</div>
    <button class="close" data-close aria-label="Закрыть"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="sheet-body">
      <div class="sheet-title"><h2>${esc(m.title)}</h2><div class="o" id="sheet-sub"></div></div>
      <div class="tags" id="sheet-tags"></div>
      <p id="sheet-overview"></p>
      <dl class="facts" id="sheet-facts"></dl>
      <div class="src">
        <label for="src-input">Ссылка на ваш файл с фильмом</label>
        <div class="src-row"><input id="src-input" type="url" inputmode="url" placeholder="https://… (ваш сервер или Google Drive)" value="${esc(url)}"><button class="btn" id="src-save">Сохранить</button></div>
        <small id="src-note">${url ? "Ссылка сохранена. Кнопка «Смотреть» откроет её в новой вкладке." : "Вставьте ссылку один раз, дальше «Смотреть» будет открывать фильм сразу."}</small>
      </div>
      <div class="sheet-actions" id="sheet-actions">${actionsHtml(m)}</div>
    </div></div>`;
  o.hidden = false;
  fillSheetInfo(sheetMovie);
  if (focusSrc) { $("#src-input").focus(); $("#src-note").textContent = "Сначала добавьте ссылку на этот фильм, потом «Смотреть» заработает."; }

  // Подробности и трейлер приходят отдельным запросом
  TMDB.details(id).then(d => {
    if (!sheetMovie || sheetMovie.id !== id) return;   // окно уже закрыли или открыли другой фильм
    sheetMovie = Object.assign(sheetMovie, d);
    fillSheetInfo(sheetMovie);
    const media = $("#sheet-media");
    if (!media) return;
    if (d.trailerKey) {
      media.innerHTML = playerHtml(d.trailerKey);
    } else {
      media.querySelector(".spinner")?.remove();
      media.insertAdjacentHTML("beforeend", `<div class="no-trailer"><span>Трейлер не найден</span><a class="btn" href="${youtubeSearch(sheetMovie)}" target="_blank" rel="noopener">Искать на YouTube</a></div>`);
    }
  }).catch(() => {
    const media = $("#sheet-media");
    if (!media || !sheetMovie || sheetMovie.id !== id) return;
    media.querySelector(".spinner")?.remove();
    media.insertAdjacentHTML("beforeend", `<div class="no-trailer"><span>Не удалось загрузить трейлер</span><a class="btn" href="${youtubeSearch(sheetMovie)}" target="_blank" rel="noopener">YouTube</a></div>`);
  });
}

/* Подставляет в окно то, что известно о фильме на данный момент */
function fillSheetInfo(m) {
  $("#sheet-sub").textContent = [m.orig && m.orig !== m.title ? m.orig : "", m.year, dur(m.runtime)].filter(Boolean).join(" · ");
  $("#sheet-tags").innerHTML = (m.genres || []).map(x => `<span class="tag">${esc(x)}</span>`).join("");
  $("#sheet-overview").textContent = m.overview || (m.runtime ? "У этого фильма пока нет описания на выбранном языке." : "");
  const facts = [["Рейтинг", m.rating ? `★ ${m.rating.toFixed(1)}` : ""], ["Режиссёр", m.director], ["В ролях", (m.cast || []).join(", ")]].filter(f => f[1]);
  $("#sheet-facts").innerHTML = facts.map(f => `<dt>${f[0]}</dt><dd>${esc(f[1])}</dd>`).join("");
}

function saveSrc() {
  if (!sheetMovie) return;
  const id = sheetMovie.id;
  const v = $("#src-input").value.trim();
  if (v && !validUrl(v)) { $("#src-note").textContent = "Ссылка должна начинаться с http:// или https://"; return; }
  if (v) state.urls[id] = v; else delete state.urls[id];
  save(); renderList();
  $("#sheet-actions").innerHTML = actionsHtml(sheetMovie);
  $("#src-note").textContent = v ? "Ссылка сохранена. Кнопка «Смотреть» откроет её в новой вкладке." : "Ссылка удалена.";
}

function toggleLike(m) {
  if (isLiked(m.id)) {
    state.liked = state.liked.filter(x => x.id !== m.id);
  } else {
    state.liked.push(snap(m));
    state.passed = state.passed.filter(x => x !== m.id);
    deck = deck.filter(d => d.id !== m.id);
    if (!m.runtime) loadRuntime(m.id);
  }
  save(); renderAll();
  $("#sheet-actions").innerHTML = actionsHtml(m);
}

/* ------------------------------------------------------------
   9. ОБРАБОТЧИКИ НАЖАТИЙ
   Один общий слушатель на весь документ: смотрим, на что именно нажали.
   Нужное действие зашито в data-атрибутах кнопок (data-open, data-remove и так далее).
   ------------------------------------------------------------ */
document.addEventListener("click", e => {
  const t = e.target.closest("button, [data-open], .backdrop");
  if (!t) return;
  if (t.id === "tab-swipe") return setTab("swipe");
  if (t.id === "tab-list") return setTab("list");
  if (t.id === "btn-like") return swipeButton(1);
  if (t.id === "btn-nope") return swipeButton(-1);
  if (t.id === "btn-undo") return undo();
  if (t.id === "btn-retry") { if (!genres.length) return boot(); paging = newPaging(); return refill("init"); }
  if (t.id === "btn-reset") { state.passed = []; history = []; save(); paging = newPaging(); return refill("filter"); }
  if (t.id === "src-save") return saveSrc();
  if ("genre" in t.dataset) return selectGenre(+t.dataset.genre, t);
  if ("undo" in t.dataset) return undo();
  if (t.dataset.open) { const m = findMovie(+t.dataset.open); return m && openSheet(m); }
  if (t.dataset.addSrc) { const m = findMovie(+t.dataset.addSrc); return m && openSheet(m, true); }
  if (t.dataset.remove) {
    const id = +t.dataset.remove;
    const remove = () => { state.liked = state.liked.filter(x => x.id !== id); save(); renderAll(); };
    const row = $(`[data-row="${id}"]`);
    if (row && !RM) { row.classList.add("out"); return setTimeout(remove, 340); }
    return remove();
  }
  if ("toggle" in t.dataset) return sheetMovie && toggleLike(sheetMovie);
  if ("close" in t.dataset) return closeOverlay();
  if (t.classList.contains("backdrop") && e.target === t) return closeOverlay();
});

document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") { if (e.key === "Enter") saveSrc(); return; }
  if (e.key === "Escape") closeOverlay();
  if ($("#overlay").hidden && !$("#view-swipe").hidden) {
    if (e.key === "ArrowRight") swipeButton(1);
    if (e.key === "ArrowLeft") swipeButton(-1);
  }
});

function setTab(name) {
  const next = $(name === "swipe" ? "#view-swipe" : "#view-list");
  const changed = next.hidden;
  $("#view-swipe").hidden = name !== "swipe";
  $("#view-list").hidden = name !== "list";
  $("#tab-swipe").setAttribute("aria-selected", name === "swipe");
  $("#tab-list").setAttribute("aria-selected", name === "list");
  $("#tab-ind").classList.toggle("right", name === "list");
  if (!changed) return;
  next.classList.remove("enter"); void next.offsetWidth; next.classList.add("enter");
  if (name === "list") {
    const l = $("#list");
    l.classList.add("enter");
    setTimeout(() => l.classList.remove("enter"), 1200);
  }
}

let prevLiked = state.liked.length;
function renderAll(mode, undoDir) {
  renderSwipe(mode, undoDir); renderList();
  const b = $("#badge");
  b.textContent = state.liked.length; b.hidden = state.liked.length === 0;
  if (state.liked.length > prevLiked) bump(b);
  prevLiked = state.liked.length;
}

/* ------------------------------------------------------------
   10. ЗАПУСК И ЗАСТАВКА
   Заставка: красная точка появляется, дважды пульсирует,
   затем из неё влево выезжает слово «filmder». Нажатие по заставке пропускает её.
   ------------------------------------------------------------ */
let appStarted = false;

async function boot() {
  try {
    paging = newPaging();
    genres = await TMDB.genres();
  } catch (e) {
    paging.error = e.message;   // покажем ошибку с кнопкой «Повторить»
    renderSwipe();
    return;
  }
  renderChips();
  const active = document.querySelector('.chip[aria-pressed="true"]');
  if (active) centerChip(active, false);
  updateFade();
  renderAll("init");   // сначала «Ищу фильмы…»
  await fillDeck(8);
  renderSwipe("init"); // потом карточки
}

function startApp() {
  if (appStarted) return;
  appStarted = true;
  if (!CONFIG.TMDB_KEY.trim()) { $("#setup").hidden = false; return; }
  boot();
}

async function runSplash() {
  const sp = $("#splash");
  const animated = !RM && !!sp.animate;
  try {
    if (animated) {
      const mark = $("#mark"), word = $("#word"), dot = $("#sdot");
      sp.addEventListener("click", () => sp.getAnimations({ subtree: true }).forEach(a => a.finish()));
      try { await Promise.race([document.fonts.ready, wait(1200)]); } catch (e) {}
      const glow = "rgba(255, 122, 92, ";
      // 1. Точка появляется
      dot.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: 450, easing: "cubic-bezier(.3,1.5,.4,1)", fill: "forwards" });
      // 2. Двойная пульсация с расходящимся свечением
      [500, 1150].forEach(delay => dot.animate([
        { transform: "scale(1)", boxShadow: `0 0 0 0 ${glow}.55)` },
        { transform: "scale(1.5)", boxShadow: `0 0 0 0 ${glow}.45)`, offset: .4 },
        { transform: "scale(1)", boxShadow: `0 0 0 18px ${glow}0)` }
      ], { duration: 650, delay, easing: "ease-out" }));
      // 3. Слово раскрывается от точки влево. Пока слова нет, сдвигаем группу, чтобы точка стояла по центру.
      const shift = (word.getBoundingClientRect().width + 8) / 2;
      const opt = { duration: 850, delay: 1750, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" };
      mark.animate([{ transform: `translateX(${-shift}px)` }, { transform: "translateX(0)" }], opt);
      const reveal = word.animate([{ clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0%)" }], opt);
      await reveal.finished;
      await wait(350);
    }
    startApp();   // приложение начинает загрузку, пока заставка тает
    if (animated) await sp.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, fill: "forwards" }).finished;
  } catch (e) {
    startApp();
  }
  sp.remove();
}
runSplash();
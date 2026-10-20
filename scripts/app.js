const $ = sel => document.querySelector(sel);

const STORE_KEY = "filmder-tmdb-v2";
let state = { liked: [], passed: [], urls: {}, genre: 0, multiGenres: [] };
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  if (saved) state = Object.assign(state, saved);
} catch (e) {}
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} };

const isLiked = id => state.liked.some(m => m.id === id);
const isSeen = id => isLiked(id) || state.passed.includes(id);
const snap = m => ({ id: m.id, title: m.title, orig: m.orig, year: m.year, rating: m.rating, poster: m.poster, runtime: m.runtime || 0, genres: m.genres || [] });

let genres = [];
let deck = [];
let paging = newPaging();
let history = [];
let busy = false;
let sheetMovie = null;

// --- ЛОГИКА ТЕМЫ (Полукруг с задержкой 0.1с и плавным появлением элементов) ---
const THEME_KEY = "filmder-theme";
const themeCheckbox = document.getElementById("theme-switch-input");

function applyTheme(isLight, animate = false) {
  if (!animate) {
    if (isLight) document.documentElement.classList.add("light");
    else document.documentElement.classList.remove("light");
    if (themeCheckbox) themeCheckbox.checked = isLight;
    return;
  }

  const wave = document.createElement("div");
  wave.className = "theme-wave";
  
  const newBgColor = isLight ? "#EAECEC" : "#0a0a0d";
  wave.style.background = newBgColor;
  
  document.body.appendChild(wave);

  // Анимация разрастания полукруга
  const anim = wave.animate([
    { transform: "translate(-50%, 0) scale(0)", opacity: 1 },
    { transform: "translate(-50%, 0) scale(75)", opacity: 1 }
  ], {
    duration: 600,
    easing: "cubic-bezier(0.25, 1, 0.5, 1)",
    fill: "forwards"
  });

  anim.onfinish = () => {
    // 1. Когда экран полностью заполнен, меняем тему под волной
    if (isLight) document.documentElement.classList.add("light");
    else document.documentElement.classList.remove("light");

    // 2. Держим экран заполненным 0.1 секунды (100 мс)
    setTimeout(() => {
      // 3. Плавно убираем волну (фейдим)
      const fadeOut = wave.animate([
        { opacity: 1 },
        { opacity: 0 }
      ], {
        duration: 500,
        easing: "ease-out",
        fill: "forwards"
      });

      // 4. Одновременно запускаем красивое появление элементов интерфейса
      const appEl = document.querySelector(".app");
      if (appEl) {
        appEl.classList.remove("theme-reveal");
        void appEl.offsetWidth;
        appEl.classList.add("theme-reveal");
      }

      fadeOut.onfinish = () => wave.remove();
    }, 100);
  };
}

// Инициализация темы при загрузке без анимации
const savedTheme = localStorage.getItem(THEME_KEY);
applyTheme(savedTheme === "light", false);

// Обработчик переключения тумблера
if (themeCheckbox) {
  themeCheckbox.addEventListener("change", () => {
    const isLight = themeCheckbox.checked;
    localStorage.setItem(THEME_KEY, isLight ? "light" : "dark");
    applyTheme(isLight, true);
  });
}

function newPaging() { return { page: 0, total: 1, loading: false, error: null }; }

const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const wait = ms => new Promise(r => setTimeout(r, ms));
function dur(min) { if (!min) return ""; const h = Math.floor(min / 60), m = min % 60; return h ? `${h} ч ${m} мин` : `${m} мин`; }
function plural(n) { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? "фильм" : (a >= 2 && a <= 4 && (b < 10 || b >= 20)) ? "фильма" : "фильмов"; }
const ICON_PLAY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>`;
const youtubeSearch = m => "https://www.youtube.com/results?search_query=" + encodeURIComponent(`${m.title} ${m.year} официальный трейлер`);

function anim(el, keyframes, options) {
  if (!el || RM || !el.animate) return null;
  return el.animate(keyframes, Object.assign({ fill: "backwards", easing: "cubic-bezier(.2,.9,.25,1)" }, options));
}
const bump = el => anim(el, [{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 380 });

function posterHtml(path, size, alt) {
  const src = TMDB.img(path, "original");
  return `<div class="poster">${src ? `<img src="${src}" alt="${esc(alt || "")}" draggable="false" decoding="async">` : ""}</div>`;
}

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

function burstDelete(rowEl) {
  if (RM) return;
  const r = rowEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < 14; i++) {
    const p = document.createElement("span");
    const s = 3 + Math.random() * 5;
    p.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:${s}px;height:${s}px;border-radius:50%;background:var(--nope);pointer-events:none;z-index:40`;
    document.body.appendChild(p);
    const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 50;
    const an = p.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(0)`, opacity: 0 }
    ], { duration: 500 + Math.random() * 200, easing: "cubic-bezier(.1,.7,.3,1)" });
    an.onfinish = () => p.remove();
  }
}

async function fillDeck(min = 8) {
  const p = paging;
  if (p.loading) return;
  p.loading = true; p.error = null;
  try {
    let guard = 0;
    if (p.page === 0) p.page = 1;

    while (deck.length < min && p.page <= p.total && guard++ < 6) {
      const filter = state.multiGenres.length ? state.multiGenres : (state.genre || null);
      const data = await TMDB.discover(filter, p.page);
      if (p !== paging) return;
      
      p.total = Math.min(data.totalPages || 40, 40);
      
      for (const m of data.items) {
        if (m.poster && !isSeen(m.id) && !deck.some(d => d.id === m.id)) deck.push(m);
      }
      
      if (deck.length < min && p.page < p.total) {
        p.page++;
      } else {
        break;
      }
    }
  } catch (e) {
    if (p === paging) p.error = e.message;
  }
  p.loading = false;
}

function topUp() {
  if (deck.length >= 6 || paging.page >= paging.total || paging.loading) return;
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
const fl = i => `brightness(${1 - i * 0.22})`;

function cardHtml(m) {
  const sub = m.orig && m.orig !== m.title ? `${esc(m.orig)} · ${m.year}` : m.year;
  return `${posterHtml(m.poster, "original", m.title)}<div class="shade"></div>
    <div class="tap-hint">${ICON_PLAY}Трейлер</div>
    <div class="rate">★ ${m.rating.toFixed(1)}</div>
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
        <h2>Фильмы по вашему запросу закончились</h2><p>Выберите другие жанры${state.passed.length ? " или верните пропущенные" : ""}.</p>
        ${state.passed.length ? `<button class="btn primary" id="btn-reset">Показать пропущенные снова</button>` : ""}</div>`;
    }
    stage.innerHTML = html;
    anim(stage.firstElementChild, [{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 450 });
    return;
  }

  const top = deck.slice(0, 3);
  stage.innerHTML = "";
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

function hint(el) {
  el._hint = anim(el, [
    { transform: tf(0) },
    { transform: "translateX(26px) rotate(3deg)", offset: .3 },
    { transform: "translateX(-26px) rotate(-3deg)", offset: .65 },
    { transform: tf(0) }
  ], { duration: 1300, delay: 1600, fill: "none", easing: "ease-in-out" });
}

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
    start.dx = e.clientX - start.x; 
    start.dy = e.clientY - start.y;
    if (Math.abs(start.dx) > 6 || Math.abs(start.dy) > 6) start.moved = true;
    
    el.style.transform = `translate(${start.dx}px, ${start.dy}px) rotate(${start.dx / 18}deg)`;
    pos.style.transform = `translate(${-start.dx * 0.18}px, ${-start.dy * 0.18}px) scale(1.3)`;

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
    if (!s.moved) { el.style.transition = ""; pos.style.transform = ""; openSheet(m); return; }
    if (s.dx > 90) fly(el, m, 1);
    else if (s.dx < -90) fly(el, m, -1);
    else {
      el.style.transition = "transform .5s cubic-bezier(.3,1.5,.4,1)";
      el.style.transform = tf(0);
      pos.style.transform = "";
      likeStamp.style.opacity = nopeStamp.style.opacity = 0;
    }
  };

  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

function fly(el, m, dir) {
  if (busy) return;
  busy = true;
  const cards = [...$("#stage").querySelectorAll(".card")];
  cards.forEach((c, k) => {
    const i = cards.length - 1 - k;
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

function loadRuntime(id) {
  TMDB.details(id).then(d => {
    const s = state.liked.find(x => x.id === id);
    if (s) {
      if (d.runtime) s.runtime = d.runtime;
      if (d.genres) s.genres = d.genres;
      save(); renderList();
    }
  }).catch(() => {});
}

function undo() {
  const last = history.pop();
  if (!last) return;
  const id = last.movie.id;
  state.liked = state.liked.filter(m => m.id !== id);
  state.passed = state.passed.filter(x => x !== id);
  deck.unshift(last.movie);
  save(); hideToast(); renderAll("undo", last.dir);
}

let toastTimer = null;
function showToast(m) {
  const t = $("#toast");
  t.innerHTML = `<span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    <div class="tmain" data-open="${m.id}"><small>Добавлено в мой вечер</small><b>${esc(m.title)}</b></div>
    <button class="tundo" data-undo>Отменить</button><i class="bar"></i>`;
  
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3300);
}

function hideToast() { 
  clearTimeout(toastTimer); 
  $("#toast").classList.remove("show"); 
}

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

  const groups = {};
  items.forEach(m => {
    let cat = "Без категории";
    if (m.genres && m.genres.length) {
      const animGenre = m.genres.find(g => g === "Мультфильмы" || g === "Аниме");
      cat = animGenre || m.genres[0];
    }
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(m);
  });

  let html = `<div class="summary" style="--i:0"><b>${items.length} ${plural(items.length)}</b><span>${totalText}</span></div>`;
  let idx = 1;

  for (const [cat, movies] of Object.entries(groups)) {
    html += `<div class="list-category-title">${esc(cat)}</div>`;
    for (const m of movies) {
      html += `<div class="row-container" data-id="${m.id}">
        <div class="row-delete-bg">Удалить</div>
        <div class="row" style="--i:${idx++}" data-row="${m.id}">
          <div class="thumb" data-open="${m.id}">${posterHtml(m.poster, "original", m.title)}</div>
          <div class="row-main">
            <button class="row-title" data-open="${m.id}">${esc(m.title)}</button>
            <div class="row-meta">${[m.year, dur(m.runtime), `★ ${m.rating.toFixed(1)}`].filter(Boolean).join(" · ")}</div>
            <div class="row-actions">${watchButton(m, "primary")}</div>
          </div>
        </div>
      </div>`;
    }
  }

  list.innerHTML = html;
  bindRowSwipe();
}

function bindRowSwipe() {
  document.querySelectorAll(".row").forEach(row => {
    let startX = 0, startY = 0, currentX = 0, isDragging = false, locked = false;
    const container = row.closest(".row-container");
    const id = +container.dataset.id;

    row.addEventListener("pointerdown", e => {
      if (e.target.closest("button, a, .thumb")) return;
      startX = e.clientX;
      startY = e.clientY;
      isDragging = true;
      locked = false;
      row.style.transition = "none";
      row.setPointerCapture(e.pointerId);
    });

    row.addEventListener("pointermove", e => {
      if (!isDragging) return;
      currentX = e.clientX - startX;
      const currentY = e.clientY - startY;

      if (!locked) {
        if (Math.abs(currentY) > Math.abs(currentX)) {
          isDragging = false;
          row.style.transform = "translateX(0)";
          return;
        }
        if (Math.abs(currentX) > 10) locked = true;
      }

      if (locked && currentX < 0) {
        row.style.transform = `translateX(${currentX}px)`;
      }
    });

    const finishDrag = () => {
      if (!isDragging && !locked) return;
      isDragging = false;
      locked = false;
      
      if (currentX < -90) {
        row.style.transition = "transform .25s ease-out, opacity .25s ease-out";
        row.style.transform = "translateX(-120%)";
        row.style.opacity = "0";
        burstDelete(row);
        container.classList.add("removing");
        setTimeout(() => {
          state.liked = state.liked.filter(x => x.id !== id);
          save();
          renderAll();
        }, 280);
      } else {
        row.style.transition = "transform .3s var(--spring)";
        row.style.transform = "translateX(0)";
      }
      currentX = 0;
    };

    row.addEventListener("pointerup", finishDrag);
    row.addEventListener("pointercancel", finishDrag);
  });
}

function findMovie(id) {
  return deck.find(m => m.id === id) || state.liked.find(m => m.id === id) || history.map(h => h.movie).find(m => m.id === id);
}

function closeOverlay() {
  const o = $("#overlay");
  if (o.hidden) return;
  o.classList.remove("static");
  o.classList.add("closing");
  sheetMovie = null;
  setTimeout(() => { if (!sheetMovie) { o.hidden = true; o.innerHTML = ""; } o.classList.remove("closing"); }, RM ? 0 : 240);
}

function mediaHtml(m) {
  const back = TMDB.img(m.backdrop, "w780") || TMDB.img(m.poster, "original");
  return `${back ? `<img src="${back}" alt="">` : ""}<div class="spinner"></div>`;
}

function playerHtml(key) {
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
  const wasOpen = !o.hidden && !o.classList.contains("closing");
  sheetMovie = Object.assign({}, m);
  const id = m.id;
  const url = state.urls[id] || "";
  o.classList.remove("closing");
  o.classList.toggle("static", wasOpen);

  o.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(m.title)}" id="sheet-element">
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
      <div class="related-section" id="related-section"></div>
    </div></div>`;

  o.hidden = false;
  fillSheetInfo(sheetMovie);
  if (focusSrc) { $("#src-input").focus(); $("#src-note").textContent = "Сначала добавьте ссылку на этот фильм, потом «Смотреть» заработает."; }

  bindSheetSwipeToClose();

  TMDB.details(id).then(d => {
    if (!sheetMovie || sheetMovie.id !== id) return;
    sheetMovie = Object.assign(sheetMovie, d);
    fillSheetInfo(sheetMovie);
    const media = $("#sheet-media");
    if (media) {
      if (d.trailerKey) {
        media.innerHTML = playerHtml(d.trailerKey);
      } else {
        media.querySelector(".spinner")?.remove();
        media.insertAdjacentHTML("beforeend", `<div class="no-trailer"><span>Трейлер не найден</span><a class="btn" href="${youtubeSearch(sheetMovie)}" target="_blank" rel="noopener">Искать на YouTube</a></div>`);
      }
    }
    renderRelated(d.related);
  }).catch(() => {
    const media = $("#sheet-media");
    if (media) {
      media.querySelector(".spinner")?.remove();
      media.insertAdjacentHTML("beforeend", `<div class="no-trailer"><span>Не удалось загрузить трейлер</span><a class="btn" href="${youtubeSearch(sheetMovie)}" target="_blank" rel="noopener">YouTube</a></div>`);
    }
  });
}

function bindSheetSwipeToClose() {
  const sheet = $("#sheet-element");
  if (!sheet) return;
  let startY = 0, currentY = 0, isDragging = false;

  sheet.addEventListener("pointerdown", e => {
    if (sheet.scrollTop <= 0) {
      startY = e.clientY;
      isDragging = true;
    }
  });

  sheet.addEventListener("pointermove", e => {
    if (!isDragging) return;
    currentY = e.clientY - startY;
    if (currentY > 0) {
      sheet.style.transform = `translateY(${currentY}px)`;
    }
  });

  const endDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    sheet.style.transition = "transform .3s var(--spring)";
    if (currentY > 100) {
      sheet.style.transform = "translateY(100%)";
      setTimeout(closeOverlay, 250);
    } else {
      sheet.style.transform = "translateY(0)";
    }
    currentY = 0;
    setTimeout(() => sheet.style.transition = "", 300);
  };

  sheet.addEventListener("pointerup", endDrag);
  sheet.addEventListener("pointercancel", endDrag);
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
    <div class="related-scroll">
      ${related.slice(0, 8).map(r => `
        <div class="related-card" data-related-id="${r.id}">
          <div class="related-poster">${r.poster ? `<img src="${TMDB.img(r.poster, "original")}" alt="${esc(r.title)}" loading="lazy">` : ""}</div>
          <div class="related-name">${esc(r.title)}</div>
        </div>
      `).join("")}
    </div>`;
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

function openFiltersModal() {
  const grid = $("#filter-grid");
  grid.innerHTML = genres.map(g => `
    <label class="filter-item">
      <input type="checkbox" value="${g.id}" ${state.multiGenres.includes(g.id) ? "checked" : ""}>
      <span>${esc(g.name)}</span>
    </label>
  `).join("");
  $("#filters-overlay").hidden = false;
}

function applyFiltersModal() {
  const checked = [...$("#filter-grid").querySelectorAll("input:checked")].map(i => i.value === "anime" ? "anime" : isNaN(i.value) ? i.value : +i.value);
  state.multiGenres = checked;
  state.genre = 0;
  save();
  $("#filters-overlay").hidden = true;
  deck = []; history = []; paging = newPaging();
  refill("filter");
}

function selectGenre(id) {
  if (state.genre === id && state.multiGenres.length === 0) {
    state.genre = 0;
  } else {
    state.genre = id;
    state.multiGenres = [];
  }
  save();
  deck = []; history = []; paging = newPaging();
  refill("filter");
}

const tutorialSteps = [
  { title: "Добро пожаловать в Filmder!", text: "Удобный способ находить фильмы на вечер с друзьями или в одиночку." },
  { title: "Как свайпать", text: "Свайп вправо добавляет фильм в «Мой вечер», свайп влево — пропускает его." },
  { title: "Жанры и фильтры", text: "Настраивайте мультивыбор жанров через кнопку «Фильтры» в правом верхнем углу." },
  { title: "Мой вечер", text: "Здесь хранятся ваши выбранные фильмы, разбитые по категориям. Смахните фильм влево, чтобы удалить его." }
];
let currentTutorialStep = 0;

function checkTutorial() {
  if (!localStorage.getItem("filmder-tutorial-shown")) {
    showTutorialStep(0);
    $("#tutorial").hidden = false;
  }
}

function showTutorialStep(step) {
  currentTutorialStep = step;
  if (step >= tutorialSteps.length) {
    $("#tutorial").hidden = true;
    localStorage.setItem("filmder-tutorial-shown", "true");
    return;
  }
  $("#tutorial-step-counter").textContent = `Шаг ${step + 1} из ${tutorialSteps.length}`;
  $("#tutorial-title").textContent = tutorialSteps[step].title;
  $("#tutorial-text").textContent = tutorialSteps[step].text;
  $("#tutorial-next").textContent = step === tutorialSteps.length - 1 ? "Начать" : "Далее";
}

document.addEventListener("click", e => {
  const t = e.target.closest("button, [data-open], [data-related-id], .backdrop");
  if (!t) return;
  if (t.id === "tab-swipe") return setTab("swipe");
  if (t.id === "tab-list") return setTab("list");
  if (t.id === "btn-like") return swipeButton(1);
  if (t.id === "btn-nope") return swipeButton(-1);
  if (t.id === "btn-undo") return undo();
  if (t.id === "btn-open-filters") return openFiltersModal();
  if (t.id === "btn-apply-filters") return applyFiltersModal();
  if (t.id === "btn-reset-filters") { $("#filter-grid").querySelectorAll("input").forEach(i => i.checked = false); }
  if (t.id === "tutorial-next") return showTutorialStep(currentTutorialStep + 1);
  if (t.id === "tutorial-skip") { $("#tutorial").hidden = true; localStorage.setItem("filmder-tutorial-shown", "true"); }
  if (t.id === "btn-retry") { if (!genres.length) return boot(); paging = newPaging(); return refill("init"); }
  if (t.id === "btn-reset") { state.passed = []; history = []; save(); paging = newPaging(); return refill("filter"); }
  if (t.id === "src-save") return saveSrc();
  if ("undo" in t.dataset) return undo();
  if (t.dataset.open) { const m = findMovie(+t.dataset.open); return m && openSheet(m); }
  if (t.dataset.relatedId) { const m = findMovie(+t.dataset.relatedId); if (m) openSheet(m); else TMDB.details(+t.dataset.relatedId).then(openSheet); return; }
  if (t.dataset.addSrc) { const m = findMovie(+t.dataset.addSrc); return m && openSheet(m, true); }
  if ("toggle" in t.dataset) return sheetMovie && toggleLike(sheetMovie);
  if ("close" in t.dataset) return closeOverlay();
  if (t.classList.contains("backdrop") && e.target === t) {
    if (t.id === "filters-overlay") t.hidden = true;
    else closeOverlay();
  }
});

document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") { if (e.key === "Enter") saveSrc(); return; }
  if (e.key === "Escape") { closeOverlay(); $("#filters-overlay").hidden = true; }
  if ($("#overlay").hidden && $("#filters-overlay").hidden && !$("#view-swipe").hidden) {
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

let appStarted = false;

async function boot() {
  try {
    paging = newPaging();
    genres = await TMDB.genres();
  } catch (e) {
    paging.error = e.message;
    renderSwipe();
    return;
  }
  renderAll("init");
  await fillDeck(8);
  renderSwipe("init");
  checkTutorial();
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
      dot.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: 450, easing: "cubic-bezier(.3,1.5,.4,1)", fill: "forwards" });
      [500, 1150].forEach(delay => dot.animate([
        { transform: "scale(1)", boxShadow: `0 0 0 0 ${glow}.55)` },
        { transform: "scale(1.5)", boxShadow: `0 0 0 0 ${glow}.45)`, offset: .4 },
        { transform: "scale(1)", boxShadow: `0 0 0 18px ${glow}0)` }
      ], { duration: 650, delay, easing: "ease-out" }));
      const shift = (word.getBoundingClientRect().width + 8) / 2;
      const opt = { duration: 850, delay: 1750, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" };
      mark.animate([{ transform: `translateX(${-shift}px)` }, { transform: "translateX(0)" }], opt);
      const reveal = word.animate([{ clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0%)" }], opt);
      await reveal.finished;
      await wait(350);
    }
    startApp();
    if (animated) await sp.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, fill: "forwards" }).finished;
  } catch (e) {
    startApp();
  }
  sp.remove();
}
runSplash();
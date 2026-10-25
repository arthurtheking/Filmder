"use strict";

/* ============ Колесо на вечер ============ */
const ICON_DICE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="8.5" cy="15.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="15.5" r=".9" fill="currentColor"/></svg>`;
const ICON_GAME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10v5M4.5 12.5h5M15.5 11.5h.01M18 14h.01"/></svg>`;
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
  </button>
  <button class="fate-btn" id="btn-fate" style="--i:${i + 1}">
    <span class="fate-ico">${ICON_GAME}</span>
    <span class="fate-t"><b>Пусть решит игра</b><small>${typeof DG !== "undefined" ? DG.ids.length : 30} мини-игр: скачки, рулетка, дартс…</small></span>
    <span class="fate-go" aria-hidden="true">›</span>
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
  wheelPreloadWinner(wheelSegs[k]);
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

// Большой постер победного экрана грузим и декодируем заранее, пока карусель крутится,
// иначе при подмене карточки на копию в «Сегодня смотрим» постер на пару кадров мигает пустым
const wheelWinUrl = m => (m && m.poster ? TMDB.img(m.poster, "w500") : null);
function wheelPreloadWinner(m) { const u = wheelWinUrl(m); if (u) keepImage(u); }
function wheelWinnerReady(m) {
  const u = wheelWinUrl(m), im = u && imgKeep.get(u);
  if (!im) return Promise.resolve();
  return Promise.race([im.decode ? im.decode().catch(() => {}) : Promise.resolve(), wait(600)]);
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
  wheelOpenTimer = setTimeout(() => wheelWinnerReady(m).then(() => { if (wheelWon && wheelCurrent === m) wheelReveal(); }), 900);
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

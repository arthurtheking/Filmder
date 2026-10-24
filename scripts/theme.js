"use strict";

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

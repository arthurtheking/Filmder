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

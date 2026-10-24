"use strict";

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

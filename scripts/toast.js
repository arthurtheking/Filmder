"use strict";

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

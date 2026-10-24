"use strict";

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

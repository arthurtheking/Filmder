"use strict";

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
  if (dir > 0 && typeof duelBlocks === "function" && duelBlocks()) { // слоты дуэли заняты — карточка возвращается
    el.style.transition = `transform .5s ${SPRING}`;
    el.style.transform = tf(0);
    el.querySelectorAll(".stamp").forEach(x => (x.style.opacity = 0));
    return;
  }
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
  const inDuel = dir > 0 && typeof duelActive === "function" && duelActive();
  if (dir > 0) {
    if (inDuel) duelPick(snap(m));
    else { state.liked.push(snap(m)); loadRuntime(m.id); }
    burst($("#btn-like"), "var(--like)", 8);
  } else {
    passed.add(m.id);
    burst($("#btn-nope"), "var(--nope)", 4);
  }
  history_.push({ movie: m, dir });
  if (history_.length > HISTORY_LIMIT) history_.shift();
  save();
  advanceStack();
  refreshList();
  if (dir > 0) showToast({ sub: inDuel ? "Добавлено в дуэль" : "Добавлено в мой вечер", title: m.title, id: m.id, undo });
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
  if (typeof duelUnpick === "function") duelUnpick(id);
  passed.delete(id);
  deck = deck.filter(d => d.id !== id);
  deck.unshift(last.movie);
  save();
  hideToast();
  haptic();
  renderAll("undo", last.dir);
}

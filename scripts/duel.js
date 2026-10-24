"use strict";

/* ============ Дуэль ============ */
// Комната живёт на сервере (Durable Object). Клиент держит WebSocket и рисует то, что пришло.
// Свайпы в режиме дуэли кладут фильмы не в «Мой вечер», а в слоты комнаты.
const DUEL_KEY = "filmder-duel";
const DUEL_PID_KEY = "filmder-duel-pid";
const duel = { code: "", ws: null, view: null, retry: 0, timer: 0, prevPhase: undefined, shownRound: 0, animate: false, spin: 0 };

const duelEl = () => document.getElementById("duel-overlay");
const duelBase = () => (CONFIG.PROXY_URL || "").trim().replace(/\/+$/, "");
const duelActive = () => !!(duel.code && duel.view && duel.view.phase === "picking");
function duelPid() {
  let v = ls.get(DUEL_PID_KEY) || "";
  if (!/^[a-f0-9]{32}$/.test(v)) { v = syncNewId(); ls.set(DUEL_PID_KEY, v); }
  return v;
}

/* ---------- Подключение ---------- */
function duelSend(o) { if (duel.ws && duel.ws.readyState === 1) duel.ws.send(JSON.stringify(o)); }

function duelConnect() {
  clearTimeout(duel.timer);
  if (!duel.code || (duel.ws && duel.ws.readyState <= 1)) return;
  let ws;
  try { ws = new WebSocket(`${duelBase().replace(/^http/, "ws")}/room/${duel.code}/ws?pid=${duelPid()}`); }
  catch (e) { return duelRetry(); }
  duel.ws = ws;
  ws.onopen = () => { duel.retry = 0; };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === "state") { duel.view = m; duelOnState(); }
    else if (m.t === "error") duelFail(m.code);
  };
  ws.onclose = () => { if (duel.ws === ws) { duel.ws = null; if (duel.code) duelRetry(); } };
}
function duelRetry() {
  clearTimeout(duel.timer);
  duel.timer = setTimeout(duelConnect, Math.min(8000, 1000 * 2 ** duel.retry++));
  duelRender();
}
function duelStart(code) {
  duel.code = code; duel.view = null; duel.prevPhase = undefined; duel.retry = 0;
  ls.set(DUEL_KEY, code);
  duelConnect();
  duelRender();
}
function duelLeave() {
  clearTimeout(duel.timer); clearTimeout(duel.spin);
  duel.code = ""; duel.view = null; duel.animate = false;
  if (duel.ws) { duel.ws.onclose = null; try { duel.ws.close(); } catch (e) {} duel.ws = null; }
  ls.set(DUEL_KEY, "");
  duelRender();
}
function duelFail(code) {
  duelLeave();
  showToast({ sub: "Дуэль", title: code === "full" ? "В комнате уже двое" : "Комната не найдена или закрыта" });
}
function duelResume() {
  const c = ls.get(DUEL_KEY) || "";
  if (/^[A-Z2-9]{5}$/.test(c) && duelBase()) duelStart(c);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && duel.code) duelConnect(); });
addEventListener("online", () => { if (duel.code) duelConnect(); });

/* ---------- Выбор фильмов (вызывается из swipe.js) ---------- */
function duelBlocks() {
  if (!duelActive()) return false;
  const me = duel.view.me;
  if (me.done) { showToast({ sub: "Дуэль", title: "Вы нажали «Готово». Измените это, чтобы выбирать дальше" }); return true; }
  if (me.picks.length >= duel.view.limit) { showToast({ sub: "Дуэль", title: `Все ${duel.view.limit} слотов заняты` }); return true; }
  return false;
}
function duelPick(m) {
  if (!duelActive()) return;
  const me = duel.view.me;
  if (!me.picks.some(x => x.id === m.id)) me.picks.push(m); // сразу показываем, сервер подтвердит
  duelSend({ t: "pick", movie: m });
  duelRenderBar();
}
function duelUnpick(id) {
  if (!duelActive()) return;
  const me = duel.view.me;
  if (!me.picks.some(x => x.id === id)) return;
  me.picks = me.picks.filter(x => x.id !== id);
  duelSend({ t: "unpick", id });
  duelRender();
}

/* ---------- Реакция на состояние ---------- */
function duelOnState() {
  const v = duel.view, prev = duel.prevPhase, o = duelEl();
  duel.prevPhase = v.phase;
  if (v.phase === "picking" && prev !== "picking" && o && !o.hidden) {
    duelClose();
    setTab("swipe");
    showToast({ sub: "Дуэль началась", title: `Выберите до ${v.limit} фильмов` });
  }
  if (v.phase === "result" && duel.shownRound !== v.round) {
    duel.shownRound = v.round;
    if (prev !== undefined) { duel.animate = true; duelOpen(); }
  }
  duelRender();
}

/* ---------- Интерфейс ---------- */
function duelRenderBar() {
  const bar = $("#duel-bar");
  if (!bar) return;
  if (!duelActive()) { bar.hidden = true; return; }
  const v = duel.view, me = v.me, o = v.other;
  bar.hidden = false;
  bar.innerHTML = `<button class="duel-info" data-duel="open"><b>Дуэль ${duel.code}</b>
    <span>Вы ${me.picks.length}/${v.limit} · соперник ${o ? o.count : 0}/${v.limit}${o && o.done ? " · готов" : ""}${o && !o.online ? " · не в сети" : ""}</span></button>
    <button class="btn ${me.done ? "ghost" : "primary"} small" data-duel="done" ${!me.done && !me.picks.length ? "disabled" : ""}>${me.done ? "Ждём · изменить" : "Готово"}</button>`;
}

function duelOpen() {
  if (!duelBase()) return showToast({ sub: "Дуэль", title: "Не задан PROXY_URL в config.js" });
  let o = duelEl();
  if (!o) {
    o = document.createElement("div");
    o.id = "duel-overlay";
    o.hidden = true;
    o.innerHTML = `<div class="duel-top"><b>Дуэль</b><button class="btn icon" data-duel="close" aria-label="Закрыть">${ICON_CLOSE}</button></div><div class="duel-body" id="duel-body"></div>`;
    document.body.appendChild(o);
  }
  o.hidden = false;
  duelRender();
}
function duelClose() { const o = duelEl(); if (o) o.hidden = true; clearTimeout(duel.spin); }

function pickGridHtml(picks, removable) {
  return `<div class="duel-grid">${picks.map(m => `<div class="duel-pick">${m.poster ? `<img src="${TMDB.img(m.poster, "w185")}" alt="${esc(m.title)}">` : `<span>${esc(m.title)}</span>`}
    ${removable ? `<button data-duel-rm="${m.id}" aria-label="Убрать">✕</button>` : ""}</div>`).join("")}</div>`;
}

function duelRender() {
  duelRenderBar();
  const o = duelEl();
  if (!o || o.hidden) return;
  const body = $("#duel-body"), v = duel.view;
  if (!duel.code) {
    body.innerHTML = `<p class="duel-lead">Создайте комнату и отправьте код другу. У каждого по ${10} фильмов, победителя выберет случай.</p>
      <button class="btn primary" data-duel="create">Создать комнату</button>
      <div class="duel-join"><input id="duel-code" maxlength="5" autocapitalize="characters" autocorrect="off" placeholder="КОД"><button class="btn" data-duel="join">Войти</button></div>`;
  } else if (!v) {
    body.innerHTML = `<div class="duel-wait"><div class="spinner"></div><p>Подключаюсь к комнате ${duel.code}…</p></div><button class="btn ghost" data-duel="leave">Выйти</button>`;
  } else if (v.phase === "lobby") {
    body.innerHTML = `<p class="duel-lead">Отправьте код второму игроку</p><div class="duel-code">${duel.code}</div>
      <button class="btn primary" data-duel="share">Поделиться кодом</button>
      <p class="duel-sub">Ждём второго игрока…</p><button class="btn ghost" data-duel="leave">Выйти</button>`;
  } else if (v.phase === "picking") {
    const me = v.me, other = v.other;
    body.innerHTML = `<p class="duel-lead">Комната ${duel.code} · ${me.picks.length}/${v.limit} у вас, ${other ? other.count : 0}/${v.limit} у соперника${other && !other.online ? " (не в сети)" : ""}</p>
      ${me.picks.length ? pickGridHtml(me.picks, !me.done) : `<p class="duel-sub">Пока пусто. Свайпайте вправо фильмы, которые хотите посмотреть.</p>`}
      <button class="btn primary" data-duel="swipe">К свайпам</button>
      <button class="btn ${me.done ? "ghost" : ""}" data-duel="done" ${!me.done && !me.picks.length ? "disabled" : ""}>${me.done ? "Ждём соперника · изменить выбор" : "Готово"}</button>
      <button class="btn ghost" data-duel="leave">Выйти</button>`;
  } else if (v.phase === "result") {
    duelRenderResult(body, v);
  }
}

function duelRenderResult(body, v) {
  const r = v.result, w = r.pool.find(m => m.id === r.winnerId);
  if (!w) return;
  if (duel.animate && !RM() && r.pool.some(m => m.poster)) {
    body.innerHTML = `<p class="duel-lead">Выбираем…</p><div class="duel-reel"><img id="duel-reel-img" alt=""></div>`;
    return duelSpin(r, w);
  }
  const by = r.match || w.owners.length === 2 ? "Выбрали оба" : w.owners[0] === v.you ? "Выбрали вы" : "Выбрал соперник";
  const meta = [w.year, dur(w.runtime), `★ ${(w.rating || 0).toFixed(1)}`].filter(Boolean).join(" · ");
  body.innerHTML = `<div class="duel-tag">Сегодня смотрим${r.match ? " · совпало у обоих!" : ""}</div>
    ${w.poster ? `<img class="duel-poster" src="${TMDB.img(w.poster, "w500")}" alt="">` : ""}
    <h3 class="duel-title">${esc(w.title)}</h3><p class="duel-sub">${esc(meta)} · ${by}</p>
    <div class="duel-pool">${r.pool.map(m => `<i class="${m.owners.length === 2 ? "both" : m.owners[0] === v.you ? "mine" : "theirs"} ${m.id === w.id ? "win" : ""}">${m.poster ? `<img src="${TMDB.img(m.poster, "w92")}" alt="">` : ""}</i>`).join("")}</div>
    <button class="btn primary" data-duel="info">Подробнее</button>
    <button class="btn" data-duel="again">Ещё раунд</button>
    <button class="btn ghost" data-duel="leave">Выйти</button>`;
}

// Анимация «барабана»: постеры сменяются всё медленнее и останавливаются на победителе
function duelSpin(r, win) {
  clearTimeout(duel.spin);
  const pool = r.pool.filter(m => m.poster);
  const steps = 16 + (r.seed % 6);
  let i = r.seed % pool.length, k = 0;
  const tick = () => {
    const el = document.getElementById("duel-reel-img");
    if (!el) return;
    if (k >= steps) {
      duel.animate = false;
      duelRender();
      haptic([20, 40, 30]);
      const o = duelEl();
      if (o) wheelConfetti(o, innerWidth / 2, innerHeight * 0.3);
      return;
    }
    const m = k === steps - 1 ? win : pool[i++ % pool.length];
    el.src = TMDB.img(m.poster, "w342");
    k++;
    haptic(4);
    duel.spin = setTimeout(tick, 40 + 0.9 * k * k);
  };
  tick();
}

/* ---------- Действия ---------- */
async function duelCreate() {
  try {
    const res = await fetch(duelBase() + "/room", { method: "POST" });
    if (!res.ok) throw new Error(res.status);
    duelStart((await res.json()).code);
  } catch (e) { showToast({ sub: "Дуэль", title: "Не удалось создать комнату" }); }
}

document.addEventListener("click", e => {
  const rm = e.target.closest("[data-duel-rm]");
  if (rm) return duelUnpick(+rm.dataset.duelRm);
  const b = e.target.closest("[data-duel]");
  if (!b) return;
  switch (b.dataset.duel) {
    case "open": return duelOpen();
    case "close": return duelClose();
    case "swipe": duelClose(); return setTab("swipe");
    case "create": return duelCreate();
    case "join": {
      const c = ($("#duel-code").value || "").trim().toUpperCase();
      if (!/^[A-Z2-9]{5}$/.test(c)) return showToast({ sub: "Ошибка", title: "Код — 5 символов" });
      return duelStart(c);
    }
    case "done": return duelSend({ t: "done", v: !duel.view.me.done });
    case "again": return duelSend({ t: "again" });
    case "leave": if (confirm("Выйти из дуэли? Выбранные фильмы останутся в комнате, пока она не закроется.")) { duelLeave(); } return;
    case "share": {
      const text = `Заходи в дуэль Filmder, код комнаты: ${duel.code}`;
      if (navigator.share) navigator.share({ text }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => showToast({ sub: "Дуэль", title: "Код скопирован" }));
      return;
    }
    case "info": {
      const r = duel.view && duel.view.result, w = r && r.pool.find(m => m.id === r.winnerId);
      if (w) { duelClose(); openSheet(w); }
      return;
    }
  }
});
const duelBtn = document.getElementById("btn-duel");
if (duelBtn) duelBtn.addEventListener("click", duelOpen);

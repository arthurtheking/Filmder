"use strict";

/* ============ Дуэль ============ */
// Комната живёт на сервере (Durable Object). Клиент держит WebSocket и рисует то, что пришло.
// Свайпы в режиме дуэли кладут фильмы не в «Мой вечер», а в слоты комнаты.
const DUEL_KEY = "filmder-duel";
const DUEL_PID_KEY = "filmder-duel-pid";
const duel = { code: "", ws: null, view: null, retry: 0, timer: 0, prevPhase: undefined, shownRound: 0, animate: false, scene: "", token: 0, run: null, bars: false };

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
  duel.code = code; duel.view = null; duel.prevPhase = undefined; duel.retry = 0; duel.scene = "";
  ls.set(DUEL_KEY, code);
  duelConnect();
  duelRender();
}
function duelLeave() {
  clearTimeout(duel.timer); duelStopRun();
  duel.code = ""; duel.view = null; duel.animate = false; duel.scene = "";
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
    if (prev !== undefined) { duel.animate = true; duel.scene = ""; duelOpen(); }
  }
  duelRender();
}

/* ---------- Значки ---------- */
const DUEL_SWORDS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M5 19l-2 2"/></svg>`;
const DUEL_USER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`;
const DUEL_COPY = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>`;
const DUEL_REPLAY = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>`;
const RING_C = 2 * Math.PI * 26;

/* ---------- Полоска дуэли над свайпами ---------- */
function duelRenderBar() {
  const bar = $("#duel-bar");
  if (!bar) return;
  if (!duelActive()) { bar.hidden = true; bar.dataset.ready = ""; return; }
  const v = duel.view, me = v.me, o = v.other;
  if (bar.dataset.ready !== duel.code + v.limit) {
    const pips = '<i></i>'.repeat(v.limit);
    bar.innerHTML = `<button class="duel-info" data-duel="open" aria-label="Открыть дуэль">
      <span class="db-code">${DUEL_SWORDS}<b>${duel.code}</b></span>
      <span class="db-rows">
        <span class="db-row me"><em>Вы</em><span class="pips" style="--n:${v.limit}">${pips}</span><u></u></span>
        <span class="db-row them"><em>Он</em><span class="pips" style="--n:${v.limit}">${pips}</span><u></u></span>
      </span></button>
      <button class="btn small" id="duel-done" data-duel="done"></button>`;
    bar.dataset.ready = duel.code + v.limit;
    bar.hidden = false;
    anim(bar, FX_IN, { duration: 450 });
  }
  bar.hidden = false;
  const fill = (row, count, ready, offline) => {
    row.classList.toggle("ready", !!ready); row.classList.toggle("off", !!offline);
    row.querySelectorAll(".pips i").forEach((p, i) => {
      const on = i < count;
      if (on && !p.classList.contains("on")) { p.classList.remove("pop"); void p.offsetWidth; p.classList.add("pop"); }
      p.classList.toggle("on", on);
    });
    row.querySelector("u").textContent = ready ? "✓" : offline ? "·" : count;
  };
  const rows = bar.querySelectorAll(".db-row");
  fill(rows[0], me.picks.length, me.done);
  fill(rows[1], o ? o.count : 0, o && o.done, o && !o.online);
  const b = $("#duel-done");
  b.textContent = me.done ? "Ждём · изменить" : "Готово";
  b.classList.toggle("ghost", !!me.done);
  b.classList.toggle("primary", !me.done);
  b.disabled = !me.done && !me.picks.length;
}

/* ---------- Оверлей ---------- */
function duelOpen() {
  if (!duelBase()) return showToast({ sub: "Дуэль", title: "Не задан PROXY_URL в config.js" });
  let o = duelEl();
  if (!o) {
    o = document.createElement("div");
    o.id = "duel-overlay";
    o.hidden = true;
    o.innerHTML = `<div class="duel-aura"><i></i><i></i></div>
      <div class="duel-top"><span class="duel-badge">${DUEL_SWORDS}</span><b>Дуэль</b><span class="duel-room" id="duel-room"></span>
      <button class="duel-x" data-duel="close" aria-label="Закрыть">${ICON_CLOSE}</button></div>
      <div class="duel-body" id="duel-body"></div>`;
    document.body.appendChild(o);
  }
  if (o.hidden) { o.hidden = false; o.style.animation = "none"; void o.offsetWidth; o.style.animation = ""; }
  duelRender();
}
function duelBars(dark) {
  const o = duelEl();
  if (o) o.classList.toggle("dark", dark);
  if (dark && !duel.bars) { duel.bars = true; revealBarsOn("#07080c"); }
  if (!dark && duel.bars) { duel.bars = false; revealBarsOff(); }
}
function duelStopRun() {
  duel.token++;
  if (duel.run) { duel.run.cancel(); duel.run = null; }
}
function duelClose() {
  const o = duelEl();
  if (o) o.hidden = true;
  if (duel.animate) { duel.animate = false; duel.scene = ""; } // следующий заход — сразу итог
  duelStopRun();
  duelBars(false);
}

/* ---------- Экраны ---------- */
function pickGridHtml(picks, limit, removable, fresh) {
  const cells = [];
  for (let i = 0; i < limit; i++) {
    const m = picks[i];
    cells.push(m
      ? `<div class="dp-pick ${fresh.has(m.id) ? "new" : ""}" style="--i:${i}">${m.poster ? `<img src="${TMDB.img(m.poster, "w185")}" alt="${esc(m.title)}" draggable="false">` : `<span>${esc(m.title)}</span>`}
        ${removable ? `<button data-duel-rm="${m.id}" aria-label="Убрать">✕</button>` : ""}</div>`
      : `<div class="dp-slot" style="--i:${i}"></div>`);
  }
  return cells.join("");
}
const duelStatus = (p, other) => (!p ? "ждём…" : other && !p.online ? "не в сети" : p.done ? "готов" : other ? "выбирает…" : "");

function duelBuild(key, body, v) {
  body.className = "duel-body";
  if (key === "home") {
    const games = DG.ids.map(id => DG.games.get(id)), names = games.map(g => `<span>${g.icon}${esc(g.name)}</span>`).join("");
    body.innerHTML = `<div class="dh-hero"><i class="rg"></i><i class="rg r2"></i><i class="rg r3"></i><div class="dh-ico">${DUEL_SWORDS}</div></div>
      <h2 class="dh-title">Дуэль на двоих</h2>
      <p class="duel-lead">Создайте комнату и отправьте код другу. У каждого по ${10} фильмов, а какой посмотрите — решит одна из <b>${games.length} мини-игр</b>.</p>
      <div class="dh-steps"><span><i>1</i>Код</span><span><i>2</i>Свайпы</span><span><i>3</i>Игра</span></div>
      <button class="btn primary big shine" data-duel="create">Создать комнату</button>
      <div class="dh-or"><span>или войти по коду</span></div>
      <div class="duel-join"><input id="duel-code" maxlength="5" autocapitalize="characters" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="КОД"><button class="btn" data-duel="join">Войти</button></div>
      <div class="dh-marq" aria-hidden="true"><div>${names}${names}</div></div>`;
    const inp = $("#duel-code");
    inp.addEventListener("input", () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z2-9]/g, ""); });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") duelAct("join"); });
  } else if (key === "connect") {
    body.innerHTML = `<div class="duel-wait"><div class="spinner"></div><p>Подключаюсь к комнате ${duel.code}…</p></div><button class="btn ghost" data-duel="leave">Выйти</button>`;
  } else if (key === "lobby") {
    body.innerHTML = `<p class="duel-lead">Отправьте код второму игроку</p>
      <div class="dl-code">${duel.code.split("").map((c, i) => `<i style="--i:${i}">${c}</i>`).join("")}</div>
      <div class="dl-actions"><button class="btn primary" data-duel="share">Поделиться</button><button class="btn" data-duel="copy">${DUEL_COPY}Скопировать</button></div>
      <div class="dl-wait"><span class="radar"><i></i><i></i><i></i><b>${DUEL_USER}</b></span><p>Ждём второго игрока<span class="dots"></span></p></div>
      <button class="btn ghost" data-duel="leave">Выйти</button>`;
  } else if (key === "picking") {
    const ring = (cls, label) => `<div class="dp-p ${cls}"><div class="dp-ring"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" class="bg"/><circle cx="30" cy="30" r="26" class="fg" style="stroke-dasharray:${RING_C};stroke-dashoffset:${RING_C}"/></svg><b>0</b></div><span>${label}</span><em></em></div>`;
    body.innerHTML = `<div class="dp-vs">${ring("me", "Вы")}<div class="dp-mark">VS</div>${ring("them", "Соперник")}</div>
      <p class="duel-sub" id="dp-hint"></p>
      <div class="dp-grid" id="dp-grid"></div>
      <div class="dp-actions"><button class="btn primary" data-duel="swipe">К свайпам</button>
      <button class="btn" id="dp-done" data-duel="done"></button>
      <button class="btn ghost" data-duel="leave">Выйти</button></div>`;
    duel.gridKey = "";
  }
}

function duelPatch(key, body, v) {
  if (key !== "picking") return;
  const me = v.me, o = v.other, lim = v.limit;
  const set = (sel, n, p, other) => {
    const el = body.querySelector(sel);
    el.querySelector(".fg").style.strokeDashoffset = RING_C * (1 - Math.min(1, n / lim));
    const b = el.querySelector("b"); if (b.textContent != n) { b.textContent = n; bump(b); }
    const st = duelStatus(p, other);
    const em = el.querySelector("em"); em.textContent = st; el.classList.toggle("ready", !!(p && p.done)); el.classList.toggle("off", !!(p && other && !p.online));
  };
  set(".dp-p.me", me.picks.length, me, false);
  set(".dp-p.them", o ? o.count : 0, o, true);
  $("#dp-hint").textContent = me.done ? "Вы готовы. Нажмите «Изменить», чтобы выбрать ещё" : me.picks.length ? `Выбрано ${me.picks.length} из ${lim}. Свайпайте вправо — фильм попадёт в слот` : "Свайпайте вправо фильмы, которые хотите посмотреть";
  const gk = me.picks.map(m => m.id).join(",") + (me.done ? "d" : "");
  if (gk !== duel.gridKey) {
    const prevIds = new Set((duel.gridIds || []));
    const fresh = new Set(me.picks.filter(m => !prevIds.has(m.id)).map(m => m.id));
    if (!duel.gridKey) fresh.clear();
    duel.gridKey = gk; duel.gridIds = me.picks.map(m => m.id);
    $("#dp-grid").innerHTML = pickGridHtml(me.picks, lim, !me.done, fresh);
  }
  const d = $("#dp-done");
  d.textContent = me.done ? "Изменить выбор" : "Готово";
  d.classList.toggle("ghost", !!me.done);
  d.disabled = !me.done && !me.picks.length;
}

function duelRender() {
  duelRenderBar();
  const o = duelEl();
  if (!o || o.hidden) return;
  const v = duel.view, body = $("#duel-body");
  $("#duel-room").textContent = duel.code ? duel.code : "";
  const key = !duel.code ? "home" : !v ? "connect" : v.phase;
  if (key === "result") return duelRenderResult(body, v);
  if (duel.scene.startsWith("result")) { duelStopRun(); duel.scene = ""; }
  duelBars(false);
  if (duel.scene !== key) { duel.scene = key; duelBuild(key, body, v); }
  duelPatch(key, body, v);
}

/* ---------- Результат: вступление → мини-игра → победитель ---------- */
function duelRenderResult(body, v) {
  const key = `result:${v.round}`;
  if (duel.scene === key || duel.scene === key + ":run") return;
  duelStopRun();
  duelBars(true);
  if (duel.animate && !RM()) { duel.scene = key + ":run"; duelRunScene(v, body); }
  else { duel.animate = false; duel.scene = key; duelReveal(body, v, false); }
}

const duelFan = (pool, slot, cls) => {
  const list = pool.filter(m => m.owners.includes(slot)).slice(0, 6), c = list.length;
  return `<div class="vs-fan ${cls}">${list.map((m, i) => `<i style="--r:${((i - (c - 1) / 2) * 9).toFixed(1)}deg;--x:${((i - (c - 1) / 2) * 15).toFixed(0)}px;--i:${i}${m.poster ? `;background-image:url(${TMDB.img(m.poster, "w92")})` : ""}"></i>`).join("")}</div>`;
};

async function duelRunScene(v, body) {
  const token = ++duel.token, r = v.result, you = v.you;
  const alive = () => token === duel.token;
  const { game } = dgSetup(r);
  const mine = r.pool.filter(m => m.owners.includes(you)).length, theirs = r.pool.filter(m => m.owners.includes(1 - you)).length;
  body.className = "duel-body dz";
  body.innerHTML = `<button class="btn glass small dz-skip" data-duel="skip">Пропустить</button>
    <div class="dz-main"><div class="vs">
      <div class="vs-side me"><div class="vs-ava">${DUEL_USER}</div><b>Вы</b>${duelFan(r.pool, you, "me")}<small>${mine} ${plural(mine)}</small></div>
      <div class="vs-mark"><span>VS</span></div>
      <div class="vs-side them"><div class="vs-ava">${DUEL_USER}</div><b>Соперник</b>${duelFan(r.pool, 1 - you, "them")}<small>${theirs} ${plural(theirs)}</small></div>
    </div>
    <div class="vs-game"><span class="ico">${game.icon}</span><div><small>Выбор сделает игра</small><b>${esc(game.name)}</b></div></div></div>`;
  haptic([10, 40, 10]);
  await wait(2500);
  if (!alive()) return;
  const main = body.querySelector(".dz-main");
  main.innerHTML = '<div class="dg-arena"></div>';
  const ctl = dgPlay(r, main.firstChild, you);
  duel.run = ctl;
  await ctl.done;
  if (!alive()) return;
  await wait(500);
  if (!alive()) return;
  duelFinishScene(v);
}
function duelFinishScene(v) {
  duelStopRun();
  duel.animate = false;
  duel.scene = `result:${v.round}`;
  duelReveal($("#duel-body"), duel.view || v, true);
}
function duelSkip() {
  if (!duel.view || duel.view.phase !== "result") return;
  duelFinishScene(duel.view);
}

function duelReveal(body, v, fx) {
  const r = v.result, w = r.pool.find(m => m.id === r.winnerId);
  if (!w) return;
  const game = (typeof dgSetup === "function") ? dgSetup(r).game : null;
  const both = r.match || w.owners.length === 2;
  const by = both ? "Выбрали оба" : w.owners[0] === v.you ? "Выбрали вы" : "Выбрал соперник";
  const side = both ? "both" : w.owners[0] === v.you ? "me" : "them";
  const chips = [w.year, dur(w.runtime), w.rating ? `★ ${w.rating.toFixed(1)}` : ""].filter(Boolean);
  body.className = "duel-body dz dz-end";
  body.innerHTML = `<div class="dz-bg" ${w.poster ? `style="background-image:url(${TMDB.img(w.poster, "w342")})"` : ""}></div><div class="dz-rays"></div>
    <div class="dz-main dz-reveal">
      <div class="dz-tag">${r.match ? "Совпало у обоих!" : "Сегодня смотрим"}</div>
      <div class="dz-card ${fx ? "land" : ""}">${w.poster ? `<img src="${TMDB.img(w.poster, "w500")}" alt="">` : `<span>${esc(w.title)}</span>`}<i class="dz-shine"></i></div>
      <h3 class="dz-title">${esc(w.title)}</h3>
      <div class="dz-chips">${chips.map(c => `<span>${esc(c)}</span>`).join("")}<span class="by ${side}">${by}</span></div>
      ${game && !game.special ? `<div class="dz-game"><span>${game.icon}</span>Решила игра «${esc(game.name)}»</div>` : ""}
      <div class="dz-pool">${r.pool.map(m => `<i class="${m.owners.length === 2 ? "both" : m.owners[0] === v.you ? "mine" : "theirs"} ${m.id === w.id ? "win" : ""}">${m.poster ? `<img src="${TMDB.img(m.poster, "w92")}" alt="">` : ""}</i>`).join("")}</div>
      <div class="dz-actions">
        <button class="btn primary" data-duel="info">Подробнее</button>
        <button class="btn glass" data-duel="again">Ещё раунд</button>
      </div>
      <div class="dz-links"><button class="btn ghost small" data-duel="replay">${DUEL_REPLAY}Показать игру ещё раз</button><button class="btn ghost small" data-duel="leave">Выйти</button></div>
    </div>`;
  if (fx) {
    haptic([20, 40, 30]);
    const o = duelEl();
    if (o) { setTimeout(() => wheelConfetti(o, innerWidth * 0.5, innerHeight * 0.3), 250); setTimeout(() => wheelConfetti(o, innerWidth * 0.22, innerHeight * 0.4), 600); setTimeout(() => wheelConfetti(o, innerWidth * 0.78, innerHeight * 0.4), 900); }
  }
}

/* ---------- Действия ---------- */
async function duelCreate() {
  try {
    const res = await fetch(duelBase() + "/room", { method: "POST" });
    if (!res.ok) throw new Error(res.status);
    duelStart((await res.json()).code);
  } catch (e) { showToast({ sub: "Дуэль", title: "Не удалось создать комнату" }); }
}

function duelAct(a, b) {
  switch (a) {
    case "open": return duelOpen();
    case "close": return duelClose();
    case "swipe": duelClose(); return setTab("swipe");
    case "create": return duelCreate();
    case "join": {
      const c = (($("#duel-code") || {}).value || "").trim().toUpperCase();
      if (!/^[A-Z2-9]{5}$/.test(c)) return showToast({ sub: "Ошибка", title: "Код — 5 символов" });
      return duelStart(c);
    }
    case "done": return duelSend({ t: "done", v: !duel.view.me.done });
    case "again": return duelSend({ t: "again" });
    case "skip": return duelSkip();
    case "replay": duel.animate = true; duel.scene = ""; return duelRender();
    case "leave": if (confirm("Выйти из дуэли? Выбранные фильмы останутся в комнате, пока она не закроется.")) { duelLeave(); } return;
    case "copy": case "share": {
      const text = `Заходи в дуэль Filmder, код комнаты: ${duel.code}`;
      if (a === "share" && navigator.share) navigator.share({ text }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => showToast({ sub: "Дуэль", title: "Код скопирован" }));
      return;
    }
    case "info": {
      const r = duel.view && duel.view.result, w = r && r.pool.find(m => m.id === r.winnerId);
      if (w) { duelClose(); openSheet(w); }
      return;
    }
  }
}
document.addEventListener("click", e => {
  const rm = e.target.closest("[data-duel-rm]");
  if (rm) return duelUnpick(+rm.dataset.duelRm);
  const b = e.target.closest("[data-duel]");
  if (b) duelAct(b.dataset.duel);
});
const duelBtn = document.getElementById("btn-duel");
if (duelBtn) duelBtn.addEventListener("click", duelOpen);

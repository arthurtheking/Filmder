"use strict";

/* ============ Дуэль ============ */
// Комната живёт на сервере (Durable Object). Клиент держит WebSocket и рисует то, что пришло.
// В комнате 2–6 игроков. Свайпы в режиме дуэли кладут фильмы не в «Мой вечер», а в слоты комнаты.
// Те же сцены (вступление → мини-игра → победитель) используются для реплеев по ссылке и для режима «Судьба».
const DUEL_KEY = "filmder-duel";
const DUEL_PID_KEY = "filmder-duel-pid";
const DUEL_NAME_KEY = "filmder-duel-name";
const DUEL_MAX = 6;
const duel = { code: "", ws: null, view: null, retry: 0, timer: 0, prevPhase: undefined, shownRound: 0, animate: false, scene: "", token: 0, run: null, bars: false, fate: null, replay: null, picker: false, gridKey: "", seq: 0 };

const duelEl = () => document.getElementById("duel-overlay");
const duelBase = () => (CONFIG.PROXY_URL || "").trim().replace(/\/+$/, "");
const duelActive = () => !!(duel.code && duel.view && duel.view.phase === "picking");
const duelName = () => (ls.get(DUEL_NAME_KEY) || "").slice(0, 16);
const duelCur = () => duel.fate || duel.replay || duel.view; // что показывает оверлей
const duelLink = code => `${location.origin}${location.pathname}#d=${code}`;
const pcol = slot => dgPlayerColor(slot);
const pini = name => ((name || "?").trim()[0] || "?").toUpperCase();
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
  try { ws = new WebSocket(`${duelBase().replace(/^http/, "ws")}/room/${duel.code}/ws?pid=${duelPid()}&name=${encodeURIComponent(duelName())}`); }
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
  duel.code = code; duel.view = null; duel.prevPhase = undefined; duel.retry = 0; duel.scene = ""; duel.shownRound = 0;
  ls.set(DUEL_KEY, code);
  duelConnect();
  duelRender();
}
function duelLeave() {
  clearTimeout(duel.timer); duelStopRun();
  if (duel.view && duel.view.phase === "lobby") duelSend({ t: "leave" });
  duel.code = ""; duel.view = null; duel.animate = false; duel.scene = "";
  if (duel.ws) { duel.ws.onclose = null; try { duel.ws.close(); } catch (e) {} duel.ws = null; }
  ls.set(DUEL_KEY, "");
  duelRender();
}
function duelFail(code) {
  duelLeave();
  showToast({ sub: "Дуэль", title: code === "full" ? `В комнате уже ${DUEL_MAX} игроков` : code === "started" ? "Дуэль уже началась — зайти нельзя" : "Комната не найдена или закрыта" });
}
function duelResume() {
  if (duelHashRoute()) return;
  const c = ls.get(DUEL_KEY) || "";
  if (/^[A-Z2-9]{5}$/.test(c) && duelBase()) duelStart(c);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && duel.code) duelConnect(); });
addEventListener("online", () => { if (duel.code) duelConnect(); });
addEventListener("hashchange", () => duelHashRoute());

/* ---------- Ссылки: #d=КОД — войти в комнату, #r=ID — посмотреть реплей ---------- */
function duelHashRoute() {
  const h = location.hash;
  let m = h.match(/^#d=([A-Za-z2-9]{5})$/);
  if (m) {
    history.replaceState(null, "", location.pathname + location.search);
    duelJoinLink(m[1].toUpperCase());
    return true;
  }
  m = h.match(/^#r=([a-z0-9]{8})$/);
  if (m) {
    history.replaceState(null, "", location.pathname + location.search);
    duelOpenReplay(m[1]);
    return true;
  }
  return false;
}
function duelJoinLink(code) {
  if (!duelBase()) return showToast({ sub: "Дуэль", title: "Не задан PROXY_URL в config.js" });
  if (duel.code && duel.code !== code && !confirm("Вы уже в другой дуэли. Выйти из неё и зайти по ссылке?")) return;
  if (duel.code !== code) { if (duel.code) duelLeave(); duelStart(code); }
  duelOpen();
}
async function duelOpenReplay(id) {
  if (!duelBase()) return showToast({ sub: "Дуэль", title: "Не задан PROXY_URL в config.js" });
  try {
    const res = await fetch(`${duelBase()}/replay/${id}`);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    duelShowSynthetic({
      phase: "result", you: -1, spectator: true, sid: "r" + id, round: d.round || 1, stake: d.stake || "", target: 0,
      players: d.players && d.players.length ? d.players : [{ slot: 0, name: "Игрок 1" }],
      result: { winnerId: d.winnerId, match: d.match, pool: d.pool, seed: d.seed, game: d.game, wins: d.wins || [], seriesWinners: d.seriesWinners || [] },
    }, "replay");
  } catch (e) { showToast({ sub: "Дуэль", title: "Реплей не найден или устарел" }); }
}
function duelShowSynthetic(v, kind) {
  duelStopRun();
  duel.fate = kind === "fate" ? v : null; duel.replay = kind === "replay" ? v : null; duel.picker = false;
  duel.animate = true; duel.scene = "";
  duelOpen();
}

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
  if (v.phase === "picking" && prev !== "picking" && o && !o.hidden && !duel.fate && !duel.replay) {
    duelClose();
    setTab("swipe");
    showToast({ sub: "Дуэль началась", title: `Выберите до ${v.limit} фильмов` });
  }
  if (v.phase === "result" && duel.shownRound !== v.round) {
    duel.shownRound = v.round;
    if (prev !== undefined) { duel.fate = duel.replay = null; duel.animate = true; duel.scene = ""; duelOpen(); }
  }
  duelRender();
}

/* ---------- Значки ---------- */
const DUEL_SWORDS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M5 19l-2 2"/></svg>`;
const DUEL_USER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`;
const DUEL_COPY = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>`;
const DUEL_REPLAY = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>`;
const DUEL_SHARE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;
const DUEL_CROWN = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>`;
const DUEL_CUP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 14v4M8 21h8M10 18h4"/></svg>`;
const DUEL_GAME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10v5M4.5 12.5h5M15.5 11.5h.01M18 14h.01"/></svg>`;
const RING_C = 2 * Math.PI * 26;
const STAKES = ["Заваривает чай", "Выбирает закуски", "Платит за пиццу", "Моет посуду"];
const TARGETS = [[0, "Один раунд"], [2, "До 2 побед"], [3, "До 3"], [5, "До 5"]];
const avHtml = (p, cls = "") => `<i class="av ${cls}" style="--c:${pcol(p.slot)}">${esc(pini(p.name))}</i>`;
const nameOf = (v, p) => (p.slot === v.you ? "Вы" : p.name);

/* ---------- Полоска дуэли над свайпами ---------- */
function duelRenderBar() {
  const bar = $("#duel-bar");
  if (!bar) return;
  if (!duelActive()) { bar.hidden = true; bar.dataset.ready = ""; return; }
  const v = duel.view, me = v.me, others = v.players.filter(p => p.slot !== v.you);
  const sig = duel.code + v.limit + others.map(p => p.slot + p.name).join("|");
  if (bar.dataset.ready !== sig) {
    bar.innerHTML = `<button class="duel-info" data-duel="open" aria-label="Открыть дуэль">
      <span class="db-code">${DUEL_SWORDS}<b>${duel.code}</b></span>
      <span class="db-rows">
        <span class="db-row me"><em>Вы</em><span class="pips" style="--n:${v.limit}">${"<i></i>".repeat(v.limit)}</span><u></u></span>
        <span class="db-row others">${others.map(p => `<span class="pc" data-slot="${p.slot}" style="--c:${pcol(p.slot)}"><i>${esc(pini(p.name))}</i><u></u></span>`).join("")}</span>
      </span></button>
      <button class="btn small" id="duel-done" data-duel="done"></button>`;
    bar.dataset.ready = sig;
    bar.hidden = false;
    anim(bar, FX_IN, { duration: 450 });
  }
  bar.hidden = false;
  const row = bar.querySelector(".db-row.me");
  row.classList.toggle("ready", !!me.done);
  row.querySelectorAll(".pips i").forEach((p, i) => {
    const on = i < me.picks.length;
    if (on && !p.classList.contains("on")) { p.classList.remove("pop"); void p.offsetWidth; p.classList.add("pop"); }
    p.classList.toggle("on", on);
  });
  row.querySelector("u").textContent = me.done ? "✓" : me.picks.length;
  others.forEach(p => {
    const c = bar.querySelector(`.pc[data-slot="${p.slot}"]`);
    if (!c) return;
    c.style.setProperty("--p", Math.min(100, (p.count / v.limit) * 100));
    c.classList.toggle("ready", !!p.done); c.classList.toggle("off", !p.online);
    c.querySelector("u").textContent = p.done ? "✓" : p.count;
  });
  const b = $("#duel-done");
  b.textContent = me.done ? "Ждём · изменить" : "Готово";
  b.classList.toggle("ghost", !!me.done);
  b.classList.toggle("primary", !me.done);
  b.disabled = !me.done && !me.picks.length;
}

/* ---------- Оверлей ---------- */
function duelOpen() {
  if (!duel.fate && !duel.replay && !duelBase()) return showToast({ sub: "Дуэль", title: "Не задан PROXY_URL в config.js" });
  let o = duelEl();
  if (!o) {
    o = document.createElement("div");
    o.id = "duel-overlay";
    o.hidden = true;
    o.innerHTML = `<div class="duel-aura"><i></i><i></i></div>
      <div class="duel-top"><span class="duel-badge">${DUEL_SWORDS}</span><b id="duel-title">Дуэль</b><span class="duel-room" id="duel-room"></span>
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
  if (duel.animate) { duel.animate = false; }
  duel.scene = "";
  duel.fate = duel.replay = null; duel.picker = false;
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
const rulesText = v => [v.stake ? `Ставка: ${v.stake}` : "", v.target ? `Серия до ${v.target} побед` : ""].filter(Boolean).join(" · ");

function duelBuild(key, body, v) {
  body.className = "duel-body";
  if (key === "home") {
    const games = DG.ids.map(id => DG.games.get(id)), names = games.map(g => `<span>${g.icon}${esc(g.name)}</span>`).join("");
    body.innerHTML = `<div class="dh-hero"><i class="rg"></i><i class="rg r2"></i><i class="rg r3"></i><div class="dh-ico">${DUEL_SWORDS}</div></div>
      <h2 class="dh-title">Дуэль на 2–${DUEL_MAX} игроков</h2>
      <p class="duel-lead">Создайте комнату и позовите друзей по ссылке или QR. Каждый выбирает фильмы, а какой смотреть — решит одна из <b>${games.length} мини-игр</b>.</p>
      <div class="dh-steps"><span><i>1</i>Ссылка</span><span><i>2</i>Свайпы</span><span><i>3</i>Игра</span></div>
      <input class="dh-name" id="duel-name" maxlength="16" autocomplete="nickname" placeholder="Ваше имя (необязательно)" value="${esc(duelName())}">
      <button class="btn primary big shine" data-duel="create">Создать комнату</button>
      <div class="dh-or"><span>или войти по коду</span></div>
      <div class="duel-join"><input id="duel-code" maxlength="5" autocapitalize="characters" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="КОД"><button class="btn" data-duel="join">Войти</button></div>
      <div class="dh-marq" aria-hidden="true"><div>${names}${names}</div></div>`;
    const inp = $("#duel-code");
    inp.addEventListener("input", () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z2-9]/g, ""); });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") duelAct("join"); });
    $("#duel-name").addEventListener("input", e => ls.set(DUEL_NAME_KEY, e.target.value.trim().slice(0, 16)));
  } else if (key === "connect") {
    body.innerHTML = `<div class="duel-wait"><div class="spinner"></div><p>Подключаюсь к комнате ${duel.code}…</p></div><button class="btn ghost" data-duel="leave">Выйти</button>`;
  } else if (key === "lobby") {
    let qr = "";
    try { qr = qrSvg(duelLink(duel.code), { level: "M", fg: "#0b0d12", bg: "#fff", quiet: 2 }); } catch (e) { qr = ""; }
    body.innerHTML = `<p class="duel-lead">Позовите друзей: они зайдут по ссылке или QR-коду</p>
      <div class="dl-join">${qr ? `<div class="dl-qr">${qr}</div>` : ""}<div class="dl-codewrap"><small>Код комнаты</small><div class="dl-code">${duel.code.split("").map((c, i) => `<i style="--i:${i}">${c}</i>`).join("")}</div></div></div>
      <div class="dl-actions"><button class="btn primary" data-duel="share">${DUEL_SHARE}Позвать</button><button class="btn" data-duel="copy">${DUEL_COPY}Ссылка</button></div>
      <div class="dl-players" id="dl-players"></div>
      <input class="dh-name" id="dl-name" maxlength="16" autocomplete="nickname" placeholder="Ваше имя" value="${esc(duelName())}">
      <div class="dl-cfg" id="dl-cfg"></div>
      <button class="btn primary big" id="dl-start" data-duel="start" hidden>Начать дуэль</button>
      <p class="duel-sub" id="dl-hint"></p>
      <button class="btn ghost" data-duel="leave">Выйти</button>`;
    $("#dl-name").addEventListener("change", e => { const n = e.target.value.trim().slice(0, 16); ls.set(DUEL_NAME_KEY, n); duelSend({ t: "name", name: n }); });
    duel.cfgSig = "";
  } else if (key === "picking") {
    body.innerHTML = `<div class="dp-vs" id="dp-vs"></div>
      <p class="duel-sub" id="dp-rules"></p>
      <p class="duel-sub" id="dp-hint"></p>
      <div class="dp-grid" id="dp-grid"></div>
      <div class="dp-actions"><button class="btn primary" data-duel="swipe">К свайпам</button>
      <button class="btn" id="dp-done" data-duel="done"></button>
      <button class="btn glass-line" id="dp-finish" data-duel="finish" hidden>Завершить, не дожидаясь остальных</button>
      <button class="btn ghost" data-duel="leave">Выйти</button></div>`;
    duel.gridKey = ""; duel.vsKey = "";
  }
}

function duelPatchLobby(body, v) {
  const list = $("#dl-players"), n = v.players.length;
  const sig = v.you + "#" + v.players.map(p => p.slot + p.name + p.online).join("|");
  if (list.dataset.sig !== sig) {
    const known = new Set((list.dataset.slots || "").split(","));
    list.innerHTML = v.players.map(p => `<div class="pl ${known.has(String(p.slot)) ? "" : "new"} ${p.online ? "" : "off"}" style="--c:${pcol(p.slot)}">${avHtml(p)}<b>${esc(p.name)}${p.slot === v.you ? " <small>(вы)</small>" : ""}</b>${p.slot === 0 ? `<span class="crown" title="Ведущий">${DUEL_CROWN}</span>` : ""}</div>`).join("")
      + (n < DUEL_MAX ? `<div class="pl waiting"><i class="av"><span class="dots"></span></i><b>Ждём игрока</b></div>` : "");
    list.dataset.sig = sig; list.dataset.slots = v.players.map(p => p.slot).join(",");
  }
  const start = $("#dl-start");
  start.hidden = !v.host;
  start.disabled = n < 2;
  start.textContent = n < 2 ? "Нужен хотя бы второй игрок" : `Начать дуэль · ${n} ${n < 5 ? "игрока" : "игроков"}`;
  $("#dl-hint").textContent = v.host ? "" : "Ждём, пока ведущий начнёт дуэль";
  // ставка и серия: ведущий настраивает, остальные видят
  const cfg = $("#dl-cfg"), csig = v.host + "|" + v.stake + "|" + v.target;
  if (duel.cfgSig !== csig && !(document.activeElement && document.activeElement.id === "dl-stake")) {
    duel.cfgSig = csig;
    cfg.innerHTML = v.host
      ? `<div class="cfg-t">Ставка проигравшим</div>
         <input class="dh-name" id="dl-stake" maxlength="40" placeholder="Например: проигравший делает чай" value="${esc(v.stake)}">
         <div class="chips">${STAKES.map(s => `<button class="chip ${v.stake === s ? "on" : ""}" data-stake="${esc(s)}">${esc(s)}</button>`).join("")}</div>
         <div class="cfg-t">Серия</div>
         <div class="chips">${TARGETS.map(([t, l]) => `<button class="chip ${v.target === t ? "on" : ""}" data-target="${t}">${l}</button>`).join("")}</div>`
      : (rulesText(v) ? `<div class="cfg-line">${esc(rulesText(v))}</div>` : "");
    const st = $("#dl-stake");
    if (st) st.addEventListener("change", e => duelSend({ t: "cfg", stake: e.target.value }));
  }
}

function duelPatch(key, body, v) {
  if (key === "lobby") return duelPatchLobby(body, v);
  if (key !== "picking") return;
  const me = v.me, lim = v.limit, n = v.players.length;
  const vsSig = v.players.map(p => p.slot + p.name).join("|");
  const vs = $("#dp-vs");
  if (duel.vsKey !== vsSig) {
    duel.vsKey = vsSig;
    vs.classList.toggle("many", n > 2);
    vs.innerHTML = v.players.map((p, i) => `<div class="dp-p" data-slot="${p.slot}" style="--c:${pcol(p.slot)}"><div class="dp-ring"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" class="bg"/><circle cx="30" cy="30" r="26" class="fg" style="stroke-dasharray:${RING_C};stroke-dashoffset:${RING_C}"/></svg><b>0</b></div><span>${esc(nameOf(v, p))}</span><em></em></div>`
      + (n === 2 && i === 0 ? '<div class="dp-mark">VS</div>' : "")).join("");
  }
  v.players.forEach(p => {
    const el = vs.querySelector(`.dp-p[data-slot="${p.slot}"]`);
    if (!el) return;
    const cnt = p.slot === v.you ? me.picks.length : p.count;
    el.querySelector(".fg").style.strokeDashoffset = RING_C * (1 - Math.min(1, cnt / lim));
    const b = el.querySelector("b"); if (b.textContent != cnt) { b.textContent = cnt; bump(b); }
    el.querySelector("em").textContent = p.slot === v.you ? (me.done ? "готов" : "") : !p.online ? "не в сети" : p.done ? "готов" : "выбирает…";
    el.classList.toggle("ready", p.slot === v.you ? me.done : p.done); el.classList.toggle("off", !p.online && p.slot !== v.you);
  });
  $("#dp-rules").textContent = rulesText(v);
  $("#dp-rules").hidden = !rulesText(v);
  $("#dp-hint").textContent = me.done ? "Вы готовы. Нажмите «Изменить выбор», чтобы выбрать ещё" : me.picks.length ? `Выбрано ${me.picks.length} из ${lim}. Свайпайте вправо — фильм попадёт в слот` : "Свайпайте вправо фильмы, которые хотите посмотреть";
  const gk = me.picks.map(m => m.id).join(",") + (me.done ? "d" : "") + lim;
  if (gk !== duel.gridKey) {
    const prevIds = new Set(duel.gridIds || []);
    const fresh = new Set(me.picks.filter(m => !prevIds.has(m.id)).map(m => m.id));
    if (!duel.gridKey) fresh.clear();
    duel.gridKey = gk; duel.gridIds = me.picks.map(m => m.id);
    const g = $("#dp-grid");
    g.style.setProperty("--cols", lim === 10 ? 5 : lim === 6 ? 6 : 5);
    g.innerHTML = pickGridHtml(me.picks, lim, !me.done, fresh);
  }
  const d = $("#dp-done");
  d.textContent = me.done ? "Изменить выбор" : "Готово";
  d.classList.toggle("ghost", !!me.done);
  d.disabled = !me.done && !me.picks.length;
  const withPicks = v.players.filter(p => (p.slot === v.you ? me.picks.length : p.count) > 0).length;
  const fin = $("#dp-finish");
  fin.hidden = !(v.host && withPicks >= 2 && !v.players.every(p => (p.slot === v.you ? me.done : p.done)));
}

function duelRender() {
  duelRenderBar();
  const o = duelEl();
  if (!o || o.hidden) return;
  const v = duelCur(), body = $("#duel-body");
  const synthetic = duel.fate || duel.replay;
  $("#duel-room").textContent = synthetic ? "" : duel.code || "";
  $("#duel-title").textContent = duel.fate ? "Судьба" : duel.replay ? "Реплей" : "Дуэль";
  if (duel.picker) return duelRenderPicker(body);
  const key = synthetic ? "result" : !duel.code ? "home" : !v ? "connect" : v.phase;
  if (key === "result") return duelRenderResult(body, v);
  if (duel.scene.startsWith("result")) { duelStopRun(); duel.scene = ""; }
  duelBars(false);
  if (duel.scene !== key) { duel.scene = key; duelBuild(key, body, v); }
  duelPatch(key, body, v);
}

/* ---------- Результат: вступление → мини-игра → победитель ---------- */
function duelRenderResult(body, v) {
  const key = `result:${v.sid || v.round}`;
  if (duel.scene === key || duel.scene === key + ":run") return;
  duelStopRun();
  duelBars(true);
  if (duel.animate && !RM()) { duel.scene = key + ":run"; duelRunScene(v, body); }
  else { duel.animate = false; duel.scene = key; duelReveal(body, v, false); }
}

const duelFan = (pool, slot, cls, max = 6) => {
  const list = pool.filter(m => m.owners.includes(slot)).slice(0, max), c = list.length;
  return `<div class="vs-fan ${cls}" style="--c:${pcol(slot)}">${list.map((m, i) => `<i style="--r:${((i - (c - 1) / 2) * 9).toFixed(1)}deg;--x:${((i - (c - 1) / 2) * 15).toFixed(0)}px;--i:${i}${m.poster ? `;background-image:url(${TMDB.img(m.poster, "w92")})` : ""}"></i>`).join("")}</div>`;
};

function duelIntroHtml(v, game) {
  const r = v.result, P = v.players, cnt = p => r.pool.filter(m => m.owners.includes(p.slot)).length;
  const chip = `<div class="vs-game"><span class="ico">${game.icon}</span><div><small>Выбор сделает игра</small><b>${esc(game.name)}</b></div></div>`;
  const rules = rulesText(v) ? `<div class="vs-rules">${esc(rulesText(v))}</div>` : "";
  if (v.solo) return `<div class="vs"><div class="vs-solo"><div class="vs-ava big">${DUEL_GAME}</div><b>Судьба решает</b><small>${r.pool.length} ${plural(r.pool.length)} в игре</small></div></div>${chip}`;
  if (P.length <= 2) {
    const [a, b] = [P[0], P[1] || { slot: 1, name: "—" }];
    const side = (p, cls) => `<div class="vs-side ${cls}" style="--c:${pcol(p.slot)}"><div class="vs-ava">${DUEL_USER}</div><b>${esc(nameOf(v, p))}</b>${duelFan(r.pool, p.slot, cls)}<small>${cnt(p)} ${plural(cnt(p))}</small></div>`;
    return `<div class="vs">${side(a, "me")}<div class="vs-mark"><span>VS</span></div>${side(b, "them")}</div>${rules}${chip}`;
  }
  return `<div class="vs many"><div class="vs-mark"><span>VS</span></div><div class="vs-grid">${P.map((p, i) => `<div class="vs-side" style="--c:${pcol(p.slot)};--d:${i * 90}ms"><div class="vs-ava">${DUEL_USER}</div><b>${esc(nameOf(v, p))}</b>${duelFan(r.pool, p.slot, "mini", 3)}<small>${cnt(p)} ${plural(cnt(p))}</small></div>`).join("")}</div></div>${rules}${chip}`;
}

async function duelRunScene(v, body) {
  const token = ++duel.token, r = v.result;
  const alive = () => token === duel.token;
  const { game } = dgSetup(r);
  body.className = "duel-body dz";
  body.innerHTML = `<button class="btn glass small dz-skip" data-duel="skip">Пропустить</button><div class="dz-main">${duelIntroHtml(v, game)}</div>`;
  haptic([10, 40, 10]);
  await wait(2600);
  if (!alive()) return;
  const main = body.querySelector(".dz-main");
  main.innerHTML = '<div class="dg-arena"></div>';
  const ctl = dgPlay(r, main.firstChild, v.you, v.players);
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
  duel.scene = `result:${v.sid || v.round}`;
  duelReveal($("#duel-body"), v, true);
}
function duelSkip() {
  const v = duelCur();
  if (v && v.phase === "result") duelFinishScene(v);
}

function duelReveal(body, v, fx) {
  const r = v.result, w = r.pool.find(m => m.id === r.winnerId);
  if (!w) return;
  const game = dgSetup(r).game, P = v.players, you = v.you, owners = w.owners;
  const nm = slot => { const p = P.find(x => x.slot === slot); return p ? (slot === you ? "Вы" : p.name) : "—"; };
  const shared = owners.length > 1;
  const by = v.solo ? "" : shared ? (owners.length === P.length ? "Выбрали все" : "Выбрали: " + owners.map(nm).join(", ")) : owners[0] === you ? "Ваш фильм" : `Фильм игрока ${nm(owners[0])}`;
  const byCol = shared ? DG_GOLD : pcol(owners[0]);
  const chips = [w.year, dur(w.runtime), w.rating ? `★ ${w.rating.toFixed(1)}` : ""].filter(Boolean);
  const wins = r.wins || [];
  const showScore = !v.solo && P.length >= 2 && wins.length && (v.round > 1 || v.target || v.spectator);
  const losers = P.filter(p => !owners.includes(p.slot));
  const series = (r.seriesWinners || []).map(nm);
  const stake = v.stake && !v.solo ? (losers.length ? `<div class="dz-stake"><i>${DUEL_CUP}</i><div><small>Ставка</small><b>${esc(v.stake)}</b><span>${esc(losers.map(p => nm(p.slot)).join(", "))}</span></div></div>`
    : `<div class="dz-stake calm"><i>${DUEL_CUP}</i><div><small>Ставка</small><b>Никому платить не нужно</b><span>Фильм выбрали все</span></div></div>`) : "";
  const poolHtml = r.pool.map(m => `<i style="--c:${m.owners.length > 1 ? DG_GOLD : pcol(m.owners[0])}" class="${m.id === w.id ? "win" : ""}">${m.poster ? `<img src="${TMDB.img(m.poster, "w92")}" alt="">` : ""}</i>`).join("");
  const mode = v.solo ? "solo" : v.spectator ? "spec" : "room";
  const actions = mode === "solo"
    ? `<button class="btn primary" data-duel="info">${ICON_PLAY}К просмотру</button><button class="btn glass" data-duel="reroll">${DUEL_REPLAY}Ещё раз</button>`
    : mode === "spec"
      ? `<button class="btn primary" data-duel="info">Подробнее</button><button class="btn glass" data-duel="home">Своя дуэль</button>`
      : `<button class="btn primary" data-duel="info">Подробнее</button><button class="btn glass" data-duel="again">${series.length ? "Новая серия" : "Ещё раунд"}</button>`;
  body.className = "duel-body dz dz-end";
  body.innerHTML = `<div class="dz-bg" ${w.poster ? `style="background-image:url(${TMDB.img(w.poster, "w342")})"` : ""}></div><div class="dz-rays"></div>
    <div class="dz-main dz-reveal">
      <div class="dz-tag">${v.solo ? "Судьба выбрала" : r.match ? "Совпало!" : "Сегодня смотрим"}</div>
      <div class="dz-card ${fx ? "land" : ""}">${w.poster ? `<img src="${TMDB.img(w.poster, "w500")}" alt="">` : `<span>${esc(w.title)}</span>`}<i class="dz-shine"></i></div>
      <h3 class="dz-title">${esc(w.title)}</h3>
      <div class="dz-chips">${chips.map(c => `<span>${esc(c)}</span>`).join("")}${by ? `<span class="by" style="--c:${byCol}">${esc(by)}</span>` : ""}</div>
      ${series.length ? `<div class="dz-series"><i>${DUEL_CUP}</i><div><small>Серия до ${v.target || "—"} побед</small><b>Победил${series.length > 1 ? "и" : ""}: ${esc(series.join(", "))}</b></div></div>` : ""}
      ${showScore ? `<div class="dz-score">${P.map(p => `<span class="${owners.includes(p.slot) ? "win" : ""}" style="--c:${pcol(p.slot)}">${avHtml(p)}<b>${esc(nm(p.slot))}</b><u>${wins[p.slot] || 0}</u></span>`).join("")}</div>` : ""}
      ${stake}
      ${game && !game.special ? `<div class="dz-game"><span>${game.icon}</span>Решила игра «${esc(game.name)}»</div>` : ""}
      <div class="dz-pool">${poolHtml}</div>
      <div class="dz-actions">${actions}</div>
      <div class="dz-links">
        <button class="btn ghost small" data-duel="share-result">${DUEL_SHARE}Поделиться</button>
        <button class="btn ghost small" data-duel="replay">${DUEL_REPLAY}Игра ещё раз</button>
        ${mode === "solo" ? `<button class="btn ghost small" data-duel="picker">${DUEL_GAME}Другая игра</button>` : ""}
        <button class="btn ghost small" data-duel="${mode === "room" ? "leave" : "close"}">${mode === "room" ? "Выйти" : "Закрыть"}</button>
      </div>
    </div>`;
  if (fx) {
    haptic([20, 40, 30]);
    const o = duelEl();
    if (o) { setTimeout(() => wheelConfetti(o, innerWidth * 0.5, innerHeight * 0.3), 250); setTimeout(() => wheelConfetti(o, innerWidth * 0.22, innerHeight * 0.4), 600); setTimeout(() => wheelConfetti(o, innerWidth * 0.78, innerHeight * 0.4), 900); if (series.length) setTimeout(() => wheelConfetti(o, innerWidth * 0.5, innerHeight * 0.5), 1300); }
  }
}

/* ---------- «Судьба»: игра выбирает фильм из «Мой вечер» ---------- */
function duelRandInt(n) { return crypto.getRandomValues(new Uint32Array(1))[0] % n; }
function duelFatePool() {
  const list = state.liked.filter(m => m.id).map(m => ({ id: m.id, title: m.title, orig: m.orig || "", year: m.year || "", rating: m.rating || 0, poster: m.poster || null, runtime: m.runtime || 0, genres: m.genres || [], owners: [0] }));
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = duelRandInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, 20);
}
function duelFateRoll(pool, gameId) {
  const ok = DG.ids.filter(id => pool.length >= DG.games.get(id).min);
  const game = gameId && ok.includes(gameId) ? gameId : ok[duelRandInt(ok.length)];
  const win = pool[duelRandInt(pool.length)];
  duel.seq++;
  return {
    phase: "result", you: 0, solo: true, sid: "f" + duel.seq, round: 1, stake: "", target: 0, players: [{ slot: 0, name: "Вы" }],
    pool, result: { winnerId: win.id, match: false, pool, seed: duelRandInt(1_000_000_000), game, wins: [], seriesWinners: [] },
  };
}
function duelFate(gameId) {
  const pool = duel.fate ? duel.fate.pool : duelFatePool();
  if (pool.length < 2) return showToast({ sub: "Судьба", title: "Добавьте в «Мой вечер» хотя бы два фильма" });
  duel.picker = false;
  duelShowSynthetic(duelFateRoll(pool, gameId), "fate");
}
function duelFatePicker() {
  if (state.liked.length < 2) return showToast({ sub: "Судьба", title: "Добавьте в «Мой вечер» хотя бы два фильма" });
  if (!duel.fate) duel.fate = { phase: "result", pool: duelFatePool(), solo: true, you: 0, players: [], result: null };
  duelStopRun(); duel.picker = true; duel.animate = false; duel.scene = "";
  duelOpen();
}
function duelRenderPicker(body) {
  duelBars(false);
  if (duel.scene === "picker") return;
  duel.scene = "picker";
  body.className = "duel-body";
  const pool = duel.fate.pool;
  body.innerHTML = `<h2 class="dh-title">Пусть решит игра</h2>
    <p class="duel-lead">Из ${pool.length} ${plural(pool.length)} вашего вечера выберет одна из ${DG.ids.length} игр. Выберите свою или доверьтесь случаю.</p>
    <button class="btn primary big shine" data-fate="">${DUEL_GAME}Случайная игра</button>
    <div class="fp-grid">${DG.ids.filter(id => pool.length >= DG.games.get(id).min).map(id => { const g = DG.games.get(id); return `<button class="fp-g" data-fate="${id}"><i>${g.icon}</i><b>${esc(g.name)}</b><small>${esc(g.tag || "")}</small></button>`; }).join("")}</div>`;
}

/* ---------- Поделиться: короткая ссылка-реплей + карточка-картинка ---------- */
function duelReplayPayload(v) {
  const r = v.result;
  return { winnerId: r.winnerId, match: !!r.match, pool: r.pool, seed: r.seed, game: r.game, players: v.players.map(p => ({ name: p.slot === v.you && v.solo ? "Я" : p.name })), stake: v.stake || "", round: v.round || 1, wins: r.wins || [], seriesWinners: r.seriesWinners || [] };
}
async function duelMakeReplayLink(v) {
  if (v.replayLink) return v.replayLink;
  const res = await fetch(`${duelBase()}/replay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(duelReplayPayload(v)) });
  if (!res.ok) throw new Error(res.status);
  const { id } = await res.json();
  v.replayLink = `${location.origin}${location.pathname}#r=${id}`;
  return v.replayLink;
}
const duelLoadImg = src => new Promise(res => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
function duelWrap(x, text, maxW, maxLines) {
  const words = text.split(/\s+/), lines = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…"; }
  return lines;
}
async function duelCardBlob(v, link) {
  const r = v.result, w = r.pool.find(m => m.id === r.winnerId), game = dgSetup(r).game;
  const W = 1080, H = 1920, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  const img = w.poster ? await duelLoadImg(TMDB.img(w.poster, "w500")) : null;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--user-accent").trim() || "#2cb569";
  x.fillStyle = "#07080c"; x.fillRect(0, 0, W, H);
  if (img) { // мягкий фон: рисуем крошечную копию и растягиваем
    const t = document.createElement("canvas"); t.width = 18; t.height = 32; t.getContext("2d").drawImage(img, 0, img.naturalHeight * 0.1, img.naturalWidth, img.naturalHeight * 0.8, 0, 0, 18, 32);
    x.imageSmoothingQuality = "high"; x.globalAlpha = 0.7; x.drawImage(t, -120, -120, W + 240, H + 240); x.globalAlpha = 1;
  }
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(7,8,12,.35)"); g.addColorStop(0.55, "rgba(7,8,12,.55)"); g.addColorStop(1, "rgba(7,8,12,.96)");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const font = (wgt, px) => `${wgt} ${px}px Unbounded, "Onest", system-ui, sans-serif`;
  x.textAlign = "center"; x.textBaseline = "alphabetic";
  // метка
  const tag = (v.solo ? "СУДЬБА ВЫБРАЛА" : r.match ? "СОВПАЛО!" : "СЕГОДНЯ СМОТРИМ");
  x.font = font(500, 34); const tw = x.measureText(tag).width + 80;
  x.fillStyle = "rgba(255,255,255,.16)"; dgRRect(x, W / 2 - tw / 2, 130, tw, 76, 38); x.fill();
  x.strokeStyle = accent; x.lineWidth = 3; x.stroke();
  x.fillStyle = "#fff"; x.fillText(tag, W / 2, 182);
  // постер
  const pw = 600, ph = 900, px = (W - pw) / 2, py = 260;
  x.save(); x.shadowColor = "rgba(0,0,0,.7)"; x.shadowBlur = 80; x.shadowOffsetY = 30; x.fillStyle = "#1c1c23"; dgRRect(x, px, py, pw, ph, 36); x.fill(); x.restore();
  x.save(); dgRRect(x, px, py, pw, ph, 36); x.clip();
  if (img) x.drawImage(img, px, py, pw, ph); else { x.fillStyle = "#222"; x.fillRect(px, py, pw, ph); }
  x.restore(); x.lineWidth = 6; x.strokeStyle = "rgba(255,255,255,.9)"; dgRRect(x, px, py, pw, ph, 36); x.stroke();
  // название
  x.fillStyle = "#fff"; x.font = font(500, 68);
  const lines = duelWrap(x, w.title, W - 160, 2); lines.forEach((l, i) => x.fillText(l, W / 2, 1270 + i * 80));
  let y = 1270 + lines.length * 80 + 20;
  x.font = "500 38px Onest, system-ui, sans-serif"; x.fillStyle = "rgba(255,255,255,.75)";
  x.fillText([w.year, dur(w.runtime), w.rating ? `★ ${w.rating.toFixed(1)}` : ""].filter(Boolean).join("  ·  "), W / 2, y); y += 70;
  x.fillStyle = "#fff"; x.font = "600 40px Onest, system-ui, sans-serif";
  if (game && !game.special) { x.fillStyle = accent; x.fillText(`Решила игра «${game.name}»`, W / 2, y); y += 62; }
  const names = (r.pool.find(m => m.id === w.id).owners || []).map(o => (v.players.find(p => p.slot === o) || {}).name).filter(Boolean);
  x.fillStyle = "rgba(255,255,255,.85)"; x.font = "500 36px Onest, system-ui, sans-serif";
  if (!v.solo && names.length) { x.fillText(`Выбор: ${names.join(", ")}`.slice(0, 48), W / 2, y); y += 56; }
  if (v.stake && !v.solo) { x.fillStyle = "#ffd166"; x.fillText(`Ставка: ${v.stake}`.slice(0, 48), W / 2, y); y += 56; }
  // низ: бренд и QR
  x.textAlign = "left"; x.fillStyle = "#fff"; x.font = font(600, 54); x.fillText("Filmder", 90, 1790);
  x.fillStyle = "rgba(255,255,255,.6)"; x.font = "500 30px Onest, system-ui, sans-serif"; x.fillText("Посмотри, как решилась судьба", 90, 1840);
  try {
    const m = qrMatrix(link, "L"), n = m.length, q = 2, cell = Math.floor(190 / (n + q * 2)), s = cell * (n + q * 2), ox = W - 90 - s, oy = 1700;
    x.fillStyle = "#fff"; dgRRect(x, ox, oy, s, s, 14); x.fill();
    x.fillStyle = "#0b0d12"; m.forEach((row, yy) => row.forEach((b, xx) => { if (b) x.fillRect(ox + (xx + q) * cell, oy + (yy + q) * cell, cell, cell); }));
  } catch (e) {}
  return new Promise(res => { try { c.toBlob(b => res(b), "image/png"); } catch (e) { res(null); } });
}
async function duelShareResult() {
  const v = duelCur();
  if (!v || !v.result) return;
  showToast({ sub: "Поделиться", title: "Готовлю карточку…" });
  let link = "";
  try { link = await duelMakeReplayLink(v); } catch (e) { link = location.origin + location.pathname; }
  const w = v.result.pool.find(m => m.id === v.result.winnerId);
  const text = v.solo ? `Нам выбрали фильм: «${w.title}». Смотри, как решилась судьба: ${link}` : `Наш фильм на вечер — «${w.title}». Смотри, как это решалось: ${link}`;
  let blob = null;
  try { blob = await duelCardBlob(v, link); } catch (e) { blob = null; }
  hideToast();
  const file = blob && new File([blob], "filmder.png", { type: "image/png" });
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    if (navigator.share) { await navigator.share({ text, url: link }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
  if (blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "filmder.png"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  showToast({ sub: "Поделиться", title: blob ? "Ссылка скопирована, картинка сохранена" : "Ссылка скопирована" });
}

/* ---------- Действия ---------- */
async function duelCreate() {
  try {
    const res = await fetch(duelBase() + "/room", { method: "POST" });
    if (!res.ok) throw new Error(res.status);
    duelStart((await res.json()).code);
  } catch (e) { showToast({ sub: "Дуэль", title: "Не удалось создать комнату" }); }
}

function duelAct(a) {
  switch (a) {
    case "open": return duelOpen();
    case "close": return duelClose();
    case "home": duelClose(); return duelOpen();
    case "swipe": duelClose(); return setTab("swipe");
    case "create": return duelCreate();
    case "join": {
      const c = (($("#duel-code") || {}).value || "").trim().toUpperCase();
      if (!/^[A-Z2-9]{5}$/.test(c)) return showToast({ sub: "Ошибка", title: "Код — 5 символов" });
      return duelStart(c);
    }
    case "start": return duelSend({ t: "start" });
    case "finish": if (confirm("Завершить раунд? Те, кто ещё не нажал «Готово», останутся с тем, что успели выбрать.")) duelSend({ t: "finish" }); return;
    case "done": return duelSend({ t: "done", v: !duel.view.me.done });
    case "again": return duelSend({ t: "again" });
    case "skip": return duelSkip();
    case "replay": duel.animate = true; duel.scene = ""; return duelRender();
    case "reroll": return duelFate();
    case "picker": return duelFatePicker();
    case "share-result": return duelShareResult();
    case "leave": if (confirm("Выйти из дуэли? Выбранные фильмы останутся в комнате, пока она не закроется.")) duelLeave(); return;
    case "copy": case "share": {
      const link = duelLink(duel.code), text = `Заходи в дуэль Filmder! Код комнаты: ${duel.code}`;
      if (a === "share" && navigator.share) navigator.share({ text, url: link }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => showToast({ sub: "Дуэль", title: "Ссылка скопирована" }));
      return;
    }
    case "info": {
      const v = duelCur(), r = v && v.result, w = r && r.pool.find(m => m.id === r.winnerId);
      if (w) { duelClose(); openSheet(w); }
      return;
    }
  }
}
document.addEventListener("click", e => {
  const rm = e.target.closest("[data-duel-rm]");
  if (rm) return duelUnpick(+rm.dataset.duelRm);
  const st = e.target.closest("[data-stake]");
  if (st) { const s = st.dataset.stake, cur = duel.view && duel.view.stake; return duelSend({ t: "cfg", stake: cur === s ? "" : s }); }
  const tg = e.target.closest("[data-target]");
  if (tg) return duelSend({ t: "cfg", target: +tg.dataset.target });
  if (e.target.closest("#btn-fate")) return duelFatePicker();
  const ft = e.target.closest("[data-fate]");
  if (ft) return duelFate(ft.dataset.fate || undefined);
  const b = e.target.closest("[data-duel]");
  if (b) duelAct(b.dataset.duel);
});
const duelBtn = document.getElementById("btn-duel");
if (duelBtn) duelBtn.addEventListener("click", duelOpen);

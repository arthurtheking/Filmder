"use strict";

/* ============ Мини-игры дуэли: ядро ============ */
// Сервер присылает result.game (id игры), result.seed и winnerId. Клиент только показывает «шоу»:
//  • игра выбирается по id (если id неизвестен или «carousel», игра выбирается по seed — у обоих одна и та же);
//  • вся случайность внутри игры берётся из генератора, засеянного seed, поэтому у обоих игроков
//    анимация одинаковая и всегда заканчивается на winnerId, выбранном сервером.
// Чтобы добавить игру: dgReg({ id, name, tag, icon, min, max, run(G) }) — см. dg-casino.js.

const DG = { games: new Map(), ids: [] };

function dgReg(g) {
  g.min = g.min || 2;
  g.max = g.max || 20;
  DG.games.set(g.id, g);
  if (!g.special) DG.ids.push(g.id);
}

const dgHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function dgRng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Цвет игрока по месту в комнате (одинаков на всех устройствах)
const DG_PLAYER = ["#46e0a0", "#ff7a5c", "#5ab0ff", "#ffb84d", "#c58bff", "#ff6fb1"];
const DG_GOLD = "#ffd166";
const dgPlayerColor = slot => DG_PLAYER[((slot % DG_PLAYER.length) + DG_PLAYER.length) % DG_PLAYER.length];
const DG_COLORS = ["#2fb3a8", "#e8683f", "#7c4dff", "#e8a317", "#d63384", "#2f6fe0", "#2bb673", "#d9413d", "#12a8c9", "#7fb71a", "#c05bd6", "#e07b28"];
const dgEase = {
  lin: t => t,
  in2: t => t * t,
  in3: t => t * t * t,
  out2: t => 1 - (1 - t) ** 2,
  out3: t => 1 - (1 - t) ** 3,
  out4: t => 1 - (1 - t) ** 4,
  out5: t => 1 - (1 - t) ** 5,
  io: t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: t => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  bounce: t => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};
const dgLerp = (a, b, t) => a + (b - a) * t;
const dgClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dgIcon = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/* ---------- Выбор игры и набора фильмов ---------- */
function dgSetup(r) {
  const n = r.pool.length;
  let items = r.pool, game = null;
  if (r.match) {
    const w = r.pool.find(m => m.id === r.winnerId), k = w ? w.owners.length : 2;
    const common = r.pool.filter(m => m.owners.length === k);
    if (common.length < 2) return { game: DG.games.get("match"), items: common.length ? common : r.pool };
    items = common;
  }
  if (r.game && r.game !== "carousel") game = DG.games.get(r.game) || null;
  if (!game || items.length < game.min) {
    const ok = DG.ids.map(id => DG.games.get(id)).filter(g => items.length >= g.min);
    game = ok[(r.seed >>> 0) % ok.length];
  }
  return { game, items, n };
}

// Ждём, пока постеры декодируются (но не дольше ms), чтобы игра не стартовала с пустыми карточками
function dgPreload(items, ms = 2200) {
  const jobs = items.filter(m => m.poster).map(m => new Promise(res => {
    const im = new Image();
    im.onload = im.onerror = () => res();
    im.src = TMDB.img(m.poster, "w185");
  }));
  return Promise.race([Promise.all(jobs), wait(ms)]);
}

/* ---------- Запуск ---------- */
// host — пустой контейнер .dg-arena. Возвращает { game, done, cancel }
function dgPlay(r, host, you, players) {
  players = players && players.length ? players : [{ slot: 0, name: "Вы" }, { slot: 1, name: "Соперник" }];
  const { game, items: base } = dgSetup(r);
  const win = r.pool.find(m => m.id === r.winnerId);
  const rng = dgRng((r.seed ^ dgHash(game.id)) >>> 0);

  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let items = base;
  if (items.length > game.max) {
    const others = shuffle(items.filter(m => m.id !== win.id)).slice(0, game.max - 1);
    items = [win, ...others];
  }
  items = shuffle(items);

  host.innerHTML = `<div class="dg-head"><span class="dg-gicon">${game.icon || ""}</span><div class="dg-gname"><b>${esc(game.name)}</b><small>${esc(game.tag || "")}</small></div></div>
    <div class="dg-stage" data-game="${game.id}"></div><div class="dg-cap"></div>
    <div class="dg-legend">${players.filter(p => r.pool.some(m => m.owners.includes(p.slot))).map(p => `<i style="--c:${dgPlayerColor(p.slot)}">${esc(p.slot === you ? "Вы" : p.name)}</i>`).join("")}${r.pool.some(m => m.owners.length > 1) ? `<i style="--c:${DG_GOLD}">Общие</i>` : ""}</div>`;
  const stage = host.querySelector(".dg-stage"), cap = host.querySelector(".dg-cap");

  let dead = false, lastTick = 0, finish;
  const done = new Promise(res => (finish = res));
  const W = stage.clientWidth || 340, H = stage.clientHeight || 420;

  const G = {
    el: stage, W, H, items, n: items.length, win, wi: items.findIndex(m => m.id === win.id), all: r.pool, you, players, seed: r.seed, rng, shuffle,
    get dead() { return dead; },
    int: n => Math.floor(rng() * n),
    range: (a, b) => a + rng() * (b - a),
    pick: a => a[Math.floor(rng() * a.length)],
    others: () => items.filter(m => m.id !== win.id),
    side: m => (m.owners.length > 1 ? "both" : m.owners[0] === you ? "mine" : "theirs"),
    ring: m => (m.owners.length > 1 ? DG_GOLD : dgPlayerColor(m.owners[0])),
    ownerNames: m => m.owners.map(o => { const p = players.find(x => x.slot === o); return p ? (o === you ? "Вы" : p.name) : "—"; }),
    color: m => DG_COLORS[Math.max(0, items.indexOf(m)) % DG_COLORS.length],
    ci: i => DG_COLORS[i % DG_COLORS.length],
    src: (m, size = "w185") => (m.poster ? TMDB.img(m.poster, size) : ""),

    wait: ms => new Promise(res => setTimeout(() => { if (!dead) res(); }, ms)),
    // Покадровая анимация: fn(eased, raw). Промис выполняется после последнего кадра.
    anim: (ms, fn, ease = dgEase.lin) => new Promise(res => {
      const t0 = performance.now();
      const step = now => {
        if (dead) return;
        const p = Math.min(1, (now - t0) / ms);
        fn(ease(p), p);
        if (p < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    }),
    // Бесконечный цикл: fn(dt секунд, t секунд с начала) возвращает true — остановить
    loop: fn => new Promise(res => {
      let last = performance.now(), t = 0;
      const step = now => {
        if (dead) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now; t += dt;
        if (fn(dt, t)) res(); else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }),
    // WAAPI-анимация элемента; промис — когда закончится
    fly: (el, kf, ms, easing = "cubic-bezier(.16,1,.3,1)", extra = {}) => new Promise(res => {
      if (!el.animate) return res();
      const a = el.animate(kf, Object.assign({ duration: ms, easing, fill: "forwards" }, extra));
      a.onfinish = () => { if (!dead) res(); };
    }),
    say(text, tone) {
      cap.className = "dg-cap" + (tone ? " " + tone : "");
      cap.textContent = text;
      void cap.offsetWidth;
      cap.classList.add("pop");
    },
    tick() { const n = performance.now(); if (n - lastTick > 55) { lastTick = n; haptic(5); } },
    thud() { haptic(18); },

    // Карточка-постер. o: { w, abs }
    card(m, o = {}) {
      const w = o.w || 60, d = document.createElement("div");
      d.className = "dg-card" + (o.abs ? " abs" : "");
      d.dataset.side = G.side(m);
      d.style.width = w + "px";
      d._w = w; d._h = w * 1.5; d._m = m;
      d.style.setProperty("--c", G.color(m));
      d.style.setProperty("--ring", G.ring(m));
      d.style.borderRadius = Math.max(4, w * 0.09) + "px";
      const src = G.src(m, w > 110 ? "w342" : "w185");
      d.innerHTML = `${src ? `<img src="${src}" alt="" draggable="false" onerror="this.parentNode.classList.add('np')">` : ""}<span class="ph">${esc(m.title)}</span>`;
      if (!src) d.classList.add("np");
      return d;
    },
    // Произвольный элемент с размерами (для G.place)
    box(cls, w, h, html = "") {
      const d = document.createElement("div");
      d.className = cls;
      d.style.width = w + "px"; d.style.height = h + "px";
      d._w = w; d._h = h;
      if (html) d.innerHTML = html;
      return d;
    },
    // Ставит центр элемента в (x, y)
    place(el, x, y, s = 1, rot = 0) {
      el.style.transform = `translate(${(x - el._w / 2).toFixed(1)}px,${(y - el._h / 2).toFixed(1)}px) rotate(${rot}deg) scale(${s})`;
    },
    add(el) { stage.appendChild(el); return el; },
    html(s) { stage.insertAdjacentHTML("beforeend", s); return stage.lastElementChild; },
    // «Осталась одна» — подсветка победителя на финише игры
    shine(el) { if (el) el.classList.add("dg-won"); },
    // n мест; победитель стоит на случайном месте, остальные места заполнены другими фильмами по кругу
    fill(n) {
      const o = G.others(), k = G.int(n), out = [];
      for (let i = 0, j = G.int(Math.max(1, o.length)); i < n; i++) out.push(i === k ? win : o[j++ % o.length] || win);
      return { list: out, at: k };
    },
  };

  const cancel = () => { dead = true; finish(); };
  dgPreload(items).then(() => {
    if (dead) return;
    Promise.resolve(game.run(G)).then(() => { if (!dead) finish(); }, e => { console.error("duel game", game.id, e); finish(); });
  });
  return { game, done, cancel, items: items.length };
}

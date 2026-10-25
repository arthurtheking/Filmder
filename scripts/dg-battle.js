"use strict";

/* ============ Мини-игры дуэли: битвы ============ */

/* ---------- Сетка карточек ---------- */
function dgGrid(G, n, maxW = 100) {
  const cols = n <= 4 ? 2 : n <= 9 ? 3 : n <= 12 ? 4 : 5, rows = Math.ceil(n / cols);
  const cw = Math.min((G.W - 16) / cols - 10, ((G.H - 16) / rows - 10) / 1.5, maxW), ch = cw * 1.5;
  const cellW = (G.W - 12) / cols, cellH = Math.min((G.H - 12) / rows, ch + 14), top0 = (G.H - rows * cellH) / 2;
  const pos = i => {
    const col = i % cols, row = Math.floor(i / cols), inRow = row === rows - 1 ? n - row * cols : cols;
    return [6 + ((cols - inRow) * cellW) / 2 + col * cellW + cellW / 2, top0 + row * cellH + cellH / 2];
  };
  return { cols, rows, cw, ch, pos };
}

/* ---------- Движок «выбывание» ---------- */
// o: { intro, setup(cards,L), kill(card,i,L), pre(group), groups(victims), gap(k) }
async function dgElim(G, o) {
  const n = G.n, L = dgGrid(G, n);
  const cards = G.items.map((m, i) => {
    const c = G.card(m, { w: L.cw, abs: true }); G.add(c); G.place(c, ...L.pos(i));
    c.animate([{ opacity: 0, transform: c.style.transform + " scale(.5)" }, { opacity: 1, transform: c.style.transform }], { duration: 380, delay: i * 35, fill: "backwards", easing: "cubic-bezier(.34,1.56,.64,1)" });
    return c;
  });
  if (o.setup) o.setup(cards, L);
  G.say(o.intro);
  await G.wait(650 + n * 35);
  let victims = G.shuffle(G.items.map((_, i) => i).filter(i => i !== G.wi)), left = n, k = 0;
  while (victims.length) {
    let group;
    if (o.groups) group = o.groups(victims); else group = victims.slice(0, victims.length > 11 ? 2 : 1);
    victims = victims.filter(v => !group.includes(v));
    if (o.pre) await o.pre(group, cards, L);
    await Promise.all(group.map(i => o.kill(cards[i], i, L)));
    left -= group.length;
    G.say(left > 1 ? `Осталось ${left}` : "Остался один!");
    await G.wait(o.gap ? o.gap(k, victims.length) : Math.max(180, 520 - k * 40));
    k++;
  }
  G.thud();
  G.shine(cards[G.wi]);
  G.say(G.win.title, "gold");
  await G.wait(1300);
}
const dgAt = (G, el, x, y, cls, ms = 700) => { const e = G.html(`<i class="${cls}"></i>`); e.style.left = x + "px"; e.style.top = y + "px"; setTimeout(() => e.remove(), ms); return e; };

dgReg({
  id: "meteors", name: "Метеориты", max: 16, tag: "Небо падает — остаётся один",
  icon: dgIcon('<path d="M20 4 9 15M17 3 6 14M21 8 10 19"/><circle cx="7" cy="17" r="4"/>'),
  run: G => dgElim(G, {
    intro: "Метеоритный дождь!",
    async kill(c, i, L) {
      const [x, y] = L.pos(i), m = G.box("el-meteor dg-abs", 12, 110); G.add(m);
      await G.anim(360, e => G.place(m, dgLerp(x + 170, x, e), dgLerp(y - 340, y, e), 1, 26), dgEase.in2);
      m.remove(); dgAt(G, null, x, y, "el-boom", 650); G.thud();
      c.classList.add("ash");
    },
  }),
});

dgReg({
  id: "sniper", name: "Снайпер", max: 16, tag: "Прицел выбирает мишени",
  icon: dgIcon('<circle cx="12" cy="12" r="8"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>'),
  run: G => {
    let scope, sx, sy;
    return dgElim(G, {
      intro: "Снайпер на позиции…",
      setup(cards, L) {
        scope = G.box("el-scope dg-abs", 76, 76, '<svg viewBox="0 0 76 76"><circle cx="38" cy="38" r="30" fill="none" stroke="#ff3d5a" stroke-width="2"/><path d="M38 0v26M38 50v26M0 38h26M50 38h26" stroke="#ff3d5a" stroke-width="2"/><circle cx="38" cy="38" r="2.5" fill="#ff3d5a"/></svg>');
        G.add(scope); sx = G.W / 2; sy = G.H / 2; G.place(scope, sx, sy);
      },
      async kill(c, i, L) {
        const [x, y] = L.pos(i), x0 = sx, y0 = sy;
        await G.anim(300, e => G.place(scope, dgLerp(x0, x, e), dgLerp(y0, y, e)), dgEase.io);
        sx = x; sy = y;
        await G.wait(150);
        scope.classList.remove("fire"); void scope.offsetWidth; scope.classList.add("fire");
        G.thud();
        c.insertAdjacentHTML("beforeend", '<i class="el-hole"></i>');
        c.classList.add("shot");
      },
      gap: k => Math.max(120, 380 - k * 30),
    });
  },
});

dgReg({
  id: "bubbles", name: "Пузыри", max: 16, tag: "Лопаем пузыри, пока не останется один",
  icon: dgIcon('<circle cx="9" cy="14" r="6"/><circle cx="17" cy="7" r="3"/><path d="M6.5 12a3 3 0 0 1 2-1.5"/>'),
  run: G => dgElim(G, {
    intro: "Каждый фильм — в пузыре",
    setup(cards, L) {
      cards.forEach((c, i) => {
        const [x, y] = L.pos(i), b = G.box("el-bub dg-abs", L.cw + 16, L.ch + 16);
        b.style.animationDelay = -i * 0.37 + "s"; G.add(b); G.place(b, x, y); c._bub = b;
      });
    },
    async kill(c, i, L) {
      const [x, y] = L.pos(i), nd = G.box("el-needle dg-abs", 70, 3); G.add(nd);
      await G.anim(240, e => G.place(nd, dgLerp(x + 150, x + L.cw * 0.45, e), dgLerp(y - 100, y - L.ch * 0.2, e), 1, 32), dgEase.in2);
      nd.remove(); G.thud();
      c._bub.classList.add("pop");
      for (let k = 0; k < 7; k++) { const a = (k / 7) * 6.28, d = dgAt(G, null, x, y, "el-drop", 520); d.style.setProperty("--dx", Math.cos(a) * L.cw * 0.9 + "px"); d.style.setProperty("--dy", Math.sin(a) * L.ch * 0.6 + "px"); }
      c.classList.add("dim");
      setTimeout(() => c._bub.remove(), 400);
    },
  }),
});

dgReg({
  id: "snap", name: "Щелчок", max: 20, tag: "Каждый раунд исчезает половина",
  icon: dgIcon('<path d="M9 11V5a2 2 0 0 1 4 0v6M13 9a2 2 0 0 1 4 0v3a6 6 0 0 1-6 6H9a5 5 0 0 1-4-2l-2-3 2-1 3 2"/><path d="M19 3l1 2M21 6l-2 .5"/>'),
  run: G => dgElim(G, {
    intro: "Половина исчезнет…",
    groups: v => v.slice(0, Math.max(1, Math.ceil((v.length + 1) / 2) - 0 === v.length + 1 ? v.length : Math.floor((v.length + 1) / 2))),
    async pre() { G.say("ЩЕЛЧОК!", "gold"); G.html('<div class="el-snapflash"></div>'); G.thud(); await G.wait(260); },
    async kill(c) {
      c.style.setProperty("--dx", G.range(-60, 60) + "px"); c.style.setProperty("--dy", G.range(-90, -30) + "px"); c.style.setProperty("--r", G.range(-40, 40) + "deg");
      c.classList.add("dust");
    },
    gap: () => 900,
  }),
});

/* ---------- Боулинг ---------- */
dgReg({
  id: "bowling", name: "Боулинг", max: 10, tag: "Страйк! Один кегль устоял",
  icon: dgIcon('<circle cx="8" cy="16" r="5"/><circle cx="7" cy="14.5" r=".6"/><circle cx="9.5" cy="14.5" r=".6"/><path d="M17 3c-1.5 2-1.5 5 0 7-1 2-2 4-.5 7h4c1.500-3 .5-5-.5-7 1.500-2 1.500-5 0-7z" transform="translate(-1 0) scale(.9)"/>'),
  async run(G) {
    const n = G.n; let k = 1; while ((k * (k + 1)) / 2 < n) k++;
    const rowsN = []; let left = n;
    for (let r = 0; r < k; r++) { const c = Math.min(r + 1, left - (k - 1 - r) * 0); rowsN.push(r < k - 1 ? r + 1 : left); left -= rowsN[r]; }
    const gx = Math.min((G.W - 20) / k, 70), cw = Math.min(gx * 0.82, 52), ch = cw * 1.5, gy = Math.min(ch * 0.8, (G.H * 0.5) / k), top = 36;
    const spots = [];
    rowsN.forEach((c, r) => { for (let j = 0; j < c; j++) spots.push([G.W / 2 + (j - (c - 1) / 2) * gx, top + ch / 2 + r * gy]); });
    const order = G.shuffle(spots.map((_, i) => i));
    const pins = G.items.map((m, i) => {
      const c = G.card(m, { w: cw, abs: true }); G.add(c); G.place(c, ...spots[order[i]]);
      c.animate([{ opacity: 0, transform: c.style.transform + " translateY(-30px)" }, { opacity: 1, transform: c.style.transform }], { duration: 400, delay: i * 70, fill: "backwards", easing: "cubic-bezier(.34,1.56,.64,1)" });
      return c;
    });
    G.html(`<div class="bw-lane"></div>`);
    const ball = G.box("bw-ball dg-abs", 42, 42); G.add(ball);
    const by0 = G.H - 40, front = spots[order[G.wi]];
    const tx = G.W / 2 + (G.rng() - 0.5) * gx * 0.6, ty = top + ch / 2 + (rowsN.length - 1) * gy + ch * 0.6;
    G.place(ball, G.W / 2, by0);
    G.say("Бросок!");
    await G.wait(900 + n * 70);
    await G.anim(1100, (e, p) => G.place(ball, dgLerp(G.W / 2, tx, e), dgLerp(by0, ty, e), dgLerp(1.25, 0.75, e), p * 700), dgEase.in2);
    G.thud();
    G.say("СТРАЙК!", "gold");
    const falls = G.items.map((_, i) => i).filter(i => i !== G.wi).map(i => {
      const [x, y] = spots[order[i]], d = Math.hypot(x - tx, y - ty), dir = (x - tx) >= 0 ? 1 : -1, c = pins[i];
      const base = c.style.transform;
      return G.fly(c, [{ transform: base }, { transform: `${base} translate(${dir * (30 + G.range(0, 60))}px,${G.range(-70, -20)}px) rotate(${dir * G.range(70, 140)}deg)`, opacity: 0.2 }], 700, "cubic-bezier(.3,.6,.4,1)", { delay: d * 1.2 }).then(() => c.classList.add("dim"));
    });
    // победитель качается, но стоит
    const w = pins[G.wi], wb = w.style.transform;
    G.fly(w, [{ transform: wb }, { transform: `${wb} rotate(10deg)` }, { transform: `${wb} rotate(-8deg)` }, { transform: `${wb} rotate(5deg)` }, { transform: `${wb} rotate(-2deg)` }, { transform: wb }], 1200, "ease-out", { delay: 200 });
    G.fly(ball, [{ opacity: 1 }, { opacity: 0 }], 600, "ease-in", { delay: 400 });
    await Promise.all(falls);
    await G.wait(300);
    G.thud(); G.shine(w);
    G.say(G.win.title, "gold");
    await G.wait(1300);
  },
});

/* ---------- Горячая картошка ---------- */
dgReg({
  id: "bomb", name: "Горячая картошка", max: 8, tag: "Бомба переходит из рук в руки",
  icon: dgIcon('<circle cx="11" cy="14" r="7"/><path d="M15 8l3-3M18 3v3h3"/>'),
  async run(G) {
    const n = G.n, R = Math.min(G.W, G.H) * 0.34, cx = G.W / 2, cy = G.H / 2;
    const cw = Math.min(56, ((2 * Math.PI * R) / n) * 0.78), ch = cw * 1.5;
    const P = i => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [cx + Math.cos(a) * R, cy + Math.sin(a) * R * 1.12]; };
    const cards = G.items.map((m, i) => {
      const c = G.card(m, { w: cw, abs: true }); G.add(c); G.place(c, ...P(i));
      c.animate([{ opacity: 0, transform: c.style.transform + " scale(.4)" }, { opacity: 1, transform: c.style.transform }], { duration: 380, delay: i * 70, fill: "backwards", easing: "cubic-bezier(.34,1.56,.64,1)" });
      return c;
    });
    const bomb = G.box("bm-bomb dg-abs", 34, 40, '<i class="b"></i><i class="f"></i>'); G.add(bomb);
    let at = G.int(n); const hold = i => { const [x, y] = P(i); return [x, y - ch * 0.62]; };
    G.place(bomb, ...hold(at));
    G.say("Бомба пошла по рукам!");
    await G.wait(1000 + n * 70);
    let alive = G.items.map((_, i) => i);
    const victims = G.shuffle(alive.filter(i => i !== G.wi));
    let round = 0;
    while (victims.length) {
      const v = victims.shift(), hops = 2 + G.int(2);
      for (let h = 0; h < hops; h++) {
        let to; do { to = G.pick(alive); } while (to === at);
        const [x0, y0] = hold(at), [x1, y1] = hold(to), dur = Math.max(150, 300 - round * 22);
        await G.anim(dur, (e, p) => G.place(bomb, dgLerp(x0, x1, e), dgLerp(y0, y1, e) - Math.sin(p * Math.PI) * 28, 1 + Math.sin(p * Math.PI) * 0.15), dgEase.io);
        at = to; G.tick(); bomb.classList.add("tick"); setTimeout(() => bomb.classList.remove("tick"), 90);
      }
      if (at !== v) { // финальный прыжок к жертве
        const [x0, y0] = hold(at), [x1, y1] = hold(v);
        await G.anim(240, (e, p) => G.place(bomb, dgLerp(x0, x1, e), dgLerp(y0, y1, e) - Math.sin(p * Math.PI) * 28), dgEase.io);
        at = v;
      }
      await G.wait(260);
      const [bx, by] = P(v);
      dgAt(G, null, bx, by, "el-boom big", 700); G.thud();
      G.el.classList.remove("shake"); void G.el.offsetWidth; G.el.classList.add("shake");
      cards[v].classList.add("ash");
      alive = alive.filter(i => i !== v);
      round++;
      G.say(alive.length > 1 ? `Осталось ${alive.length}` : "Остался один!");
      if (alive.length > 1) { at = G.pick(alive); const [hx, hy] = hold(at); bomb.style.opacity = 0; G.place(bomb, hx, hy); await G.wait(250); bomb.style.opacity = 1; }
    }
    bomb.remove();
    G.shine(cards[G.wi]);
    G.say(G.win.title, "gold");
    await G.wait(1300);
  },
});

/* ============ Турнир «один на один» ============ */
// Показываем путь победителя по сетке; остальные матчи решаются «за кадром».
async function dgBracket(G, o) {
  const n = G.n, cw = Math.min(G.W * 0.26, 104), ch = cw * 1.5, tw = Math.min(24, (G.W - 24) / n - 3);
  const thumbs = G.items.map((m, i) => {
    const t = G.card(m, { w: tw, abs: true }); t.classList.add("br-th"); G.add(t);
    G.place(t, G.W / 2 + (i - (n - 1) / 2) * (tw + 3), G.H - tw * 0.75 - 8);
    return t;
  });
  let alive = G.shuffle(G.items.map((_, i) => i));
  if (alive.length % 2 && alive[alive.length - 1] === G.wi) alive.unshift(alive.pop()); // победитель не получает «пропуск»
  let round = 0;
  const rounds = Math.ceil(Math.log2(n));
  while (alive.length > 1) {
    round++;
    const bye = alive.length % 2 ? alive.pop() : null, next = [];
    let mine = null;
    for (let k = 0; k < alive.length; k += 2) {
      const a = alive[k], b = alive[k + 1];
      const w = a === G.wi ? a : b === G.wi ? b : (G.rng() < 0.5 ? a : b);
      next.push(w);
      if (a === G.wi || b === G.wi) mine = [a, b, w];
    }
    if (bye !== null) next.push(bye);
    const final = alive.length + (bye !== null ? 1 : 0) === 2, semi = !final && next.length === 2;
    const title = final ? "ФИНАЛ" : semi ? "Полуфинал" : `Раунд ${round} из ${rounds}`;
    G.say(title, final ? "gold" : "");
    const [a, b, w] = mine;
    const wLeft = G.rng() < 0.5, L = wLeft ? G.wi : (a === G.wi ? b : a), Rr = wLeft ? (a === G.wi ? b : a) : G.wi;
    const ca = G.card(G.items[L], { w: cw, abs: true }), cb = G.card(G.items[Rr], { w: cw, abs: true });
    const yy = G.H * 0.4;
    G.add(ca); G.add(cb);
    G.place(ca, G.W * 0.21, yy); G.place(cb, G.W * 0.79, yy);
    for (const [c, from] of [[ca, -90], [cb, 90]]) c.animate([{ opacity: 0, transform: c.style.transform + ` translateX(${from}px)` }, { opacity: 1, transform: c.style.transform }], { duration: 450, fill: "backwards", easing: "cubic-bezier(.16,1,.3,1)" });
    const nm = G.html(`<div class="br-names"><span style="left:${G.W * 0.21 - cw / 2}px;width:${cw}px;top:${yy + ch / 2 + 6}px">${esc(G.items[L].title)}</span><span style="left:${G.W * 0.79 - cw / 2}px;width:${cw}px;top:${yy + ch / 2 + 6}px">${esc(G.items[Rr].title)}</span></div>`);
    await G.wait(650);
    await o.play(G, { ca, cb, cw, ch, yy, final, round }, wLeft);
    (wLeft ? cb : ca).classList.add("dim");
    G.shine(wLeft ? ca : cb);
    G.thud();
    await G.wait(final ? 900 : 650);
    // убираем матч, обновляем ленту
    const gone = alive.filter(i => !next.includes(i));
    gone.forEach(i => thumbs[i].classList.add("dim"));
    await Promise.all([ca, cb, nm].map(e => G.fly(e, [{ opacity: 1 }, { opacity: 0 }], 260, "ease-in")));
    [ca, cb, nm, ...G.el.querySelectorAll(".br-x")].forEach(e => e.remove());
    alive = next;
  }
  G.shine(thumbs[G.wi]);
  G.say(G.win.title, "gold");
  await G.wait(1000);
}
const dgBr = (id, name, tag, icon, play) => dgReg({ id, name, tag, icon, max: 8, run: G => dgBracket(G, { play }) });

/* --- Монетка --- */
dgBr("coin", "Монетка", "Орёл или решка — решает судьба",
  dgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>'),
  async (G, m, wLeft) => {
    const D = Math.min(G.W * 0.28, 100), cx = G.W / 2, base = m.yy + 10;
    const sa = G.src(G.items[0], "w185"); void sa;
    const face = (card) => { const src = card._m.poster ? G.src(card._m, "w185") : ""; return src ? `background-image:url(${src})` : `background:${G.color(card._m)}`; };
    const coin = G.html(`<div class="bc-wrap" style="left:${cx - D / 2}px;top:${base - D / 2}px;width:${D}px;height:${D}px"><div class="bc-coin"><div class="bc-f" style="${face(m.ca)}"></div><div class="bc-f b" style="${face(m.cb)}"></div></div><div class="bc-sh"></div></div>`);
    const inner = coin.querySelector(".bc-coin"), sh = coin.querySelector(".bc-sh");
    const fast = !m.final, turns = fast ? 5 : 8, ms = fast ? 1300 : 2100, end = wLeft ? 0 : 180;
    G.say("Подбрасываем монетку…");
    G.fly(coin, [{ transform: "translateY(0)" }, { transform: `translateY(${-G.H * 0.3}px)`, offset: 0.5, easing: "cubic-bezier(.3,0,.9,.6)" }, { transform: "translateY(0)" }], ms, "cubic-bezier(.2,.5,.4,1)");
    G.fly(sh, [{ transform: "scale(1)", opacity: 0.5 }, { transform: "scale(.4)", opacity: 0.15, offset: 0.5 }, { transform: "scale(1)", opacity: 0.5 }], ms, "ease-in-out");
    const iv = setInterval(() => (G.dead ? clearInterval(iv) : G.tick()), 100);
    await G.fly(inner, [{ transform: "rotateX(0deg)" }, { transform: `rotateX(${360 * turns + end}deg)` }], ms, "cubic-bezier(.2,.6,.3,1)");
    clearInterval(iv);
    G.say(wLeft ? "Выпала левая сторона!" : "Выпала правая сторона!");
    await G.wait(300);
    coin.remove();
  });

/* --- Камень-ножницы-бумага --- */
const DG_RPS = [
  '<path d="M14 24c0-4 2-6 5-6h10c4 0 7 3 7 7v8c0 5-4 9-9 9h-5c-5 0-8-4-8-8z"/><path d="M19 18v8M25 18v8M31 18v8"/>',
  '<path d="M12 8h20l6 6v26H12z"/><path d="M32 8v6h6M18 22h14M18 28h14M18 34h9"/>',
  '<circle cx="16" cy="36" r="5"/><circle cx="32" cy="36" r="5"/><path d="M19 32 34 8M29 32 14 8"/>',
];
dgBr("rps", "Камень-ножницы-бумага", "Классика на каждый раунд",
  dgIcon('<path d="M7 11V7a2 2 0 0 1 4 0v4M11 9a2 2 0 0 1 4 0v3M7 11a2 2 0 0 0-4 0v3a7 7 0 0 0 7 7h2a6 6 0 0 0 6-6v-3a2 2 0 0 0-4 0"/>'),
  async (G, m, wLeft) => {
    const mk = (x) => G.html(`<div class="rp-hand" style="left:${x - 34}px;top:${m.yy - 34}px"><svg viewBox="0 0 48 48" width="68" height="68" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${DG_RPS[0]}</svg></div>`);
    const hands = [mk(G.W * 0.5 - 0), null];
    hands[0].style.left = G.W * 0.5 - 76 + "px"; hands[1] = mk(0); hands[1].style.left = G.W * 0.5 + 8 + "px";
    hands[1].classList.add("flip");
    const setSign = (h, s) => { h.querySelector("svg").innerHTML = DG_RPS[s]; };
    const rounds = m.final && G.rng() < 0.5 ? 2 : 1;
    for (let r = 0; r < rounds; r++) {
      G.say(r ? "Ничья! Ещё раз…" : "Камень… ножницы… бумага…");
      setSign(hands[0], 0); setSign(hands[1], 0);
      for (let k = 0; k < 3; k++) {
        hands.forEach(h => h.animate([{ transform: h.classList.contains("flip") ? "scaleX(-1) translateY(0)" : "translateY(0)" }, { transform: h.classList.contains("flip") ? "scaleX(-1) translateY(-24px)" : "translateY(-24px)" }, { transform: h.classList.contains("flip") ? "scaleX(-1) translateY(0)" : "translateY(0)" }], { duration: 360, easing: "ease-in-out" }));
        G.tick(); await G.wait(400);
      }
      const last = r === rounds - 1, sA = G.int(3);
      const aWin = wLeft;
      const sB = last ? (aWin ? (sA + 2) % 3 : (sA + 1) % 3) : sA;
      setSign(hands[0], sA); setSign(hands[1], sB);
      hands.forEach(h => h.animate([{ transform: (h.classList.contains("flip") ? "scaleX(-1) " : "") + "scale(1.4)" }, { transform: (h.classList.contains("flip") ? "scaleX(-1) " : "") + "scale(1)" }], { duration: 320, easing: "cubic-bezier(.34,1.56,.64,1)" }));
      G.thud();
      await G.wait(last ? 600 : 800);
    }
    hands.forEach(h => h.remove());
  });

/* --- Дуэль на револьверах --- */
dgBr("draw", "Дуэль на револьверах", "Кто быстрее среагирует",
  dgIcon('<path d="M3 9h13l2 2v3h-5l-1 3H8l1-3H3zM16 9V7"/>'),
  async (G, m, wLeft) => {
    const cy = m.yy, cxL = G.W * 0.21, cxR = G.W * 0.79;
    const msW = Math.round(G.range(140, 230)), msL = msW + Math.round(G.range(50, 140));
    const tags = G.html(`<div class="dw-ms l" style="left:${cxL - 40}px;top:${cy - m.ch / 2 - 30}px">— мс</div><div class="dw-ms r" style="left:${cxR - 40}px;top:${cy - m.ch / 2 - 30}px">— мс</div>`);
    const msEls = G.el.querySelectorAll(".dw-ms"); msEls.forEach(e => e.classList.add("br-x"));
    const sign = G.html('<div class="dw-sign">ЖДИТЕ…</div>'); sign.classList.add("br-x");
    G.say("Руки на кобуре…");
    await G.wait((m.final ? 900 : 500) + G.rng() * 900);
    sign.textContent = "ОГОНЬ!"; sign.classList.add("go"); G.thud();
    const msA = wLeft ? msW : msL, msB = wLeft ? msL : msW;
    const t0 = performance.now();
    const shoot = async (x0, x1, delay) => {
      await G.wait(delay);
      const b = G.box("dw-bullet dg-abs", 14, 4); b.classList.add("br-x"); G.add(b);
      await G.anim(130, e => G.place(b, dgLerp(x0, x1, e), cy), dgEase.lin); b.remove();
    };
    const winnerShot = wLeft ? shoot(cxL + m.cw / 2, cxR - m.cw / 2, msW) : shoot(cxR - m.cw / 2, cxL + m.cw / 2, msW);
    await G.anim(msL + 150, () => {
      const t = performance.now() - t0;
      msEls[0].textContent = Math.min(Math.round(t), msA) + " мс"; msEls[1].textContent = Math.min(Math.round(t), msB) + " мс";
    });
    msEls[wLeft ? 0 : 1].classList.add("best");
    await winnerShot;
    const loser = wLeft ? m.cb : m.ca;
    loser.classList.add("hit"); G.thud();
    G.say(`${wLeft ? msW : msW} мс — быстрее!`);
    await G.wait(500);
  });

/* --- Канат --- */
dgBr("tug", "Перетягивание каната", "Кто перетянет — тот и победил",
  dgIcon('<path d="M3 12h18M7 8v8M17 8v8M12 5v14"/>'),
  async (G, m, wLeft) => {
    const y = m.yy, xl = G.W * 0.21, xr = G.W * 0.79, mid = G.W / 2;
    const nmEl = G.el.querySelector(".br-names"); if (nmEl) nmEl.style.opacity = 0;
    const rope = G.html(`<div class="tg-rope br-x" style="left:${xl}px;width:${xr - xl}px;top:${y}px"></div>`);
    const flag = G.html(`<div class="tg-flag br-x" style="left:${mid - 7}px;top:${y - 18}px"></div>`);
    G.html(`<div class="tg-line br-x" style="left:${mid}px;top:${y - 70}px"></div>`);
    G.say("Тянем!");
    const end = (wLeft ? -1 : 1) * G.W * 0.06; // победитель тянет к себе, проигравший едет через линию
    const ms = m.final ? 3200 : 2000;
    await G.anim(ms, (e, p) => {
      const f = end * e + Math.sin(p * 16) * (1 - p) * G.W * 0.025;
      G.place(m.ca, xl + f, y); G.place(m.cb, xr + f, y);
      rope.style.transform = `translateX(${f}px)`; flag.style.transform = `translateX(${f}px)`;
      if (Math.floor(p * 24) % 2) G.tick();
    }, dgEase.io);
  });

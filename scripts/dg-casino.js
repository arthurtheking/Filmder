"use strict";

/* ============ Мини-игры дуэли: казино ============ */

/* ---------- Общее для колёс на canvas ---------- */
function dgCanvas(size) {
  const dpr = Math.min(devicePixelRatio || 1, 2), c = document.createElement("canvas");
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = size + "px";
  const x = c.getContext("2d");
  x.scale(dpr, dpr);
  return { c, x };
}
function dgImgs(G, size = "w185") {
  return G.items.map(m => { const im = new Image(); im.src = G.src(m, size); return im; });
}
function dgRRect(x, l, t, w, h, r) {
  x.beginPath();
  x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r);
  x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath();
}
// Рисует постер с центром в (0,0) текущей системы координат
function dgPoster(x, im, w, h, fallback, ring) {
  x.save();
  dgRRect(x, -w / 2, -h / 2, w, h, Math.max(2, w * 0.1));
  x.clip();
  if (im && im.complete && im.naturalWidth) {
    const ar = im.naturalWidth / im.naturalHeight, tr = w / h;
    let sx = 0, sy = 0, sw = im.naturalWidth, sh = im.naturalHeight;
    if (ar > tr) { sw = sh * tr; sx = (im.naturalWidth - sw) / 2; } else { sh = sw / tr; sy = (im.naturalHeight - sh) / 2; }
    x.drawImage(im, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  } else { x.fillStyle = fallback; x.fillRect(-w / 2, -h / 2, w, h); }
  x.restore();
  if (ring) { dgRRect(x, -w / 2, -h / 2, w, h, Math.max(2, w * 0.1)); x.lineWidth = 2; x.strokeStyle = ring; x.stroke(); }
}
const DG_RING = { mine: "#46e0a0", theirs: "#ff7a5c", both: "#ffd166" };

/* ---------- Однорукий бандит ---------- */
dgReg({
  id: "slots", name: "Однорукий бандит", tag: "Три барабана — три одинаковых постера",
  icon: dgIcon('<rect x="3" y="5" width="15" height="14" rx="3"/><path d="M8 5v14M13 5v14M21 8v5"/><circle cx="21" cy="7" r="1.2"/>'),
  async run(G) {
    const gap = 6;
    const cw = Math.min(G.W * 0.2, 92, ((G.H * 0.78) / 3 - gap) / 1.5), ch = cw * 1.5 + gap;
    const mach = G.html(`<div class="sl-machine"><div class="sl-top"><b>FILMDER</b><div class="sl-bulbs">${"<i></i>".repeat(9)}</div></div><div class="sl-reels"></div>
      <div class="sl-lever"><i class="stick"></i><b class="ball"></b></div></div>`);
    const holder = mach.querySelector(".sl-reels");
    const reels = [];
    for (let k = 0; k < 3; k++) {
      const len = 20 + k * 7, fin = len - 2, strip = document.createElement("div"), reel = document.createElement("div");
      let prev = null;
      for (let i = 0; i < len; i++) {
        let mv = G.win;
        if (i !== fin) { do { mv = G.pick(G.others()); } while (mv === prev && G.others().length > 1); }
        prev = mv;
        const c = document.createElement("div");
        c.className = "sl-cell"; c.style.height = ch + "px";
        c.appendChild(G.card(mv, { w: cw }));
        strip.appendChild(c);
      }
      reel.className = "sl-reel"; strip.className = "sl-strip";
      reel.style.cssText = `width:${cw + gap * 2}px;height:${ch * 3}px`;
      reel.appendChild(strip); holder.appendChild(reel);
      reels.push({ reel, strip, target: (fin - 1) * ch });
    }
    holder.insertAdjacentHTML("beforeend", `<div class="sl-line" style="top:${ch * 1.5}px"></div>`);
    G.say("Тянем рычаг…");
    await G.wait(500);
    const ball = mach.querySelector(".ball"), stick = mach.querySelector(".stick");
    G.fly(ball, [{ transform: "translateY(0)" }, { transform: "translateY(38px)" }, { transform: "translateY(0)" }], 650, "ease-in-out");
    G.fly(stick, [{ transform: "scaleY(1)" }, { transform: "scaleY(.35)" }, { transform: "scaleY(1)" }], 650, "ease-in-out");
    G.thud();
    await G.wait(350);
    const iv = setInterval(() => (G.dead ? clearInterval(iv) : G.tick()), 90);
    mach.classList.add("run");
    await Promise.all(reels.map(async (r, k) => {
      r.reel.classList.add("spin");
      await G.fly(r.strip, [
        { transform: "translateY(0)" },
        { transform: `translateY(${-r.target - ch * 0.14}px)`, offset: 0.9, easing: "ease-in-out" },
        { transform: `translateY(${-r.target}px)` },
      ], 2300 + k * 850, "cubic-bezier(.3,.55,.25,1)");
      r.reel.classList.remove("spin"); r.reel.classList.add("stop");
      G.thud();
      G.say(k < 2 ? "Есть совпадение…" : "");
    }));
    clearInterval(iv);
    mach.classList.remove("run"); mach.classList.add("jackpot");
    holder.querySelector(".sl-line").classList.add("win");
    G.say("ДЖЕКПОТ!", "gold");
    await G.wait(1100);
  },
});

/* ---------- Рулетка ---------- */
dgReg({
  id: "roulette", name: "Рулетка", tag: "Шарик решит, чей фильм сегодня",
  icon: dgIcon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21"/>'),
  async run(G) {
    const size = Math.min(G.W - 8, G.H - 12, 420), R = size * 0.37, cx = size / 2, cy = size / 2;
    const { c, x } = dgCanvas(size);
    G.add(c);
    const imgs = dgImgs(G), n = G.n, seg = (Math.PI * 2) / n, ac = i => -Math.PI / 2 + (i + 0.5) * seg;
    const T = 7000, w0 = G.range(0, 6.28), wTurns = 2.2 + G.rng() * 0.8, ballTurns = 7;
    G.say("Делайте ставки!");
    let hl = 0;
    const draw = (t, p) => {
      const aw = w0 + Math.PI * 2 * wTurns * dgEase.out3(p);
      x.clearRect(0, 0, size, size);
      // деревянный обод и дорожка шарика
      const g = x.createRadialGradient(cx, cy, R * 1.0, cx, cy, R * 1.3);
      g.addColorStop(0, "#2a1d12"); g.addColorStop(0.55, "#6b4423"); g.addColorStop(1, "#2a1a0e");
      x.beginPath(); x.arc(cx, cy, R * 1.3, 0, 7); x.fillStyle = g; x.fill();
      x.beginPath(); x.arc(cx, cy, R * 1.14, 0, 7); x.fillStyle = "#0c0e13"; x.fill();
      x.lineWidth = 2; x.strokeStyle = "#d4af37"; x.beginPath(); x.arc(cx, cy, R * 1.3, 0, 7); x.stroke();
      x.beginPath(); x.arc(cx, cy, R * 1.14, 0, 7); x.stroke();
      // сектора
      for (let i = 0; i < n; i++) {
        const a0 = aw + ac(i) - seg / 2, a1 = a0 + seg;
        x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R, a0, a1); x.closePath();
        x.fillStyle = i % 2 ? "#14161d" : "#a8262c"; x.fill();
        x.lineWidth = 1.5; x.strokeStyle = "#d4af37"; x.stroke();
      }
      // постеры
      const rd = R * 0.7, pw = Math.min(R * 0.27, rd * seg * 0.78), ph = pw * 1.5;
      for (let i = 0; i < n; i++) {
        x.save(); x.translate(cx, cy); x.rotate(aw + ac(i) + Math.PI / 2); x.translate(0, -rd);
        dgPoster(x, imgs[i], pw, ph, G.ci(i), DG_RING[G.side(G.items[i])]);
        x.restore();
      }
      if (hl > 0) { // затемняем всех, кроме победителя
        for (let i = 0; i < n; i++) {
          if (i === G.wi) continue;
          const a0 = aw + ac(i) - seg / 2;
          x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R, a0, a0 + seg); x.closePath();
          x.fillStyle = `rgba(0,0,0,${0.62 * hl})`; x.fill();
        }
        const a0 = aw + ac(G.wi) - seg / 2;
        x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R, a0, a0 + seg); x.closePath();
        x.lineWidth = 3; x.strokeStyle = `rgba(255,224,130,${hl})`; x.stroke();
      }
      // центр
      x.save(); x.translate(cx, cy); x.rotate(aw);
      const hg = x.createRadialGradient(0, 0, 2, 0, 0, R * 0.2);
      hg.addColorStop(0, "#fff3c4"); hg.addColorStop(1, "#b8860b");
      x.beginPath(); x.arc(0, 0, R * 0.2, 0, 7); x.fillStyle = hg; x.fill();
      x.lineWidth = 3; x.strokeStyle = "#d4af37";
      for (let k = 0; k < 4; k++) { x.rotate(Math.PI / 2); x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -R * 0.2); x.stroke(); }
      x.restore();
      // шарик
      const e = dgEase.out3(Math.min(1, p / 0.97));
      const ab = aw + ac(G.wi) + Math.PI * 2 * ballTurns * (1 - e);
      const fall = dgClamp((p - 0.6) / 0.2, 0, 1);
      const br = R * (1.22 - 0.3 * dgEase.bounce(fall));
      const bx = cx + Math.cos(ab) * br, by = cy + Math.sin(ab) * br;
      x.beginPath(); x.arc(bx + 1.5, by + 2.5, 6, 0, 7); x.fillStyle = "rgba(0,0,0,.45)"; x.fill();
      const bg = x.createRadialGradient(bx - 2, by - 2, 1, bx, by, 7);
      bg.addColorStop(0, "#fff"); bg.addColorStop(1, "#c9ced6");
      x.beginPath(); x.arc(bx, by, 6.5, 0, 7); x.fillStyle = bg; x.fill();
      if (p > 0.6 && p < 0.9) G.tick();
    };
    await G.anim(T, (_, p) => draw(0, p), dgEase.lin);
    G.thud();
    G.say("Шарик остановился!");
    await G.anim(700, (e) => { hl = e; draw(0, 1); });
    G.say(G.win.title, "gold");
    await G.wait(900);
  },
});

/* ---------- Колесо фортуны ---------- */
dgReg({
  id: "fortune", name: "Колесо фортуны", max: 14, tag: "Стрелка замрёт на победителе",
  icon: dgIcon('<circle cx="12" cy="13" r="8"/><path d="M12 2.5 14.2 6h-4.4zM12 13V6M12 13l5.6-3.2M12 13l-5.6-3.2"/>'),
  async run(G) {
    const size = Math.min(G.W - 6, G.H - 6, 420), R = size * 0.4, cx = size / 2, cy = size / 2 + size * 0.03;
    const { c, x } = dgCanvas(size);
    G.add(c);
    const imgs = dgImgs(G), n = G.n, seg = (Math.PI * 2) / n;
    const a0 = G.range(0, 6.28), turns = 5 + G.int(3);
    const off = (G.rng() - 0.5) * seg * 0.6;
    const end = a0 + Math.PI * 2 * turns - (G.wi + 0.5) * seg - (a0 % (Math.PI * 2)) + off; // победитель под стрелкой
    const T = 7200;
    let flap = 0, lastPeg = -1, hl = 0;
    G.say("Крутим колесо!");
    const draw = (p, aw) => {
      x.clearRect(0, 0, size, size);
      // лампочки по ободу
      x.beginPath(); x.arc(cx, cy, R * 1.12, 0, 7); x.fillStyle = "#1a1030"; x.fill();
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2, on = (i + Math.floor(p * 40)) % 2 === 0;
        x.beginPath(); x.arc(cx + Math.cos(a) * R * 1.07, cy + Math.sin(a) * R * 1.07, 3, 0, 7);
        x.fillStyle = on ? "#ffe08a" : "#6b5a2a"; x.fill();
      }
      for (let i = 0; i < n; i++) {
        const s0 = aw - Math.PI / 2 + i * seg, s1 = s0 + seg;
        x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R, s0, s1); x.closePath();
        x.fillStyle = G.ci(i); x.fill();
        x.lineWidth = 2; x.strokeStyle = "rgba(255,255,255,.85)"; x.stroke();
      }
      const rd = R * 0.66, pw = Math.min(R * 0.36, rd * seg * 0.8), ph = pw * 1.5;
      for (let i = 0; i < n; i++) {
        x.save(); x.translate(cx, cy); x.rotate(aw - Math.PI / 2 + (i + 0.5) * seg + Math.PI / 2); x.translate(0, -rd);
        dgPoster(x, imgs[i], pw, ph, G.ci(i), DG_RING[G.side(G.items[i])]);
        x.restore();
      }
      if (hl > 0) {
        for (let i = 0; i < n; i++) {
          if (i === G.wi) continue;
          const s0 = aw - Math.PI / 2 + i * seg;
          x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R, s0, s0 + seg); x.closePath();
          x.fillStyle = `rgba(0,0,0,${0.6 * hl})`; x.fill();
        }
      }
      // ось
      const hg = x.createRadialGradient(cx, cy, 2, cx, cy, R * 0.14);
      hg.addColorStop(0, "#fff"); hg.addColorStop(1, "#e0a800");
      x.beginPath(); x.arc(cx, cy, R * 0.13, 0, 7); x.fillStyle = hg; x.fill();
      // стрелка
      x.save(); x.translate(cx, cy - R * 1.12); x.rotate(flap);
      x.beginPath(); x.moveTo(-11, -12); x.lineTo(11, -12); x.lineTo(0, 22); x.closePath();
      x.fillStyle = "#ff3d5a"; x.shadowColor = "rgba(0,0,0,.5)"; x.shadowBlur = 6; x.fill();
      x.restore();
    };
    await G.anim(T, (e, p) => {
      const aw = dgLerp(a0, end, e);
      const peg = Math.floor(((aw % (Math.PI * 2)) + Math.PI * 2) / seg);
      if (peg !== lastPeg) { lastPeg = peg; flap = -0.55; G.tick(); }
      flap *= 0.86;
      draw(p, aw);
    }, dgEase.out5);
    G.thud();
    await G.anim(600, e => { hl = e; flap = 0; draw(1, end); });
    G.say(G.win.title, "gold");
    await G.wait(900);
  },
});

/* ---------- Кубик ---------- */
dgReg({
  id: "dice", name: "Кубик", max: 6, tag: "На шести гранях — шесть фильмов",
  icon: dgIcon('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r=".8"/><circle cx="15.5" cy="15.5" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="15.5" cy="8.5" r=".8"/><circle cx="8.5" cy="15.5" r=".8"/>'),
  async run(G) {
    const S = Math.min(G.W * 0.46, G.H * 0.36, 170), half = S / 2;
    const { list, at } = G.fill(6);
    const T = ["rotateY(0deg)", "rotateY(180deg)", "rotateY(90deg)", "rotateY(-90deg)", "rotateX(90deg)", "rotateX(-90deg)"];
    const SHOW = [[0, 0], [0, 180], [0, -90], [0, 90], [-90, 0], [90, 0]]; // поворот куба, чтобы грань была спереди
    const scene = G.html(`<div class="dc-scene" style="width:${S}px;height:${S}px"><div class="dc-shadow"></div><div class="dc-throw"><div class="dc-cube" style="width:${S}px;height:${S}px">
      ${list.map((m, i) => `<div class="dc-face" style="width:${S}px;height:${S}px;transform:${T[i]} translateZ(${half}px)" data-side="${G.side(m)}">
        ${m.poster ? `<img src="${G.src(m, "w342")}" alt="" draggable="false">` : `<span>${esc(m.title)}</span>`}<em>${i + 1}</em></div>`).join("")}
    </div></div></div>`);
    const cube = scene.querySelector(".dc-cube"), thr = scene.querySelector(".dc-throw"), sh = scene.querySelector(".dc-shadow");
    G.say("Бросаем кубик…");
    await G.wait(400);
    const [rx, ry] = SHOW[at];
    const f = `rotateX(${rx + 360 * (2 + G.int(2))}deg) rotateY(${ry + 360 * (2 + G.int(2))}deg) rotateZ(${360 * (1 + G.int(2))}deg)`;
    const iv = setInterval(() => (G.dead ? clearInterval(iv) : G.tick()), 110);
    const fall = S * 1.5;
    G.fly(sh, [{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(1)", opacity: 0.55, offset: 0.4 }, { transform: "scale(.7)", opacity: 0.4, offset: 0.62 }, { transform: "scale(1)", opacity: 0.55, offset: 0.78 }, { transform: "scale(.9)", opacity: 0.5, offset: 0.9 }, { transform: "scale(1)", opacity: 0.55 }], 2400, "linear");
    G.fly(thr, [
      { transform: `translateY(${-fall}px)`, easing: "cubic-bezier(.55,0,1,.6)" },
      { transform: "translateY(0)", offset: 0.4, easing: "cubic-bezier(.2,.7,.4,1)" },
      { transform: `translateY(${-S * 0.5}px)`, offset: 0.62, easing: "cubic-bezier(.55,0,1,.6)" },
      { transform: "translateY(0)", offset: 0.78, easing: "cubic-bezier(.2,.7,.4,1)" },
      { transform: `translateY(${-S * 0.14}px)`, offset: 0.9, easing: "cubic-bezier(.55,0,1,.6)" },
      { transform: "translateY(0)" },
    ], 2400, "linear");
    await G.fly(cube, [{ transform: "rotateX(0) rotateY(0) rotateZ(0)" }, { transform: f }], 2400, "cubic-bezier(.15,.65,.25,1)");
    clearInterval(iv);
    G.thud();
    scene.classList.add("done");
    scene.querySelectorAll(".dc-face")[at].classList.add("win");
    G.say(`Выпало ${at + 1}: ${G.win.title}`, "gold");
    await G.wait(1200);
  },
});

/* ---------- Напёрстки ---------- */
dgReg({
  id: "shells", name: "Напёрстки", max: 3, tag: "Следите за звездой",
  icon: dgIcon('<path d="M7 20 9 8a3 3 0 0 1 6 0l2 12zM5 20h14"/><path d="M12 3v2"/>'),
  async run(G) {
    const { list, at } = G.fill(3);
    const cw = Math.min(G.W * 0.27, 108), gh = cw * 1.75, cardW = cw * 0.8;
    const cy = G.H * 0.55, xs = [G.W * 0.2, G.W * 0.5, G.W * 0.8];
    const gs = list.map((m, i) => {
      const g = G.box("sh-g", cw, gh);
      g.classList.add("dg-abs");
      const card = G.card(m, { w: cardW });
      card.classList.add("sh-card");
      g.appendChild(card);
      g.insertAdjacentHTML("beforeend", `<div class="sh-cup"><i></i></div>${i === at ? '<div class="sh-star">★</div>' : ""}`);
      g._m = m; g._cup = g.querySelector(".sh-cup");
      g.classList.add("lift");
      G.add(g);
      return g;
    });
    const slotOf = [0, 1, 2], setX = (g, x, y = 0) => G.place(g, x, cy + y);
    gs.forEach((g, i) => setX(g, xs[i]));
    G.say("Запомните победителя!");
    await G.wait(1500);
    gs.forEach(g => g.classList.remove("lift"));
    gs[at].querySelector(".sh-star")?.remove();
    await G.wait(550);
    G.say("Перемешиваем…");
    const swaps = 8 + G.int(3);
    for (let s = 0; s < swaps; s++) {
      const a = G.int(3); let b = G.int(3); if (b === a) b = (a + 1 + G.int(2)) % 3;
      const ga = slotOf[a], gb = slotOf[b]; // какие группы стоят в слотах a и b
      const dur = Math.max(260, 520 - s * 28), up = s % 2 ? -32 : 32;
      await G.anim(dur, e => {
        setX(gs[ga], dgLerp(xs[a], xs[b], e), Math.sin(e * Math.PI) * -up);
        setX(gs[gb], dgLerp(xs[b], xs[a], e), Math.sin(e * Math.PI) * up);
      }, dgEase.io);
      slotOf[a] = gb; slotOf[b] = ga;
      G.tick();
    }
    G.say("Где победитель?");
    await G.wait(900);
    const order = [0, 1, 2].filter(i => i !== at);
    for (const i of order) { gs[i].classList.add("lift", "dim"); G.tick(); await G.wait(520); }
    gs[at].classList.add("lift", "win");
    G.thud();
    G.say(G.win.title, "gold");
    await G.wait(1200);
  },
});

/* ---------- Старшая карта ---------- */
dgReg({
  id: "cardwar", name: "Старшая карта", max: 8, tag: "У кого карта выше — тот и победил",
  icon: dgIcon('<rect x="5" y="3" width="11" height="16" rx="2"/><path d="M9 21h8a2 2 0 0 0 2-2V8"/><path d="M10.5 9.5c0-1.2 1.8-1.2 2.5 0 .7-1.2 2.5-1.2 2.5 0 0 1.5-2.5 3-2.5 3s-2.5-1.5-2.5-3z" transform="translate(-2 -1)"/>'),
  async run(G) {
    const n = G.n, cols = n <= 4 ? n : Math.ceil(n / 2), rows = Math.ceil(n / cols);
    const pw = Math.min((G.W - 12) / cols - 12, ((G.H - 16) / rows - 10) / 2.25, 120);
    const ph = pw * 1.5, cwid = pw * 0.84, chei = cwid * 1.4, gh = ph + chei * 0.6;
    const SU = ["♠", "♥", "♦", "♣"], RK = { 11: "J", 12: "Q", 13: "K", 14: "A" };
    const ranks = G.shuffle([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]).slice(0, n).sort((a, b) => b - a);
    const rank = G.items.map((m, i) => (i === G.wi ? ranks[0] : null));
    const rest = ranks.slice(1); let k = 0;
    G.items.forEach((m, i) => { if (rank[i] === null) rank[i] = rest[k++]; });
    const suit = G.items.map(() => G.int(4));
    const cellW = (G.W - 12) / cols, cellH = Math.min((G.H - 12) / rows, gh + 26), top0 = (G.H - rows * cellH) / 2;
    const cells = G.items.map((m, i) => {
      const col = i % cols, row = Math.floor(i / cols), inRow = row === rows - 1 ? n - row * cols : cols;
      const off = ((cols - inRow) * cellW) / 2;
      const x = 6 + off + col * cellW + cellW / 2, y = top0 + row * cellH + cellH / 2;
      const py = y - gh / 2 + ph / 2, cy = py + ph / 2 + chei * 0.1, cx = x + pw * 0.2;
      const post = G.card(m, { w: pw, abs: true });
      const g = G.box("cw-card dg-abs", cwid, chei);
      g.style.fontSize = cwid * 0.3 + "px";
      const red = suit[i] === 1 || suit[i] === 2, r = RK[rank[i]] || rank[i];
      g.innerHTML = `<div class="cw-in"><div class="cw-back"></div><div class="cw-front ${red ? "red" : ""}"><b>${r}</b><i>${SU[suit[i]]}</i><u>${SU[suit[i]]}</u></div></div>`;
      G.add(post); G.add(g);
      G.place(post, x, py);
      G.place(g, G.W / 2, G.H + 60, 0.6);
      post.animate([{ opacity: 0, transform: post.style.transform + " scale(.7)" }, { opacity: 1, transform: post.style.transform }], { duration: 420, delay: i * 70, fill: "backwards", easing: "cubic-bezier(.16,1,.3,1)" });
      return { post, g, cx, cy, in: g.querySelector(".cw-in") };
    });
    G.say("Раздаём карты…");
    await G.wait(450 + n * 70);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], sx = G.W / 2, sy = G.H + 60, rot = i % 2 ? 5 : -5;
      await G.anim(240, e => G.place(c.g, dgLerp(sx, c.cx, e), dgLerp(sy, c.cy, e), dgLerp(0.6, 1, e), dgLerp(-25, rot, e)), dgEase.out3);
      G.tick();
    }
    await G.wait(350);
    // порядок открытия: победитель — предпоследний или последний
    const order = G.shuffle(G.items.map((_, i) => i).filter(i => i !== G.wi));
    order.splice(Math.max(0, order.length - G.int(2)), 0, G.wi);
    let best = -1;
    G.say("Открываем…");
    for (const i of order) {
      const c = cells[i];
      await G.fly(c.in, [{ transform: "rotateY(0deg)" }, { transform: "rotateY(180deg)" }], 520, "cubic-bezier(.3,1.3,.5,1)");
      G.thud();
      if (best < 0 || rank[i] > rank[best]) {
        if (best >= 0) cells[best].g.classList.remove("lead");
        best = i; c.g.classList.add("lead");
        G.say(`Лидирует «${G.items[i].title}»`);
      }
      await G.wait(i === G.wi ? 500 : 380);
    }
    cells.forEach((c, i) => { if (i !== G.wi) { c.post.classList.add("dim"); c.g.classList.add("dim"); } });
    G.shine(cells[G.wi].post);
    G.say(G.win.title, "gold");
    await G.wait(1100);
  },
});

/* ---------- Скретч-карты ---------- */
dgReg({
  id: "scratch", name: "Скретч-карты", max: 9, tag: "Сотрите защитный слой — найдите выигрыш",
  icon: dgIcon('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 15l4-4M11 15l4-4M15 15l2-2"/>'),
  async run(G) {
    const n = G.n, cols = n <= 4 ? 2 : 3, rows = Math.ceil(n / cols);
    const tw = Math.min((G.W - 24) / cols - 10, ((G.H - 20) / rows - 10) / 1.5, 112);
    const th = tw * 1.5, cellW = (G.W - 12) / cols, cellH = Math.min((G.H - 12) / rows, th + 16), top0 = (G.H - rows * cellH) / 2;
    const tiles = G.items.map((m, i) => {
      const col = i % cols, row = Math.floor(i / cols), inRow = row === rows - 1 ? n - row * cols : cols;
      const off = ((cols - inRow) * cellW) / 2;
      const t = G.box("sc-tile dg-abs", tw, th);
      t.appendChild(G.card(m, { w: tw }));
      t.insertAdjacentHTML("beforeend", `<div class="sc-cover"><span>?</span></div><div class="sc-coin"></div><div class="sc-mark"></div>`);
      G.add(t);
      G.place(t, 6 + off + col * cellW + cellW / 2, top0 + row * cellH + cellH / 2);
      t.animate([{ opacity: 0, transform: t.style.transform + " scale(.6)" }, { opacity: 1, transform: t.style.transform }], { duration: 420, delay: i * 60, fill: "backwards", easing: "cubic-bezier(.34,1.56,.64,1)" });
      return t;
    });
    G.say("Стираем защитный слой…");
    await G.wait(500 + n * 60);
    const order = G.shuffle(G.items.map((_, i) => i).filter(i => i !== G.wi));
    order.push(G.wi);
    for (let k = 0; k < order.length; k++) {
      const t = tiles[order[k]], last = k === order.length - 1;
      const cover = t.querySelector(".sc-cover"), coin = t.querySelector(".sc-coin");
      const dur = last ? 900 : Math.max(280, 520 - k * 30);
      G.fly(coin, [
        { transform: "translate(0,0)", opacity: 1 }, { transform: `translate(${tw * 0.9}px,${th * 0.2}px)` }, { transform: `translate(${tw * 0.1}px,${th * 0.45}px)` },
        { transform: `translate(${tw * 0.9}px,${th * 0.7}px)` }, { transform: `translate(${tw * 0.1}px,${th * 0.9}px)`, opacity: 1 }, { transform: `translate(${tw * 0.5}px,${th * 1.1}px)`, opacity: 0 },
      ], dur, "linear");
      await G.fly(cover, [{ clipPath: "polygon(0 0,100% 0,100% 100%,0 100%)" }, { clipPath: "polygon(100% 0,100% 0,100% 100%,100% 100%)" }], dur, "ease-in-out");
      G.tick();
      if (last) { t.classList.add("win"); G.thud(); } else { t.classList.add("lose"); }
      await G.wait(last ? 200 : 120);
    }
    G.say(G.win.title, "gold");
    await G.wait(1200);
  },
});

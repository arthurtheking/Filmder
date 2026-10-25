"use strict";

/* ============ Мини-игры дуэли: аркады ============ */

/* ---------- Плинко ---------- */
dgReg({
  id: "plinko", name: "Плинко", max: 9, tag: "Шарик скачет по колышкам",
  icon: dgIcon('<circle cx="12" cy="4" r="1.6"/><circle cx="8" cy="10" r="1"/><circle cx="16" cy="10" r="1"/><circle cx="4.5" cy="16" r="1"/><circle cx="12" cy="16" r="1"/><circle cx="19.5" cy="16" r="1"/><path d="M3 21h18"/>'),
  async run(G) {
    const m = G.n, R = m - 1, dx = Math.min((G.W - 16) / m, 62);
    const pw = Math.min(dx * 0.78, 52), ph = pw * 1.5, bh = ph + 14, top = 30;
    const dy = Math.min((G.H - top - bh - 44) / Math.max(R, 1), 58), cx = G.W / 2;
    const pegY = r => top + 24 + r * dy, pegX = (r, j) => cx + (j - r / 2) * dx;
    const pegs = [];
    for (let r = 0; r < R; r++) for (let j = 0; j <= r; j++) {
      const p = G.html(`<i class="pl-peg" style="left:${pegX(r, j) - 4}px;top:${pegY(r) - 4}px"></i>`);
      pegs[r * 20 + j] = p;
    }
    const by = pegY(R - 1) + dy * 0.9 + bh / 2 + 4;
    const buckets = G.items.map((mv, j) => {
      const b = G.box("pl-bucket dg-abs", dx - 3, bh);
      b.appendChild(G.card(mv, { w: pw }));
      G.add(b); G.place(b, cx + (j - R / 2) * dx, by);
      return b;
    });
    const ball = G.box("pl-ball dg-abs", 16, 16); G.add(ball);
    const dirs = G.shuffle(Array.from({ length: R }, (_, i) => (i < G.wi ? 1 : 0)));
    let x = cx, y = top - 6;
    G.place(ball, x, y);
    G.say("Бросаем шарик!");
    await G.wait(600);
    let k = 0;
    for (let r = 0; r < R; r++) {
      const tx = pegX(r, k), ty = pegY(r) - 10;
      await G.anim(r === 0 ? 420 : 1, e => G.place(ball, dgLerp(x, tx, e), dgLerp(y, ty, e * e)), dgEase.lin);
      x = tx; y = ty;
      const pg = pegs[r * 20 + k]; pg.classList.remove("hit"); void pg.offsetWidth; pg.classList.add("hit");
      G.tick();
      k += dirs[r];
      const nx = pegX(r + 1, k), ny = r + 1 < R ? pegY(r + 1) - 10 : by - bh / 2 - 8;
      const hop = dy * 0.5;
      await G.anim(r + 1 < R ? 300 : 460, (e, p) => G.place(ball, dgLerp(x, nx, p), dgLerp(y, ny, e) - Math.sin(Math.PI * Math.min(1, p * 1.25)) * hop * (1 - p)), r + 1 < R ? dgEase.in2 : dgEase.bounce);
      x = nx; y = ny;
    }
    G.thud();
    buckets.forEach((b, j) => b.classList.add(j === G.wi ? "win" : "dim"));
    G.say(G.win.title, "gold");
    await G.wait(1200);
  },
});

/* ---------- Лототрон ---------- */
dgReg({
  id: "lotto", name: "Лототрон", max: 12, tag: "Шары перемешаны — выпадет один",
  icon: dgIcon('<circle cx="12" cy="11" r="8"/><circle cx="9.5" cy="12" r="1.5"/><circle cx="14.5" cy="9.5" r="1.5"/><circle cx="14" cy="14.5" r="1.5"/><path d="M8 21h8M12 19v2"/>'),
  async run(G) {
    const n = G.n, Rd = Math.min(G.W * 0.4, G.H * 0.3, 160), cx = G.W / 2, cy = G.H * 0.52;
    const rb = dgClamp((Rd * 0.62) / Math.sqrt(Math.max(n, 3)), 13, 24);
    const drum = G.html(`<div class="lt-drum" style="left:${cx - Rd}px;top:${cy - Rd}px;width:${Rd * 2}px;height:${Rd * 2}px"><div class="lt-shine"></div></div>`);
    G.html(`<div class="lt-stand" style="left:${cx - Rd * 0.6}px;top:${cy + Rd - 4}px;width:${Rd * 1.2}px"></div>`);
    const balls = G.items.map((m, i) => {
      const el = document.createElement("div");
      el.className = "lt-ball"; el.style.setProperty("--ring", G.ring(m));
      el.style.cssText = `width:${rb * 2}px;height:${rb * 2}px;background:radial-gradient(circle at 35% 30%, #fff8, ${G.ci(i)} 55%);font-size:${rb * 0.95}px`;
      el.textContent = i + 1;
      drum.appendChild(el);
      const a = Math.random() * 6.28, r = Math.random() * (Rd - rb) * 0.7;
      return { el, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: (Math.random() - 0.5) * 300, vy: (Math.random() - 0.5) * 300, out: false };
    });
    const render = () => balls.forEach(b => { b.el.style.transform = `translate(${(b.x + Rd - rb).toFixed(1)}px,${(b.y + Rd - rb).toFixed(1)}px)`; });
    const step = (dt, stir) => {
      for (const b of balls) {
        if (b.out) continue;
        b.vy += 900 * dt;
        if (stir && b.y > -Rd * 0.1) { b.vy -= (1500 + Math.random() * 1700) * dt; b.vx += (Math.random() - 0.5) * 1400 * dt; }
        b.x += b.vx * dt; b.y += b.vy * dt;
        const d = Math.hypot(b.x, b.y), lim = Rd - rb - 2;
        if (d > lim) {
          const nx = b.x / d, ny = b.y / d, vn = b.vx * nx + b.vy * ny;
          b.x = nx * lim; b.y = ny * lim;
          if (vn > 0) { b.vx -= 1.8 * vn * nx; b.vy -= 1.8 * vn * ny; }
        }
      }
      for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], b = balls[j];
        if (a.out || b.out) continue;
        const ddx = b.x - a.x, ddy = b.y - a.y, d = Math.hypot(ddx, ddy), min = rb * 2;
        if (d < min && d > 0.001) {
          const nx = ddx / d, ny = ddy / d, ov = (min - d) / 2;
          a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (vn < 0) { const j2 = -(1.9 * vn) / 2; a.vx -= j2 * nx; a.vy -= j2 * ny; b.vx += j2 * nx; b.vy += j2 * ny; }
        }
      }
    };
    G.say("Перемешиваем шары…");
    let acc = 0;
    const sim = (secs, stir) => G.loop((dt, t) => {
      acc += dt;
      while (acc > 1 / 120) { step(1 / 120, stir); acc -= 1 / 120; }
      render();
      if (stir && Math.floor(t * 12) % 2 === 0) G.tick();
      return t >= secs;
    });
    await sim(3.8, true);
    G.say("Выпадает шар…");
    await sim(1.1, false);
    const w = balls[G.wi];
    w.out = true;
    w.el.style.zIndex = 5; w.el.classList.add("pick");
    const sx = w.x, sy = w.y, tx = 0, ty = -Rd - rb * 1.6;
    const others = balls.filter(b => b !== w);
    G.loop(() => { step(1 / 60, false); render(); return false; }); // остальные шары продолжают катиться
    await G.anim(1100, (e) => {
      w.x = dgLerp(sx, tx, e); w.y = dgLerp(sy, ty, e) - Math.sin(e * Math.PI) * 0;
      w.el.style.transform = `translate(${(w.x + Rd - rb).toFixed(1)}px,${(w.y + Rd - rb).toFixed(1)}px) scale(${1 + e * 0.5})`;
    }, dgEase.io);
    G.thud();
    others.forEach(b => b.el.classList.add("dim"));
    const pw = Math.min(G.W * 0.4, 150);
    const card = G.card(G.win, { w: pw, abs: true });
    G.add(card);
    card.style.zIndex = 9;
    const bx = cx, by = cy + ty;
    await G.anim(650, e => G.place(card, dgLerp(bx, cx, e), dgLerp(by, G.H * 0.5, e), dgLerp(0.2, 1, e), dgLerp(-30, 0, e)), dgEase.back);
    w.el.style.opacity = 0;
    G.shine(card);
    G.say(`Шар № ${G.wi + 1}: ${G.win.title}`, "gold");
    await G.wait(1200);
  },
});

/* ---------- Кран-машина ---------- */
dgReg({
  id: "claw", name: "Кран-машина", max: 8, tag: "Клешня вытащит приз",
  icon: dgIcon('<path d="M12 3v8M6 11h12M8 11c-1 3 0 6 2 8M16 11c1 3 0 6-2 8"/><path d="M4 3h16"/>'),
  async run(G) {
    const W = G.W, H = Math.min(G.H, 470), oy = (G.H - H) / 2, n = G.n, padL = 62;
    const box = G.html(`<div class="cl-box" style="width:${W}px;height:${H}px;top:${oy}px"><i class="cl-rail"></i><div class="cl-chute"><span>ПРИЗ</span></div></div>`);
    box.style.position = "absolute"; box.style.left = "0";
    const avail = W - padL - 12, cw = Math.min(avail / n - 5, 58), ch = cw * 1.5;
    const floorY = H - 12, py = floorY - ch / 2, xs = i => padL + 4 + (avail / n) * (i + 0.5);
    const cards = G.items.map((m, i) => {
      const c = G.card(m, { w: cw, abs: true }); box.appendChild(c);
      G.place(c, xs(i), py, 1, (i % 2 ? 2 : -2));
      c.animate([{ opacity: 0, transform: c.style.transform + " translateY(-20px)" }, { opacity: 1, transform: c.style.transform }], { duration: 400, delay: i * 60, fill: "backwards" });
      return c;
    });
    const cable = document.createElement("i"), head = G.box("cl-head dg-abs", 44, 40);
    cable.className = "cl-cable";
    head.innerHTML = '<u class="l"></u><u class="r"></u><b></b>';
    box.appendChild(cable); box.appendChild(head);
    let hx = W / 2, hy = 44;
    const setClaw = () => {
      G.place(head, hx, hy + 14);
      cable.style.transform = `translateX(${hx - 1}px)`; cable.style.height = hy + "px";
    };
    setClaw();
    const go = (x, y, ms, carry, ease = dgEase.io) => {
      const x0 = hx, y0 = hy;
      return G.anim(ms, e => { hx = dgLerp(x0, x, e); hy = dgLerp(y0, y, e); setClaw(); if (carry) carry(); }, ease);
    };
    const grabY = i => py - ch / 2 - 22;
    await G.wait(700 + n * 50);
    G.say("Целимся…");
    // попытка 1 — мимо
    const d = (G.wi + 1 + G.int(n - 1)) % n;
    await go(xs(d), 44, 900);
    await go(xs(d), grabY(d), 800);
    head.classList.add("closed");
    await G.wait(380);
    const cd = cards[d], carry = () => G.place(cd, hx, hy + 22 + ch / 2, 1, Math.sin(hy / 20) * 3);
    await go(xs(d), grabY(d) - ch * 0.5, 650, carry, dgEase.out3);
    head.classList.remove("closed");
    G.say("Сорвалось!");
    const fy = hy + 22 + ch / 2;
    G.anim(520, e => G.place(cd, xs(d), dgLerp(fy, py, e), 1, dgLerp(4, i2r(d), e)), dgEase.bounce);
    await go(xs(d), 44, 600);
    // попытка 2 — приз
    await G.wait(250);
    G.say("Ещё одна попытка…");
    await go(xs(G.wi), 44, 900);
    await go(xs(G.wi), grabY(G.wi), 800);
    head.classList.add("closed");
    await G.wait(400);
    const cw2 = cards[G.wi], carry2 = () => G.place(cw2, hx, hy + 22 + ch / 2, 1, Math.sin(hy / 18) * 3);
    cw2.style.zIndex = 4;
    await go(xs(G.wi), 44, 1000, carry2, dgEase.out3);
    G.thud();
    await go(30, 44, 1100, carry2);
    head.classList.remove("closed");
    const chuteY = floorY - 30;
    const drop0 = hy + 22 + ch / 2;
    await G.anim(650, e => G.place(cw2, 30, dgLerp(drop0, chuteY, e), dgLerp(1, 0.8, e), 0), dgEase.bounce);
    G.thud();
    G.say(G.win.title, "gold");
    G.shine(cw2);
    cards.forEach((c, i) => { if (i !== G.wi) c.classList.add("dim"); });
    await G.wait(1300);
    function i2r(i) { return i % 2 ? 2 : -2; }
  },
});

/* ---------- Дартс ---------- */
dgReg({
  id: "darts", name: "Дартс", min: 3, max: 14, tag: "Метим в нужный сектор",
  icon: dgIcon('<circle cx="11" cy="13" r="7"/><circle cx="11" cy="13" r="3"/><path d="m14 10 7-7M17 3h4v4"/>'),
  async run(G) {
    const S = Math.min(G.W - 8, G.H - 8, 420), R = S * 0.46, cx = S / 2, cy = S / 2, n = G.n, seg = (Math.PI * 2) / n;
    const P = (r, a) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
    const ca = i => -Math.PI / 2 + i * seg;
    const wedge = (i, r0, r1) => {
      const a0 = ca(i) - seg / 2, a1 = ca(i) + seg / 2;
      return `M${P(r0, a0)}L${P(r1, a0)}A${r1} ${r1} 0 0 1 ${P(r1, a1)}L${P(r0, a1)}A${r0} ${r0} 0 0 0 ${P(r0, a0)}Z`;
    };
    let svg = `<svg class="dt-board" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"><circle cx="${cx}" cy="${cy}" r="${R * 1.1}" fill="#0b0d12" stroke="#d4af37" stroke-width="2"/>`;
    for (let i = 0; i < n; i++) {
      svg += `<g class="dt-w" data-i="${i}"><path d="${wedge(i, R * 0.18, R * 0.93)}" fill="${i % 2 ? "#1a1f2b" : "#e9e2cf"}"/>
        <path d="${wedge(i, R * 0.93, R)}" fill="${i % 2 ? "#d9413d" : "#2bb673"}"/></g>`;
    }
    svg += `<circle cx="${cx}" cy="${cy}" r="${R * 0.18}" fill="#2bb673"/><circle cx="${cx}" cy="${cy}" r="${R * 0.08}" fill="#d9413d"/></svg>`;
    const wrap = G.html(`<div class="dt-wrap" style="width:${S}px;height:${S}px">${svg}</div>`);
    const ws = wrap.querySelectorAll(".dt-w");
    const tr = R * 0.6, tw = Math.min(R * 0.34, 2 * tr * Math.sin(seg / 2) * 0.82);
    const thumbs = G.items.map((m, i) => {
      const t = document.createElement("div");
      t.className = "dt-thumb"; t.style.setProperty("--ring", G.ring(m));
      const src = G.src(m);
      t.style.cssText = `width:${tw}px;height:${tw}px;left:${cx + Math.cos(ca(i)) * tr - tw / 2}px;top:${cy + Math.sin(ca(i)) * tr - tw / 2}px;${src ? `background-image:url(${src})` : `background:${G.ci(i)}`}`;
      wrap.appendChild(t);
      t.animate([{ opacity: 0, transform: "scale(.4)" }, { opacity: 1, transform: "none" }], { duration: 400, delay: i * 40, fill: "backwards", easing: "cubic-bezier(.34,1.56,.64,1)" });
      return t;
    });
    // дротики
    const DH = 56;
    const dartSvg = '<svg viewBox="0 0 16 56" width="16" height="56"><path d="M8 0 10 22H6z" fill="#cfd5df"/><rect x="5.5" y="22" width="5" height="18" rx="2" fill="#f1f1f4"/><path d="M8 38 15 56H8zM8 38 1 56H8z" fill="var(--user-accent)"/><path d="M8 38v18" stroke="#0007"/></svg>';
    const throwDart = async (tx, ty, ms) => {
      const d = G.box("dt-dart dg-abs", 16, DH, dartSvg);
      d.style.zIndex = 8; wrap.appendChild(d);
      const sx = cx + (Math.random() - 0.5) * 60, sy = S + 50;
      await G.anim(ms, (e, p) => G.place(d, dgLerp(sx, tx, e) + Math.sin(p * 9) * (1 - p) * 4, dgLerp(sy, ty + DH / 2 - 2, e), dgLerp(2, 1, e), dgLerp(-10, 0, e)), dgEase.out3);
      G.thud();
      d.animate([{ transform: d.style.transform + " rotate(-5deg)" }, { transform: d.style.transform + " rotate(4deg)" }, { transform: d.style.transform }], { duration: 380, easing: "ease-out" });
      return d;
    };
    const decoys = G.shuffle(G.items.map((_, i) => i).filter(i => i !== G.wi)).slice(0, n >= 4 ? 2 : 1);
    G.say("Разминка…");
    await G.wait(800);
    const msgs = ["Мимо!", "Почти!"];
    for (let k = 0; k < decoys.length; k++) {
      G.say(`Бросок ${k + 1}…`);
      await G.wait(350);
      const i = decoys[k], a = ca(i) + (Math.random() - 0.5) * seg * 0.5, r = R * (0.35 + Math.random() * 0.55);
      await throwDart(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 640);
      G.say(msgs[k]);
      await G.wait(600);
    }
    G.say("Последний бросок…");
    await G.wait(650);
    const a = ca(G.wi) + (G.rng() - 0.5) * seg * 0.15;
    await throwDart(cx + Math.cos(a) * tr, cy + Math.sin(a) * tr, 760);
    ws.forEach((w, i) => w.classList.toggle("win", i === G.wi));
    wrap.classList.add("done");
    thumbs.forEach((t, i) => t.classList.toggle(i === G.wi ? "win" : "dim", true));
    G.say(G.win.title, "gold");
    await G.wait(1300);
  },
});

/* ---------- Силомер ---------- */
dgReg({
  id: "striker", name: "Силомер", max: 6, tag: "Кто ударит сильнее — позвонит в колокол",
  icon: dgIcon('<path d="M14 4 20 10 10 20 4 14zM4 14l-1 6 6-1"/><path d="m14 4-2-2M20 10l2 2"/>'),
  async run(G) {
    const n = G.n, cw = Math.min((G.W - 24) / n - 8, 54), ch = cw * 1.5;
    const yT = 56, yB = G.H - ch - 64, cx = G.W / 2;
    const tower = G.html(`<div class="st-tower" style="left:${cx - 14}px;top:${yT}px;height:${yB - yT}px"><i></i></div>`);
    let ticks = "";
    for (let k = 0; k <= 10; k++) ticks += `<em style="top:${yT + ((yB - yT) * (10 - k)) / 10}px"><b>${k * 10}</b></em>`;
    G.html(`<div class="st-ticks">${ticks}</div>`);
    const bell = G.html(`<div class="st-bell" style="left:${cx - 20}px;top:${yT - 46}px">${dgIcon('<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21a2 2 0 0 0 4 0"/>')}</div>`);
    const puck = G.box("st-puck dg-abs", 26, 26); G.add(puck); G.place(puck, cx, yB - 4);
    const mallet = G.html(`<div class="st-mallet" style="left:${cx - 86}px;top:${yB - 12}px"><i></i><b></b></div>`);
    const row = G.items.map((m, i) => {
      const c = G.card(m, { w: cw, abs: true });
      G.add(c); G.place(c, (G.W / n) * (i + 0.5), G.H - ch / 2 - 30);
      const sc = G.html(`<div class="st-score" style="left:${(G.W / n) * (i + 0.5) - 20}px;top:${G.H - 26}px"></div>`);
      return { c, sc };
    });
    const scores = G.items.map((_, i) => (i === G.wi ? 100 : 22 + Math.floor(G.rng() * 68)));
    const others = G.shuffle(G.items.map((_, i) => i).filter(i => i !== G.wi));
    others.splice(others.length - G.int(2), 0, G.wi);
    if (others.length > n) others.length = n;
    const order = others;
    const rec = G.box("st-rec dg-abs", 28, 42); rec.style.opacity = 0; G.add(rec);
    let best = -1;
    G.say("Кто сильнее?");
    await G.wait(600);
    for (const i of order) {
      const { c, sc } = row[i], s = scores[i];
      G.say(`Бьёт «${G.items[i].title}»`);
      c.classList.add("turn");
      await G.wait(320);
      G.fly(mallet, [{ transform: "rotate(-60deg)" }, { transform: "rotate(14deg)", offset: 0.6 }, { transform: "rotate(0deg)" }], 420, "cubic-bezier(.5,0,.3,1)");
      await G.wait(160);
      G.thud();
      const y1 = yB - 4 - ((yB - yT) * s) / 100;
      await G.anim(380 + s * 6, e => G.place(puck, cx, dgLerp(yB - 4, y1, e)), dgEase.out3);
      sc.textContent = s; sc.classList.add("on");
      if (s === 100) {
        bell.classList.add("ring"); G.thud(); G.say("ДЗЫНЬ! Колокол!", "gold");
        await G.wait(700);
      } else {
        if (best < 0 || s > scores[best]) {
          best = i;
          const rc = G.card(G.items[i], { w: 24 }); rec.innerHTML = ""; rec.appendChild(rc);
          G.place(rec, cx + 36, y1); rec.style.opacity = 1;
        }
        await G.anim(300, e => G.place(puck, cx, dgLerp(y1, yB - 4, e)), dgEase.in2);
        await G.wait(100);
      }
      c.classList.remove("turn");
      c.classList.toggle("dim", s !== 100);
    }
    G.shine(row[G.wi].c);
    G.say(G.win.title, "gold");
    await G.wait(1200);
  },
});

/* ---------- Лесенка (амидакудзи) ---------- */
dgReg({
  id: "ladder", name: "Лесенка", max: 7, tag: "Идём по ступенькам до приза",
  icon: dgIcon('<path d="M6 3v18M18 3v18M6 8h12M6 14h12"/>'),
  async run(G) {
    const n = G.n, padX = 26, gx = (G.W - padX * 2) / Math.max(n - 1, 1), cw = Math.min(gx * 0.78, 56), ch = cw * 1.5;
    const yTop = 52, yBot = G.H - ch - 30, rows = 9, ry = r => yTop + 18 + ((yBot - yTop - 36) * (r + 0.5)) / rows;
    const colX = j => padX + j * gx;
    const rungs = Array.from({ length: rows }, () => []);
    for (let r = 0; r < rows; r++) for (let j = 0; j < n - 1; j++) if (Math.random() < 0.5 && !rungs[r].includes(j - 1)) rungs[r].push(j);
    const start = G.int(n);
    // маршрут
    const pts = [[colX(start), yTop]];
    let col = start;
    for (let r = 0; r < rows; r++) {
      pts.push([colX(col), ry(r)]);
      if (rungs[r].includes(col)) { col++; pts.push([colX(col), ry(r)]); }
      else if (rungs[r].includes(col - 1)) { col--; pts.push([colX(col), ry(r)]); }
    }
    pts.push([colX(col), yBot]);
    const end = col;
    // призы: победитель внизу под колонкой end
    const rest = G.shuffle(G.others());
    const prizes = Array.from({ length: n }, (_, j) => (j === end ? G.win : rest.pop() || G.win));
    let svg = `<svg class="ld-svg" width="${G.W}" height="${G.H}" viewBox="0 0 ${G.W} ${G.H}">`;
    for (let j = 0; j < n; j++) svg += `<line x1="${colX(j)}" y1="${yTop}" x2="${colX(j)}" y2="${yBot}" class="ld-line"/>`;
    rungs.forEach((rs, r) => rs.forEach(j => { svg += `<line x1="${colX(j)}" y1="${ry(r)}" x2="${colX(j + 1)}" y2="${ry(r)}" class="ld-line"/>`; }));
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
    svg += `<path id="ld-path" d="${d}" class="ld-path"/></svg>`;
    G.html(svg);
    const path = G.el.querySelector("#ld-path"), len = path.getTotalLength();
    path.style.strokeDasharray = len; path.style.strokeDashoffset = len;
    for (let j = 0; j < n; j++) {
      const t = G.html(`<div class="ld-token ${j === start ? "me" : ""}" style="left:${colX(j) - 14}px;top:${yTop - 36}px;--c:${G.ci(j)}">${j + 1}</div>`);
      t.animate([{ opacity: 0, transform: "translateY(-12px)" }, { opacity: 1, transform: "none" }], { duration: 350, delay: j * 50, fill: "backwards" });
    }
    const cards = prizes.map((m, j) => {
      const c = G.card(m, { w: cw, abs: true }); G.add(c); G.place(c, colX(j), yBot + ch / 2 + 8);
      const cap = G.html(`<div class="ld-cover" style="left:${colX(j) - cw / 2}px;top:${yBot + 8}px;width:${cw}px;height:${ch}px"><span>?</span></div>`);
      return { c, cap };
    });
    const dot = G.box("ld-dot dg-abs", 16, 16); G.add(dot); G.place(dot, pts[0][0], pts[0][1]);
    G.say(`Стартуем с № ${start + 1}`);
    await G.wait(1000);
    G.say("Спускаемся по лесенке…");
    let lastSeg = 0;
    await G.anim(5200, (e) => {
      path.style.strokeDashoffset = len * (1 - e);
      const p = path.getPointAtLength(len * e);
      G.place(dot, p.x, p.y);
      const sg = Math.floor(e * pts.length * 2); if (sg !== lastSeg) { lastSeg = sg; G.tick(); }
    }, dgEase.io);
    G.thud();
    cards.forEach(({ c, cap }, j) => { cap.classList.add("off"); if (j !== end) c.classList.add("dim"); });
    await G.wait(450);
    G.shine(cards[end].c);
    G.say(G.win.title, "gold");
    await G.wait(1300);
  },
});

/* ---------- Горячие клетки ---------- */
dgReg({
  id: "grid", name: "Горячие клетки", max: 20, tag: "Свет прыгает по постерам",
  icon: dgIcon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  async run(G) {
    const n = G.n, cols = n <= 3 ? n : n <= 8 ? 3 : n <= 12 ? 4 : 5, rows = Math.ceil(n / cols);
    const cw = Math.min((G.W - 20) / cols - 8, ((G.H - 20) / rows - 8) / 1.5, 110), ch = cw * 1.5;
    const cellW = (G.W - 12) / cols, cellH = Math.min((G.H - 12) / rows, ch + 12), top0 = (G.H - rows * cellH) / 2;
    const pos = i => { const col = i % cols, row = Math.floor(i / cols), inRow = row === rows - 1 ? n - row * cols : cols; return [6 + ((cols - inRow) * cellW) / 2 + col * cellW + cellW / 2, top0 + row * cellH + cellH / 2]; };
    const cards = G.items.map((m, i) => {
      const c = G.card(m, { w: cw, abs: true }); G.add(c); const [x, y] = pos(i); G.place(c, x, y);
      c.animate([{ opacity: 0, transform: c.style.transform + " scale(.5)" }, { opacity: 1, transform: c.style.transform }], { duration: 380, delay: i * 35, fill: "backwards", easing: "cubic-bezier(.34,1.56,.64,1)" });
      return c;
    });
    const hl = G.box("gh-hl dg-abs", cw + 12, ch + 12); G.add(hl);
    G.place(hl, ...pos(0)); hl.style.opacity = 0;
    G.say("Свет выбирает…");
    await G.wait(500 + n * 35);
    const L = 24 + G.int(6), seq = [];
    let prev = -1;
    for (let k = 0; k < L - 1; k++) { let i; do { i = G.int(n); } while (i === prev); seq.push(i); prev = i; }
    if (prev === G.wi) seq[seq.length - 1] = (G.wi + 1) % n;
    seq.push(G.wi);
    hl.style.opacity = 1;
    for (let k = 0; k < seq.length; k++) {
      const [x, y] = pos(seq[k]);
      G.place(hl, x, y);
      cards.forEach((c, i) => c.classList.toggle("hot", i === seq[k]));
      G.tick();
      await G.wait(55 + 0.32 * k * k);
    }
    G.thud();
    cards.forEach((c, i) => { if (i !== G.wi) c.classList.add("dim"); });
    hl.classList.add("done");
    G.shine(cards[G.wi]);
    G.say(G.win.title, "gold");
    await G.wait(1200);
  },
});

/* ---------- Киноплёнка ---------- */
dgReg({
  id: "reel", name: "Киноплёнка", tag: "Кадр на метке — наш фильм",
  icon: dgIcon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
  async run(G) {
    const fw = Math.min(G.W * 0.46, 150), fh = fw * 1.5, gap = 14, pitch = fw + gap, cy = G.H / 2;
    const loops = Math.max(3, Math.ceil(26 / G.n)), seq = [];
    for (let l = 0; l < loops; l++) G.items.forEach((m) => seq.push(m));
    const target = (loops - 1) * G.n + G.wi;
    const strip = G.html(`<div class="rl-strip" style="top:${cy - fh / 2 - 22}px;height:${fh + 44}px;width:${seq.length * pitch + 40}px"></div>`);
    seq.forEach((m, i) => {
      const f = document.createElement("div");
      f.className = "rl-frame"; f.style.cssText = `left:${20 + i * pitch}px;width:${fw}px;height:${fh + 44}px`;
      f.innerHTML = '<i></i><i></i><i></i><i></i>';
      f.appendChild(G.card(m, { w: fw }));
      strip.appendChild(f);
    });
    G.html(`<div class="rl-mark" style="left:${G.W / 2 - fw / 2 - 8}px;top:${cy - fh / 2 - 30}px;width:${fw + 16}px;height:${fh + 60}px"></div>`);
    const jitter = (G.rng() - 0.5) * fw * 0.3;
    const x0 = G.W / 2 - (20 + fw / 2), x1 = G.W / 2 - (20 + target * pitch + fw / 2) + jitter;
    strip.style.transform = `translateX(${x0}px)`;
    G.say("Крутим плёнку…");
    await G.wait(500);
    let last = -1;
    await G.anim(6500, e => {
      const x = dgLerp(x0, x1, e);
      strip.style.transform = `translateX(${x}px)`;
      const k = Math.round((x0 - x) / pitch); if (k !== last) { last = k; G.tick(); }
    }, dgEase.out5);
    G.thud();
    await G.anim(300, e => { strip.style.transform = `translateX(${dgLerp(x1, x1 - jitter, e)}px)`; }, dgEase.out2);
    strip.querySelectorAll(".dg-card").forEach((c, i) => { if (i !== target) c.classList.add("dim"); else G.shine(c); });
    G.say(G.win.title, "gold");
    await G.wait(1200);
  },
});

/* ---------- Совпадение (служебная сцена: фильм выбрали несколько игроков) ---------- */
dgReg({
  id: "match", name: "Совпадение!", special: true, min: 1, max: 20, tag: "Один и тот же фильм выбрали сразу несколько",
  icon: dgIcon('<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.6 4.5 6.4 4.5c2.2 0 3.6 1.2 4.6 2.7h2c1-1.5 2.4-2.7 4.6-2.7 3.8 0 5.5 3.9 4 7.3C19.5 16.4 12 21 12 21z"/>'),
  async run(G) {
    const pl = G.players, big = Math.min(G.W * 0.4, 150), mx = G.W / 2, my = G.H / 2 - 10;
    const hit = m => m.id === G.win.id;
    if (pl.length <= 2) {
      // два игрока: два «веера» — слева и справа, совпавший фильм летит к центру с обеих сторон
      const lists = pl.map(p => G.all.filter(m => m.owners.includes(p.slot)));
      const cw = dgClamp(Math.min((G.H - 80) / 5 / 1.5 - 4, 46), 22, 46), ch = cw * 1.5;
      const colX = (side, c) => (side === 0 ? G.W * 0.14 : G.W * 0.86) + (c - 0.5) * (cw + 6) * (side === 0 ? 1 : -1);
      const rowY = r => 60 + r * (ch + 8) + ch / 2;
      G.html(`<div class="mt-label" style="left:${G.W * 0.14 - 10}px">${esc(pl[0] ? pl[0].name : "")}</div><div class="mt-label them" style="left:${G.W * 0.86 - 40}px">${esc(pl[1] ? pl[1].name : "")}</div>`);
      const A = [], B = [];
      lists.forEach((list, side) => list.forEach((m, i) => {
        const c = G.card(m, { w: cw, abs: true }); G.add(c);
        G.place(c, colX(side, i % 2), rowY(Math.floor(i / 2)));
        c.animate([{ opacity: 0, transform: c.style.transform + " scale(.4)" }, { opacity: 1, transform: c.style.transform }], { duration: 400, delay: i * 70 + side * 40, fill: "backwards", easing: "cubic-bezier(.34,1.56,.64,1)" });
        (side ? B : A).push({ c, m, i });
      }));
      G.say("Сравниваем выборы…");
      await G.wait(900 + Math.max(...lists.map(l => l.length), 1) * 70);
      [...A, ...B].forEach(x => { if (!hit(x.m)) x.c.classList.add("dim"); });
      G.tick();
      await G.wait(800);
      const a = A.find(x => hit(x.m)) || A[0], b = B.find(x => hit(x.m)) || B[0] || A[0];
      a.c.style.zIndex = 5; b.c.style.zIndex = 4;
      const ax = colX(0, a.i % 2), ay = rowY(Math.floor(a.i / 2)), bx = colX(1, b.i % 2), by = rowY(Math.floor(b.i / 2));
      await Promise.all([
        G.anim(1000, e => G.place(a.c, dgLerp(ax, mx - 6, e), dgLerp(ay, my, e), dgLerp(1, big / cw, e), dgLerp(0, -4, e)), dgEase.io),
        G.anim(1000, e => G.place(b.c, dgLerp(bx, mx + 6, e), dgLerp(by, my, e), dgLerp(1, big / cw, e), dgLerp(0, 4, e)), dgEase.io),
      ]);
      if (b !== a) b.c.style.opacity = 0;
      G.shine(a.c);
    } else {
      // группа: все выбранные фильмы разложены сеткой; совпавший выезжает в центр
      const n = G.all.length, cols = n <= 12 ? 4 : n <= 24 ? 6 : 8, rows = Math.ceil(n / cols);
      const cw = Math.min((G.W - 16) / cols - 6, ((G.H - 16) / rows - 6) / 1.5, 64), ch = cw * 1.5;
      const cellW = (G.W - 12) / cols, cellH = Math.min((G.H - 12) / rows, ch + 8), top0 = (G.H - rows * cellH) / 2;
      let win;
      const cards = G.all.map((m, i) => {
        const col = i % cols, row = Math.floor(i / cols), inRow = row === rows - 1 ? n - row * cols : cols;
        const x = 6 + ((cols - inRow) * cellW) / 2 + col * cellW + cellW / 2, y = top0 + row * cellH + cellH / 2;
        const c = G.card(m, { w: cw, abs: true }); G.add(c); G.place(c, x, y);
        c.animate([{ opacity: 0, transform: c.style.transform + " scale(.4)" }, { opacity: 1, transform: c.style.transform }], { duration: 380, delay: i * 25, fill: "backwards", easing: "cubic-bezier(.34,1.56,.64,1)" });
        if (hit(m)) win = { c, x, y, cw };
        return c;
      });
      G.say("Ищем общий фильм…");
      await G.wait(900 + n * 25);
      cards.forEach(c => { if (c !== win.c) c.classList.add("dim"); });
      G.tick();
      await G.wait(800);
      win.c.style.zIndex = 5;
      await G.anim(1000, e => G.place(win.c, dgLerp(win.x, mx, e), dgLerp(win.y, my, e), dgLerp(1, big / win.cw, e), 0), dgEase.io);
      G.shine(win.c);
      const names = G.ownerNames(G.win);
      G.html(`<div class="mt-owners" style="top:${my + big * 0.75 + 12}px">${names.map(n2 => `<span>${esc(n2)}</span>`).join("")}</div>`);
    }
    G.thud();
    G.html('<div class="mt-flash"></div>');
    G.say("СОВПАДЕНИЕ!", "gold");
    await G.wait(1500);
  },
});

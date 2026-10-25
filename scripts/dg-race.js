"use strict";

/* ============ Мини-игры дуэли: забеги ============ */
// Общий движок: у каждого участника своя «скорость с шумом», нормированная так, чтобы победитель
// пришёл первым. Перед финишем время замедляется (слоу-мо), на финише — фотофиниш.
async function dgRace(G, cfg) {
  const n = G.n, V = !!cfg.vertical;
  G.html(`<div class="rc-track ${cfg.cls}"></div>`);
  let lane, cw, ch, pos, fin;
  if (!V) {
    lane = Math.min((G.H - 30) / n, 92); ch = Math.min(lane - 6, 84); cw = ch / 1.5;
    const x0 = 52, x1 = G.W - 38, top = (G.H - lane * n) / 2;
    pos = (i, p) => [x0 + (x1 - x0) * p, top + lane * (i + 0.5)];
    G.items.forEach((m, i) => G.html(`<div class="rc-lane" style="left:0;right:0;top:${top + lane * i}px;height:${lane}px"><b>${i + 1}</b></div>`));
    G.html(`<div class="rc-finish h" style="left:${x1 + cw / 2 + 2}px;top:${top}px;height:${lane * n}px"></div>`);
  } else {
    lane = Math.min((G.W - 16) / n, 80); cw = Math.min(lane - 8, 60); ch = cw * 1.5;
    const y0 = G.H - ch / 2 - 30, y1 = ch / 2 + 40, left = (G.W - lane * n) / 2;
    pos = (i, p) => [left + lane * (i + 0.5), y0 - (y0 - y1) * p];
    G.items.forEach((m, i) => G.html(`<div class="rc-lane v" style="top:0;bottom:0;left:${left + lane * i}px;width:${lane}px"><b>${i + 1}</b></div>`));
    G.html(`<div class="rc-finish v" style="top:${y1 - ch / 2 - 8}px;left:${left}px;width:${lane * n}px"></div>`);
  }
  const Tw = cfg.dur;
  const prm = G.items.map((m, i) => {
    const gap = i === G.wi ? 0 : 0.3 + G.rng() * 1.3;
    return { T: Tw + gap, a1: 0.32, w1: 1.2 + G.rng() * 1.4, f1: G.rng() * 6.28, a2: 0.18, w2: 3 + G.rng() * 2, f2: G.rng() * 6.28 };
  });
  // самый близкий соперник — почти фотофиниш
  const others = prm.map((p, i) => i).filter(i => i !== G.wi);
  if (others.length) prm[others[G.int(others.length)]].T = Tw + 0.12;
  const F = (p, t) => t + (p.a1 / p.w1) * (Math.cos(p.f1) - Math.cos(p.w1 * t + p.f1)) + (p.a2 / p.w2) * (Math.cos(p.f2) - Math.cos(p.w2 * t + p.f2));
  const prog = (i, t) => { const p = prm[i], tt = Math.min(t, p.T); return F(p, tt) / F(p, p.T); };
  const runners = G.items.map((m, i) => {
    const b = G.box("rc-run dg-abs", cw, ch);
    b.appendChild(G.card(m, { w: cw }));
    if (cfg.deco) cfg.deco(b, i, { cw, ch, G });
    G.add(b); G.place(b, ...pos(i, 0));
    b.animate([{ opacity: 0, transform: b.style.transform + " scale(.5)" }, { opacity: 1, transform: b.style.transform }], { duration: 400, delay: i * 50, fill: "backwards" });
    return b;
  });
  await G.wait(500 + n * 50);
  for (const s of ["3", "2", "1"]) { G.say(s, "gold"); G.tick(); await G.wait(500); }
  G.say(cfg.go || "Старт!", "gold"); G.thud();
  let rt = 0, leader = -1, lastSay = 0;
  await G.loop((dt, t) => {
    let mx = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, prog(i, rt));
    rt += dt * (mx > 0.88 && rt < Tw ? 0.4 : 1);
    let best = 0, bi = 0;
    for (let i = 0; i < n; i++) {
      const p = prog(i, rt), [x, y] = pos(i, p);
      if (p > best) { best = p; bi = i; }
      const run = p < 1;
      if (!V) G.place(runners[i], x, y + (run && cfg.bob !== 0 ? Math.sin(t * (cfg.bob || 16) + i * 1.7) * 2.2 : 0), 1, run && cfg.tilt ? Math.sin(t * 9 + i) * cfg.tilt : 0);
      else G.place(runners[i], x + (run && cfg.sway ? Math.sin(t * 2.2 + i * 1.3) * cfg.sway : 0), y, 1, run && cfg.sway ? Math.sin(t * 2.2 + i * 1.3 + 1) * 4 : 0);
      if (cfg.trail) cfg.trail(runners[i], p);
    }
    if (bi !== leader && t - lastSay > 0.6) { leader = bi; lastSay = t; G.say(`Лидирует «${G.items[bi].title}»`); }
    G.tick();
    return rt >= Tw;
  });
  G.thud();
  G.html('<div class="rc-flash"></div>');
  G.say("ФИНИШ!", "gold");
  // остальные добегают
  const rt0 = rt;
  await G.anim(1100, (e) => {
    for (let i = 0; i < n; i++) { const [x, y] = pos(i, prog(i, rt0 + e * 1.1)); G.place(runners[i], x, y); }
  }, dgEase.out2);
  runners.forEach((r, i) => { const c = r.querySelector(".dg-card"); if (i === G.wi) G.shine(c); else c.classList.add("dim"); });
  G.say(G.win.title, "gold");
  await G.wait(1200);
}

const dgFlame = (b, i, o) => { b.insertAdjacentHTML("beforeend", '<i class="rc-flame"></i>'); };

dgReg({
  id: "horses", name: "Скачки", max: 10, tag: "Кто первым пересечёт финиш",
  icon: dgIcon('<path d="M4 20h16M6 20V9l4-4h4l4 4v11M10 5V3"/><path d="M9 13h6"/>'),
  run: G => dgRace(G, { cls: "horses", dur: 6, tilt: 3, bob: 18, deco: (b, i, o) => b.insertAdjacentHTML("beforeend", '<i class="rc-dust"></i>') }),
});
dgReg({
  id: "swim", name: "Заплыв", max: 10, tag: "Дорожки, брызги и финиш",
  icon: dgIcon('<path d="M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2.5-1.5 4.5-1.5S19 17 21 17M3 21c2 0 2-1.5 4.5-1.5S10 21 12 21s2.5-1.5 4.5-1.5S19 21 21 21"/><circle cx="14" cy="6" r="2"/><path d="m6 14 4-4 4 1 3 3"/>'),
  run: G => dgRace(G, { cls: "swim", dur: 6.5, bob: 9, tilt: 2, deco: b => b.insertAdjacentHTML("beforeend", '<i class="rc-wave"></i>') }),
});
dgReg({
  id: "rockets", name: "Ракеты", max: 10, vertical: true, tag: "Взлёт к луне наперегонки",
  icon: dgIcon('<path d="M12 2c3 2 5 6 5 10l-2 3H9l-2-3c0-4 2-8 5-10zM9 15l-2 4 3-1M15 15l2 4-3-1"/><circle cx="12" cy="9" r="1.5"/>'),
  run: G => dgRace(G, { cls: "rockets", vertical: true, dur: 6, sway: 2, go: "Пуск!", deco: dgFlame }),
});
dgReg({
  id: "snails", name: "Улиточные бега", max: 8, tag: "Медленно, но верно",
  icon: dgIcon('<path d="M3 19h17M5 19c-1-6 2-11 8-11 4 0 6 3 6 6s-2 5-5 5"/><path d="M10 14a2.5 2.5 0 1 1 5 0M5 12V8M3 12V9"/>'),
  run: G => dgRace(G, { cls: "snails", dur: 6.5, bob: 5, deco: b => b.insertAdjacentHTML("beforeend", '<i class="rc-snail"></i>') }),
});
dgReg({
  id: "balloons", name: "Воздушные шары", max: 10, vertical: true, tag: "Чей шар поднимется выше",
  icon: dgIcon('<ellipse cx="12" cy="9" rx="6" ry="7"/><path d="M12 16v2l-1.5 3M12 18l1.5 3"/>'),
  run: G => dgRace(G, { cls: "balloons", vertical: true, dur: 7, sway: 5, go: "Отпускаем!", deco: (b, i) => b.insertAdjacentHTML("beforeend", `<i class="rc-balloon" style="--b:${DG_COLORS[(i * 5) % DG_COLORS.length]}"></i>`) }),
});

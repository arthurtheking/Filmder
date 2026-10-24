// Правила комнаты дуэли. Чистая логика без зависимостей — легко тестировать.
export const LIMIT = 10;
const rndDefault = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;

export function shuffle(a, rnd = rndDefault) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Клиенту не доверяем: берём только известные поля и режем длину
export function cleanMovie(m) {
  if (!m || !Number.isInteger(m.id) || m.id <= 0) return null;
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  return {
    id: m.id, title: str(m.title, 120), orig: str(m.orig, 120), year: str(m.year, 4),
    rating: Math.max(0, Math.min(10, +m.rating || 0)),
    poster: /^\/[\w.-]+\.(jpg|png|webp)$/.test(m.poster || "") ? m.poster : null,
    runtime: Math.max(0, Math.min(1000, +m.runtime || 0)),
    genres: Array.isArray(m.genres) ? m.genres.slice(0, 5).map(g => str(g, 30)) : [],
  };
}

// Победитель выбирается на сервере. Совпавшие у обоих фильмы побеждают сразу (match);
// иначе сначала случайный игрок, потом случайный фильм из его списка — шансы людей равны
export function finishRound(s, rnd = rndDefault) {
  const byId = new Map();
  s.order.forEach((pid, slot) => s.players[pid].picks.forEach(m => {
    const e = byId.get(m.id) || Object.assign({}, m, { owners: [] });
    e.owners.push(slot);
    byId.set(m.id, e);
  }));
  const pool = shuffle([...byId.values()], rnd);
  const common = pool.filter(m => m.owners.length === 2);
  let win, match = false;
  if (common.length) { win = common[rnd(common.length)]; match = true; }
  else {
    const slot = rnd(2);
    const mine = pool.filter(m => m.owners[0] === slot);
    win = mine[rnd(mine.length)];
  }
  s.phase = "result";
  s.result = { winnerId: win.id, match, pool, seed: rnd(1_000_000_000), game: "carousel" };
}

// true — состояние изменилось
export function applyMessage(s, pid, msg) {
  const p = s.players[pid];
  if (!p || !msg) return false;
  if (msg.t === "again") {
    if (s.phase !== "result") return false;
    s.order.forEach(id => { s.players[id].picks = []; s.players[id].done = false; });
    s.phase = "picking"; s.result = null; s.round++;
    return true;
  }
  if (s.phase !== "picking") return false;
  if (msg.t === "pick") {
    const m = cleanMovie(msg.movie);
    if (!m || p.done || p.picks.length >= LIMIT || p.picks.some(x => x.id === m.id)) return false;
    p.picks.push(m);
    return true;
  }
  if (msg.t === "unpick") {
    if (p.done) return false;
    const n = p.picks.length;
    p.picks = p.picks.filter(x => x.id !== msg.id);
    return p.picks.length !== n;
  }
  if (msg.t === "done") {
    const v = !!msg.v;
    if ((v && !p.picks.length) || p.done === v) return false;
    p.done = v;
    if (s.order.length === 2 && s.order.every(id => s.players[id].done)) finishRound(s);
    return true;
  }
  return false;
}

export function viewFor(s, pid, onlineOf) {
  const me = s.players[pid];
  const otherPid = s.order.find(x => x !== pid);
  const o = otherPid && s.players[otherPid];
  return {
    t: "state", phase: s.phase, round: s.round, limit: LIMIT, you: s.order.indexOf(pid),
    me: { picks: me.picks, done: me.done },
    other: o ? { count: o.picks.length, done: o.done, online: onlineOf(otherPid) } : null,
    result: s.phase === "result" ? s.result : null, // чужие фильмы раскрываются только в результате
  };
}

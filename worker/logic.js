// Правила комнаты дуэли. Чистая логика без зависимостей — легко тестировать.
export const LIMIT = 10;          // слотов у игрока в дуэли на двоих
export const MAX_PLAYERS = 6;
export const limitFor = n => (n <= 2 ? 10 : n <= 4 ? 6 : 5);   // чем больше игроков, тем меньше слотов — пул остаётся разумным
// Игры, которые умеет показывать клиент (scripts/dg-*.js). «match» сюда не входит: клиент включает его сам, когда фильм выбрали несколько игроков.
export const GAMES = ["slots", "roulette", "fortune", "dice", "shells", "cardwar", "scratch", "plinko", "lotto", "claw", "darts", "striker", "ladder", "grid", "reel",
  "horses", "swim", "rockets", "snails", "balloons", "meteors", "sniper", "bubbles", "snap", "bowling", "bomb", "coin", "rps", "draw", "tug"];
export const TARGETS = [0, 2, 3, 5];   // «первый до N побед»; 0 — без серии
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

export const cleanName = v => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16) : "");
export const cleanStake = v => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) : "");

// Подтверждённый клиентом реплей: оставляем только известные поля
export function cleanReplay(b) {
  if (!b || typeof b !== "object" || !Array.isArray(b.pool) || !b.pool.length || b.pool.length > 70) return null;
  const pool = [];
  for (const m of b.pool) {
    const c = cleanMovie(m);
    const owners = Array.isArray(m && m.owners) ? [...new Set(m.owners.filter(x => Number.isInteger(x) && x >= 0 && x < MAX_PLAYERS))] : [];
    if (!c || !owners.length) return null;
    c.owners = owners; pool.push(c);
  }
  if (!pool.some(m => m.id === b.winnerId)) return null;
  const game = typeof b.game === "string" && /^[a-z]{2,16}$/.test(b.game) ? b.game : "carousel";
  const players = (Array.isArray(b.players) ? b.players : []).slice(0, MAX_PLAYERS).map((p, i) => ({ slot: i, name: cleanName(p && p.name) || `Игрок ${i + 1}` }));
  return {
    v: 1, winnerId: b.winnerId, match: !!b.match, pool, game, seed: Number.isInteger(b.seed) ? Math.abs(b.seed) % 1_000_000_000 : 1,
    players, stake: cleanStake(b.stake), round: Math.max(1, Math.min(999, +b.round || 1)),
    wins: Array.isArray(b.wins) ? b.wins.slice(0, MAX_PLAYERS).map(x => Math.max(0, Math.min(99, +x || 0))) : [],
    seriesWinners: Array.isArray(b.seriesWinners) ? b.seriesWinners.filter(x => Number.isInteger(x) && x >= 0 && x < MAX_PLAYERS) : [],
  };
}

// Победитель выбирается на сервере.
// Фильм, который выбрали сразу несколько игроков, побеждает (чем больше владельцев — тем приоритетнее).
// Иначе: сначала случайный игрок, потом случайный фильм из его списка — шансы людей равны.
export function finishRound(s, rnd = rndDefault) {
  const byId = new Map();
  s.order.forEach((pid, slot) => s.players[pid].picks.forEach(m => {
    const e = byId.get(m.id) || Object.assign({}, m, { owners: [] });
    e.owners.push(slot);
    byId.set(m.id, e);
  }));
  const pool = shuffle([...byId.values()], rnd);
  const maxOwn = pool.reduce((a, m) => Math.max(a, m.owners.length), 0);
  let win, match = false;
  if (maxOwn >= 2) {
    const top = pool.filter(m => m.owners.length === maxOwn);
    win = top[rnd(top.length)]; match = true;
  } else {
    const slots = s.order.map((pid, i) => i).filter(i => s.players[s.order[i]].picks.length);
    const slot = slots[rnd(slots.length)];
    const mine = pool.filter(m => m.owners[0] === slot);
    win = mine[rnd(mine.length)];
  }
  // счёт серии: победа — каждому, чей фильм выбран
  s.wins = s.wins || {};
  win.owners.forEach(slot => { const id = s.order[slot]; s.wins[id] = (s.wins[id] || 0) + 1; });
  const wins = s.order.map(id => s.wins[id] || 0);
  const seriesWinners = s.target ? wins.map((w, i) => (w >= s.target ? i : -1)).filter(i => i >= 0) : [];
  s.phase = "result";
  s.result = { winnerId: win.id, match, pool, seed: rnd(1_000_000_000), game: GAMES[rnd(GAMES.length)], wins, seriesWinners };
}

// true — состояние изменилось
export function applyMessage(s, pid, msg) {
  const p = s.players[pid];
  if (!p || !msg) return false;
  const isHost = s.order[0] === pid;

  if (msg.t === "name") { const n = cleanName(msg.name); if (n === (p.name || "")) return false; p.name = n; return true; }
  if (msg.t === "cfg") {
    if (!isHost) return false;
    const stake = msg.stake === undefined ? s.stake : cleanStake(msg.stake);
    const target = msg.target === undefined ? s.target : (TARGETS.includes(msg.target) ? msg.target : s.target);
    if (stake === s.stake && target === s.target) return false;
    s.stake = stake; s.target = target;
    return true;
  }
  if (msg.t === "leave") {
    if (s.phase !== "lobby") return false;
    delete s.players[pid]; s.order = s.order.filter(x => x !== pid);
    return true;
  }
  if (msg.t === "start") {
    if (!isHost || s.phase !== "lobby" || s.order.length < 2) return false;
    s.phase = "picking"; s.limit = limitFor(s.order.length);
    return true;
  }
  if (msg.t === "again") {
    if (s.phase !== "result") return false;
    if (s.result && s.result.seriesWinners && s.result.seriesWinners.length) s.wins = {}; // серия сыграна — счёт с нуля
    s.order.forEach(id => { s.players[id].picks = []; s.players[id].done = false; });
    s.phase = "picking"; s.result = null; s.round++;
    return true;
  }
  if (s.phase !== "picking") return false;
  if (msg.t === "finish") { // ведущий завершает раунд, не дожидаясь отставших
    const active = s.order.filter(id => s.players[id].picks.length);
    if (!isHost || active.length < 2) return false;
    finishRound(s);
    return true;
  }
  const limit = s.limit || LIMIT;
  if (msg.t === "pick") {
    const m = cleanMovie(msg.movie);
    if (!m || p.done || p.picks.length >= limit || p.picks.some(x => x.id === m.id)) return false;
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
    if (s.order.length >= 2 && s.order.every(id => s.players[id].done)) finishRound(s);
    return true;
  }
  return false;
}

export function viewFor(s, pid, onlineOf) {
  const me = s.players[pid], slot = s.order.indexOf(pid);
  return {
    t: "state", phase: s.phase, round: s.round, limit: s.limit || LIMIT, you: slot, host: slot === 0,
    players: s.order.map((id, i) => ({ slot: i, name: s.players[id].name || `Игрок ${i + 1}`, count: s.players[id].picks.length, done: s.players[id].done, online: onlineOf(id), wins: (s.wins && s.wins[id]) || 0 })),
    me: { picks: me.picks, done: me.done },
    stake: s.stake || "", target: s.target || 0,
    result: s.phase === "result" ? s.result : null, // чужие фильмы раскрываются только в результате
  };
}

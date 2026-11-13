var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// logic.js
var LIMIT = 10;
var MAX_PLAYERS = 6;
var limitFor = /* @__PURE__ */ __name((n) => n <= 2 ? 10 : n <= 4 ? 6 : 5, "limitFor");
var GAMES = [
  "slots",
  "roulette",
  "fortune",
  "dice",
  "shells",
  "cardwar",
  "scratch",
  "plinko",
  "lotto",
  "claw",
  "darts",
  "striker",
  "ladder",
  "grid",
  "reel",
  "horses",
  "swim",
  "rockets",
  "snails",
  "balloons",
  "meteors",
  "sniper",
  "bubbles",
  "snap",
  "bowling",
  "bomb",
  "coin",
  "rps",
  "draw",
  "tug"
];
var TARGETS = [0, 2, 3, 5];
var rndDefault = /* @__PURE__ */ __name((n) => crypto.getRandomValues(new Uint32Array(1))[0] % n, "rndDefault");
function shuffle(a, rnd = rndDefault) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
__name(shuffle, "shuffle");
function cleanMovie(m) {
  if (!m || !Number.isInteger(m.id) || m.id <= 0) return null;
  const str = /* @__PURE__ */ __name((v, n) => typeof v === "string" ? v.slice(0, n) : "", "str");
  return {
    id: m.id,
    title: str(m.title, 120),
    orig: str(m.orig, 120),
    year: str(m.year, 4),
    rating: Math.max(0, Math.min(10, +m.rating || 0)),
    poster: /^\/[\w.@-]+\.(jpg|png|webp)$/.test(m.poster || "") ? m.poster : null,
    runtime: Math.max(0, Math.min(1e3, +m.runtime || 0)),
    genres: Array.isArray(m.genres) ? m.genres.slice(0, 5).map((g) => str(g, 30)) : []
  };
}
__name(cleanMovie, "cleanMovie");
var cleanName = /* @__PURE__ */ __name((v) => typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16) : "", "cleanName");
var cleanStake = /* @__PURE__ */ __name((v) => typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) : "", "cleanStake");
function cleanReplay(b) {
  if (!b || typeof b !== "object" || !Array.isArray(b.pool) || !b.pool.length || b.pool.length > 70) return null;
  const pool = [];
  for (const m of b.pool) {
    const c = cleanMovie(m);
    const owners = Array.isArray(m && m.owners) ? [...new Set(m.owners.filter((x) => Number.isInteger(x) && x >= 0 && x < MAX_PLAYERS))] : [];
    if (!c || !owners.length) return null;
    c.owners = owners;
    pool.push(c);
  }
  if (!pool.some((m) => m.id === b.winnerId)) return null;
  const game = typeof b.game === "string" && /^[a-z]{2,16}$/.test(b.game) ? b.game : "carousel";
  const players = (Array.isArray(b.players) ? b.players : []).slice(0, MAX_PLAYERS).map((p, i) => ({ slot: i, name: cleanName(p && p.name) || `\u0418\u0433\u0440\u043E\u043A ${i + 1}` }));
  return {
    v: 1,
    winnerId: b.winnerId,
    match: !!b.match,
    pool,
    game,
    seed: Number.isInteger(b.seed) ? Math.abs(b.seed) % 1e9 : 1,
    players,
    stake: cleanStake(b.stake),
    round: Math.max(1, Math.min(999, +b.round || 1)),
    wins: Array.isArray(b.wins) ? b.wins.slice(0, MAX_PLAYERS).map((x) => Math.max(0, Math.min(99, +x || 0))) : [],
    seriesWinners: Array.isArray(b.seriesWinners) ? b.seriesWinners.filter((x) => Number.isInteger(x) && x >= 0 && x < MAX_PLAYERS) : []
  };
}
__name(cleanReplay, "cleanReplay");
function finishRound(s, rnd = rndDefault) {
  const byId = /* @__PURE__ */ new Map();
  s.order.forEach((pid, slot) => s.players[pid].picks.forEach((m) => {
    const e = byId.get(m.id) || Object.assign({}, m, { owners: [] });
    e.owners.push(slot);
    byId.set(m.id, e);
  }));
  const pool = shuffle([...byId.values()], rnd);
  const maxOwn = pool.reduce((a, m) => Math.max(a, m.owners.length), 0);
  let win, match = false;
  if (maxOwn >= 2) {
    const top = pool.filter((m) => m.owners.length === maxOwn);
    win = top[rnd(top.length)];
    match = true;
  } else {
    const slots = s.order.map((pid, i) => i).filter((i) => s.players[s.order[i]].picks.length);
    const slot = slots[rnd(slots.length)];
    const mine = pool.filter((m) => m.owners[0] === slot);
    win = mine[rnd(mine.length)];
  }
  s.wins = s.wins || {};
  win.owners.forEach((slot) => {
    const id = s.order[slot];
    s.wins[id] = (s.wins[id] || 0) + 1;
  });
  const wins = s.order.map((id) => s.wins[id] || 0);
  const seriesWinners = s.target ? wins.map((w, i) => w >= s.target ? i : -1).filter((i) => i >= 0) : [];
  s.phase = "result";
  s.result = { winnerId: win.id, match, pool, seed: rnd(1e9), game: GAMES[rnd(GAMES.length)], wins, seriesWinners };
}
__name(finishRound, "finishRound");
function applyMessage(s, pid, msg) {
  const p = s.players[pid];
  if (!p || !msg) return false;
  const isHost = s.order[0] === pid;
  if (msg.t === "name") {
    const n = cleanName(msg.name);
    if (n === (p.name || "")) return false;
    p.name = n;
    return true;
  }
  if (msg.t === "cfg") {
    if (!isHost) return false;
    const stake = msg.stake === void 0 ? s.stake : cleanStake(msg.stake);
    const target = msg.target === void 0 ? s.target : TARGETS.includes(msg.target) ? msg.target : s.target;
    if (stake === s.stake && target === s.target) return false;
    s.stake = stake;
    s.target = target;
    return true;
  }
  if (msg.t === "leave") {
    if (s.phase !== "lobby") return false;
    delete s.players[pid];
    s.order = s.order.filter((x) => x !== pid);
    return true;
  }
  if (msg.t === "start") {
    if (!isHost || s.phase !== "lobby" || s.order.length < 2) return false;
    s.phase = "picking";
    s.limit = limitFor(s.order.length);
    return true;
  }
  if (msg.t === "again") {
    if (s.phase !== "result") return false;
    if (s.result && s.result.seriesWinners && s.result.seriesWinners.length) s.wins = {};
    s.order.forEach((id) => {
      s.players[id].picks = [];
      s.players[id].done = false;
    });
    s.phase = "picking";
    s.result = null;
    s.round++;
    return true;
  }
  if (s.phase !== "picking") return false;
  if (msg.t === "finish") {
    const active = s.order.filter((id) => s.players[id].picks.length);
    if (!isHost || active.length < 2) return false;
    finishRound(s);
    return true;
  }
  const limit = s.limit || LIMIT;
  if (msg.t === "pick") {
    const m = cleanMovie(msg.movie);
    if (!m || p.done || p.picks.length >= limit || p.picks.some((x) => x.id === m.id)) return false;
    p.picks.push(m);
    return true;
  }
  if (msg.t === "unpick") {
    if (p.done) return false;
    const n = p.picks.length;
    p.picks = p.picks.filter((x) => x.id !== msg.id);
    return p.picks.length !== n;
  }
  if (msg.t === "done") {
    const v = !!msg.v;
    if (v && !p.picks.length || p.done === v) return false;
    p.done = v;
    if (s.order.length >= 2 && s.order.every((id) => s.players[id].done)) finishRound(s);
    return true;
  }
  return false;
}
__name(applyMessage, "applyMessage");
function viewFor(s, pid, onlineOf) {
  const me = s.players[pid], slot = s.order.indexOf(pid);
  return {
    t: "state",
    phase: s.phase,
    round: s.round,
    limit: s.limit || LIMIT,
    you: slot,
    host: slot === 0,
    players: s.order.map((id, i) => ({ slot: i, name: s.players[id].name || `\u0418\u0433\u0440\u043E\u043A ${i + 1}`, count: s.players[id].picks.length, done: s.players[id].done, online: onlineOf(id), wins: s.wins && s.wins[id] || 0 })),
    me: { picks: me.picks, done: me.done },
    stake: s.stake || "",
    target: s.target || 0,
    result: s.phase === "result" ? s.result : null
    // чужие фильмы раскрываются только в результате
  };
}
__name(viewFor, "viewFor");

// room.js
import { DurableObject } from "cloudflare:workers";
var TTL = 6 * 3600 * 1e3;
var Room = class extends DurableObject {
  static {
    __name(this, "Room");
  }
  load() {
    return this.ctx.storage.get("s").then((s) => s || null);
  }
  online(pid) {
    return this.ctx.getWebSockets(pid).length > 0;
  }
  async broadcast() {
    const s = await this.load();
    if (!s) return;
    for (const ws of this.ctx.getWebSockets()) {
      const pid = this.ctx.getTags(ws)[0];
      if (!s.players[pid]) continue;
      try {
        ws.send(JSON.stringify(viewFor(s, pid, (p) => this.online(p))));
      } catch {
      }
    }
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/init") {
      if (await this.load()) return new Response("", { status: 409 });
      await this.ctx.storage.put("s", { phase: "lobby", players: {}, order: [], round: 1, result: null, stake: "", target: 0, wins: {}, limit: 10 });
      await this.ctx.storage.setAlarm(Date.now() + TTL);
      return new Response("ok");
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const reject = /* @__PURE__ */ __name((code) => {
      server.accept();
      server.send(JSON.stringify({ t: "error", code }));
      server.close(1e3, code);
      return new Response(null, { status: 101, webSocket: client });
    }, "reject");
    const s = await this.load();
    if (!s) return reject("none");
    const pid = url.searchParams.get("pid") || "";
    if (!/^[a-f0-9]{32}$/.test(pid)) return reject("pid");
    if (!s.players[pid]) {
      if (s.phase !== "lobby") return reject("started");
      if (s.order.length >= MAX_PLAYERS) return reject("full");
      s.players[pid] = { picks: [], done: false, name: cleanName(url.searchParams.get("name") || "") };
      s.order.push(pid);
      await this.ctx.storage.put("s", s);
    }
    this.ctx.acceptWebSocket(server, [pid]);
    await this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > 4e3) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const s = await this.load();
    if (!s) return;
    if (applyMessage(s, this.ctx.getTags(ws)[0], msg)) await this.ctx.storage.put("s", s);
    await this.broadcast();
  }
  async webSocketClose(ws) {
    try {
      ws.close();
    } catch {
    }
    await this.broadcast();
  }
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1e3, "expired");
      } catch {
      }
    }
    await this.ctx.storage.deleteAll();
  }
};

// index.js
var TMDB = "https://api.themoviedb.org/3";
var TMDB_OK = /^\/(genre\/movie\/list|discover\/movie|movie\/\d+)$/;
var SYNC_ID = /^[a-f0-9]{32}$/;
var MAX_BODY = 1e6;
var index_default = {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const list = (env.ALLOWED_ORIGIN || "*").split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
    const any = list.includes("*");
    const allowed = any ? "*" : list.includes(origin) ? origin : list[0];
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...any ? {} : { "Vary": "Origin" }
    };
    const reply = /* @__PURE__ */ __name((body, status = 200, extra = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...cors, ...extra }
    }), "reply");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!any && origin && !list.includes(origin)) return reply({ error: "origin" }, 403);
    const url = new URL(req.url);
    if (url.pathname === "/room" && req.method === "POST") {
      const ab = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      for (let i = 0; i < 5; i++) {
        const r = crypto.getRandomValues(new Uint8Array(5));
        const code = [...r].map((x) => ab[x % ab.length]).join("");
        const res = await env.ROOM.get(env.ROOM.idFromName(code)).fetch("https://room/init");
        if (res.status === 200) return reply({ code });
      }
      return reply({ error: "busy" }, 503);
    }
    const rm = url.pathname.match(/^\/room\/([A-Z2-9]{5})\/ws$/);
    if (rm) {
      if (req.headers.get("Upgrade") !== "websocket") return reply({ error: "ws" }, 426);
      return env.ROOM.get(env.ROOM.idFromName(rm[1])).fetch(req);
    }
    if (url.pathname === "/replay" && req.method === "POST") {
      const text = await req.text();
      if (text.length > 3e4) return reply({ error: "too big" }, 413);
      let b;
      try {
        b = JSON.parse(text);
      } catch {
        return reply({ error: "json" }, 400);
      }
      const clean = cleanReplay(b);
      if (!clean) return reply({ error: "shape" }, 400);
      const ab = "abcdefghjkmnpqrstuvwxyz23456789";
      const id = [...crypto.getRandomValues(new Uint8Array(8))].map((x) => ab[x % ab.length]).join("");
      await env.SYNC.put("r:" + id, JSON.stringify(clean), { expirationTtl: 30 * 86400 });
      return reply({ id });
    }
    const rp = url.pathname.match(/^\/replay\/([a-z0-9]{8})$/);
    if (rp && req.method === "GET") {
      const cur = await env.SYNC.get("r:" + rp[1]);
      return cur ? reply(cur, 200, { "Cache-Control": "public, max-age=3600" }) : reply({ error: "none" }, 404);
    }
    if (url.pathname.startsWith("/tmdb/")) {
      const path = url.pathname.slice(5);
      if (req.method !== "GET" || !TMDB_OK.test(path)) return reply({ error: "not allowed" }, 403);
      const target = new URL(TMDB + path);
      url.searchParams.forEach((v, k) => {
        if (k !== "api_key") target.searchParams.set(k, v);
      });
      const tok = (env.TMDB_TOKEN || "").trim();
      const headers = {};
      if (tok.startsWith("eyJ")) headers.Authorization = "Bearer " + tok;
      else target.searchParams.set("api_key", tok);
      const res = await fetch(target, {
        headers,
        cf: { cacheEverything: true, cacheTtl: 3600 }
      });
      return new Response(res.body, {
        status: res.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600", ...cors }
      });
    }
    const m = url.pathname.match(/^\/sync\/([a-f0-9]+)$/);
    if (m && SYNC_ID.test(m[1])) {
      const key = "s:" + m[1];
      if (req.method === "GET") {
        const cur = await env.SYNC.get(key);
        return cur ? reply(cur, 200, { "Cache-Control": "no-store" }) : reply({ error: "none" }, 404);
      }
      if (req.method === "PUT") {
        const text = await req.text();
        if (text.length > MAX_BODY) return reply({ error: "too big" }, 413);
        let b;
        try {
          b = JSON.parse(text);
        } catch {
          return reply({ error: "json" }, 400);
        }
        if (!b || typeof b.rev !== "number" || !b.data || !Array.isArray(b.data.liked) || !Array.isArray(b.data.watched))
          return reply({ error: "shape" }, 400);
        const curRaw = await env.SYNC.get(key);
        const curRev = curRaw ? JSON.parse(curRaw).rev : 0;
        if (curRev !== (b.base || 0)) return reply({ error: "conflict" }, 409);
        await env.SYNC.put(key, JSON.stringify({ rev: b.rev, data: b.data }));
        return reply({ ok: true });
      }
    }
    if (url.pathname === "/license/verify" && req.method === "POST") {
      const text = await req.text();
      let b;
      try {
        b = JSON.parse(text);
      } catch {
        return reply({ error: "json" }, 400);
      }
      const userId = b.userId;
      if (!userId || typeof userId !== "string") return reply({ error: "userId required" }, 400);
      const licenseKey = "license:" + userId;
      const license = await env.SYNC.get(licenseKey);
      if (!license) return reply({ pro: false });
      try {
        const lic = JSON.parse(license);
        const now = Date.now();
        const isValid = lic.type === "lifetime" || lic.expires && lic.expires > now;
        return reply({ pro: isValid, type: lic.type, expires: lic.expires || null });
      } catch {
        return reply({ pro: false });
      }
    }
    if (url.pathname === "/stripe/checkout" && req.method === "POST") {
      const secretKey = (env.STRIPE_SECRET_KEY || "").trim();
      if (!secretKey) return reply({ error: "stripe not configured" }, 500);
      const text = await req.text();
      let b;
      try {
        b = JSON.parse(text);
      } catch {
        return reply({ error: "json" }, 400);
      }
      const userId = b.userId;
      const mode = b.mode || "payment";
      if (!userId || typeof userId !== "string") return reply({ error: "userId required" }, 400);
      const priceId = mode === "subscription" ? env.STRIPE_PRICE_SUBSCRIPTION || "" : env.STRIPE_PRICE_LIFETIME || "";
      if (!priceId) return reply({ error: "price not configured" }, 500);
      const origin2 = req.headers.get("Origin") || "";
      const successUrl = `${origin2}/?pro=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin2}/?pro=cancel`;
      const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          "mode": mode,
          "success_url": successUrl,
          "cancel_url": cancelUrl,
          "customer_email": b.email || void 0,
          "metadata[userId]": userId,
          "line_items[0][price]": priceId,
          "line_items[0][quantity]": "1"
        }).toString()
      });
      const session = await stripeRes.json();
      if (!stripeRes.ok) {
        return reply({ error: session.error?.message || "stripe error" }, 400);
      }
      return reply({ url: session.url, sessionId: session.id });
    }
    if (url.pathname === "/stripe/portal" && req.method === "POST") {
      const secretKey = (env.STRIPE_SECRET_KEY || "").trim();
      if (!secretKey) return reply({ error: "stripe not configured" }, 500);
      const text = await req.text();
      let b;
      try {
        b = JSON.parse(text);
      } catch {
        return reply({ error: "json" }, 400);
      }
      const userId = b.userId;
      if (!userId || typeof userId !== "string") return reply({ error: "userId required" }, 400);
      const licenseKey = "license:" + userId;
      const license = await env.SYNC.get(licenseKey);
      let customerId = null;
      if (license) {
        try {
          const lic = JSON.parse(license);
          customerId = lic.stripeCustomerId;
        } catch {
        }
      }
      if (!customerId) return reply({ error: "no customer" }, 404);
      const origin2 = req.headers.get("Origin") || "";
      const returnUrl = `${origin2}/`;
      const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          "customer": customerId,
          "return_url": returnUrl
        }).toString()
      });
      const session = await portalRes.json();
      if (!portalRes.ok) {
        return reply({ error: session.error?.message || "stripe error" }, 400);
      }
      return reply({ url: session.url });
    }
    if (url.pathname === "/stripe/webhook" && req.method === "POST") {
      const sig = req.headers.get("stripe-signature");
      const webhookSecret = (env.STRIPE_WEBHOOK_SECRET || "").trim();
      if (!webhookSecret) return reply({ error: "webhook not configured" }, 500);
      const body = await req.text();
      let event;
      try {
        event = JSON.parse(body);
      } catch {
        return reply({ error: "invalid payload" }, 400);
      }
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const customerId = session.customer;
        if (userId && customerId) {
          const licenseKey = "license:" + userId;
          if (session.mode === "payment") {
            await env.SYNC.put(licenseKey, JSON.stringify({ type: "lifetime", stripeCustomerId: customerId, created: Date.now() }));
          } else if (session.mode === "subscription") {
            const subscription = await fetch(`https://api.stripe.com/v1/subscriptions/${session.subscription}`, {
              headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
            }).then((r) => r.json());
            await env.SYNC.put(licenseKey, JSON.stringify({
              type: "pro",
              expires: (subscription.current_period_end || 0) * 1e3,
              stripeCustomerId: customerId,
              stripeSubscriptionId: session.subscription
            }));
          }
        }
      } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;
        const customerId = subscription.customer;
      }
      return reply({ received: true });
    }
    return reply({ error: "not found" }, 404);
  }
};

// C:/Users/barda/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// C:/Users/barda/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-k1tvFr/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// C:/Users/barda/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-k1tvFr/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  Room,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map

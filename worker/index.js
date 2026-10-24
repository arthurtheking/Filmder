export { Room } from "./room.js";

// Filmder proxy + sync. Секреты: TMDB_TOKEN. KV: SYNC. Переменная: ALLOWED_ORIGIN.
const TMDB = "https://api.themoviedb.org/3";
const TMDB_OK = /^\/(genre\/movie\/list|discover\/movie|movie\/\d+)$/;
const SYNC_ID = /^[a-f0-9]{32}$/;
const MAX_BODY = 1_000_000;

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const reply = (body, status = 200, extra = {}) =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status, headers: { "Content-Type": "application/json", ...cors, ...extra },
      });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    // Браузеры с чужих сайтов отсекаются; прямые запросы без Origin (curl) проходят — защита от случайного, не от целенаправленного
    if (allowed !== "*" && origin && origin !== allowed) return reply({ error: "origin" }, 403);

    const url = new URL(req.url);

    // --- Дуэль ---
    if (url.pathname === "/room" && req.method === "POST") {
      const ab = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      for (let i = 0; i < 5; i++) {
        const r = crypto.getRandomValues(new Uint8Array(5));
        const code = [...r].map(x => ab[x % ab.length]).join("");
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

    // --- TMDB ---
    if (url.pathname.startsWith("/tmdb/")) {
      const path = url.pathname.slice(5);
      if (req.method !== "GET" || !TMDB_OK.test(path)) return reply({ error: "not allowed" }, 403);
      const target = new URL(TMDB + path);
      url.searchParams.forEach((v, k) => { if (k !== "api_key") target.searchParams.set(k, v); });
      const res = await fetch(target, {
        headers: { Authorization: "Bearer " + env.TMDB_TOKEN },
        cf: { cacheEverything: true, cacheTtl: 3600 },
      });
      return new Response(res.body, {
        status: res.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600", ...cors },
      });
    }

    // --- Синхронизация ---
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
        try { b = JSON.parse(text); } catch { return reply({ error: "json" }, 400); }
        if (!b || typeof b.rev !== "number" || !b.data || !Array.isArray(b.data.liked) || !Array.isArray(b.data.watched))
          return reply({ error: "shape" }, 400);
        const curRaw = await env.SYNC.get(key);
        const curRev = curRaw ? JSON.parse(curRaw).rev : 0;
        if (curRev !== (b.base || 0)) return reply({ error: "conflict" }, 409);
        await env.SYNC.put(key, JSON.stringify({ rev: b.rev, data: b.data }));
        return reply({ ok: true });
      }
    }
    return reply({ error: "not found" }, 404);
  },
};

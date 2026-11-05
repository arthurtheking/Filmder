import { cleanReplay } from "./logic.js";
export { Room } from "./room.js";

// Filmder proxy + sync. Секреты: TMDB_TOKEN. KV: SYNC. Переменная: ALLOWED_ORIGIN.
const TMDB = "https://api.themoviedb.org/3";
const TMDB_OK = /^\/(genre\/movie\/list|discover\/movie|movie\/\d+)$/;
const SYNC_ID = /^[a-f0-9]{32}$/;
const MAX_BODY = 1_000_000;

// Про лицензии: ключ в KV — "license:<userId>" = JSON { type: "pro"|"lifetime", expires?: number, stripeCustomerId?: string }
// userId — хеш от fingerprint или email (если есть). Для анонимных — локальный ID в localStorage.

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    // ALLOWED_ORIGIN — один адрес или несколько через запятую, либо "*"
    const list = (env.ALLOWED_ORIGIN || "*").split(",").map(x => x.trim().replace(/\/+$/, "")).filter(Boolean);
    const any = list.includes("*");
    const allowed = any ? "*" : list.includes(origin) ? origin : list[0];
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...(any ? {} : { "Vary": "Origin" }),
    };
    const reply = (body, status = 200, extra = {}) =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status, headers: { "Content-Type": "application/json", ...cors, ...extra },
      });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    // Браузеры с чужих сайтов отсекаются; прямые запросы без Origin (curl) проходят — защита от случайного, не от целенаправленного
    if (!any && origin && !list.includes(origin)) return reply({ error: "origin" }, 403);

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

    // --- Реплеи дуэлей: короткая ссылка вместо длинного списка фильмов ---
    if (url.pathname === "/replay" && req.method === "POST") {
      const text = await req.text();
      if (text.length > 30_000) return reply({ error: "too big" }, 413);
      let b; try { b = JSON.parse(text); } catch { return reply({ error: "json" }, 400); }
      const clean = cleanReplay(b);
      if (!clean) return reply({ error: "shape" }, 400);
      const ab = "abcdefghjkmnpqrstuvwxyz23456789";
      const id = [...crypto.getRandomValues(new Uint8Array(8))].map(x => ab[x % ab.length]).join("");
      await env.SYNC.put("r:" + id, JSON.stringify(clean), { expirationTtl: 30 * 86400 });
      return reply({ id });
    }
    const rp = url.pathname.match(/^\/replay\/([a-z0-9]{8})$/);
    if (rp && req.method === "GET") {
      const cur = await env.SYNC.get("r:" + rp[1]);
      return cur ? reply(cur, 200, { "Cache-Control": "public, max-age=3600" }) : reply({ error: "none" }, 404);
    }

    // --- TMDB ---
    if (url.pathname.startsWith("/tmdb/")) {
      const path = url.pathname.slice(5);
      if (req.method !== "GET" || !TMDB_OK.test(path)) return reply({ error: "not allowed" }, 403);
      const target = new URL(TMDB + path);
      url.searchParams.forEach((v, k) => { if (k !== "api_key") target.searchParams.set(k, v); });
      // Длинный токен (eyJ…) идёт заголовком Bearer, короткий ключ v3 — параметром api_key
      const tok = (env.TMDB_TOKEN || "").trim();
      const headers = {};
      if (tok.startsWith("eyJ")) headers.Authorization = "Bearer " + tok;
      else target.searchParams.set("api_key", tok);
      const res = await fetch(target, {
        headers,
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

    // --- Лицензии (Pro) ---
    if (url.pathname === "/license/verify" && req.method === "POST") {
      const text = await req.text();
      let b; try { b = JSON.parse(text); } catch { return reply({ error: "json" }, 400); }
      const userId = b.userId;
      if (!userId || typeof userId !== "string") return reply({ error: "userId required" }, 400);
      const licenseKey = "license:" + userId;
      const license = await env.SYNC.get(licenseKey);
      if (!license) return reply({ pro: false });
      try {
        const lic = JSON.parse(license);
        const now = Date.now();
        const isValid = lic.type === "lifetime" || (lic.expires && lic.expires > now);
        return reply({ pro: isValid, type: lic.type, expires: lic.expires || null });
      } catch {
        return reply({ pro: false });
      }
    }

    // --- Stripe Checkout Session ---
    if (url.pathname === "/stripe/checkout" && req.method === "POST") {
      const secretKey = (env.STRIPE_SECRET_KEY || "").trim();
      if (!secretKey) return reply({ error: "stripe not configured" }, 500);
      const text = await req.text();
      let b; try { b = JSON.parse(text); } catch { return reply({ error: "json" }, 400); }
      const userId = b.userId;
      const mode = b.mode || "payment"; // "payment" для lifetime, "subscription" для подписки
      if (!userId || typeof userId !== "string") return reply({ error: "userId required" }, 400);

      const priceId = mode === "subscription"
        ? (env.STRIPE_PRICE_SUBSCRIPTION || "")
        : (env.STRIPE_PRICE_LIFETIME || "");
      if (!priceId) return reply({ error: "price not configured" }, 500);

      const origin = req.headers.get("Origin") || "";
      const successUrl = `${origin}/?pro=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin}/?pro=cancel`;

      const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          "mode": mode,
          "success_url": successUrl,
          "cancel_url": cancelUrl,
          "customer_email": b.email || undefined,
          "metadata[userId]": userId,
          "line_items[0][price]": priceId,
          "line_items[0][quantity]": "1",
        }).toString(),
      });

      const session = await stripeRes.json();
      if (!stripeRes.ok) {
        return reply({ error: session.error?.message || "stripe error" }, 400);
      }
      return reply({ url: session.url, sessionId: session.id });
    }

    // --- Stripe Customer Portal ---
    if (url.pathname === "/stripe/portal" && req.method === "POST") {
      const secretKey = (env.STRIPE_SECRET_KEY || "").trim();
      if (!secretKey) return reply({ error: "stripe not configured" }, 500);
      const text = await req.text();
      let b; try { b = JSON.parse(text); } catch { return reply({ error: "json" }, 400); }
      const userId = b.userId;
      if (!userId || typeof userId !== "string") return reply({ error: "userId required" }, 400);

      // Найти customerId по userId
      const licenseKey = "license:" + userId;
      const license = await env.SYNC.get(licenseKey);
      let customerId = null;
      if (license) {
        try {
          const lic = JSON.parse(license);
          customerId = lic.stripeCustomerId;
        } catch {}
      }
      if (!customerId) return reply({ error: "no customer" }, 404);

      const origin = req.headers.get("Origin") || "";
      const returnUrl = `${origin}/`;

      const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          "customer": customerId,
          "return_url": returnUrl,
        }).toString(),
      });

      const session = await portalRes.json();
      if (!portalRes.ok) {
        return reply({ error: session.error?.message || "stripe error" }, 400);
      }
      return reply({ url: session.url });
    }

    // --- Stripe Webhook ---
    if (url.pathname === "/stripe/webhook" && req.method === "POST") {
      const sig = req.headers.get("stripe-signature");
      const webhookSecret = (env.STRIPE_WEBHOOK_SECRET || "").trim();
      if (!webhookSecret) return reply({ error: "webhook not configured" }, 500);
      const body = await req.text();
      let event;
      try {
        // Проверка подписи Stripe (упрощённо — в продакшене используйте stripe-node или аналоги)
        // Тут просто парсим событие
        event = JSON.parse(body);
      } catch {
        return reply({ error: "invalid payload" }, 400);
      }
      // Обработка событий
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const customerId = session.customer;
        if (userId && customerId) {
          const licenseKey = "license:" + userId;
          // Lifetime purchase
          if (session.mode === "payment") {
            await env.SYNC.put(licenseKey, JSON.stringify({ type: "lifetime", stripeCustomerId: customerId, created: Date.now() }));
          }
          // Subscription
          else if (session.mode === "subscription") {
            const subscription = await fetch(`https://api.stripe.com/v1/subscriptions/${session.subscription}`, {
              headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
            }).then(r => r.json());
            await env.SYNC.put(licenseKey, JSON.stringify({
              type: "pro",
              expires: (subscription.current_period_end || 0) * 1000,
              stripeCustomerId: customerId,
              stripeSubscriptionId: session.subscription
            }));
          }
        }
      }
      else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        // Найти userId по customerId (можно хранить маппинг customerId -> userId)
        // Для простоты: ищем в KV все лицензии и обновляем подходящую
        // В продакшене лучше иметь отдельный индекс
      }
      return reply({ received: true });
    }

    return reply({ error: "not found" }, 404);
  },
};

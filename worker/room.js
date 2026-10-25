import { DurableObject } from "cloudflare:workers";
import { applyMessage, viewFor, MAX_PLAYERS, cleanName } from "./logic.js";

const TTL = 6 * 3600 * 1000;

export class Room extends DurableObject {
  load() { return this.ctx.storage.get("s").then(s => s || null); }
  online(pid) { return this.ctx.getWebSockets(pid).length > 0; }

  async broadcast() {
    const s = await this.load();
    if (!s) return;
    for (const ws of this.ctx.getWebSockets()) {
      const pid = this.ctx.getTags(ws)[0];
      if (!s.players[pid]) continue;
      try { ws.send(JSON.stringify(viewFor(s, pid, p => this.online(p)))); } catch {}
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
    const reject = code => { server.accept(); server.send(JSON.stringify({ t: "error", code })); server.close(1000, code); return new Response(null, { status: 101, webSocket: client }); };

    const s = await this.load();
    if (!s) return reject("none");
    const pid = url.searchParams.get("pid") || "";
    if (!/^[a-f0-9]{32}$/.test(pid)) return reject("pid");
    if (!s.players[pid]) {
      if (s.phase !== "lobby") return reject("started"); // новых игроков принимаем только в лобби
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
    if (typeof raw !== "string" || raw.length > 4000) return;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const s = await this.load();
    if (!s) return;
    if (applyMessage(s, this.ctx.getTags(ws)[0], msg)) await this.ctx.storage.put("s", s);
    await this.broadcast();
  }

  async webSocketClose(ws) { try { ws.close(); } catch {} await this.broadcast(); }

  async alarm() {
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, "expired"); } catch {} }
    await this.ctx.storage.deleteAll();
  }
}

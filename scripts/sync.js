"use strict";

/* ============ Синхронизация через Worker ============ */
// Схема: у каждого устройства есть rev (время последнего локального изменения) и synced (rev сервера, который оно видело).
// Нет локальных правок → берём серверную копию целиком (удаления тоже переносятся).
// Правки есть и с обеих сторон → объединяем (ничего не теряется, но удаления в этом случае могут вернуться).
const SYNC_ID_KEY = "filmder-sync-id";
const SYNC_META_KEY = "filmder-sync-meta";
let syncApplying = false, syncBusy = false, syncPushTimer = 0;

const syncId = () => { const v = ls.get(SYNC_ID_KEY) || ""; return /^[a-f0-9]{32}$/.test(v) ? v : ""; };
const syncOn = () => !!((CONFIG.PROXY_URL || "").trim() && syncId());
function syncMeta() {
  try { return Object.assign({ rev: 0, synced: 0 }, JSON.parse(ls.get(SYNC_META_KEY) || "{}")); }
  catch (e) { return { rev: 0, synced: 0 }; }
}
const syncSetMeta = m => ls.set(SYNC_META_KEY, JSON.stringify(m));

// Вызывается из save() при любом изменении данных
function syncMarkDirty() {
  if (syncApplying || !syncOn()) return;
  const m = syncMeta();
  m.rev = Math.max(Date.now(), m.rev + 1);
  syncSetMeta(m);
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(syncRun, 3000);
}

async function syncFetch(method, body) {
  const base = CONFIG.PROXY_URL.trim().replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${base}/sync/${syncId()}`, {
      method, signal: ctrl.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return { none: true };
    if (res.status === 409) return { conflict: true };
    if (!res.ok) throw new Error("HTTP_" + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

// Подтянуть чужие данные целиком
function syncApply(d) {
  syncApplying = true;
  try {
    state.liked = (d.liked || []).map(cleanEntry).filter(Boolean);
    state.watched = (d.watched || []).map(cleanEntry).filter(Boolean);
    state.urls = {};
    if (d.urls && typeof d.urls === "object") for (const [id, u] of Object.entries(d.urls)) if (typeof u === "string" && validUrl(u)) state.urls[id] = u;
    passed.clear();
    (d.passed || []).forEach(id => { if (Number.isFinite(+id)) passed.add(+id); });
    deck = deck.filter(m => !isSeen(m.id));
    save();
  } finally { syncApplying = false; }
  renderAll();
}

// Объединить с локальными данными
function syncMerge(d) {
  syncApplying = true;
  try {
    for (const m of (d.watched || []).map(cleanEntry).filter(Boolean)) {
      if (isWatched(m.id)) continue;
      state.liked = state.liked.filter(x => x.id !== m.id);
      state.watched.push(m);
    }
    state.watched.sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0));
    for (const m of (d.liked || []).map(cleanEntry).filter(Boolean)) if (!isLiked(m.id) && !isWatched(m.id)) state.liked.push(m);
    if (d.urls && typeof d.urls === "object") for (const [id, u] of Object.entries(d.urls)) if (!state.urls[id] && typeof u === "string" && validUrl(u)) state.urls[id] = u;
    (d.passed || []).forEach(id => { if (Number.isFinite(+id)) passed.add(+id); });
    deck = deck.filter(m => !isSeen(m.id));
    save();
  } finally { syncApplying = false; }
  renderAll();
}

// Полный цикл: сверить с сервером → применить/объединить → отправить свои правки
async function syncRun(quiet = true) {
  if (!syncOn() || syncBusy || !navigator.onLine) return false;
  syncBusy = true;
  clearTimeout(syncPushTimer);
  let pulled = false, ok = false;
  try {
    for (let tries = 0; tries < 3; tries++) {
      const m = syncMeta();
      const r = await syncFetch("GET");
      if (!r.none && r.rev !== m.synced) {
        if (m.rev > m.synced) { syncMerge(r.data); m.rev = Math.max(Date.now(), r.rev + 1); }
        else { syncApply(r.data); m.rev = r.rev; }
        m.synced = r.rev;
        pulled = true;
      }
      const hasData = state.liked.length || state.watched.length;
      if (m.rev > m.synced || (r.none && hasData)) {
        if (!m.rev) m.rev = Date.now();
        const put = await syncFetch("PUT", { base: r.none ? 0 : m.synced, rev: m.rev, data: buildBackup().data });
        if (put.conflict) { syncSetMeta(m); continue; }
        m.synced = m.rev;
      }
      syncSetMeta(m);
      ok = true;
      break;
    }
  } catch (e) {
    if (!quiet) showToast({ sub: "Синхронизация", title: "Нет связи с сервером" });
  }
  syncBusy = false;
  if (pulled) showToast({ sub: "Синхронизация", title: "Данные обновлены с другого устройства" });
  else if (ok && !quiet) showToast({ sub: "Синхронизация", title: "Всё актуально" });
  return ok;
}

function syncNewId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

// Простое диалоговое окно: показать код / создать новый / ввести чужой / отключить
function syncDialog() {
  if (!(CONFIG.PROXY_URL || "").trim()) return showToast({ sub: "Синхронизация", title: "Не задан PROXY_URL в config.js" });
  const cur = syncId();
  const msg = cur
    ? "Код синхронизации. Скопируйте его и введите на другом устройстве.\nЧтобы отключить — очистите поле и нажмите OK."
    : "Введите код с другого устройства.\nЧтобы создать новый код — оставьте поле пустым и нажмите OK.";
  const v = prompt(msg, cur);
  if (v === null) return;
  const code = v.trim().toLowerCase();

  if (cur && !code) {
    ls.set(SYNC_ID_KEY, ""); ls.set(SYNC_META_KEY, "");
    return showToast({ sub: "Синхронизация", title: "Отключена" });
  }
  if (cur && code === cur) return;
  const next = code || syncNewId();
  if (!/^[a-f0-9]{32}$/.test(next)) return showToast({ sub: "Ошибка", title: "Код — 32 символа 0–9 и a–f" });

  ls.set(SYNC_ID_KEY, next);
  syncSetMeta({ rev: Date.now(), synced: 0 }); // первый запуск с новым кодом: объединить с тем, что есть на сервере
  syncRun(false).then(ok => {
    if (ok && !code) prompt("Ваш новый код. Скопируйте и сохраните его, он нужен для второго устройства:", next);
  });
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) syncRun(); });
addEventListener("online", () => syncRun());

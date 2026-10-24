"use strict";

/* ============ Состояние ============ */
let state = { liked: [], watched: [], urls: {}, multiGenres: [] };
const passed = new Set();
try {
  const saved = JSON.parse(ls.get(STORE_KEY) || "null");
  if (saved && typeof saved === "object") {
    if (Array.isArray(saved.liked)) state.liked = saved.liked.filter(m => m && m.id);
    if (Array.isArray(saved.watched)) state.watched = saved.watched.filter(m => m && m.id);
    if (saved.urls && typeof saved.urls === "object") state.urls = saved.urls;
    if (Array.isArray(saved.multiGenres)) state.multiGenres = saved.multiGenres;
    else if (saved.genre) state.multiGenres = [saved.genre];
    if (Array.isArray(saved.passed)) saved.passed.forEach(id => passed.add(id));
  }
} catch (e) {}

const saveNow = () => ls.set(STORE_KEY, JSON.stringify({
  liked: state.liked, watched: state.watched, urls: state.urls, multiGenres: state.multiGenres,
  passed: [...passed].slice(-PASSED_LIMIT),
}));
let saveTimer = 0;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); };
addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });

const isLiked = id => state.liked.some(m => m.id === id);
const isWatched = id => state.watched.some(m => m.id === id);
const isSeen = id => passed.has(id) || isLiked(id) || isWatched(id);
const findStored = id => state.liked.find(m => m.id === id) || state.watched.find(m => m.id === id);

function categoryOf(m) {
  if (m.category) return m.category;
  const g = m.genres || [];
  return g.find(x => x === "Мультфильмы" || x === "Аниме") || g[0] || "Другое";
}
const snap = m => ({
  id: m.id, title: m.title, orig: m.orig, year: m.year, rating: m.rating || 0,
  poster: m.poster, runtime: m.runtime || 0, genres: m.genres || [], category: categoryOf(m),
});

let genres = [];
let deck = [];
let paging = newPaging();
let history_ = [];
let busy = false;
let sheetMovie = null;
let listMode = "queue"; // "queue" | "watched"

function newPaging() { return { page: 1, total: 1, loading: false, error: null }; }

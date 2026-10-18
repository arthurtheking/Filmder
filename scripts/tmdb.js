/* ============================================================
   TMDB: всё, что связано с запросами к сайту themoviedb.org.
   Остальной код приложения (app.js) не знает, как устроен их API,
   он просто вызывает функции отсюда: TMDB.genres(), TMDB.discover(), TMDB.details().
   Документация API: https://developer.themoviedb.org/reference
   ============================================================ */
const TMDB = (() => {
  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p";

  const cache = new Map();   // запомненные ответы, чтобы не спрашивать одно и то же дважды
  const genreMap = {};       // id жанра → название, например 28 → "Боевик"

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);   // TMDB отдаёт жанры строчными, делаем заглавную

  /* Один универсальный запрос. path это адрес вида "/movie/603", params это дополнительные параметры. */
  async function get(path, params = {}) {
    const url = new URL(API + path);
    url.searchParams.set("language", CONFIG.LANGUAGE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    // Ключ можно передать двумя способами, в зависимости от того, какой из двух у вас есть
    const key = CONFIG.TMDB_KEY.trim();
    const headers = {};
    if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;   // длинный токен
    else url.searchParams.set("api_key", key);                           // короткий ключ

    const id = url.toString();
    if (cache.has(id)) return cache.get(id);

    const res = await fetch(url, { headers });
    if (res.status === 401) throw new Error("BAD_KEY");   // ключ неверный
    if (!res.ok) throw new Error("HTTP_" + res.status);
    const data = await res.json();
    cache.set(id, data);
    return data;
  }

  /* Список жанров, отсортированный по алфавиту */
  async function genres() {
    const data = await get("/genre/movie/list");
    const list = data.genres.map(g => ({ id: g.id, name: cap(g.name) }));
    list.forEach(g => (genreMap[g.id] = g.name));
    return list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  /* Страница фильмов. genreId = 0 значит «любой жанр». Сначала самые популярные. */
  async function discover(genreId, page) {
    const params = {
      sort_by: "popularity.desc",
      "vote_count.gte": CONFIG.MIN_VOTES,
      include_adult: "false",
      page,
    };
    if (genreId) params.with_genres = genreId;
    const data = await get("/discover/movie", params);
    return { items: data.results.map(normalize), totalPages: data.total_pages };
  }

  /* Подробности: длительность, режиссёр, актёры и трейлер. Одним запросом через append_to_response. */
  async function details(id) {
    const d = await get("/movie/" + id, { append_to_response: "videos,credits", include_video_language: "ru,en" });
    const director = (d.credits?.crew || []).find(p => p.job === "Director");
    return {
      id: d.id,
      title: d.title || d.original_title,
      orig: d.original_title,
      year: (d.release_date || "").slice(0, 4),
      runtime: d.runtime || 0,
      rating: d.vote_average || 0,
      genres: (d.genres || []).map(g => cap(g.name)),
      overview: d.overview || "",
      poster: d.poster_path,
      backdrop: d.backdrop_path,
      director: director ? director.name : "",
      cast: (d.credits?.cast || []).slice(0, 4).map(p => p.name),
      trailerKey: pickTrailer(d.videos?.results || []),
    };
  }

  /* Из списка видео выбираем лучший трейлер: сначала русский, потом английский, трейлер лучше тизера */
  function pickTrailer(videos) {
    const yt = videos.filter(v => v.site === "YouTube");
    const score = v => (v.type === "Trailer" ? 4 : v.type === "Teaser" ? 0 : -10) + (v.iso_639_1 === "ru" ? 2 : 0) + (v.official ? 1 : 0);
    const best = yt.sort((a, b) => score(b) - score(a))[0];
    return best && score(best) >= 0 ? best.key : null;
  }

  /* Приводим «сырой» фильм из списка к одному виду, с которым работает приложение */
  function normalize(r) {
    return {
      id: r.id,
      title: r.title || r.original_title,
      orig: r.original_title,
      year: (r.release_date || "").slice(0, 4),
      rating: r.vote_average || 0,
      genres: (r.genre_ids || []).map(id => genreMap[id]).filter(Boolean),
      overview: r.overview || "",
      poster: r.poster_path,
      backdrop: r.backdrop_path,
    };
  }

  /* Адрес картинки. size: w185, w342, w500, w780. Если картинки нет, вернёт null. */
  const img = (path, size = "w500") => (path ? `${IMG}/${size}${path}` : null);

  return { genres, discover, details, img };
})();
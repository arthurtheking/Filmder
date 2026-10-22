const TMDB = (() => {
  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p";
  const CACHE_LIMIT = 200;

  const cache = new Map();
  const genreMap = {};
  let genresPromise = null;

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function request(url, headers) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { headers });
        if (res.status === 401) throw new Error("BAD_KEY");
        if (res.status === 429 || res.status >= 500) throw new Error("HTTP_" + res.status);
        if (!res.ok) throw new Error("HTTP_" + res.status);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (e.message === "BAD_KEY") throw e;
        if (attempt === 0) await wait(600);
      }
    }
    throw lastErr;
  }

  function get(path, params = {}) {
    const url = new URL(API + path);
    url.searchParams.set("language", CONFIG.LANGUAGE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const key = (CONFIG.TMDB_KEY || "").trim();
    const headers = {};
    if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
    else url.searchParams.set("api_key", key);

    const id = url.toString();
    if (cache.has(id)) return cache.get(id);

    const p = request(url, headers);
    cache.set(id, p);
    p.catch(() => cache.delete(id));
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return p;
  }

  const genreName = id => (id === 16 ? "Мультфильмы" : genreMap[id]);

  function genres() {
    if (!genresPromise) {
      genresPromise = get("/genre/movie/list").then(data => {
        const list = data.genres.map(g => ({ id: g.id, name: g.id === 16 ? "Мультфильмы" : cap(g.name) }));
        list.forEach(g => (genreMap[g.id] = g.name));
        list.push({ id: "anime", name: "Аниме" });
        return list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
      });
      genresPromise.catch(() => (genresPromise = null));
    }
    return genresPromise;
  }

  function genreParams(selected) {
    const out = {};
    const list = Array.isArray(selected) ? selected.map(String) : selected ? [String(selected)] : [];
    if (!list.length) return out;

    const hasAnime = list.includes("anime");
    const ids = new Set(list.filter(g => g !== "anime"));
    if (hasAnime) ids.add("16");
    out.with_genres = [...ids].join("|");

    // Язык «ja» ограничивает всю выборку, поэтому только если выбрано одно лишь аниме
    const onlyAnime = hasAnime && [...ids].every(g => g === "16");
    if (onlyAnime) out.with_original_language = "ja";
    return out;
  }

  async function discover(selected, page = 1) {
    const maxPages = CONFIG.MAX_PAGES || 40;
    const params = Object.assign({
      sort_by: "popularity.desc",
      "vote_count.gte": CONFIG.MIN_VOTES,
      include_adult: "false",
      page,
    }, genreParams(selected));

    const data = await get("/discover/movie", params);
    return {
      items: shuffle(data.results || []).map(normalize),
      totalPages: Math.max(1, Math.min(data.total_pages || 1, maxPages)),
    };
  }

  async function details(id) {
    const d = await get("/movie/" + id, {
      append_to_response: "videos,credits,recommendations,similar",
      include_video_language: "ru,en,null",
    });
    const director = (d.credits?.crew || []).find(p => p.job === "Director");
    const lang = d.original_language;
    const isAnim = (d.genres || []).some(g => g.id === 16);
    const isAnime = isAnim && lang === "ja";
    return {
      id: d.id,
      title: d.title || d.original_title,
      orig: d.original_title,
      year: (d.release_date || "").slice(0, 4),
      runtime: d.runtime || 0,
      rating: d.vote_average || 0,
      lang,
      isAnime,
      genres: (d.genres || []).map(g => (g.id === 16 ? (isAnime ? "Аниме" : "Мультфильмы") : genreName(g.id) || cap(g.name))),
      overview: d.overview || "",
      poster: d.poster_path,
      backdrop: d.backdrop_path,
      director: director ? director.name : "",
      cast: (d.credits?.cast || []).slice(0, 4).map(p => p.name),
      trailerKey: pickTrailer(d.videos?.results || []),
      related: pickRelated(d, id),
    };
  }

  function pickTrailer(videos) {
    const score = v => (v.type === "Trailer" ? 4 : v.type === "Teaser" ? 0 : -10) + (v.iso_639_1 === "ru" ? 2 : 0) + (v.official ? 1 : 0);
    const best = videos.filter(v => v.site === "YouTube").sort((a, b) => score(b) - score(a))[0];
    return best && score(best) >= 0 ? best.key : null;
  }

  function pickRelated(d, selfId) {
    const all = [...(d.recommendations?.results || []), ...(d.similar?.results || [])];
    const seen = new Set([selfId]);
    const out = [];
    for (const r of all) {
      if (!r.poster_path || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(normalize(r));
      if (out.length >= 8) break;
    }
    return out;
  }

  function normalize(r) {
    const ids = r.genre_ids || [];
    const isAnime = ids.includes(16) && r.original_language === "ja";
    return {
      id: r.id,
      title: r.title || r.original_title,
      orig: r.original_title,
      year: (r.release_date || "").slice(0, 4),
      rating: r.vote_average || 0,
      lang: r.original_language,
      isAnime,
      genres: ids.map(id => (id === 16 ? (isAnime ? "Аниме" : "Мультфильмы") : genreName(id))).filter(Boolean),
      overview: r.overview || "",
      poster: r.poster_path,
      backdrop: r.backdrop_path,
    };
  }

  // Размеры TMDB: w92, w154, w185, w342, w500, w780, original
  const img = (path, size = "w500") => (path ? `${IMG}/${size}${path}` : null);

  return { genres, discover, details, img };
})();
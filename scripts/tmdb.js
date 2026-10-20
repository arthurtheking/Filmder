const TMDB = (() => {
  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p";

  const cache = new Map();
  const genreMap = {};

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  async function get(path, params = {}) {
    const url = new URL(API + path);
    url.searchParams.set("language", CONFIG.LANGUAGE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const key = CONFIG.TMDB_KEY.trim();
    const headers = {};
    if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
    else url.searchParams.set("api_key", key);

    const id = url.toString();
    if (cache.has(id)) return cache.get(id);

    const res = await fetch(url, { headers });
    if (res.status === 401) throw new Error("BAD_KEY");
    if (!res.ok) throw new Error("HTTP_" + res.status);
    const data = await res.json();
    cache.set(id, data);
    return data;
  }

  function genreName(id, lang) {
    if (id === 16) return "Мультфильмы";
    return genreMap[id];
  }

  async function genres() {
    const data = await get("/genre/movie/list");
    const list = data.genres.map(g => ({ id: g.id, name: g.id === 16 ? "Мультфильмы" : cap(g.name) }));
    list.forEach(g => (genreMap[g.id] = g.name));
    list.push({ id: "anime", name: "Аниме" });
    return list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  async function discover(genreFilter, page) {
    const maxPages = CONFIG.MAX_PAGES || 40;
    const targetPage = page || 1;

    const params = {
      sort_by: "popularity.desc",
      "vote_count.gte": CONFIG.MIN_VOTES,
      include_adult: "false",
      page: targetPage,
    };

    if (genreFilter) {
      if (Array.isArray(genreFilter)) {
        const hasAnime = genreFilter.includes("anime");
        const hasCartoons = genreFilter.includes(16) || genreFilter.includes("16");
        const numericGenres = genreFilter.filter(id => id !== "anime" && id !== 16 && id !== "16");
        
        let list = [...numericGenres];
        if (hasCartoons || hasAnime) list.push(16);
        
        if (list.length) params.with_genres = list.join("|");
        if (hasAnime) params.with_original_language = "ja";
      } else if (genreFilter === "anime" || genreFilter === "16" || genreFilter === 16) {
        params.with_genres = "16";
        if (genreFilter === "anime") params.with_original_language = "ja";
      } else {
        params.with_genres = String(genreFilter);
      }
    }

    const data = await get("/discover/movie", params);
    const shuffledResults = (data.results || []).sort(() => Math.random() - 0.5);
    return { items: shuffledResults.map(normalize), totalPages: Math.min(data.total_pages || 1, maxPages) };
  }

  async function details(id) {
    const d = await get("/movie/" + id, {
      append_to_response: "videos,credits,recommendations,similar",
      include_video_language: "ru,en",
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
      genres: (d.genres || []).map(g => g.id === 16 ? (isAnime ? "Аниме" : "Мультфильмы") : (genreName(g.id, lang) || cap(g.name))),
      overview: d.overview || "",
      poster: d.poster_path,
      backdrop: d.backdrop_path,
      director: director ? director.name : "",
      cast: (d.credits?.cast || []).slice(0, 4).map(p => p.name),
      trailerKey: pickTrailer(d.videos?.results || []),
      related: pickRelated(d, id, isAnim, isAnime),
    };
  }

  function pickTrailer(videos) {
    const yt = videos.filter(v => v.site === "YouTube");
    const score = v => (v.type === "Trailer" ? 4 : v.type === "Teaser" ? 0 : -10) + (v.iso_639_1 === "ru" ? 2 : 0) + (v.official ? 1 : 0);
    const best = yt.sort((a, b) => score(b) - score(a))[0];
    return best && score(best) >= 0 ? best.key : null;
  }

  function pickRelated(d, selfId, isAnim, isAnime) {
    const all = [...(d.recommendations?.results || []), ...(d.similar?.results || [])];
    const seen = new Set([selfId]);
    const out = [];
    for (const r of all) {
      if (!r.poster_path || seen.has(r.id)) continue;
      seen.add(r.id);
      const m = normalize(r);
      out.push(m);
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
      genres: ids.map(id => id === 16 ? (isAnime ? "Аниме" : "Мультфильмы") : genreName(id, r.original_language)).filter(Boolean),
      overview: r.overview || "",
      poster: r.poster_path,
      backdrop: r.backdrop_path,
    };
  }

  const img = (path, size = "w500") => (path ? `${IMG}/${size}${path}` : null);

  return { genres, discover, details, img };
})();
const CONFIG = {
  // Адрес вашего Worker (см. DEPLOY.md). Токен TMDB хранится только там.
  PROXY_URL: "https://filmder-proxy.bardartur.workers.dev",
  // Запасной вариант без прокси (ключ будет виден всем): вставьте сюда ключ и оставьте PROXY_URL пустым
  TMDB_KEY: "",
  LANGUAGE: "ru-RU",
  MIN_VOTES: 300,
  MAX_PAGES: 40,
};

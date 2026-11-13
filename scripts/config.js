const CONFIG = {
  // Адрес вашего Worker (см. DEPLOY.md). Токен TMDB хранится только там.
  // Для локальной разработки: http://localhost:8787
  // Для продакшена: https://filmder-proxy.bardartur.workers.dev
  PROXY_URL: "https://filmder-proxy.arthurtheking.workers.dev",
  // Запасной вариант без прокси (ключ будет виден всем): вставьте сюда ключ и оставьте PROXY_URL пустым
  TMDB_KEY: "b965c284c2d27c8928b1253e53b2bc3c",
  LANGUAGE: "ru-RU",
  MIN_VOTES: 300,
  MAX_PAGES: 40,
};

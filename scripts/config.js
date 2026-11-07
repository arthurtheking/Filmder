const CONFIG = {
  // Адрес вашего Worker (см. DEPLOY.md). Токен TMDB хранится только там.
  // Для локальной разработки: http://localhost:8787
  // Для продакшена: https://filmder-proxy.bardartur.workers.dev
  PROXY_URL: "http://localhost:8787",
  // Запасной вариант без прокси (ключ будет виден всем): вставьте сюда ключ и оставьте PROXY_URL пустым
  TMDB_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIzYmYxYTllZGQ1ZWZiOTRhYjQzMDYzMzI5YTE1NmU2MCIsIm5iZiI6MTc5MjMzMjMxMC4yMjEsInN1YiI6IjZhZDRkMjE2MzkxYWIyNzllYzc5NzU5ZCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ._V3804MWTQ8JTe-2Y9q-X9ljmUlh7wNcNFSj9VWojxo",
  LANGUAGE: "ru-RU",
  MIN_VOTES: 300,
  MAX_PAGES: 40,
};

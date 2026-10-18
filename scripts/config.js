/* ============================================================
   НАСТРОЙКИ
   Единственное, что нужно изменить, это ключ TMDB.
   Где взять: themoviedb.org → Settings → API.
   Подойдёт любой из двух:
     • короткий «API Key» (32 символа)
     • длинный «API Read Access Token» (начинается с eyJ...)
   ============================================================ */
const CONFIG = {
  TMDB_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJjNTc0MzYxNjQwZTYwZDg4OGU0YjkzYjY3OTk4ODM0ZCIsIm5iZiI6MTc5MjMzMjMxMC4yMjEsInN1YiI6IjZhZDRkMjE2MzkxYWIyNzllYzc5NzU5ZCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.F5L3y6rn__d7R11RiWCpeaXVGEqNmNOkN77e8a2w4EI",
 
  // Язык названий и описаний. Для украинского поставьте "uk-UA", для английского "en-US".
  LANGUAGE: "ru-RU",
 
  // Показывать только фильмы, у которых не меньше стольких оценок.
  // Так в колоду не попадает малоизвестное. Уменьшите число, чтобы увидеть больше редких фильмов.
  MIN_VOTES: 300,
};
 
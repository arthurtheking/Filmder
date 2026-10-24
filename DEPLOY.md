# Развёртывание прокси (один раз)

1. `npm i -g wrangler && wrangler login`
2. `cd worker`
3. `wrangler kv namespace create SYNC` → скопируйте `id` в `wrangler.toml`
4. В `wrangler.toml` впишите `ALLOWED_ORIGIN` — адрес, где лежит Filmder (без слеша в конце, например `https://user.github.io`)
5. `wrangler secret put TMDB_TOKEN` → вставьте НОВЫЙ токен TMDB (старый перевыпустите)
6. `wrangler deploy` → получите адрес вида `https://filmder-proxy.<вы>.workers.dev`
7. В `scripts/config.js` впишите его в `PROXY_URL`
8. Загрузите сайт. В «Мой вечер» → «Синхронизация» создайте код; на втором устройстве введите его же.

## Дуэль
Ничего дополнительного: `wrangler deploy` сам создаёт Durable Object `Room` (миграция в `wrangler.toml`).
Работает на бесплатном тарифе Cloudflare. Комната удаляется через 6 часов после создания.

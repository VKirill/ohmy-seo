# hosting/ — сайт ohmy-seo.ru и облачный MCP

Полный протокол поставки: корневой [`../AGENTS.md`](../AGENTS.md) (секция Ship protocol). Этот файл — только стек Docker.

- Сайт: `apps/web` → контейнер `ohmy-seo-web` → `https://ohmy-seo.ru`
- Облачный MCP: `apps/gateway` + MCP, запечённый из GitHub-тега `OHMY_SEO_REF` → `ohmy-seo-gateway` → `https://mcp.ohmy-seo.ru/mcp`
- Прод-копия этого каталога: `/home/ohmy-seo/stack` на VPS (`ssh ovh-main`). Push в `main` сам стек не обновляет.

Новый или облачный write-тул: `apps/gateway/src/tool-policy.ts` + тест. Карточка интеграции: `apps/web/src/lib/marketing/catalog.ts`.

Выкладка: rsync сюда без `.env`/`secrets/`, выставить `OHMY_SEO_REF` на свежий тег, `docker compose build web gateway && docker compose up -d`. Не коммитить `apps/web/AGENTS.md` и `apps/web/CLAUDE.md` (их пишет Next.js).

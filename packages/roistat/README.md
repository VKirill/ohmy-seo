# @ohmy-seo/roistat

Отдельный read-only MCP-сервер для Roistat REST API v1. Он не зависит от Яндекса и не использует Yandex OAuth.

Инструменты:

- `roistat_list_projects` — доступные проекты;
- `roistat_list_analytics_fields` — метрики, измерения, модели атрибуции и значения измерений;
- `roistat_get_analytics` — отчёт `/project/analytics/data`.

Произвольного API-шлюза и write-endpoints нет: сервер физически не умеет вызывать мутации.

Настройка:

1. Скопировать `.env.example` в `.env`.
2. Указать `ROISTAT_API_KEY` из профиля Roistat.
3. Опционально указать `ROISTAT_PROJECT_ID`; список проектов работает без него.

Документация: [авторизация](https://help-ru.roistat.com/API/methods/about/), [проекты](https://help-ru.roistat.com/API/methods/projects/), [аналитика](https://help-ru.roistat.com/API/methods/analytics/).

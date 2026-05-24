# Deliverables: <campaign-name>

> Финальные артефакты которые идут клиенту.

## Structure

Зависит от applied recipe (см. `~/.claude/docs/recipes/marketing/<recipe>.md` секция "Output package"). Типичные подпапки:

- `posts/` — готовые тексты постов
- `ads/` — рекламные креативы и брифы
- `research/` — research-отчёты
- `emails/` — email-кампании
- `audit/` — audit findings (SEO/SMM/Ads)
- `seo/` — SEO-артефакты
- `strategy.md` — стратегический документ
- `measurement-plan.md` — KPI + триггеры
- `compliance-summary.md` — legal-ru-marketing compliance результат
- `cover-summary.md` — финальное message клиенту

## Cover-summary template

Когда финализируешь — заполни cover-summary.md:

```
# <campaign-name> — финальный пакет

## Что сделано (3-5 буллетов в бизнес-языке)
- ...

## Что отдаём
- <тип артефакта>: <количество> в <папке>

## Что осталось проверить
- <manual review item 1>
- <production validation item 2>

## Comments senior'a
- Риски: ...
- Dependencies на стороне клиента: ...
- Long-term recommendations: ...

## Next action для клиента
1. ...
2. ...
```

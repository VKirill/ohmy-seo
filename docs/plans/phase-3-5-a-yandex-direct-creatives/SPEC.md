# Phase 3.5.A — Yandex Direct creatives skill (no validation)

## Goal

Превратить тонкий `yandex-direct-spec` в production-ready скилл `yandex-direct-creatives`, который даёт `ads-specialist` знания и шаблоны для написания качественных объявлений Direct по кластерам из Key Collector CSV. Финальная валидация ложится на Direct API при загрузке кампаний — наша сторона никакой клиентской валидации не делает.

## Non-goals

- **Никакой клиентской валидации креативов.** Direct сам отклонит при загрузке, агент пишет по гайдлайнам — этого достаточно. Никаких Python-скриптов с проверкой лимитов / ФЗ-38 / категорий / пунктуации.
- Любые вызовы Direct API (создание/чтение кампаний, ставок, статистики) — Phase 3.5.B.
- Заливка кампаний из CSV в Direct (даже как drafts) — Phase 3.5.C.
- Слияние с `yandex-direct` скиллом (API-контракт) — намеренно отдельный.
- Google Ads и другие платформы.

## Background — что меняется относительно первой редакции SPEC

Codex first-round нашёл 4 high/critical в SPEC с валидатором (неправильное правило пунктуации, dangling refs, неспецифицированный batch-workflow, опасный `valid:true` для regulated категорий). Пользователь принял стратегическое решение: **убрать клиентскую валидацию целиком**. Это снимает 4 из 5 findings разом, остаётся одно — dangling refs в других скиллах после переименования. Оно остаётся в acceptance.

## Acceptance criteria

- [ ] Директория `~/.claude/skills/yandex-direct-spec/` отсутствует, всё перенесено в `~/.claude/skills/yandex-direct-creatives/`.
- [ ] `rg -n "yandex-direct-spec" ~/.claude/{skills,agents}` возвращает 0 совпадений (все ссылки обновлены — `google-ads-spec`, `vk-ads-spec`, `telegram-ads-spec`, `ads-specialist.md` и любые другие места).
- [ ] `SKILL.md` < 500 строк, проходит чек-лист `skill-evaluation`: «Use when» / «Do not use» / «Purpose» ≥ 2 предложений / «Capabilities» непустые / `## API Reference` ссылается на все references.
- [ ] Description SKILL.md 150–400 символов, триггеры: «написать объявление Директ», «креативы по CSV кластерам», «лимиты заголовка Direct», «разбить CSV кластеры на кампании», «структура группы Direct».
- [ ] 5 новых references созданы, каждый < 500 строк: `limits-and-moderation.md`, `csv-workflow.md`, `cluster-to-campaign-strategy.md`, `composition-templates.md`, `style-and-avoid.md`.
- [ ] `limits-and-moderation.md` точно отражает источник `vendor/yandex-direct-docs-snapshot/docs/moderation/technical-restrictions.md`: per-field rules (главный заголовок 56 ВКЛЮЧАЯ пунктуацию; доп. заголовок 30+15 отдельно; текст 81+15 отдельно; и т.д.). С примерами расчёта на конкретных строках.
- [ ] `composition-templates.md` — ≥ 2 готовых вариантов объявления на каждый из 4 intent-типов (informational / transactional / branded / navigational), каждый вариант с заголовком + 2-м заголовком + текстом + 4 быстрыми ссылками + 4 уточнениями.
- [ ] `csv-workflow.md` точно описывает 25 колонок Key Collector CSV (формат `/home/ubuntu/downloads/test_direct.csv`) и пайплайн «прочитал → понял кластеры → пишу 2+ объявления на кластер».
- [ ] `style-and-avoid.md` (бывший forbidden-patterns в режиме «избегай для скорости модерации») — обзор паттернов которых лучше избегать (КАПС, !!!, эмодзи в headline, «лучший»/«№1» без подтверждения), без enforcement и без regex'ов. Это guidance для писателя, не валидатор.
- [ ] `~/.claude/agents/ads-specialist.md` — заменён `yandex-direct-spec` → `yandex-direct-creatives`, добавлена таблица «Когда что грузить» (creatives skill vs API skill).
- [ ] Старая директория `yandex-direct-spec` удалена ПОСЛЕ того как все ссылки обновлены.

## File plan

Все пути абсолютные. Файлы скилла живут **вне репозитория** в `~/.claude/skills/`, агент-файл тоже.

| File | Status | Lines | Hard cap | Responsibility |
|---|---|---|---|---|
| `/home/ubuntu/.claude/skills/yandex-direct-creatives/SKILL.md` | Rewrite | ~200 | 400 | Триггеры, decision-таблица «задача → reference», список всех references |
| `/home/ubuntu/.claude/skills/yandex-direct-creatives/references/limits-and-moderation.md` | New | ~280 | 450 | **Per-field лимиты** (главный заголовок 56 включая всё; доп. заголовок 30+15; текст 81+15; и т.д.) + 18+/ERID/ФЗ-38 — как REFERENCE для писателя, не для валидатора |
| `/home/ubuntu/.claude/skills/yandex-direct-creatives/references/csv-workflow.md` | New | ~200 | 400 | 25 колонок Key Collector + пайплайн «CSV → кластеры → объявления» |
| `/home/ubuntu/.claude/skills/yandex-direct-creatives/references/cluster-to-campaign-strategy.md` | New | ~180 | 350 | Decision-таблица «1 кампания = 1 vs N кластеров», naming, вывод минус-слов |
| `/home/ubuntu/.claude/skills/yandex-direct-creatives/references/composition-templates.md` | New | ~260 | 450 | 4 intent × ≥ 2 варианта × (заголовок + 2-й + текст + сайтлинки + уточнения) |
| `/home/ubuntu/.claude/skills/yandex-direct-creatives/references/style-and-avoid.md` | New | ~140 | 300 | Guidance: что лучше не писать (CAPS, !!!, эмодзи в headline, превосходные степени). Без enforcement |
| `/home/ubuntu/.claude/skills/yandex-direct-creatives/references/{ad-formats,campaign-types,benchmarks-2026,targeting-and-keywords}.md` | Moved | unchanged | — | Перемещены `mv`, минимальные кросс-ссылки на новые reference |
| `/home/ubuntu/.claude/agents/ads-specialist.md` | Modify | +20/-8 | — | Переключение на новый скилл + таблица «Когда что грузить» |
| `~/.claude/skills/google-ads-spec/**`, `vk-ads-spec/**`, `telegram-ads-spec/**` (если найдутся ссылки на `yandex-direct-spec`) | Modify | ?/0 | — | Глобальный grep + replace `yandex-direct-spec` → `yandex-direct-creatives` |

**Итого:** ~1060 строк нового markdown + перемещение 4 существующих файлов. **Никакого Python кода.**

## Per-file content rules

```
limits-and-moderation.md:
  Contains:
    - Таблица per-field лимитов из technical-restrictions.md источника:
      * Заголовок ТГО: 56, включая пробелы И знаки препинания
      * Дополнительный заголовок ТГО: 30 символов + 15 знаков пунктуации (отдельный счётчик)
      * Текст ТГО: 81 символ + 15 знаков пунктуации (отдельный счётчик)
      * Отображаемая ссылка: 20 (не включая домен)
      * Уточнения: 25 (с пробелами), общая длина уточнений на объявление ≤ 132 desktop / ≤ 66 mobile
      * Быстрая ссылка: заголовок 30, описание 60
      * Продвижение приложений: заголовок 56, текст 75
    - Аналогичные таблицы для РСЯ-баннеров, видео, СмартБаннеров, МастерКампании
    - Кампания/группа/аккаунт: 3000 кампаний (1000 активных), 1000 групп на кампанию, 50 объявлений на группу, 200 ключевых фраз на группу
    - 18+/12+/6+/0+: упрощённое правило — список ниш [алкоголь, табак, Rx-фарма, беттинг, азартные игры, эзотерика] → обязателен 18+
    - ERID/ФЗ-38: обязательный токен с 01.09.2022, формат маркера в тексте
    - **Все таблицы — REFERENCE для писателя**, не правила валидатора. Direct сам отклонит на загрузке если что-то нарушено.
  NOT inside:
    - Логика валидации / regex / Python код
    - Шаблоны написания (→ composition-templates.md)

csv-workflow.md:
  Contains:
    - Формат Key Collector: UTF-8 с BOM, ';' разделитель, 25 колонок
    - Назначение каждой колонки (Кластер, Маркерный запрос, Запрос, Тип, Частотность, "!", "[!]", Показы/Клики Direct, CTR, ставки) + что делать при пустых значениях
    - Пайплайн: «прочитай через Read tool → сгруппируй по полю Кластер → определи Тип intent (informational/transactional/...) → напиши 2+ объявления на кластер»
    - Конкретный референс на /home/ubuntu/downloads/test_direct.csv как golden sample
  NOT inside:
    - Парсер CSV в коде (нет валидатора)
    - Стратегия группировки (→ cluster-to-campaign-strategy.md)

cluster-to-campaign-strategy.md:
  Contains:
    - Decision table: 1 кампания = 1 кластер vs N кластеров под intent
    - Naming: [intent]_[geo]_[product] для кампаний, [cluster_id]_[marker] для групп
    - Вывод минус-слов из не-целевых intent-типов того же CSV
    - Минимум 3 объявления на группу, рекомендация 3-5
    - **Стабильные ID** — `cluster_id` берётся из CSV, `ad_variant_id` назначается в порядке 1/2/3 внутри группы. Эти ID должны быть в имени группы / debug-метаданных, чтобы Phase 3.5.C мог при отклонении модерации найти исходный кластер и шаблон.
    - **Batch-risk и canary** (контракт для Phase 3.5.C, в этой фазе только документируется):
      * При CSV ≥ 100 кластеров — обязательно сначала canary 5-10% первых объявлений, дождаться модерации, оценить процент REJECTED → только потом основная партия.
      * Hard cap moderate: ≤ 100 ads за раз. Больше — chunking.
      * Пороги для остановки: rejection rate > 30% на canary → стоп, пересматриваем шаблоны.
  NOT inside:
    - Парсинг CSV (→ csv-workflow.md)
    - Шаблоны (→ composition-templates.md)
    - Реализация polling/canary (→ Phase 3.5.C, здесь только контракт)

composition-templates.md:
  Contains:
    - 4 раздела по intent (informational / transactional / branded / navigational)
    - В каждом ≥ 2 готовых варианта: заголовок, 2-й заголовок, текст, 4 сайтлинка, 4 уточнения
    - Анти-шаблоны (что плохо работает)
    - Все шаблоны написаны с оглядкой на лимиты из limits-and-moderation.md (но не enforce'ятся)
  NOT inside:
    - Точные лимиты (→ limits-and-moderation.md, кросс-ссылка)
    - Стиль / запреты (→ style-and-avoid.md)

style-and-avoid.md:
  Contains:
    - Stilistic guidance, не enforcement
    - КАПС > 3 подряд — Direct может снизить CTR показа, лучше избегать
    - !!! / ??? — выглядит спамом, Direct не любит
    - Эмодзи в headline — Direct отклоняет в ТГО, в РСЯ-баннере можно
    - «лучший / №1 / единственный / гарантированный» без подтверждения — ФЗ-38 ст.5, Direct отклонит без документов
    - Спецсимволы (звёздочки, решётки) — не работают как декор
    - Каждая рекомендация: что Direct сделает + предложение safe-альтернативы
  NOT inside:
    - Категорийные запреты (медицина / фарма / БАД / азарт) — это legal-ru-marketing зона
    - Regex / валидатор (нет валидации в нашей фазе)
```

## Dependencies / external sources

- **Libraries to add:** ничего.
- **Skills to load для воркеров:** `skill-evaluation`, `ru-text-quick`, `karpathy-guidelines`.
- **Источники истины:**
  - `/home/ubuntu/tools/ohmy-seo/vendor/yandex-direct-docs-snapshot/docs/moderation/technical-restrictions.md` — главный источник лимитов (точно цитировать)
  - `vendor/yandex-direct-docs-snapshot/docs/moderation/ad-rules.md`, `adv-rules.md` — для `style-and-avoid.md`
  - `/home/ubuntu/downloads/test_direct.csv` — golden sample для `csv-workflow.md`
  - https://yandex.ru/support/direct/ru/moderation/technical-restrictions (приоритет если расходится со snapshot, помечать дату сверки)

## Architecture decisions

- **Никакой клиентской валидации.** Direct API + модерация — single source of truth. Преимущества: (а) всегда актуальные правила, (б) не дублируем логику Яндекса, (в) убираем риск false-pass от устаревшего валидатора. Trade-off: цикл «написал → залил → промодерилось → отклонилось → переписал» дольше, и это сложнее чем «sync upload reject» — см. ниже.

- **Модерация Direct асинхронная и частичная** (важно для Phase 3.5.C, фиксируем контракт здесь чтобы C-фаза не построила pipeline на ложной модели «sync reject»):
  - `Ads.add` создаёт объявление в статусе **DRAFT** — это **не** успех модерации, это «черновик принят, ошибок в формате запроса нет».
  - Чтобы реально отправить на модерацию — отдельный вызов `Ads.moderate`. Без него черновик так и висит.
  - После `moderate` статус идёт через **MODERATION → PREACCEPTED → ACCEPTED** или **REJECTED**. Между ними от секунд до часов.
  - Возможны **частичные** результаты: в `AddResults.Errors[]` / `Warnings[]` приходит per-item обратная связь — одна группа из 10 может полностью пройти, другая — частично, третья — целиком отклонена.
  - Возможно **пост-факторное отклонение** — объявление было ACCEPTED, через сутки модератор пересмотрел и отозвал.
  - Phase 3.5.C обязана: (а) загружать DRAFT batch'ем, (б) явно вызывать moderate, (в) поллить статус с экспоненциальным backoff, (г) парсить per-item Errors/Warnings и маппить обратно на `cluster_id` + `ad_variant_id`, (д) хранить historic moderation log для пост-факторных revoke'ов.

- **Per-field лимиты — REFERENCE, не правила.** В `limits-and-moderation.md` точно фиксируем как у Яндекса, чтобы агент писал в рамках — но не пишем код, который это проверяет.
- **Скилл и API-скилл разделены.** Один — про маркетинг, второй — про API-контракт.
- **`forbidden-patterns` переименовался в `style-and-avoid`** — точнее отражает суть: не «запреты», а «лучше избегай для скорости модерации».
- **Reference-файлы по 1 ответственности.**
- **Глобальный grep на ссылки** — обязательный шаг перед удалением старой папки (codex round-1 finding).

- **Batch-risk guidance в `cluster-to-campaign-strategy.md`** (контракт для Phase 3.5.C, фиксируем здесь чтобы C не плодила сразу 300+ креативов):
  - При CSV на 100+ кластеров — **обязателен canary**: сначала загрузить 5-10% первых объявлений, дождаться полной модерации, проанализировать процент REJECTED, **только потом** дозаливать остальное.
  - Hard cap batch'а в moderate: **≤ 100 объявлений за один заход**. Больше — chunking.
  - Phase 3.5.C должна резервировать **units budget** и останавливаться при rejection rate > 30% (порог обсуждается в SPEC C, ориентир здесь).
  - Стабильные ID: `cluster_id` из CSV + `ad_variant_id` (1/2/3 внутри группы) — нужны для маппинга feedback'а Direct → конкретный шаблон → конкретный кластер.
- **Per-field лимиты — REFERENCE, не правила.** В `limits-and-moderation.md` точно фиксируем как у Яндекса, чтобы агент писал в рамках — но не пишем код, который это проверяет.
- **Скилл и API-скилл разделены.** Один — про маркетинг, второй — про API-контракт.
- **`forbidden-patterns` переименовался в `style-and-avoid`** — точнее отражает суть: не «запреты», а «лучше избегай для скорости модерации».
- **Reference-файлы по 1 ответственности.**
- **Глобальный grep на ссылки** — обязательный шаг перед удалением старой папки (codex round-1 finding).

## Checklist (10 task contracts)

1. **TASK-3501-A1** — Переименование `yandex-direct-spec` → `yandex-direct-creatives` (через `mv`), создание placeholder для новых references. Risk: low.
2. **TASK-3501-A2** — `references/limits-and-moderation.md` — точные per-field лимиты из источника. Risk: low (медленно, нужна аккуратность с источником).
3. **TASK-3501-A3** — `references/style-and-avoid.md` — guidance без enforcement. depends: A1. Risk: low.
4. **TASK-3501-A4** — `references/csv-workflow.md` — 25 колонок + пайплайн. depends: A1. Risk: low.
5. **TASK-3501-A5** — `references/cluster-to-campaign-strategy.md`. depends: A4. Risk: low.
6. **TASK-3501-A6** — `references/composition-templates.md` — 4×2 шаблона. depends: A2, A3. Risk: low (ru-text-quick прогон).
7. **TASK-3501-A7** — Глобальный grep `yandex-direct-spec` в `~/.claude/{skills,agents}`, замена на `yandex-direct-creatives` во ВСЕХ найденных файлах. depends: A1. Risk: medium (можем сломать чужие скиллы, если ссылки в неожиданных форматах).
8. **TASK-3501-A8** — Переписать `SKILL.md` под `skill-evaluation` чек-лист. depends: A2, A3, A4, A5, A6. Risk: low.
9. **TASK-3501-A9** — Обновить `~/.claude/agents/ads-specialist.md`: skills блок + таблица «Когда что грузить». depends: A8. Risk: low.
10. **TASK-3501-A10** — Финальный аудит: `skill-evaluation` чек-лист + `rg -n "yandex-direct-spec"` = 0. depends: A7, A9. Risk: low.

**Граф зависимостей:**

```
A1 ──┬──> A2 ──┬──> A6 ──> A8 ──> A9 ──> A10
     ├──> A3 ──┘                          ^
     ├──> A4 ──> A5 ──┐                   |
     └──> A7 ──────────────────────────────┘
```

Параллельная фаза: A2, A3, A4, A7 — все стартуют сразу после A1 (4 worker'а параллельно).

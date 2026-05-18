# SPEC: Google Skills Pre-Phase-3

**Цель:** Подготовить три недостающих скилла в `~/.claude/skills/` перед стартом
Phase 3 (имплементация `@ohmy-seo/google-seo`). Без них worker-coder будет
гадать про Google OAuth flows, GTM API endpoints, и сломанные `→` ссылки в
SKIP-правилах существующих скиллов останутся висеть.

## Контекст

В `~/.claude/skills/` уже есть:
- `ga4-data-api` — GA4 Data API v1beta, 2 673 строки, risk:high-stakes
- `google-search-console` — GSC API v1, 1 794 строки, risk:high-stakes
- `skill-evaluation` — meta-скилл с audit checklist

Оба существующих скилла в своих frontmatter `description` упоминают:
- `→gtm` (как owner всего GTM)
- `→google-cloud-auth` (как owner OAuth / Service Account / ADC)

Этих двух скиллов **нет** — это broken pointers, нарушение `Related Skills`
пункта audit-checklist.

## Что делаем

### TASK-801: написать `google-cloud-auth`

Канонический owner Google auth для всей семьи (GSC, GA4, GTM, YouTube,
BigQuery и др.). Покрывает:

- OAuth 2.0 user flow (installed app + web app)
- Service Account JWT bearer flow
- Application Default Credentials (ADC) discovery chain
- Scopes catalog для всех Google API, которые мы реально используем
- Refresh-token lifecycle, `invalid_grant` recovery
- Error patterns (401 vs 403 vs 429 vs 500)

**Структура:**
```
~/.claude/skills/google-cloud-auth/
├── SKILL.md                                # < 500 строк, навигатор
└── references/
    ├── oauth2-user-flow.md                 # installed app + web app
    ├── service-account.md                  # JWT bearer + domain delegation
    ├── adc.md                              # Application Default Credentials
    ├── scopes-catalog.md                   # все Google scopes, что мы юзаем
    ├── refresh-tokens.md                   # lifecycle, invalid_grant
    └── errors.md                           # 401/403/429/500 patterns
```

### TASK-802: написать `gtm` (Google Tag Manager API v2)

**Read + Write.** Полный CRUD над GTM-ресурсами включая publish/rollback версий.

**Покрывает:**
- Иерархия: Account → Container → Workspace → Tag/Trigger/Variable/Folder
- Workspaces CRUD + sync (резолв конфликтов с published version)
- Tags / Triggers / Variables CRUD (создание, обновление, удаление)
- Templates (custom templates библиотека)
- Versions: create_version, publish, get_live, undelete
- Rollback: возврат на предыдущий live version (двухшаговый: create_version
  from old → publish)
- Quotas (write ops лимитированы), `etag` для optimistic concurrency

**Структура:**
```
~/.claude/skills/gtm/
├── SKILL.md
└── references/
    ├── setup.md
    ├── resources-hierarchy.md
    ├── tags-triggers-variables.md
    ├── workspaces.md
    ├── versions-publish.md
    ├── rollback.md
    ├── errors.md
    └── cookbook.md                         # 5-8 реальных автоматизаций
```

### TASK-803: аудит + регенерация version-блоков

После 801 и 802:
1. Добавить `google-cloud-auth` и `gtm` в `~/.claude/STACK_VERSIONS.md` (если
   ещё нет рядов) + в `PINS` и `SKILL_STACKS` в `sync_skill_versions.py`.
2. `python3 ~/.claude/scripts/sync_skill_versions.py` — перегенерация
   version-блоков во всех затронутых скиллах.
3. Прогнать `skill-evaluation` audit checklist (см. SKILL-md этого скилла,
   секция Audit checklist) на:
   - `google-cloud-auth` (новый)
   - `gtm` (новый)
   - `ga4-data-api` (broken pointers теперь должны резолвиться)
   - `google-search-console` (broken pointers теперь должны резолвиться)
4. Доложить YAML-отчёт о failing checks.

## Acceptance

| Критерий | TASK-801 | TASK-802 | TASK-803 |
|---|---|---|---|
| SKILL.md < 500 строк | ✓ | ✓ | n/a |
| Каждый ref/*.md < 500 строк | ✓ | ✓ | n/a |
| `description` 150–400 chars с `[RU:]` префиксом, trigger-словами, SKIP-правилами | ✓ | ✓ | n/a |
| Все секции из audit-checklist на месте (Use / Do not use / Purpose / Capabilities / Behavioral Traits / Important Constraints / Related Skills / API Reference) | ✓ | ✓ | проверить |
| `## API Reference` таблица перечисляет ВСЕ refs (no orphans) | ✓ | ✓ | проверить |
| `## Related Skills` ссылается только на существующие скиллы | ✓ | ✓ | проверить |
| Version-блок `<!-- versions:start --> ... <!-- versions:end -->` присутствует | ✓ (после 803) | ✓ (после 803) | сгенерировать |
| Никакого хардкода версий в теле | ✓ | ✓ | проверить |
| Никаких пустых `### ❌ ...` без body | ✓ | ✓ | проверить |
| `risk: high-stakes` в frontmatter | ✓ | ✓ | n/a |

## Конвенции стиля (для consistency с существующими)

- Frontmatter `description` начинается с `[RU: <русские триггеры>]` —
  паттерн используется в ga4-data-api и google-search-console.
- В YAML frontmatter: `source: vechkasov-global-skills`, `risk: high-stakes`.
- `## Use this skill when` — bullet list концретных юз-кейсов с инструментами
  (а не общие фразы).
- `## Capabilities` — каждая sub-секция имеет real body (≥ 2-3 предложения),
  никаких пустых `### Foo` без контента.
- В references/ — реальные curl/Node/Python примеры, не псевдокод.

## Risk

- **Medium:** broken pointers резолвятся только после успешного выполнения и
  801, и 802. Если одна из задач провалится — Phase 3 не стартует, но
  существующие скиллы не сломаются (они уже в текущем виде юзабельны).
- **Не трогаем production-code в `ohmy-seo`** — это работа над глобальными
  скиллами, изолировано от monorepo.

## Out of scope

- Имплементация `@ohmy-seo/google-seo` — это Phase 3, отдельный SPEC.
- Скиллы под YouTube / Threads — будут отдельными задачами после Phase 3.
- Eval cases (positive/negative routing prompts) для новых скиллов — пишем
  в follow-up если будет видно дрейф маршрутизации.

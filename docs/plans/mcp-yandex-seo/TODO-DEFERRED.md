# Deferred Findings — to address in TASK-010

## 🟡 Metrika Zod schemas miss optional fields (TASK-005)

The Zod schemas in `src/index.ts` for `metrika_search_phrases` and `metrika_traffic_summary`
miss two optional input fields specified in SPEC.md:

- `metrika_search_phrases.search_engine`: z.enum(["yandex","google","all"]).default("all")
- `metrika_traffic_summary.group_by`: z.enum(["day","week","month","none"]).default("none")

Tool functions accept these as optional with the defaults — so calls work, but the model
cannot override the filter / grouping.

Fix in TASK-010: add the two fields to the schemas and forward them in the handler arrow funcs.

## 🟢 Low — Dead code in index.ts (TASK-007)

`const STUB = ...` at src/index.ts:18 is declared but never used after all 7 tools were
wired to real handlers. tsc passes (no `noUnusedLocals` in tsconfig), but the IDE flags it.

Fix in TASK-010: remove the `STUB` constant definition and any leftover imports.

---

## ✅ Final acceptance review (TASK-010)

- [x] `npm run build` green — tsc exits 0, no errors
- [x] `npm start` prints `mcp-yandex-seo v0.1.0 running via stdio` in stderr (version confirmed in src/index.ts line 21)
- [x] All 7 tools registered with descriptions >= 150 characters each (verified in src/index.ts)
- [x] `npm run smoke` works with `--only=webmaster|metrika|wordstat|mutagen|all` flags
- [x] Missing env → FATAL message with hint, no stack trace (validateRequiredEnv() in index.ts)
- [x] `.env` in `.gitignore`, `.env.example` present
- [x] Secret leak audit: sanitizeForOutput + tokenFingerprint prevent token in stdout/stderr (TASK-009)
- [x] 401 from Yandex → `isError:true` with token refresh hint (errors.ts AuthError handler)
- [x] 429/Retry-After → `isError:true` with wait hint (errors.ts RateLimitError handler)
- [x] README with full instructions and `claude mcp add` snippet
- [x] File budgets: all .ts files within SPEC hard caps (index.ts=185/200, smoke.ts=177/300, all lib/tools within caps)
- [x] `package.json` version === "0.1.0"
- [x] `src/index.ts` McpServer version === "0.1.0"
- [x] `const STUB` removed from src/index.ts
- [x] Metrika schemas: `search_engine` added to `metrika_search_phrases`, `group_by` added to `metrika_traffic_summary` — both forwarded to run* handlers

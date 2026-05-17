# API Notes for mcp-yandex-seo v0.1.0

## 1. Direct Wordstat auth header

Answer: `Authorization: Bearer <token>` (NOT `OAuth <token>`)

Evidence: Official Yandex Direct API v5 docs (retrieved 2026-05-17 via HTTP):
> "Authorization — Содержит OAuth-токен пользователя Яндекс Директа, от имени которого
> осуществляется запрос к API.
> `Authorization: Bearer 0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f`"

Note: The label says "OAuth-token" but the actual header prefix is `Bearer`, not `OAuth`.
This differs from Webmaster/Metrika which use `OAuth <token>`.

Url checked: https://yandex.ru/dev/direct/doc/ru/concepts/headers
(301 redirect from /dev/direct/doc/dg/concepts/headers.html)

## 2. Webmaster diagnostics endpoint

Answer: `GET /v4/user/{userId}/hosts/{hostId}/diagnostics`

Full URL: `https://api.webmaster.yandex.net/v4/user/{userId}/hosts/{hostId}/diagnostics`

Evidence: Python client (bzdvdn/yandex-webmaster-api) source:
```python
endpoint = f"user/{self.user_id}/hosts/{host_id}/diagnostics"
```
Also confirmed by stufently/yandex-mcp (production MCP server):
```js
const data = await apiRequest(await hostUrl(host_id, '/diagnostics'));
```
The endpoint path is `/diagnostics` (NOT `/diagnostics/` with trailing slash, NOT `/insights/`).

Url checked:
- https://raw.githubusercontent.com/bzdvdn/yandex-webmaster-api/master/yandex_webmaster/client.py
- https://raw.githubusercontent.com/stufently/yandex-mcp/main/packages/yandex-webmaster-mcp/src/index.mjs
- Yandex docs referenced: https://yandex.ru/dev/webmaster/doc/dg/reference/host-diagnostics-get.html

## 3. Webmaster hostId format

Answer: `https:example.com:443` (colons replace slashes, port always explicit)

Examples from official Python client docstring:
- `"http:ya.ru:80"` — HTTP site on port 80
- `"https:ya.ru:443"` — HTTPS site on port 443
- `"http:xn--d1acpjx3f.xn--p1ai:80"` — Punycode IDN

Format rule: `<scheme>:<host>:<port>` — no slashes, protocol + host + port all separated by colons.

Encoding note: When used in URL paths the host_id must be URL-encoded:
`https%3Aexample.com%3A443`. The stufently/yandex-mcp docs describe it as
`"URL-encoded, e.g. 'https:example.com:443'"`.

Evidence:
```python
# from client.py get_host() docstring:
"host_id": "https:ya.ru:443",
"ascii_host_url": "https://ya.ru/",
```
```js
// from yandex-mcp index.mjs:
host_id: z.string().describe('Host ID (URL-encoded, e.g. "https:example.com:443")')
```

Url checked: https://raw.githubusercontent.com/bzdvdn/yandex-webmaster-api/master/yandex_webmaster/client.py

## 4. Mutagen balance in response

Answer: NO — `balance` is NOT in the check_key.get response. Requires a separate
`GET /json/{token}/mutagen.balance/` call.

check_key.get response fields (from official docs example):
```json
{
  "status": "completed",
  "key": "mp3",
  "strong": 25,
  "wordstat": 31460,
  "tails": 5174841,
  "direct": {"spec": 129.3, "first": 6.6, "garant": 6.6},
  "vital": "",
  "vital_site": ""
}
```

No `balance` field. Balance is a dedicated endpoint:
```
GET http://api.mutagen.ru/json/{token}/mutagen.balance/
Response: {"balance": 100.00}
```

Implementation note for mutagen-competition tool: call `mutagen.balance` separately if
you need to expose remaining balance. The competition check itself is async:
1. POST `mutagen.check_key.new/?key=<phrase>` → `{task_id, status}`
2. GET `mutagen.check_key.get/?task_id=<id>` → poll until `status == "completed"`
3. Result fields: `strong` (1-25 competition score), `wordstat`, `direct.spec/first/garant`

Also note: `kw_info` and `aggregator` fields mentioned in the task contract do NOT appear
in the official Mutagen API docs at all — these are not valid fields for this API.

Url checked: https://mutagen.ru/?p=api

## 5. JSON Schema dialect from SDK 1.29 registerTool

Answer: **draft-07 by default** (NOT 2020-12). No `$schema` field emitted.

Evidence from SDK 1.29.0 source (extracted from npm pack):

File: `dist/cjs/server/zod-json-schema-compat.js` — the `toJsonSchemaCompat` call in `mcp.js`
passes only `{strictUnions: true, pipeStrategy: 'input'}` with no `target`:

```js
// mcp.js lines 81-84 (SDK 1.29.0)
? (0, zod_json_schema_compat_js_1.toJsonSchemaCompat)(obj, {
    strictUnions: true,
    pipeStrategy: 'input'
})
```

Since `target` is `undefined`, `mapMiniTarget(undefined)` returns `'draft-7'`.
For Zod v3 schemas, `zodToJsonSchema` uses `defaultOptions.target = "jsonSchema7"` (= draft-07).

File: `zod-to-json-schema@3.25.1 dist/cjs/Options.js`:
```js
exports.defaultOptions = {
    target: "jsonSchema7",   // ← draft-07 is the default
    ...
};
```

MCP spec 2025-11-25 (SEP-1613) says schemas SHOULD use 2020-12, but the SDK does NOT
enforce this — it produces draft-07 schemas without a `$schema` field.

Workaround: No production code change needed for v0.1.0. The SDK sends tool input schemas
to Claude as opaque JSON objects — Claude ignores the `$schema` field anyway. If strict
2020-12 compliance is required in the future, pass `target: 'jsonSchema2019-09'` (confusingly
named, but it maps to 2020-12 in the compat layer). Example:

```ts
// Force 2020-12 if ever needed (not needed for v0.1.0):
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
const schema = toJsonSchemaCompat(zodSchema, { target: 'draft-2020-12' });
```

For v0.1.0: use SDK as-is. draft-07 output is compatible with all current MCP clients
including Claude Desktop and Claude Code.

Url checked: npm pack @modelcontextprotocol/sdk@1.29.0 → local file analysis

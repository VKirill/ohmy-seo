# @ohmy-seo/gtm v0.1.0

MCP server for Claude Code providing 27 tools for Google Tag Manager: read access
to accounts, containers, workspaces, tags, triggers, variables, and versions; write
operations for creating and updating entities; and version publish and rollback with
a two-step confirmation gate. Secrets are encrypted in a local SQLite database using
AES-256-GCM. Write tools require `confirm: true`; publish and rollback additionally
require `acknowledge_live: "I-UNDERSTAND-THIS-IS-LIVE"`.

## Install

```bash
pnpm install
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_GTM_MASTER_KEY` | yes | — | 32 hex bytes for AES-256-GCM encryption. Generate: `openssl rand -hex 32` |
| `MCP_GTM_DB_PATH` | no | `./data/state.db` | Path to the local SQLite state database |
| `MCP_GTM_CACHE_TTL_READ` | no | `3600` | Cache TTL for read tool results (seconds) |
| `MCP_GTM_CACHE_TTL_VERSIONS` | no | `300` | Cache TTL for version listings (seconds) |
| `MCP_GTM_OAUTH_LOOPBACK_PORT` | no | `8767` | Port for OAuth loopback redirect |

## Tools

### Read (no confirmation required)

- `gtm_list_accounts` — list accessible GTM accounts (1h cache)
- `gtm_list_containers` — list containers in an account (1h cache)
- `gtm_list_workspaces` — list workspaces in a container (1h cache)
- `gtm_list_tags` — list tags in a workspace (1h cache)
- `gtm_list_triggers` — list triggers in a workspace (1h cache)
- `gtm_list_variables` — list variables in a workspace (1h cache)
- `gtm_list_versions` — list container versions (5-min cache)
- `gtm_get_version` — get a specific container version (1h cache)

### Write (require `confirm: true`)

- `gtm_create_workspace` — create a new workspace
- `gtm_create_tag` — create a tag in a workspace
- `gtm_update_tag` — update an existing tag
- `gtm_delete_tag` — delete a tag from a workspace
- `gtm_create_trigger` — create a trigger in a workspace
- `gtm_create_variable` — create a variable in a workspace
- `gtm_create_version` — create a container version from a workspace

### Danger (require `confirm: true` + `acknowledge_live: "I-UNDERSTAND-THIS-IS-LIVE"`)

- `gtm_publish_version` — publish a version to live (two-step: preview then confirm)
- `gtm_rollback` — roll back to a previous version (two-step within 60s window)

### OAuth / Account management (8 tools)

- `register_google_oauth_app` — register OAuth client credentials
- `list_google_oauth_apps` — list registered OAuth apps
- `delete_google_oauth_app` — remove an OAuth app
- `list_google_accounts` — list connected Google accounts
- `start_google_oauth_flow` — begin browser OAuth flow, returns auth URL
- `complete_google_oauth_flow` — complete flow with auth code
- `delete_google_account` — remove a connected account
- `set_default_google_account` — set default account for all tools

### Cache

- `gtm_invalidate_cache` — invalidate cached responses
- `gtm_cache_stats` — show cache hit/miss statistics

## OAuth setup

Follow the quickstart in `~/.claude/skills/google-cloud-auth/SKILL.md`.

**Short version (User OAuth):**
1. Google Cloud Console → APIs & Services → Credentials → Create OAuth Client ID
2. Enable: Tag Manager API
3. `register_google_oauth_app({label, client_id, client_secret, scopes_declared, redirect_uri})`
4. `start_google_oauth_flow({app_label, account_label})` → open URL in browser
5. Grant access → loopback callback completes automatically (port 8767)
6. `set_default_google_account({label})`

> WARNING: `gtm_publish_version` and `gtm_rollback` affect live containers.
> Always verify the target container with `gtm_list_containers` first. Use separate
> GTM accounts or workspaces to isolate production containers during development.

## Build

```bash
pnpm run build
```

Output is written to `./dist/`. The entry point `./dist/index.js` is the MCP
server binary registered as `mcp-gtm`.

## Connect to Claude Code

```bash
pnpm run build
export MCP_GTM_MASTER_KEY=$(openssl rand -hex 32)
claude mcp add mcp-gtm node /path/to/packages/gtm/dist/index.js \
  -e MCP_GTM_MASTER_KEY=$MCP_GTM_MASTER_KEY
```

## Smoke test

```bash
pnpm run build
export MCP_GTM_MASTER_KEY=$(openssl rand -hex 32)
pnpm run smoke
```

## Security

- OAuth tokens are encrypted with AES-256-GCM; master key lives only in env.
- `data/state.db` is created with `chmod 0600` — readable only by the owning user.
- The master key is never logged or included in tool responses.
- Write operations require explicit confirmation to prevent accidental tag changes.
- Publish and rollback require a literal acknowledgement string on top of confirm.

## License

MIT

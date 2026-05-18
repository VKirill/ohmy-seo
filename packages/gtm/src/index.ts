#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolvePackageConfig } from "@ohmy-seo/mcp-core/config";
import { registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import pkg from "../package.json" with { type: "json" };

// OAuth management tools
import { runListGoogleOauthApps } from "./tools/list-google-oauth-apps.js";
import { runRegisterGoogleOauthApp } from "./tools/register-google-oauth-app.js";
import { runDeleteGoogleOauthApp } from "./tools/delete-google-oauth-app.js";
import { runListGoogleAccounts } from "./tools/list-google-accounts.js";
import { runStartGoogleOauthFlow } from "./tools/start-google-oauth-flow.js";
import { runCompleteGoogleOauthFlow } from "./tools/complete-google-oauth-flow.js";
import { runDeleteGoogleAccount } from "./tools/delete-google-account.js";
import { runSetDefaultGoogleAccount } from "./tools/set-default-google-account.js";
import { runRegisterServiceAccount } from "./tools/register-google-service-account.js";

// Read tools (cacheable)
import { runGtmListAccounts } from "./tools/gtm-list-accounts.js";
import { runGtmListContainers } from "./tools/gtm-list-containers.js";
import { runGtmListWorkspaces } from "./tools/gtm-list-workspaces.js";
import { runGtmListTags } from "./tools/gtm-list-tags.js";
import { runGtmListTriggers } from "./tools/gtm-list-triggers.js";
import { runGtmListVariables } from "./tools/gtm-list-variables.js";
import { runGtmListVersions } from "./tools/gtm-list-versions.js";
import { runGtmGetVersion } from "./tools/gtm-get-version.js";

// Write tools
import { runGtmCreateWorkspace } from "./tools/gtm-create-workspace.js";
import { runGtmCreateTag } from "./tools/gtm-create-tag.js";
import { runGtmCreateTrigger } from "./tools/gtm-create-trigger.js";
import { runGtmCreateVariable } from "./tools/gtm-create-variable.js";
import { runGtmUpdateTag } from "./tools/gtm-update-tag.js";
import { runGtmDeleteTag } from "./tools/gtm-delete-tag.js";
import { runGtmCreateVersion } from "./tools/gtm-create-version.js";

// DANGER tools
import { runGtmPublishVersion } from "./tools/gtm-publish-version.js";
import { runGtmRollback } from "./tools/gtm-rollback.js";

const PKG_VERSION: string = pkg.version;

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: false };
const WRITE = { readOnlyHint: false, openWorldHint: true, idempotentHint: false };
const DANGER = { readOnlyHint: false, openWorldHint: true, idempotentHint: false };

const server = new McpServer(
  { name: "mcp-gtm", version: PKG_VERSION },
  {
    instructions:
      "You have access to mcp-gtm: 26 tools for Google Tag Manager. " +
      "OAuth management (9 tools): list_google_oauth_apps, register_google_oauth_app, delete_google_oauth_app, " +
      "list_google_accounts, start_google_oauth_flow, complete_google_oauth_flow (deprecated), " +
      "delete_google_account, set_default_google_account, register_google_service_account. " +
      "Read tools (8, cacheable): gtm_list_accounts, gtm_list_containers, gtm_list_workspaces, " +
      "gtm_list_tags, gtm_list_triggers, gtm_list_variables (TTL 1 h); " +
      "gtm_list_versions, gtm_get_version (TTL 5 min). " +
      "Write tools (7): gtm_create_workspace, gtm_create_tag, gtm_create_trigger, gtm_create_variable, " +
      "gtm_update_tag, gtm_delete_tag, gtm_create_version. " +
      "DANGER tools (2): gtm_publish_version, gtm_rollback — affect live containers. " +
      "Requires MCP_GTM_MASTER_KEY in .env.",
  },
);

function validateRequiredEnv(): void {
  try {
    resolvePackageConfig("gtm");
  } catch (err) {
    console.error("FATAL: " + (err as Error).message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Cache policy registration for 8 read tools
// ---------------------------------------------------------------------------

registerCacheableTool("gtm_list_accounts", {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_READ",
  ttlDefaultSeconds: 3600,
});
registerCacheableTool("gtm_list_containers", {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_READ",
  ttlDefaultSeconds: 3600,
});
registerCacheableTool("gtm_list_workspaces", {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_READ",
  ttlDefaultSeconds: 3600,
});
registerCacheableTool("gtm_list_tags", {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_READ",
  ttlDefaultSeconds: 3600,
});
registerCacheableTool("gtm_list_triggers", {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_READ",
  ttlDefaultSeconds: 3600,
});
registerCacheableTool("gtm_list_variables", {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_READ",
  ttlDefaultSeconds: 3600,
});
registerCacheableTool("gtm_list_versions", {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_VERSIONS",
  ttlDefaultSeconds: 300,
});
registerCacheableTool("gtm_get_version", {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_VERSIONS",
  ttlDefaultSeconds: 300,
});

// ---------------------------------------------------------------------------
// OAuth management tools (9)
// ---------------------------------------------------------------------------

server.registerTool(
  "list_google_oauth_apps",
  {
    title: "Google OAuth — List Registered Apps",
    description:
      "Returns all Google OAuth applications registered in the local encrypted database. " +
      "Each entry shows label, client_id, declared scopes, and created_at. " +
      "Client secrets are never returned — stored encrypted. " +
      "Use before starting an OAuth flow or to audit registered credentials.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => runListGoogleOauthApps(),
);

server.registerTool(
  "register_google_oauth_app",
  {
    title: "Google OAuth — Register New App",
    description:
      "Registers a new Google OAuth application in the local encrypted database. " +
      "client_secret is AES-256 encrypted before storage. " +
      "redirect_uri must be a loopback URI (http://127.0.0.1:PORT/oauth/callback) — " +
      "OOB redirect is not supported (Google deprecated it 2023-01-31). " +
      "After registration, use start_google_oauth_flow to connect an account.",
    inputSchema: {
      label: z.string().min(1).max(64).describe("Short unique name for this app, e.g. 'my-gtm-app'"),
      client_id: z.string().min(8).max(256).describe("Google OAuth client_id from Google Cloud Console"),
      client_secret: z.string().min(8).max(256).describe("Google OAuth client_secret (stored encrypted)"),
      scopes_declared: z.string().min(1).max(512).describe("Space-delimited OAuth scopes"),
      redirect_uri: z.string().min(1).describe("Loopback redirect URI, e.g. http://127.0.0.1:8765/oauth/callback"),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    runRegisterGoogleOauthApp({
      label: args.label as string,
      client_id: args.client_id as string,
      client_secret: args.client_secret as string,
      scopes_declared: args.scopes_declared as string,
      redirect_uri: args.redirect_uri as string,
    }),
);

server.registerTool(
  "delete_google_oauth_app",
  {
    title: "Google OAuth — Delete App",
    description:
      "Deletes a registered Google OAuth application by label. Blocked if accounts are linked to it — " +
      "delete those first with delete_google_account. Action is irreversible.",
    inputSchema: {
      app_label: z.string().min(1).max(64).describe("Label of the OAuth app to delete"),
    },
    annotations: WRITE,
  },
  async (args) => runDeleteGoogleOauthApp({ app_label: args.app_label as string }),
);

server.registerTool(
  "list_google_accounts",
  {
    title: "Google OAuth — List Connected Accounts",
    description:
      "Returns all Google accounts connected via OAuth or Service Account stored in the local database. " +
      "Shows label, google_email, auth_method, scopes_granted, expires_at, and is_default. " +
      "Tokens are never returned — stored encrypted.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => runListGoogleAccounts(),
);

server.registerTool(
  "start_google_oauth_flow",
  {
    title: "Google OAuth — Start Authorization Flow",
    description:
      "Begins a Google OAuth authorization code flow with automatic loopback callback. " +
      "Opens a local HTTP listener, returns an authorize_url to open in a browser. " +
      "Waits up to 5 minutes for the user to complete authorization, then saves the account. " +
      "account_label must be free (not already taken — check list_google_accounts).",
    inputSchema: {
      app_label: z.string().min(1).max(64).describe("Label of the registered OAuth app to use"),
      account_label: z.string().min(1).max(64).describe("Desired label for the new account"),
      login_hint: z.string().optional().describe("Google email to pre-fill in consent screen (optional)"),
    },
    annotations: WRITE,
  },
  async (args) =>
    runStartGoogleOauthFlow({
      app_label: args.app_label as string,
      account_label: args.account_label as string,
      login_hint: args.login_hint as string | undefined,
    }),
);

server.registerTool(
  "complete_google_oauth_flow",
  {
    title: "Google OAuth — Complete Authorization Flow (Deprecated)",
    description:
      "Deprecated. Use start_google_oauth_flow which auto-completes via loopback. " +
      "OOB flow no longer supported since Google deprecated it on 2023-01-31.",
    inputSchema: {
      app_label: z.string().min(1).describe("Label of the registered OAuth app"),
      account_label: z.string().min(1).describe("Desired label for the account"),
      code: z.string().min(1).describe("Authorization code from Google"),
      state: z.string().min(1).describe("State token from start_google_oauth_flow"),
    },
    annotations: WRITE,
  },
  async (args) =>
    runCompleteGoogleOauthFlow({
      app_label: args.app_label as string,
      account_label: args.account_label as string,
      code: args.code as string,
      state: args.state as string,
    }),
);

server.registerTool(
  "delete_google_account",
  {
    title: "Google OAuth — Delete Account",
    description:
      "Deletes a connected Google account by label. Removes tokens from the database. " +
      "Does not revoke tokens on Google's side. To reconnect, run start_google_oauth_flow again.",
    inputSchema: {
      account_label: z.string().min(1).max(64).describe("Label of the account to delete"),
    },
    annotations: WRITE,
  },
  async (args) => runDeleteGoogleAccount({ account_label: args.account_label as string }),
);

server.registerTool(
  "set_default_google_account",
  {
    title: "Google OAuth — Set Default Account",
    description:
      "Marks a Google account as the default. Tools that accept an optional 'account' parameter " +
      "will use this account when none is specified. Use list_google_accounts to see available labels.",
    inputSchema: {
      account_label: z.string().min(1).max(64).describe("Label of the account to set as default"),
    },
    annotations: WRITE,
  },
  async (args) => runSetDefaultGoogleAccount({ account_label: args.account_label as string }),
);

server.registerTool(
  "register_google_service_account",
  {
    title: "Google — Register Service Account",
    description:
      "Registers a Google Service Account from a JSON key file. Validates the key by obtaining an " +
      "access token before saving. Required for tools that need Service Account authentication. " +
      "Provide scopes as space-delimited string.",
    inputSchema: {
      account_label: z.string().min(1).max(64).describe("Label for this service account, e.g. 'gtm-sa'"),
      json_path: z.string().min(1).describe("Absolute path to the service account JSON key file"),
      scopes: z.string().min(1).describe("Space-delimited OAuth scopes"),
    },
    annotations: WRITE,
  },
  async (args) =>
    runRegisterServiceAccount({
      account_label: args.account_label as string,
      json_path: args.json_path as string,
      scopes: args.scopes as string,
    }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMcpContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** MCP content item shape that satisfies the SDK's expected return type. */
type McpTextContent = { type: "text"; text: string };
type McpToolResult = { content: McpTextContent[] };

/**
 * Normalize a tool result to MCP content shape.
 * Tool functions that return GtmCallResult (no `content` field) are wrapped;
 * those that already return {content: [...]} are passed through unchanged.
 */
function normalizeMcpResult(result: unknown): McpToolResult {
  if (
    result !== null &&
    typeof result === "object" &&
    "content" in (result as Record<string, unknown>)
  ) {
    return result as McpToolResult;
  }
  return toMcpContent(result);
}

// ---------------------------------------------------------------------------
// Read tools (8) — cacheable
// ---------------------------------------------------------------------------

server.registerTool(
  "gtm_list_accounts",
  {
    title: "GTM — List Accounts",
    description: "Lists all GTM accounts accessible to the resolved Google account.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
    },
    annotations: READ_ONLY,
  },
  async (args) => toMcpContent(await runGtmListAccounts({ account: args.account })),
);

server.registerTool(
  "gtm_list_containers",
  {
    title: "GTM — List Containers",
    description: "Lists all containers in a GTM account.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID (numeric string)."),
    },
    annotations: READ_ONLY,
  },
  async (args) => toMcpContent(await runGtmListContainers({ account: args.account, accountId: args.accountId as string })),
);

server.registerTool(
  "gtm_list_workspaces",
  {
    title: "GTM — List Workspaces",
    description: "Lists all workspaces in a GTM container.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID (numeric string)."),
      containerId: z.string().describe("GTM Container ID (numeric string)."),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    toMcpContent(
      await runGtmListWorkspaces({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
      }),
    ),
);

server.registerTool(
  "gtm_list_tags",
  {
    title: "GTM — List Tags",
    description: "Lists all tags in a GTM workspace.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID."),
      containerId: z.string().describe("GTM Container ID."),
      workspaceId: z.string().describe("GTM Workspace ID."),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    toMcpContent(
      await runGtmListTags({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        workspaceId: args.workspaceId as string,
      }),
    ),
);

server.registerTool(
  "gtm_list_triggers",
  {
    title: "GTM — List Triggers",
    description: "Lists all triggers in a GTM workspace.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID."),
      containerId: z.string().describe("GTM Container ID."),
      workspaceId: z.string().describe("GTM Workspace ID."),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    toMcpContent(
      await runGtmListTriggers({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        workspaceId: args.workspaceId as string,
      }),
    ),
);

server.registerTool(
  "gtm_list_variables",
  {
    title: "GTM — List Variables",
    description: "Lists all variables in a GTM workspace.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID."),
      containerId: z.string().describe("GTM Container ID."),
      workspaceId: z.string().describe("GTM Workspace ID."),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    toMcpContent(
      await runGtmListVariables({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        workspaceId: args.workspaceId as string,
      }),
    ),
);

server.registerTool(
  "gtm_list_versions",
  {
    title: "GTM — List Version Headers",
    description: "Lists version headers for a GTM container. Short TTL (5 min) because the edit cycle may create new versions frequently.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID."),
      containerId: z.string().describe("GTM Container ID."),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    toMcpContent(
      await runGtmListVersions({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
      }),
    ),
);

server.registerTool(
  "gtm_get_version",
  {
    title: "GTM — Get Version",
    description: "Fetches a specific GTM container version by version ID.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID."),
      containerId: z.string().describe("GTM Container ID."),
      versionId: z.string().describe("GTM Container Version ID."),
    },
    annotations: READ_ONLY,
  },
  async (args) =>
    toMcpContent(
      await runGtmGetVersion({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        versionId: args.versionId as string,
      }),
    ),
);

// ---------------------------------------------------------------------------
// Write tools (7) — NOT cacheable
// ---------------------------------------------------------------------------

server.registerTool(
  "gtm_create_workspace",
  {
    title: "GTM — Create Workspace",
    description: "WRITE — creates a GTM Workspace in the given Container. Requires confirm:true.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID (numeric string)."),
      containerId: z.string().describe("GTM Container ID (numeric string)."),
      name: z.string().describe("Workspace name."),
      description: z.string().optional().describe("Workspace description (optional)."),
      confirm: z.boolean().default(false).describe("Set to true to execute. False returns dry-run preview."),
    },
    annotations: WRITE,
  },
  async (args) =>
    normalizeMcpResult(
      await runGtmCreateWorkspace({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        name: args.name as string,
        description: args.description as string | undefined,
        confirm: args.confirm as boolean,
      }),
    ),
);

server.registerTool(
  "gtm_create_tag",
  {
    title: "GTM — Create Tag",
    description: "WRITE — creates a GTM Tag in the given Workspace. Requires confirm:true.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID (numeric string)."),
      containerId: z.string().describe("GTM Container ID (numeric string)."),
      workspaceId: z.string().describe("GTM Workspace ID (numeric string)."),
      name: z.string().describe("Tag name."),
      type: z.string().describe("Tag type, e.g. 'ua', 'html', 'gclidAdw'."),
      parameter: z.array(z.record(z.string(), z.unknown())).optional().describe("Tag configuration parameters."),
      firingTriggerIds: z.array(z.string()).optional().describe("IDs of triggers that fire this tag."),
      blockingTriggerIds: z.array(z.string()).optional().describe("IDs of triggers that block this tag."),
      tagFiringOption: z.string().optional().describe("Tag firing option, e.g. 'oncePerLoad', 'unlimited'."),
      confirm: z.boolean().default(false).describe("Set to true to execute. False returns dry-run preview."),
    },
    annotations: WRITE,
  },
  async (args) =>
    normalizeMcpResult(
      await runGtmCreateTag({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        workspaceId: args.workspaceId as string,
        name: args.name as string,
        type: args.type as string,
        parameter: args.parameter as Array<{ type: string; key?: string; value?: string; list?: Record<string, unknown>[]; map?: Record<string, unknown>[] }> | undefined,
        firingTriggerIds: args.firingTriggerIds as string[] | undefined,
        blockingTriggerIds: args.blockingTriggerIds as string[] | undefined,
        tagFiringOption: args.tagFiringOption as string | undefined,
        confirm: args.confirm as boolean,
      }),
    ),
);

server.registerTool(
  "gtm_create_trigger",
  {
    title: "GTM — Create Trigger",
    description: "WRITE — creates a GTM Trigger in the given Workspace. Requires confirm:true.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID (numeric string)."),
      containerId: z.string().describe("GTM Container ID (numeric string)."),
      workspaceId: z.string().describe("GTM Workspace ID (numeric string)."),
      name: z.string().describe("Trigger name."),
      type: z.string().describe("Trigger type, e.g. 'pageview', 'click', 'customEvent'."),
      filter: z.array(z.record(z.string(), z.unknown())).optional().describe("Trigger filter conditions."),
      customEventFilter: z.array(z.record(z.string(), z.unknown())).optional().describe("Custom event filter conditions."),
      parameter: z.array(z.record(z.string(), z.unknown())).optional().describe("Additional trigger parameters."),
      confirm: z.boolean().default(false).describe("Set to true to execute. False returns dry-run preview."),
    },
    annotations: WRITE,
  },
  async (args) =>
    normalizeMcpResult(
      await runGtmCreateTrigger({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        workspaceId: args.workspaceId as string,
        name: args.name as string,
        type: args.type as string,
        filter: args.filter as Record<string, unknown>[] | undefined,
        customEventFilter: args.customEventFilter as Record<string, unknown>[] | undefined,
        parameter: args.parameter as Record<string, unknown>[] | undefined,
        confirm: args.confirm as boolean,
      }),
    ),
);

server.registerTool(
  "gtm_create_variable",
  {
    title: "GTM — Create Variable",
    description: "WRITE — creates a GTM Variable in the given Workspace. Requires confirm:true.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID (numeric string)."),
      containerId: z.string().describe("GTM Container ID (numeric string)."),
      workspaceId: z.string().describe("GTM Workspace ID (numeric string)."),
      name: z.string().describe("Variable name."),
      type: z.string().describe("Variable type, e.g. 'v' (constant), 'dlv' (dataLayer)."),
      parameter: z.array(z.record(z.string(), z.unknown())).optional().describe("Variable configuration parameters."),
      confirm: z.boolean().default(false).describe("Set to true to execute. False returns dry-run preview."),
    },
    annotations: WRITE,
  },
  async (args) =>
    normalizeMcpResult(
      await runGtmCreateVariable({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        workspaceId: args.workspaceId as string,
        name: args.name as string,
        type: args.type as string,
        parameter: args.parameter as Record<string, unknown>[] | undefined,
        confirm: args.confirm as boolean,
      }),
    ),
);

server.registerTool(
  "gtm_update_tag",
  {
    title: "GTM — Update Tag",
    description:
      "WRITE — updates a GTM Tag via PUT. Requires a cached etag (run gtm_list_tags first). " +
      "confirm:false returns dry-run preview; confirm:true executes the update.",
    inputSchema: {
      account: z.string().optional().describe("Registered Google account label (optional)."),
      accountId: z.string().describe("GTM Account ID."),
      containerId: z.string().describe("GTM Container ID."),
      workspaceId: z.string().describe("GTM Workspace ID."),
      tagId: z.string().describe("GTM Tag ID to update."),
      name: z.string().optional().describe("Tag display name."),
      type: z.string().optional().describe("Tag type (e.g. 'ua', 'gaawe')."),
      parameter: z.array(z.record(z.string(), z.unknown())).optional().describe("Tag parameters."),
      firingTriggerId: z.array(z.string()).optional().describe("Firing trigger IDs."),
      blockingTriggerId: z.array(z.string()).optional().describe("Blocking trigger IDs."),
      tagFiringOption: z.string().optional().describe("Tag firing option."),
      notes: z.string().optional().describe("Optional notes."),
      confirm: z.boolean().default(false).describe("true = execute; false = dry-run preview."),
    },
    annotations: WRITE,
  },
  async (args) =>
    normalizeMcpResult(
      await runGtmUpdateTag({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        workspaceId: args.workspaceId as string,
        tagId: args.tagId as string,
        name: args.name as string | undefined,
        type: args.type as string | undefined,
        parameter: args.parameter as unknown[] | undefined,
        firingTriggerId: args.firingTriggerId as string[] | undefined,
        blockingTriggerId: args.blockingTriggerId as string[] | undefined,
        tagFiringOption: args.tagFiringOption as string | undefined,
        notes: args.notes as string | undefined,
        confirm: args.confirm as boolean,
      }),
    ),
);

server.registerTool(
  "gtm_delete_tag",
  {
    title: "GTM — Delete Tag",
    description:
      "WRITE — deletes a GTM Tag. Requires a cached etag (run gtm_list_tags first). " +
      "confirm:false returns a dry-run preview; confirm:true executes the delete.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID."),
      containerId: z.string().describe("GTM Container ID."),
      workspaceId: z.string().describe("GTM Workspace ID."),
      tagId: z.string().describe("GTM Tag ID to delete."),
      confirm: z.boolean().default(false).describe("Set to true to execute the delete. false returns a dry-run preview."),
    },
    annotations: WRITE,
  },
  async (args) =>
    normalizeMcpResult(
      await runGtmDeleteTag({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        workspaceId: args.workspaceId as string,
        tagId: args.tagId as string,
        confirm: args.confirm as boolean,
      }),
    ),
);

server.registerTool(
  "gtm_create_version",
  {
    title: "GTM — Create Version",
    description:
      "Creates a checkpoint from current workspace state. Does NOT publish — workspace remains active. " +
      "Use gtm_publish_version separately to make this version live. " +
      "With confirm:false (default) returns a dry-run preview. With confirm:true executes the create_version call.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID (numeric string)."),
      containerId: z.string().describe("GTM Container ID (numeric string)."),
      workspaceId: z.string().describe("GTM Workspace ID (numeric string)."),
      name: z.string().describe("Version name (human-readable label for the checkpoint)."),
      notes: z.string().optional().describe("Optional notes describing what changed in this version."),
      confirm: z.boolean().describe("Set to true to execute. False (default) returns dry-run preview."),
    },
    annotations: WRITE,
  },
  async (args) =>
    normalizeMcpResult(
      await runGtmCreateVersion({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        workspaceId: args.workspaceId as string,
        name: args.name as string,
        notes: args.notes as string | undefined,
        confirm: args.confirm as boolean,
      }),
    ),
);

// ---------------------------------------------------------------------------
// DANGER tools (2) — live container impact
// ---------------------------------------------------------------------------

server.registerTool(
  "gtm_publish_version",
  {
    title: "GTM — Publish Version (DANGER)",
    description:
      "DANGER — affects live container. Publishes a specific GTM container version, making it live. " +
      "Verify version_id is the intended checkpoint. " +
      "Two-step gate: confirm:true + acknowledge_live:'I-UNDERSTAND-THIS-IS-LIVE:<version_id>'. " +
      "With confirm:false (default) returns a dry-run preview with the target version and a warning.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional; uses default if omitted)."),
      accountId: z.string().describe("GTM Account ID (numeric string)."),
      containerId: z.string().describe("GTM Container ID (numeric string)."),
      versionId: z.string().describe("Target GTM Container Version ID to make live."),
      confirm: z.boolean().default(false).describe("Set to true to execute publish. False (default) returns dry-run preview."),
      acknowledge_live: z.string().optional().describe("Required when confirm:true. Must be: I-UNDERSTAND-THIS-IS-LIVE:<versionId>"),
    },
    annotations: DANGER,
  },
  async (args) =>
    normalizeMcpResult(
      await runGtmPublishVersion({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        versionId: args.versionId as string,
        confirm: args.confirm as boolean | undefined,
        acknowledge_live: args.acknowledge_live as string | undefined,
      }),
    ),
);

server.registerTool(
  "gtm_rollback",
  {
    title: "GTM — Rollback Version (DANGER)",
    description:
      "DANGER — affects live container. Two-step DB-backed rollback. " +
      "Step 1 (confirm:false): previews rollback from live → target version, stores a plan (5 min TTL), returns plan_id. " +
      "Step 2 (confirm:true + plan_id + acknowledge_live): atomically claims plan, re-checks fingerprint, publishes target version. " +
      "acknowledge_live format: I-UNDERSTAND-THIS-IS-LIVE:<containerId>.",
    inputSchema: {
      account: z.string().optional().describe("Label of a registered Google account (optional)."),
      accountId: z.string().describe("GTM Account ID."),
      containerId: z.string().describe("GTM Container ID."),
      workspaceId: z.string().describe("GTM Workspace ID."),
      to_version_id: z.string().describe("Target version to roll back to."),
      plan_id: z.string().optional().describe("Required for confirm step. UUID from step 1."),
      confirm: z.boolean().default(false).describe("False (default) = preview. True = execute."),
      acknowledge_live: z.string().optional().describe("Required when confirm:true. Format: I-UNDERSTAND-THIS-IS-LIVE:<containerId>"),
    },
    annotations: DANGER,
  },
  async (args) =>
    normalizeMcpResult(
      await runGtmRollback({
        account: args.account,
        accountId: args.accountId as string,
        containerId: args.containerId as string,
        workspaceId: args.workspaceId as string,
        to_version_id: args.to_version_id as string,
        plan_id: args.plan_id as string | undefined,
        confirm: args.confirm as boolean,
        acknowledge_live: args.acknowledge_live as string | undefined,
      }),
    ),
);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  validateRequiredEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mcp-gtm v${PKG_VERSION} running via stdio`);
}

main().catch((err: Error) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});

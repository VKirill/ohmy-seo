import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runListOauthApps } from "../tools/oauth-list-apps.js";
import { runRegisterOauthApp } from "../tools/oauth-register-app.js";
import { runDeleteOauthApp } from "../tools/oauth-delete-app.js";
import { runListAccounts } from "../tools/oauth-list-accounts.js";
import { runStartOauthFlow } from "../tools/oauth-start-flow.js";
import { runCompleteOauthFlow } from "../tools/oauth-complete-flow.js";
import { runDeleteAccount } from "../tools/oauth-delete-account.js";
import { runSetDefaultAccount } from "../tools/oauth-set-default-account.js";
import { READ_ONLY } from "./_shared.js";

export function registerOauth(server: McpServer): void {
  server.registerTool(
    "list_oauth_apps",
    {
      title: "OAuth — List Registered Apps",
      description:
        "Returns all OAuth applications currently registered in the local database. Each entry shows " +
        "the app label, client_id, declared scopes, and creation timestamp. Use this tool to discover " +
        "which apps are available before starting an OAuth flow or to audit the registered credentials. " +
        "Client secrets are never returned — they are stored encrypted.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runListOauthApps(),
  );

  server.registerTool(
    "register_oauth_app",
    {
      title: "OAuth — Register New App",
      description:
        "Registers a new Yandex OAuth application in the local encrypted database using the provided " +
        "client_id, client_secret, and scope list. The client_secret is AES-256 encrypted before " +
        "storage. After registration, use start_oauth_flow with the returned app label to begin the " +
        "authorization code flow and obtain an account token for a Yandex user.",
      inputSchema: {
        label: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
          .describe("Short unique name for this app, e.g. 'my-seo-app'"),
        client_id: z
          .string()
          .min(8)
          .max(256)
          .describe("Yandex OAuth application client_id from the developer console"),
        client_secret: z
          .string()
          .min(8)
          .max(256)
          .describe("Yandex OAuth application client_secret (stored encrypted)"),
        scopes_declared: z
          .string()
          .min(1)
          .max(512)
          .describe("Space-delimited list of OAuth scopes, e.g. 'webmaster:hostinfo metrika:read'"),
      },
      annotations: READ_ONLY,
    },
    async (args) => runRegisterOauthApp(args),
  );

  server.registerTool(
    "delete_oauth_app",
    {
      title: "OAuth — Delete App",
      description:
        "Deletes a registered OAuth application by its label. The operation is blocked if any accounts " +
        "are still linked to this app — delete those accounts first with delete_account. Once deleted, " +
        "any tokens obtained via this app become unrefreshable (the credentials are gone). This action " +
        "is irreversible; double-check the label with list_oauth_apps before proceeding.",
      inputSchema: {
        label: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
          .describe("Label of the OAuth app to delete"),
      },
      annotations: READ_ONLY,
    },
    async (args) => runDeleteOauthApp(args),
  );

  server.registerTool(
    "list_accounts",
    {
      title: "OAuth — List Connected Accounts",
      description:
        "Returns all Yandex accounts connected via OAuth and stored in the local database. Each entry " +
        "includes the account label, linked yandex_login, granted scopes, token expiry timestamp, and " +
        "whether the account is set as default. Access and refresh tokens are never returned — they " +
        "remain encrypted at rest. Use this to audit available accounts before calling domain tools.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runListAccounts(),
  );

  server.registerTool(
    "start_oauth_flow",
    {
      title: "OAuth — Start Authorization Flow",
      description:
        "Begins a Yandex OAuth authorization code flow for a registered app. Returns an authorize_url " +
        "to open in a browser and an account_label to use in the subsequent complete_oauth_flow call. " +
        "The server is stateless — no pending session is stored. You must pass both account_label and " +
        "app_label again when completing the flow. The account_label must be free (not already taken).",
      inputSchema: {
        app_label: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
          .describe("Label of the registered OAuth app to use for this flow"),
        account_label: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
          .describe("Desired label for the new account, e.g. 'main' or 'client-site'"),
      },
      annotations: READ_ONLY,
    },
    async (args) => runStartOauthFlow(args),
  );

  server.registerTool(
    "complete_oauth_flow",
    {
      title: "OAuth — Complete Authorization Flow",
      description:
        "Completes a Yandex OAuth authorization code flow by exchanging the user-provided code for " +
        "access and refresh tokens. Probes the Yandex Login API and Webmaster API to resolve the " +
        "yandex_login and webmaster_user_id automatically. Tokens are AES-256 encrypted before storage. " +
        "Requires app_label (which app to use), account_label (desired name), and the 7-character code " +
        "copied from the Yandex confirmation page after the user approved the app in the browser.",
      inputSchema: {
        app_label: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
          .describe("Label of the registered OAuth app used in start_oauth_flow"),
        account_label: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
          .describe("Desired label for the new account (same value as passed to start_oauth_flow)"),
        code: z
          .string()
          .min(6)
          .max(16)
          .describe("Authorization code shown on the Yandex confirmation page (typically 7 characters)"),
      },
      annotations: READ_ONLY,
    },
    async (args) => runCompleteOauthFlow(args),
  );

  server.registerTool(
    "delete_account",
    {
      title: "OAuth — Delete Connected Account",
      description:
        "Removes a connected Yandex account from the local database by its label, permanently deleting " +
        "the encrypted access and refresh tokens. After deletion the account cannot be used for any " +
        "domain tools. To reconnect, run start_oauth_flow again. Use list_accounts to verify the label " +
        "before deleting. If the account was the default, another account must be set as default manually.",
      inputSchema: {
        label: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
          .describe("Label of the account to delete"),
      },
      annotations: READ_ONLY,
    },
    async (args) => runDeleteAccount(args),
  );

  server.registerTool(
    "set_default_account",
    {
      title: "OAuth — Set Default Account",
      description:
        "Marks the specified account as the default for all domain tools that accept an optional account " +
        "parameter. Only one account can be default at a time — the previous default is automatically " +
        "cleared. Domain tools fall back to the default account when no explicit account label is passed. " +
        "Use list_accounts to see current accounts and which one is already set as default.",
      inputSchema: {
        label: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9_-]+$/i, { error: () => "label must be alphanumeric, dash or underscore" })
          .describe("Label of the account to mark as default"),
      },
      annotations: READ_ONLY,
    },
    async (args) => runSetDefaultAccount(args),
  );
}

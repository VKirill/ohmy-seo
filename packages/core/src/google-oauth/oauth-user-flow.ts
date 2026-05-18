/**
 * Google OAuth 2.0 Authorization Code flow — loopback only.
 * OOB (urn:ietf:wg:oauth:2.0:oob) is rejected — deprecated 2023-01-31.
 * Native fetch + Node http. No external dependencies.
 */

import http from "node:http";
import { URL, URLSearchParams } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  refresh_token?: string;
}

// ---------------------------------------------------------------------------
// 1. buildAuthorizeUrl
// ---------------------------------------------------------------------------

export interface BuildAuthorizeUrlOpts {
  client_id: string;
  redirect_uri: string;
  scopes: string[];
  state: string;
  login_hint?: string;
}

export function buildAuthorizeUrl(opts: BuildAuthorizeUrlOpts): string {
  const { client_id, redirect_uri, scopes, state, login_hint } = opts;

  if (!state || state.trim() === "") {
    throw new Error("state param is required for CSRF protection");
  }

  if (redirect_uri === "urn:ietf:wg:oauth:2.0:oob") {
    throw new Error(
      "OOB OAuth flow was deprecated by Google on 2023-01-31. " +
        "Use loopback (http://127.0.0.1:PORT/oauth/callback) or Service Account instead."
    );
  }

  const params = new URLSearchParams({
    client_id,
    redirect_uri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });

  if (login_hint) {
    params.set("login_hint", login_hint);
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// 2. exchangeCodeForTokens
// ---------------------------------------------------------------------------

export interface ExchangeCodeOpts {
  client_id: string;
  client_secret: string;
  code: string;
  redirect_uri: string;
}

export async function exchangeCodeForTokens(
  opts: ExchangeCodeOpts
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: opts.client_id,
    client_secret: opts.client_secret,
    code: opts.code,
    redirect_uri: opts.redirect_uri,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed: HTTP ${res.status}`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ---------------------------------------------------------------------------
// 3. refreshAccessToken
// ---------------------------------------------------------------------------

export interface RefreshAccessTokenOpts {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

export async function refreshAccessToken(
  opts: RefreshAccessTokenOpts
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: opts.client_id,
    client_secret: opts.client_secret,
    refresh_token: opts.refresh_token,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: HTTP ${res.status}`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ---------------------------------------------------------------------------
// 4. LoopbackListener
// ---------------------------------------------------------------------------

export interface LoopbackListenerOpts {
  preferredPort?: number;
}

export class LoopbackListener {
  private preferredPort: number;
  private server: http.Server | null = null;
  private port: number | null = null;

  constructor(opts: LoopbackListenerOpts = {}) {
    this.preferredPort = opts.preferredPort ?? 8765;
  }

  async start(): Promise<{ port: number; callbackUrl: string }> {
    const port = await this._bindServer(this.preferredPort);
    this.port = port;
    const callbackUrl = `http://127.0.0.1:${port}/oauth/callback`;
    return { port, callbackUrl };
  }

  private _bindServer(preferredPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      this.server = server;

      // Try preferred port first
      server.listen(preferredPort, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("Failed to get server address"));
          return;
        }
        resolve(addr.port);
      });

      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          // Preferred port busy — ask OS for a free one
          server.removeAllListeners("error");
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (!addr || typeof addr === "string") {
              reject(new Error("Failed to get server address"));
              return;
            }
            resolve(addr.port);
          });
          server.on("error", reject);
        } else {
          reject(err);
        }
      });
    });
  }

  waitForCode(
    state: string,
    timeoutMs: number = 300_000
  ): Promise<{ code: string } | { error: string }> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error("Server not started. Call start() first."));
        return;
      }

      const server = this.server;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this._closeServer().catch(() => undefined);
        resolve({ error: "timeout" });
      }, timeoutMs);

      const settle = (result: { code: string } | { error: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._closeServer().catch(() => undefined);
        resolve(result);
      };

      server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
        if (!req.url) {
          res.writeHead(400);
          res.end("Bad request");
          return;
        }

        const parsed = new URL(req.url, `http://127.0.0.1:${this.port}`);

        if (parsed.pathname !== "/oauth/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const receivedState = parsed.searchParams.get("state");
        const code = parsed.searchParams.get("code");
        const error = parsed.searchParams.get("error");

        if (receivedState !== state) {
          res.writeHead(400);
          res.end("State mismatch — possible CSRF attack. Please restart the auth flow.");
          return;
        }

        const html =
          "<!DOCTYPE html><html><body>" +
          "<h2>Authentication complete.</h2>" +
          "<p>You can close this window.</p>" +
          "</body></html>";

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);

        if (error) {
          settle({ error });
        } else if (code) {
          settle({ code });
        } else {
          settle({ error: "missing code and error params" });
        }
      });
    });
  }

  async stop(): Promise<void> {
    await this._closeServer();
  }

  private _closeServer(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
      this.server = null;
    });
  }
}

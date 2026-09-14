import { audit } from "@/lib/db";
import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { listConnections, accessTokenFor } from "@/lib/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything a locally-installed ohmy-seo needs to rebuild its SQLite state in
 * one round trip: every live connection with a freshly-minted access token.
 * Refresh tokens deliberately stay on the server — the local sync client comes
 * back here when a token ages out, so a leaked laptop cannot mint new ones.
 */
export async function GET(req: Request) {
  const owner = await authenticateApiKey(req);
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!owner.allowTokenExport) return NextResponse.json({ error: "token_export_not_allowed" }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const connections = await listConnections(owner.userId);
  const accounts = await Promise.all(
    connections.map(async (c) => {
      try {
        const t = await accessTokenFor(owner.userId, c.id);
        return {
          connectionId: c.id,
          provider: c.provider,
          label: c.label,
          email: c.accountEmail,
          login: c.accountLogin,
          accessToken: t.accessToken,
          expiresAt: t.expiresAt.toISOString(),
          scopes: c.scopes,
          isDefault: c.isLoginIdentity,
          error: null as string | null,
        };
      } catch (e) {
        return {
          connectionId: c.id,
          provider: c.provider,
          label: c.label,
          email: c.accountEmail,
          login: c.accountLogin,
          accessToken: null,
          expiresAt: null,
          scopes: c.scopes,
          isDefault: c.isLoginIdentity,
          error: e instanceof Error ? e.message : "token unavailable",
        };
      }
    }),
  );

  await audit(owner.userId, "token.exported", { keyId: owner.keyId, count: accounts.length });
  return NextResponse.json({ userId: owner.userId, issuedAt: new Date().toISOString(), accounts });
}

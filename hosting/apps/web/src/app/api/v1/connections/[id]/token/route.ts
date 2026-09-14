import { audit } from "@/lib/db";
import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { accessTokenFor } from "@/lib/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const owner = await authenticateApiKey(req);
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!owner.allowTokenExport) return NextResponse.json({ error: "token_export_not_allowed" }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const { id } = await ctx.params;
  try {
    const t = await accessTokenFor(owner.userId, Number(id));
    await audit(owner.userId, "token.exported", { keyId: owner.keyId }, Number(id));
    return NextResponse.json({
      connectionId: Number(id),
      provider: t.provider,
      accessToken: t.accessToken,
      expiresAt: t.expiresAt.toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

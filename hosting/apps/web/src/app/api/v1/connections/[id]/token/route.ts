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

  const { id } = await ctx.params;
  try {
    const t = await accessTokenFor(owner.userId, Number(id));
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

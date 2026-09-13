import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { listConnections } from "@/lib/connections";
import { PROVIDER_SERVICES } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const owner = await authenticateApiKey(req);
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connections = await listConnections(owner.userId);
  return NextResponse.json({
    connections: connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      label: c.label,
      email: c.accountEmail,
      services: PROVIDER_SERVICES[c.provider],
      scopes: c.scopes,
      expiresAt: c.expiresAt.toISOString(),
    })),
  });
}

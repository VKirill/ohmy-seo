import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const owner = await authenticateApiKey(req);
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await pool.query<{ email: string | null; display_name: string | null }>(
    "SELECT email, display_name FROM users WHERE id = $1",
    [owner.userId],
  );
  return NextResponse.json({
    userId: owner.userId,
    email: r.rows[0]?.email ?? null,
    displayName: r.rows[0]?.display_name ?? null,
  });
}

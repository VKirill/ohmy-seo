import { NextResponse } from "next/server";
import { destroySession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(process.env.APP_URL!).origin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  await destroySession();
  return NextResponse.redirect(`${process.env.APP_URL}/`, { status: 303 });
}

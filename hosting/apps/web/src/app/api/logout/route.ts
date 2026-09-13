import { NextResponse } from "next/server";
import { destroySession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  await destroySession();
  return NextResponse.redirect(`${process.env.APP_URL}/`, { status: 303 });
}

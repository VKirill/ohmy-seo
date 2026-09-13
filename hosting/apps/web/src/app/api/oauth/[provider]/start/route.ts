import { NextResponse, type NextRequest } from "next/server";
import { isProviderId } from "@/lib/providers";
import { currentUser } from "@/lib/session";
import { oauthRedirect } from "@/lib/oauth/redirect";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isProviderId(provider)) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const user = await currentUser();
  if (req.nextUrl.searchParams.get("mode") === "connect" && !user) {
    return NextResponse.redirect(`${process.env.APP_URL}/?error=session_required`);
  }
  // Direct must follow a verified Yandex identity, never an arbitrary session.
  if (provider === "yandex-direct") {
    return NextResponse.redirect(`${process.env.APP_URL}/api/oauth/yandex/start?chain=1&mode=connect`);
  }
  return oauthRedirect({
    provider, userId: user?.id ?? null,
    chain: req.nextUrl.searchParams.get("chain") === "1", retried: false,
  }, provider === "yandex" && user !== null);
}

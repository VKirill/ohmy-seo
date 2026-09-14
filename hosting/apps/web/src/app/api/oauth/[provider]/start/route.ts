import { NextResponse, type NextRequest } from "next/server";
import { isProviderId } from "@/lib/providers";
import { currentUser } from "@/lib/session";
import { oauthRedirect } from "@/lib/oauth/redirect";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isProviderId(provider)) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const user = await currentUser();
  const mode = req.nextUrl.searchParams.get("mode");
  const login = provider === "yandex" && mode !== "connect";
  if (login) {
    if (user) return NextResponse.redirect(`${process.env.APP_URL}/app`);
    try {
      return await oauthRedirect({ provider: "yandex", purpose: "login", userId: null, chain: false, retried: false });
    } catch {
      return NextResponse.redirect(`${process.env.APP_URL}/connect?error=login_unavailable`);
    }
  }
  if (!user) return NextResponse.redirect(`${process.env.APP_URL}/connect?error=session_required`);
  if (provider === "yandex-api") return NextResponse.redirect(`${process.env.APP_URL}/app/connect/yandex-code`);
  if (provider === "yandex-direct") {
    return NextResponse.redirect(`${process.env.APP_URL}/api/oauth/yandex/start?chain=1&mode=connect`);
  }
  return oauthRedirect({
    provider, purpose: "connect", userId: user.id,
    chain: req.nextUrl.searchParams.get("chain") === "1", retried: false,
  }, provider === "yandex");
}

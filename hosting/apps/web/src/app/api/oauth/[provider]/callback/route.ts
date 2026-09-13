import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, PROVIDERS } from "@/lib/oauth";
import { oauthRedirect } from "@/lib/oauth/redirect";
import { verifyFlow } from "@/lib/oauth/state";
import { upsertConnection, hasStoredRefreshToken } from "@/lib/connections";
import { createSession, currentUser } from "@/lib/session";
import { isProviderId, CHAIN_AFTER, PROVIDER_FAMILY } from "@/lib/providers";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isProviderId(provider)) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const expected = req.cookies.get(`ohmy_state_${provider}`)?.value;
  if (!state || !expected || state !== expected) {
    return NextResponse.redirect(`${process.env.APP_URL}/app?error=state_mismatch`);
  }
  try {
    const flow = await verifyFlow(state, provider);
    const session = await currentUser();
    if (flow.userId !== (session?.id ?? null)) throw new Error("Сессия изменилась. Подключите аккаунт заново");
    // Consume the browser state on success, cancellation and failure alike.
    (await cookies()).delete(`ohmy_state_${provider}`);
    if (url.searchParams.has("error")) throw new Error("Подключение отменено");
    const code = url.searchParams.get("code");
    if (!code) throw new Error("missing_code");
    if (provider === "yandex-direct" && (!session || !flow.expectedSubject)) throw new Error("yandex_chain_required");

    const tokens = await exchangeCode(provider, code);
    // Yandex returns basic id/login for ANY valid service token, even when
    // the Direct application has no login scopes. Never borrow a session ID.
    const identity = await PROVIDERS[provider].identity(tokens.accessToken);
    if (flow.expectedSubject && identity.subject !== flow.expectedSubject) {
      throw new Error("Выбран другой аккаунт. Подключите Яндекс заново и выберите один аккаунт на обоих шагах");
    }
    if (provider === "google" && !tokens.refreshToken &&
        !(await hasStoredRefreshToken(provider, identity.subject))) {
      if (flow.retried) throw new Error("Google не предоставил постоянный доступ. Подключите аккаунт заново");
      return oauthRedirect({ ...flow, retried: true, expectedSubject: identity.subject,
        loginHint: identity.email ?? undefined }, true);
    }
    const { userId } = await upsertConnection({ provider, identity, tokens, userId: flow.userId });
    if (!session) await createSession(userId);

    const next = CHAIN_AFTER[provider];
    if (next && flow.chain) {
      return oauthRedirect({ provider: next, userId, chain: true, retried: false,
        expectedSubject: identity.subject, loginHint: identity.login ?? undefined });
    }
    const res = NextResponse.redirect(`${process.env.APP_URL}/app?connected=${PROVIDER_FAMILY[provider]}`);
    res.cookies.delete("ohmy_chain");
    res.cookies.delete("ohmy_oauth_retry");
    return res;
  } catch (e) {
    // Provider errors can contain credentials. Do not log raw endpoint bodies.
    const known = e instanceof Error && /[А-Яа-я]/.test(e.message) ? e.message : "Не удалось завершить авторизацию. Попробуйте ещё раз";
    console.error("[oauth callback] failed", provider);
    const res = NextResponse.redirect(`${process.env.APP_URL}/app?error=${encodeURIComponent(known)}`);
    res.cookies.delete(`ohmy_state_${provider}`);
    return res;
  }
}

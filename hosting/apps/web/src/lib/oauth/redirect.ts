import { yandexLoginUrl } from "./login";
import { NextResponse } from "next/server";
import { authorizeUrl } from "./index";
import { signFlow, type OAuthFlow } from "./state";

export async function oauthRedirect(flow: OAuthFlow, forceConsent = false) {
  const state = await signFlow(flow);
  const res = NextResponse.redirect(flow.purpose === "login" ? yandexLoginUrl(state) : authorizeUrl(flow.provider, state, forceConsent, flow.loginHint));
  res.cookies.set(`ohmy_state_${flow.provider}`, state, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", maxAge: 600,
  });
  return res;
}

import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { ProviderId } from "../providers";

export type OAuthFlow = {
  provider: ProviderId;
  userId: number | null;
  chain: boolean;
  retried: boolean;
  expectedSubject?: string;
  loginHint?: string;
};

function signingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 chars");
  return new TextEncoder().encode(secret);
}

export async function signFlow(flow: OAuthFlow): Promise<string> {
  return new SignJWT({ ...flow })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("ohmy-oauth")
    .setJti(randomBytes(24).toString("base64url"))
    .setIssuedAt().setExpirationTime("10m").sign(signingKey());
}

export async function verifyFlow(state: string, provider: ProviderId): Promise<OAuthFlow> {
  const { payload } = await jwtVerify(state, signingKey(), {
    algorithms: ["HS256"], audience: "ohmy-oauth",
  });
  if (payload.provider !== provider ||
      (payload.userId !== null && (!Number.isSafeInteger(payload.userId) || Number(payload.userId) <= 0)) ||
      typeof payload.chain !== "boolean" || typeof payload.retried !== "boolean") {
    throw new Error("invalid_oauth_state");
  }
  return payload as unknown as OAuthFlow;
}

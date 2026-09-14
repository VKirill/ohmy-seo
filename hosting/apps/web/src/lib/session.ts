import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { pool, ensureSchema } from "./db";

const COOKIE = "ohmy_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET ?? "";
  if (raw.length < 32) throw new Error("SESSION_SECRET must be at least 32 chars");
  return new TextEncoder().encode(raw);
}

export type SessionUser = { id: number; email: string | null; displayName: string | null };

export async function createSession(userId: number): Promise<void> {
  const jwt = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("ohmy-cabinet")
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let uid: number;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    uid = Number(payload.uid);
    if (!Number.isSafeInteger(uid) || uid <= 0 ||
        (payload.aud !== undefined && payload.aud !== "ohmy-cabinet") || payload.purpose !== undefined) return null;
  } catch {
    return null;
  }
  await ensureSchema();
  const r = await pool.query<{ id: string; email: string | null; display_name: string | null }>(
    "SELECT id, email, display_name FROM users WHERE id = $1",
    [uid],
  );
  if (r.rowCount === 0) return null;
  return { id: Number(r.rows[0].id), email: r.rows[0].email, displayName: r.rows[0].display_name };
}

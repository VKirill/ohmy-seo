"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/session";
import { createApiKey, revokeApiKey } from "@/lib/apikey";
import { revokeConnection } from "@/lib/connections";

async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("unauthorized");
  return user;
}

/** Returns the plaintext key: this is the only time it is ever shown. */
export async function actionCreateKey(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "MCP");
  const plain = await createApiKey(user.id, name);
  (await cookies()).set("ohmy_new_key", plain, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/app",
    maxAge: 300,
  });
  revalidatePath("/app");
}

export async function actionRevokeKey(formData: FormData): Promise<void> {
  const user = await requireUser();
  await revokeApiKey(user.id, Number(formData.get("id")));
  revalidatePath("/app");
}

/**
 * One visible account can span several connections (Yandex needs two OAuth
 * apps), so the form posts every id and all of them are revoked together —
 * otherwise "Отключить" would leave half the access in place.
 */
export async function actionRevokeConnection(formData: FormData): Promise<void> {
  const user = await requireUser();
  const ids = formData.getAll("id").map(Number).filter((n) => Number.isFinite(n));
  for (const id of ids) await revokeConnection(user.id, id);
  revalidatePath("/app");
}

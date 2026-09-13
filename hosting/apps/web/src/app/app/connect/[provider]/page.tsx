import { redirect, notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ConnectAccount({ params }: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  if (provider !== "yandex" && provider !== "google") notFound();
  redirect(`/api/oauth/${provider}/start?mode=connect${provider === "yandex" ? "&chain=1" : ""}`);
}

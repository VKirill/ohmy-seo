import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/session";
import { listConnections, type Connection } from "@/lib/connections";
import { listApiKeys } from "@/lib/apikey";
import {
  PROVIDER_FAMILY,
  FAMILY_LABEL,
  PROVIDER_SERVICES,
  type FamilyId,
} from "@/lib/providers";
import { ProviderMark } from "@/components/ProviderMark";
import { actionCreateKey, actionRevokeKey, actionRevokeConnection } from "@/lib/actions";

export const dynamic = "force-dynamic";

type Account = {
  family: FamilyId;
  label: string;
  email: string | null;
  parts: Connection[];
  earliestExpiry: Date;
};

/**
 * Yandex arrives as two connections because one OAuth app cannot hold Metrika,
 * Webmaster and Direct at once. That is an implementation detail: group by
 * (family, account) so the user sees one account with one set of services.
 */
function groupAccounts(connections: Connection[]): Account[] {
  const byKey = new Map<string, Account>();
  for (const c of connections) {
    const family = PROVIDER_FAMILY[c.provider];
    const key = `${family}:${c.label}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.parts.push(c);
      if (c.expiresAt < existing.earliestExpiry) existing.earliestExpiry = c.expiresAt;
    } else {
      byKey.set(key, {
        family,
        label: c.label,
        email: c.accountEmail,
        parts: [c],
        earliestExpiry: c.expiresAt,
      });
    }
  }
  return [...byKey.values()];
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const sp = await searchParams;
  const [connections, keys] = await Promise.all([
    listConnections(user.id),
    listApiKeys(user.id),
  ]);
  const accounts = groupAccounts(connections);

  const jar = await cookies();
  const freshKey = jar.get("ohmy_new_key")?.value ?? null;
  const mcpUrl = process.env.MCP_PUBLIC_URL ?? "https://mcp.ohmy-seo.ru/mcp";
  const appUrl = process.env.APP_URL ?? "https://ohmy-seo.ru";

  return (
    <main className="wrap">
      <div className="row">
        <h1 style={{ marginBottom: 0 }}>Кабинет</h1>
        <form action="/api/logout" method="post">
          <button className="btn" type="submit">Выйти</button>
        </form>
      </div>
      <p className="lead">{user.displayName ?? user.email ?? `Пользователь #${user.id}`}</p>

      {sp.error ? <div className="notice err">Не удалось подключить аккаунт: {sp.error}</div> : null}
      {sp.connected ? (
        <div className="notice ok">
          Аккаунт {FAMILY_LABEL[sp.connected as FamilyId] ?? sp.connected} подключён.
        </div>
      ) : null}

      <h2>Подключённые аккаунты: {accounts.length}</h2>
      {accounts.length === 0 ? (
        <div className="card muted">Пока ни одного аккаунта не подключено.</div>
      ) : (
        accounts.map((a) => (
          <div className="card" key={`${a.family}:${a.label}`}>
            <div className="row">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <ProviderMark family={a.family} size={22} />
                  <strong>{FAMILY_LABEL[a.family]}</strong>
                  <span className="muted">· {a.email ?? a.label}</span>
                </div>
                <div style={{ marginTop: 10 }}>
                  {[...new Set(a.parts.flatMap((c) => PROVIDER_SERVICES[c.provider]))].map((s) => (
                    <span className="tag" key={s}>{s}</span>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Доступ активен, обновляется автоматически · продлён до{" "}
                  {a.earliestExpiry.toLocaleDateString("ru-RU")}
                </div>
              </div>
              <form action={actionRevokeConnection}>
                {a.parts.map((c) => (
                  <input type="hidden" name="id" value={c.id} key={c.id} />
                ))}
                <button className="btn danger" type="submit">Отключить</button>
              </form>
            </div>
          </div>
        ))
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <a className="btn primary" href="/api/oauth/yandex/start?chain=1&mode=connect">
          <ProviderMark family="yandex" />
          <span>Добавить аккаунт Яндекса</span>
        </a>
        <a className="btn" href="/api/oauth/google/start?mode=connect">
          <ProviderMark family="google" />
          <span>Добавить аккаунт Google</span>
        </a>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
        Добавляйте аккаунты по одному — второй, третий, четвёртый и дальше.
        Выберите аккаунт на странице Яндекса или Google и подтвердите доступ.
      </p>

      <h2>API-ключи</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Ключ выдаётся на вас, а не на отдельный кабинет: все аккаунты выше видны по одному ключу,
        и новый подключённый аккаунт появляется в MCP без перевыпуска.
      </p>

      {freshKey ? (
        <div className="notice ok">
          Новый ключ создан. Скопируйте его сейчас — больше он не покажется.
          <pre style={{ marginBottom: 0 }}>{freshKey}</pre>
        </div>
      ) : null}

      {keys.length > 0 ? (
        <div className="card">
          <table>
            <thead>
              <tr><th>Название</th><th>Префикс</th><th>Последнее использование</th><th /></tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td><code>{k.prefix}…</code></td>
                  <td className="muted">
                    {k.lastUsedAt ? k.lastUsedAt.toLocaleString("ru-RU") : "не использовался"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <form action={actionRevokeKey}>
                      <input type="hidden" name="id" value={k.id} />
                      <button className="btn danger" type="submit">Отозвать</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <form action={actionCreateKey} className="card">
        <div className="row">
          <input
            name="name" placeholder="Название ключа, например «ноутбук»"
            style={{
              flex: 1, minWidth: 220, padding: "9px 12px", borderRadius: 7,
              border: "1px solid var(--border)", background: "#0b0f14", color: "var(--fg)",
              font: "inherit",
            }}
          />
          <button className="btn primary" type="submit">Выпустить ключ</button>
        </div>
      </form>

      <h2>Подключение MCP</h2>
      <div className="card">
        <strong>Облачный режим</strong> — ничего не устанавливаете, один URL в конфиге клиента:
        <pre>{JSON.stringify(
          { mcpServers: { "ohmy-seo": { type: "http", url: mcpUrl, headers: { Authorization: "Bearer ohmy_ВАШ_КЛЮЧ" } } } },
          null,
          2,
        )}</pre>
      </div>
      <div className="card">
        <strong>Локальный режим</strong> — инструменты работают у вас, за токенами ходят к нам:
        <pre>{`curl -sL ${appUrl}/ohmy-seo-sync.tgz | tar xz
npm install --omit=dev
OHMY_SEO_API_KEY=ohmy_ВАШ_КЛЮЧ OHMY_SEO_API_URL=${appUrl} node sync.mjs`}</pre>
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
          Скрипт разложит токены по локальным базам ohmy-seo и напечатает переменные окружения
          для MCP-клиента. Refresh-токены остаются у нас, поэтому запускайте его по расписанию
          раз в 30 минут — тогда доступ не протухнет.
        </p>
      </div>
    </main>
  );
}

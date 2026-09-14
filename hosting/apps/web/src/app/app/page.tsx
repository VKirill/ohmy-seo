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
  if (!user) redirect("/connect");

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
    <main id="main-content" className="wrap dashboard-main">
      <div className="row">
        <div><h1>Кабинет</h1><p className="lead">{user.displayName ?? user.email ?? `Пользователь #${user.id}`}</p></div>
        <form action="/api/logout" method="post">
          <button className="btn" type="submit">Выйти</button>
        </form>
      </div>

      <div className="dashboard-add-accounts">
        <a className="btn primary" href="/app/connect/yandex-code">
          <ProviderMark family="yandex" />
          <span>Добавить аккаунт Яндекса</span>
        </a>
        <a className="btn" href="/api/oauth/google/start?mode=connect">
          <ProviderMark family="google" />
          <span>Добавить аккаунт Google</span>
        </a>
      </div>

      {sp.error ? <div className="notice err">Не удалось подключить аккаунт: {sp.error}</div> : null}
      {sp.connected ? (
        <div className="notice ok">
          Аккаунт {FAMILY_LABEL[sp.connected as FamilyId] ?? sp.connected} подключён.
        </div>
      ) : null}

      <div className="dashboard-section-heading"><h2>Подключённые аккаунты <span className="dashboard-count">{accounts.length}</span></h2></div>
      {accounts.length === 0 ? (
        <div className="card muted">Вы вошли в кабинет. Теперь добавьте рабочие аккаунты, из которых AI будет получать данные.</div>
      ) : (
        <div className="connections-table-wrap" role="region" aria-label="Подключённые аккаунты" tabIndex={0}>
          <table className="connections-table">
            <thead><tr>
              <th scope="col">Аккаунт</th><th scope="col">Сервисы</th>
              <th scope="col">Подключение</th><th scope="col" className="connection-actions-heading">Действия</th>
            </tr></thead>
            <tbody>{accounts.map((a) => (
              <tr key={`${a.family}:${a.label}`}>
                <td>
                  <div className="connection-identity"><ProviderMark family={a.family} size={20} />
                    <div><strong>{a.email ?? a.label}</strong><span className="connection-secondary">{FAMILY_LABEL[a.family]}</span></div>
                  </div>
                </td>
                <td className="connection-services">{[...new Set(a.parts.flatMap((c) => PROVIDER_SERVICES[c.provider]))].join(" · ")}</td>
                <td><span className="connection-status">Подключён</span>
                  <span className="connection-secondary">{a.family === "yandex" ? (a.parts.some(c => c.provider === "yandex-api") ? "Новое приложение" : "Прежнее приложение") : "Google OAuth"}</span>
                </td>
                <td><div className="connection-actions">
                  <a className="connection-reconnect" href={a.family === "yandex" ? "/app/connect/yandex-code" : "/api/oauth/google/start?mode=connect"} aria-label={`Переподключить ${a.email ?? a.label}`}>Переподключить</a>
                  <form action={actionRevokeConnection}>
                    {a.parts.map((c) => <input type="hidden" name="id" value={c.id} key={c.id} />)}
                    <button className="btn danger" type="submit" aria-label={`Отключить ${a.email ?? a.label}`}>Отключить</button>
                  </form>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="dashboard-section-heading"><h2>Ваши MCP-ключи</h2></div>
      <p className="muted" style={{ marginTop: 0 }}>
        Один ключ открывает доступ ко всем вашим подключениям. При добавлении аккаунтов менять его не нужно.
      </p>

      {freshKey ? (
        <div className="notice ok">
          Новый ключ создан. Скопируйте его сейчас — больше он не покажется.
          <pre style={{ marginBottom: 0 }}>{freshKey}</pre>
        </div>
      ) : null}

      {keys.length > 0 ? (
        <div className="card key-table-wrap">
          <table>
            <thead>
              <tr><th>Название</th><th>Префикс</th><th>Последнее использование</th><th><span className="dashboard-sr-only">Действия</span></th></tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}{k.allowTokenExport ? <span className="connection-secondary">С экспортом токенов</span> : null}</td>
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

      <form action={actionCreateKey} className="card key-create">
        <label htmlFor="key-name" className="dashboard-sr-only">Название нового ключа</label>
        <div className="row">
          <input
            id="key-name" name="name" placeholder="Название ключа, например «ноутбук»"
            className="key-name-input"
          />
          <button className="btn primary" type="submit">Выпустить ключ</button>
        </div>
        <label className="key-export-option"><input type="checkbox" name="allow_token_export" /> Разрешить локальную синхронизацию токенов (не нужно для облачного MCP)</label>
      </form>

      <div className="dashboard-section-heading"><h2>Подключите AI-ассистента</h2><p className="muted"><a href="/claude-mcp">Пошаговая инструкция →</a> <a href="/prompts">Готовые вопросы к данным →</a></p></div>
      <details className="dashboard-config"><summary>Настройки подключения MCP</summary>
      <div className="card">
        <strong>Облачный режим</strong> — ничего не устанавливаете, один URL в конфиге клиента:
        <pre>{JSON.stringify(
          { mcpServers: { "ohmy-seo": { type: "http", url: mcpUrl, headers: { Authorization: "Bearer ohmy_ВАШ_КЛЮЧ" } } } },
          null,
          2,
        )}</pre>
      </div>
      <div className="card">
        <strong>Локальный режим</strong> — используйте отдельный ключ с разрешением локальной синхронизации. Он позволяет получать рабочие токены подключённых аккаунтов:
        <pre>{`curl -sL ${appUrl}/ohmy-seo-sync.tgz | tar xz
npm install --omit=dev
OHMY_SEO_API_KEY=ohmy_ВАШ_КЛЮЧ OHMY_SEO_API_URL=${appUrl} node sync.mjs`}</pre>
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
          Скрипт разложит токены по локальным базам ohmy-seo и напечатает переменные окружения
          для MCP-клиента. Refresh-токены остаются у нас, поэтому запускайте его по расписанию
          раз в 30 минут — тогда доступ не протухнет.
        </p>
      </div>
      </details>
    </main>
  );
}

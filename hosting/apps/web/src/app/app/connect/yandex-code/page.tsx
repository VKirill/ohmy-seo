import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { codeConnectionConfigured } from '@/lib/oauth/code-connection';
import { submitCodeConnection } from './actions';

export const dynamic = 'force-dynamic';

export default async function YandexCodeConnection({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!await currentUser()) redirect('/');
  const { error } = await searchParams;
  const ready = codeConnectionConfigured();
  return <main className="wrap" style={{ maxWidth: 640 }}>
    <a href="/app">← Вернуться в кабинет</a>
    <h1>Подключить аккаунт Яндекса</h1>
    {!ready ? <p className="notice">Подключение через код настраивается. Попробуйте позже.</p> : <>
      <p className="lead">Получите код у Яндекса и вставьте его сюда.</p>
      {process.env.YANDEX_API_DIRECT_READY !== "true" && <p className="notice">Доступ к Директу для нового подключения ожидает одобрения Яндекса. Метрика и Вебмастер уже доступны.</p>}
      {error && <p className="notice err" role="alert">{error === 'start' ? 'Не удалось начать подключение. Попробуйте ещё раз.' : 'Не удалось подключить аккаунт. Получите новый код и повторите попытку.'}</p>}
      <div className="card">
        <form action="/api/oauth/yandex-code/start" method="post" target="_blank">
          <button className="btn primary" type="submit">Получить код в Яндексе ↗</button>
        </form>
        <p className="muted">В новой вкладке выберите аккаунт, разрешите доступ и скопируйте код. Затем вернитесь сюда.</p>
      </div>
      <form className="card" action={submitCodeConnection}>
        <label htmlFor="yandex-code">Код подтверждения</label>
        <input id="yandex-code" name="code" type="text" required minLength={4} maxLength={128}
          autoComplete="off" autoCapitalize="none" spellCheck={false}
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 12, margin: '12px 0', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', font: 'inherit' }} />
        <button className="btn primary" type="submit">Подключить аккаунт</button>
        <p className="muted">Код действует 10 минут. Для следующего аккаунта получите новый код.</p>
      </form>
    </>}
  </main>;
}

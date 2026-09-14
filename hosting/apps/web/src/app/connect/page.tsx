import type { Metadata } from 'next';
import { MarketingShell } from '@/components/marketing/Shell';
import { ProviderMark } from '@/components/ProviderMark';

export const metadata: Metadata = { title: 'Войти через Яндекс | ohmy-seo', robots: { index: false, follow: true } };
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error === 'session_required' ? 'Сначала войдите в кабинет, затем подключите рабочий аккаунт.' : error === 'login_unavailable' ? 'Вход временно недоступен. Попробуйте позже.' : error ? 'Не удалось завершить вход. Попробуйте ещё раз.' : null;
  return <MarketingShell><main id="main-content" className="mk-container mk-section"><span className="eyebrow">БЕСПЛАТНЫЙ КАБИНЕТ МАРКЕТОЛОГА</span><h1>Войдите через Яндекс.</h1><p className="detail-lead">Один аккаунт для входа в ohmy-seo. Рабочие аккаунты, из которых будем получать данные, подключите отдельно внутри кабинета.</p>{message && <p role="alert">{message}</p>}<div className="access-grid"><article><h2>Ваш личный кабинет</h2><p>Для входа используем только данные профиля Яндекса. Этот шаг не подключает рекламу, счётчики или сайты.</p><a className="mk-button" href="/api/oauth/yandex/start"><ProviderMark family="yandex" />Войти через Яндекс ↗</a></article><article><h2>Дальше — рабочие аккаунты</h2><p>В кабинете отдельно разрешите доступ к нужным аккаунтам Яндекса и Google. Можно подключить другой аккаунт или несколько клиентских — они не меняют ваш способ входа.</p><p>Затем создайте MCP-ключ и добавьте инструменты в AI-клиент.</p></article></div><p>Уже вошли? <a href="/app">Откройте личный кабинет →</a></p><p>Нужны Google Ads или Roistat? <a href="/claude-mcp#local">Посмотрите инструкцию локальных пакетов →</a></p><p className="small">Перед входом ознакомьтесь с <a href="/privacy">политикой конфиденциальности</a>.</p></main></MarketingShell>;
}

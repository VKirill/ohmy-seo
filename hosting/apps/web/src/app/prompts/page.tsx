import type { Metadata } from 'next';
import { MarketingShell, FinalCta } from '@/components/marketing/Shell';
import { PromptLibrary } from '@/components/marketing/PromptLibrary';
import { promptCount, promptCategories } from '@/lib/marketing/prompts';

export const metadata: Metadata = {
  title: 'Готовые вопросы для Claude MCP: Директ, Google Ads, SEO и аналитика | ohmy-seo',
  description: `${promptCount} готовых запросов для маркетологов: анализ Яндекс Директа, Google Рекламы, Вебмастера, Search Console, Метрики и GA4 через MCP. Выберите сервис и скопируйте вопрос.`,
  alternates: { canonical: '/prompts' },
  openGraph: { title: 'Вопросы к вашим данным — библиотека ohmy-seo', description: 'Готовые запросы по рекламе, SEO и аналитике для Claude и других AI-ассистентов с MCP.', url: '/prompts', type: 'website', locale: 'ru_RU', images: [{ url: 'https://ohmy-seo.ru/og-image.png', width: 1200, height: 630 }] },
};
export default async function PromptsPage({ searchParams }: { searchParams: Promise<{ service?: string | string[] }> }) {
  const { service } = await searchParams;
  const activeSlug = promptCategories.find(category => category.slug === service)?.slug ?? promptCategories[0].slug;
  return <MarketingShell><main id="main-content"><section className="mk-container mk-section prompt-intro"><a className="text-link" href="/">← На главную</a><span className="eyebrow">{promptCount} ВОПРОСОВ · 10 СЕРВИСОВ · ДЛЯ МАРКЕТОЛОГОВ</span><h1>С чего начнём<br />разговор с данными?</h1><p className="detail-lead">От проверки рекламного бюджета до поиска просадок в SEO. Выберите направление и скопируйте вопрос в Claude или другой AI-ассистент с подключённым ohmy-seo.</p><ol className="prompt-instructions"><li><span>01</span>Выберите сервис во вкладках</li><li><span>02</span>Замените данные в [скобках] своими</li><li><span>03</span>Вставьте вопрос в чат с MCP</li></ol><p className="small">Ещё не подключили инструменты? <a href="/claude-mcp">Начните с инструкции →</a> Если не знаете ID аккаунта, сначала попросите ассистента показать доступные аккаунты и источники.</p></section><section className="mk-container prompt-library-section" aria-label="Библиотека вопросов"><PromptLibrary activeSlug={activeSlug} /><p className="section-note">Шаблоны помогают начать анализ. Доступ к данным зависит от подключённого сервиса и прав аккаунта. Google Ads и Roistat требуют отдельных пакетов; Mutagen и XMLStock могут расходовать платные лимиты провайдеров.</p></section><FinalCta /></main></MarketingShell>;
}

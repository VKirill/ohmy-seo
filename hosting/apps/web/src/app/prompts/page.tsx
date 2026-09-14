import type { Metadata } from 'next';
import { JsonLd } from '@/components/marketing/JsonLd';
import { socialMetadata, pageGraph, siteUrl } from '@/lib/marketing/seo';
import { MarketingShell, FinalCta } from '@/components/marketing/Shell';
import { PromptLibrary } from '@/components/marketing/PromptLibrary';
import { promptCount, promptCategories } from '@/lib/marketing/prompts';

export const metadata: Metadata = {
  title: 'Готовые вопросы для Claude MCP: Директ, Google Ads, SEO и аналитика | ohmy-seo',
  description: `${promptCount} готовых запросов для маркетологов: анализ Яндекс Директа, Google Рекламы, Вебмастера, Search Console, Метрики и GA4 через MCP. Выберите сервис и скопируйте вопрос.`,
  alternates: { canonical: '/prompts' },
  ...socialMetadata('Готовые задачи для MCP — ohmy-seo', 'Примеры запросов по рекламе, SEO и аналитике для Claude и других AI-ассистентов.', '/prompts'),
};
export default async function PromptsPage({ searchParams }: { searchParams: Promise<{ service?: string | string[] }> }) {
  const { service } = await searchParams;
  const activeSlug = promptCategories.find(category => category.slug === service)?.slug ?? promptCategories[0].slug;
  return <MarketingShell><main id="main-content"><section className="mk-container mk-section prompt-intro"><a className="text-link" href="/">← На главную</a><span className="eyebrow">{promptCount} ВОПРОСОВ · 10 СЕРВИСОВ · ДЛЯ МАРКЕТОЛОГОВ</span><h1>Готовые задачи для MCP</h1><p className="detail-lead">Выберите сервис, замените данные в [скобках] своими и скопируйте запрос в AI-чат с подключённым ohmy-seo.</p><p className="small"><a href="/claude-mcp">Как подключить MCP →</a> Не знаете ID? Попросите ассистента показать доступные аккаунты и сайты.</p></section><section className="mk-container prompt-library-section" aria-label="Библиотека вопросов"><PromptLibrary activeSlug={activeSlug} /><p className="section-note">Шаблоны помогают начать анализ. Доступ к данным зависит от подключённого сервиса и прав аккаунта. Google Ads и Roistat требуют отдельных пакетов; Mutagen и XMLStock могут расходовать платные лимиты провайдеров.</p></section><FinalCta /><JsonLd data={pageGraph('/prompts', 'Готовые задачи для MCP', 'CollectionPage', { mainEntity: { '@type': 'ItemList', numberOfItems: promptCategories.length, itemListElement: promptCategories.map((category,index) => ({ '@type': 'ListItem', position: index + 1, name: category.name, url: `${siteUrl}/prompts?service=${category.slug}#questions` })) } })} /></main></MarketingShell>;
}

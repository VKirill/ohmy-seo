import type { Metadata } from 'next';
import { JsonLd } from '@/components/marketing/JsonLd';
import { socialMetadata, pageGraph } from '@/lib/marketing/seo';
import { notFound } from 'next/navigation';
import { integrations } from '@/lib/marketing/catalog';
import { MarketingShell, FinalCta } from '@/components/marketing/Shell';
import { CopyText } from '@/components/marketing/Interactive';

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return integrations.map(i => ({ slug: i.slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = integrations.find(i => i.slug === slug);
  if (!item) return { title: 'Интеграция не найдена', robots: { index: false } };
  return { title: `${item.title} | ohmy-seo`, description: item.description, alternates: { canonical: `/integrations/${slug}` }, ...socialMetadata(item.title, item.description, `/integrations/${slug}`) };
}
export default async function IntegrationPage({ params }: Props) {
  const { slug } = await params;
  const item = integrations.find(i => i.slug === slug);
  if (!item) notFound();
  const related = integrations.filter(i => i.slug !== slug && i.category === item.category);
  return <MarketingShell><main id="main-content"><section className="mk-container detail-hero"><nav className="breadcrumbs" aria-label="Хлебные крошки"><a href="/">Главная</a><span>/</span><a href="/#integrations">Интеграции</a><span>/</span><span>{item.name}</span></nav><span className="eyebrow">{item.category} · {item.mode}</span><h1>{item.title}</h1><p className="detail-lead">{item.intro}</p><div className="mk-actions"><a className="mk-button" href={item.mode.includes('Обла') ? '/connect' : '/claude-mcp#local'}>Как подключиться ↗</a><a className="mk-button secondary" href="#example">Пример запроса ↓</a></div></section>
    <section className="mk-container detail-body"><div><span className="eyebrow">ВОЗМОЖНОСТИ</span><h2>Что можно делать с {item.name}</h2><ul className="capability-list">{item.capabilities.map(c => <li key={c}>{c}</li>)}</ul><section id="example" className="detail-example"><span className="eyebrow">ЗАДАЧА ДЛЯ AI</span><h2>Попробуйте этот запрос</h2><p>{item.prompt}</p><CopyText text={item.prompt} /><h3>Что вы получите</h3><p>{item.result}</p></section><section><h2>Инструменты MCP</h2><p>Примеры инструментов пакета. Ассистент выбирает подходящий инструмент по задаче; полный каталог и параметры доступны в документации.</p><ul className="tool-list">{item.tools.map(t => <li key={t}><code>{t}</code></li>)}</ul><a className="text-link" href={`https://github.com/VKirill/ohmy-seo/tree/main/packages/${item.package}`}>Документация пакета {item.package} ↗</a></section></div><aside className="detail-aside"><span className="eyebrow">ПЕРЕД НАЧАЛОМ РАБОТЫ</span><h2>Подключение и доступ</h2><p>{item.requirements}</p><hr /><h3>Границы возможностей</h3><p>{item.limitation}</p><a className="mk-button secondary" href="/claude-mcp">Инструкция MCP ↗</a><p className="small">Не передавайте ключи в публичные чаты и репозитории. Данные отчёта получает выбранный AI-клиент.</p></aside></section>
    <section className="mk-section mk-container"><span className="eyebrow">СЛЕДУЮЩИЙ ШАГ</span><h2>Дополните картину другими источниками</h2><div className="related-links">{(related.length ? related : integrations.slice(0,3)).map(i => <a key={i.slug} href={`/integrations/${i.slug}`}><strong>{i.name}</strong><span>{i.category} ↗</span></a>)}</div></section><FinalCta />
    <JsonLd data={pageGraph(`/integrations/${slug}`, item.name, 'WebPage', { description: item.description })} />
  </main></MarketingShell>;
}

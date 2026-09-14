import type { Metadata } from 'next';

export const siteUrl = 'https://ohmy-seo.ru';
export const socialImage = {
  url: `${siteUrl}/social-cover-20260914.png`, width: 1200, height: 630,
  alt: 'ohmy-seo — реклама, SEO и аналитика. Бесплатный MCP для маркетологов.',
};
export const publisherId = `${siteUrl}/#organization`;
export const applicationId = `${siteUrl}/#application`;
export const websiteId = `${siteUrl}/#website`;

export function socialMetadata(title: string, description: string, path?: string): Pick<Metadata, 'openGraph' | 'twitter'> {
  return {
    openGraph: { type: 'website', locale: 'ru_RU', siteName: 'ohmy-seo', title, description, ...(path ? { url: `${siteUrl}${path}` } : {}), images: [socialImage] },
    twitter: { card: 'summary_large_image', title, description, images: [socialImage] },
  };
}

export const siteGraph = {
  '@context': 'https://schema.org', '@graph': [
    { '@type': 'Organization', '@id': publisherId, name: 'ohmy-seo', url: siteUrl,
      logo: { '@type': 'ImageObject', url: `${siteUrl}/logo.png`, width: 512, height: 512 },
      sameAs: ['https://github.com/VKirill/ohmy-seo'] },
    { '@type': 'WebSite', '@id': websiteId, name: 'ohmy-seo', url: siteUrl, inLanguage: 'ru-RU',
      description: 'Бесплатный MCP для маркетологов: реклама, SEO и аналитика через AI.', publisher: { '@id': publisherId } },
  ],
};

export function pageGraph(path: string, name: string, type = 'WebPage', extra: Record<string, unknown> = {}) {
  const url = `${siteUrl}${path}`;
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': type, '@id': `${url}#page`, url, name, inLanguage: 'ru-RU', isPartOf: { '@id': websiteId },
      publisher: { '@id': publisherId }, about: { '@id': applicationId },
      image: socialImage.url, primaryImageOfPage: { '@type': 'ImageObject', url: socialImage.url, width: 1200, height: 630 },
      breadcrumb: { '@id': `${url}#breadcrumbs` }, ...extra },
    { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumbs`, itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: siteUrl },
      { '@type': 'ListItem', position: 2, name, item: url },
    ] },
  ] };
}

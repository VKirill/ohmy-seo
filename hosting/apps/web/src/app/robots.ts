import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/', disallow: ['/app', '/api/'] }, sitemap: 'https://ohmy-seo.ru/sitemap.xml', host: 'https://ohmy-seo.ru' };
}

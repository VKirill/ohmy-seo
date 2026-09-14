import type { MetadataRoute } from 'next';
import { integrations } from '@/lib/marketing/catalog';
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: 'https://ohmy-seo.ru/prompts', changeFrequency: 'monthly', priority: 0.8 }, { url: 'https://ohmy-seo.ru', changeFrequency: 'weekly', priority: 1 }, { url: 'https://ohmy-seo.ru/claude-mcp', changeFrequency: 'monthly', priority: 0.8 }, ...integrations.map(i => ({ url: `https://ohmy-seo.ru/integrations/${i.slug}`, changeFrequency: 'monthly' as const, priority: 0.8 }))];
}

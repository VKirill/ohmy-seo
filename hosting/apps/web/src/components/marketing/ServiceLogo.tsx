/** Original product artwork from official service websites; see public/logos/sources.json. */
const logos: Record<string, { file: string; width: number; height: number }> = {
  'yandex-direct': { file: 'yandex-direct.png', width: 36, height: 36 },
  'yandex-metrica': { file: 'yandex-metrica.png', width: 36, height: 36 },
  'yandex-webmaster': { file: 'yandex-webmaster.png', width: 36, height: 36 },
  'google-ads': { file: 'google-ads.svg', width: 36, height: 36 },
  'google-search-console': { file: 'google-search-console.svg', width: 160, height: 24 },
  'google-analytics': { file: 'google-analytics.svg', width: 36, height: 36 },
  'google-tag-manager': { file: 'google-tag-manager.svg', width: 36, height: 36 },
  roistat: { file: 'roistat.png', width: 36, height: 36 },
  mutagen: { file: 'mutagen.png', width: 32, height: 32 },
  xmlstock: { file: 'xmlstock.png', width: 130, height: 19 },
};
export function ServiceLogo({ slug }: { slug: string }) {
  const logo = logos[slug];
  if (!logo) return null;
  // Decorative next to the visible service name; local assets avoid third-party requests.
  return <img className="official-service-logo" src={`/logos/${logo.file}`} width={logo.width} height={logo.height} alt="" loading="lazy" decoding="async" />;
}

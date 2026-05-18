import { XMLParser } from 'fast-xml-parser';

export type SerpResult = {
  position: number;
  url: string;
  title: string;
  snippet?: string;
  favicon?: string;
  domain?: string;
};

export type NormalizedSerp = {
  engine: 'yandex' | 'google';
  query: string;
  lr?: number;
  domain?: string;
  totalfound: number;
  results: SerpResult[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
  stopNodes: ['*.title', '*.passage'],
  isArray: (_name: string, jpath: string) => {
    return (
      jpath === 'yandexsearch.response.found' ||
      jpath === 'yandexsearch.response.results.grouping.group' ||
      jpath === 'yandexsearch.response.results.grouping.group.doc.passages.passage'
    );
  },
});

function toArray<T>(val: T | T[] | undefined | null): T[] {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

function stripMarkup(text: unknown): string {
  if (typeof text !== 'string') return String(text ?? '');
  return text.replace(/<\/?hlword>/g, '').trim();
}

function extractTotalFound(found: unknown): number {
  const items = toArray(found as Record<string, unknown>);
  if (items.length === 0) return 0;

  for (const item of items) {
    if (item && typeof item === 'object') {
      const e = item as Record<string, unknown>;
      if (e['@_priority'] === 'all') {
        const val = e['#text'];
        if (typeof val === 'number') return val;
        if (typeof val === 'string') return parseInt(val, 10) || 0;
      }
    }
    if (typeof item === 'number') return item;
  }

  const first = items[0] as Record<string, unknown>;
  if (first && typeof first['#text'] === 'number') return first['#text'] as number;
  return 0;
}

function extractSnippet(passages: unknown): string | undefined {
  if (!passages) return undefined;
  const p = (passages as Record<string, unknown>).passage;
  if (!p) return undefined;
  const arr = toArray(p as unknown);
  if (arr.length === 0) return undefined;
  const first = arr[0];
  const raw = typeof first === 'string' ? first : (first as Record<string, unknown>)?.['#text'] ?? '';
  const stripped = stripMarkup(raw);
  return stripped || undefined;
}

function mapGroups(groups: unknown[]): SerpResult[] {
  return groups.map((group, idx) => {
    const g = group as Record<string, unknown>;
    const doc = g['doc'] as Record<string, unknown> | undefined;
    const src = doc ?? g;

    const url = String(src['url'] ?? '');
    const rawTitle = src['title'];
    const title =
      typeof rawTitle === 'string'
        ? stripMarkup(rawTitle)
        : rawTitle && typeof rawTitle === 'object'
          ? stripMarkup((rawTitle as Record<string, unknown>)['#text'] ?? '')
          : String(rawTitle ?? '');

    const domain = typeof src['domain'] === 'string' ? src['domain'] : undefined;
    const favicon = typeof src['favicon'] === 'string' ? src['favicon'] : undefined;
    const snippet = extractSnippet(src['passages']);

    return { position: idx + 1, url, title, snippet, favicon, domain };
  });
}

export function parseYandexSerpXml(xml: string): NormalizedSerp {
  const obj = parser.parse(xml) as Record<string, unknown>;
  const root = (obj['yandexsearch'] ?? obj) as Record<string, unknown>;
  const request = (root['request'] ?? {}) as Record<string, unknown>;
  const response = (root['response'] ?? {}) as Record<string, unknown>;

  const query = String(request['query'] ?? '');
  const totalfound = extractTotalFound(response['found']);
  const results_node = (response['results'] ?? {}) as Record<string, unknown>;
  const grouping = (results_node['grouping'] ?? {}) as Record<string, unknown>;
  const groups = toArray(grouping['group'] as unknown[]);

  return { engine: 'yandex', query, totalfound, results: mapGroups(groups) };
}

export function parseGoogleSerpXml(xml: string): NormalizedSerp {
  const serp = parseYandexSerpXml(xml);
  return { ...serp, engine: 'google' };
}

export function parseXmlstockError(xml: string): { code: number; message: string } | null {
  const obj = parser.parse(xml) as Record<string, unknown>;
  const root = (obj['yandexsearch'] ?? obj) as Record<string, unknown>;
  const response = (root['response'] ?? {}) as Record<string, unknown>;
  const error = response['error'];

  if (error == null) return null;

  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    const code =
      typeof e['@_code'] === 'number'
        ? e['@_code']
        : parseInt(String(e['@_code'] ?? '0'), 10);
    const message = typeof e['#text'] === 'string' ? e['#text'] : String(e['#text'] ?? '');
    return { code, message };
  }

  return { code: 0, message: String(error) };
}

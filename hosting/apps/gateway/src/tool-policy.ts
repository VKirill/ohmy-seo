/** The hosted surface is explicit: SDK readOnlyHint annotations are not authorization. */
const READ_TOOLS = new Set([
  'list_accounts', 'list_google_accounts', 'list_sites', 'list_counters', 'find_property',
  'refresh_inventory', 'cache_stats', 'invalidate_cache',
  'yandex_metrika_api', 'yandex_webmaster_api', 'yandex_direct_api',
  'yandex_direct_list_campaigns', 'yandex_direct_list_adgroups', 'yandex_direct_list_ads',
  'yandex_direct_list_keywords', 'yandex_direct_get_stats', 'yandex_direct_get_change_history',
  'yandex_direct_get_search_terms', 'yandex_direct_get_campaign_details',
  'gsc_list_sites', 'gsc_search_analytics', 'gsc_url_inspection', 'gsc_list_sitemaps',
  'ga4_list_properties', 'ga4_get_metadata', 'ga4_list_custom_dimensions', 'ga4_list_conversion_events',
  'ga4_run_report', 'ga4_run_realtime_report', 'ga4_batch_run_reports', 'ga4_run_pivot_report',
  'gtm_list_accounts', 'gtm_list_containers', 'gtm_list_workspaces', 'gtm_list_tags',
  'gtm_list_triggers', 'gtm_list_variables', 'gtm_list_versions', 'gtm_get_version',
]);

export function isHostedTool(name: string): boolean { return READ_TOOLS.has(name); }

export class ToolPolicyError extends Error {
  constructor() { super('Операция недоступна в облачном MCP. Разрешены только инструменты чтения данных.'); }
}

export function assertHostedCall(name: string, args: Record<string, unknown>): void {
  if (!isHostedTool(name)) throw new ToolPolicyError();
  if (!['yandex_metrika_api', 'yandex_webmaster_api', 'yandex_direct_api'].includes(name)) return;
  const endpoint = args.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || !endpoint.startsWith('/') ||
      endpoint.startsWith('//') || /[\\?#\x00-\x20]/.test(endpoint)) throw new ToolPolicyError();
  // Reject encoded separators, dot segments and controls too, including nested encoding.
  let decoded = endpoint;
  for (let i = 0; i < 4; i++) {
    try { decoded = decodeURIComponent(decoded); } catch { throw new ToolPolicyError(); }
    if (/[\\?#\x00-\x20]/.test(decoded) || decoded.startsWith('//') ||
        decoded.split('/').some(s => s === '.' || s === '..')) throw new ToolPolicyError();
  }
  if (/%[0-9a-f]{2}/i.test(decoded)) throw new ToolPolicyError();
  if (name !== 'yandex_direct_api') {
    if ((args.method ?? 'GET') !== 'GET' || args.body !== undefined) throw new ToolPolicyError();
    return;
  }
  if ((args.method ?? 'POST') !== 'POST' || !/^\/json\/v(?:5|501)\/[a-z]+\/?$/.test(endpoint)) throw new ToolPolicyError();
  // Match the child's body normalization and params promotion before authorizing.
  let body = args.body ?? args.params;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { throw new ToolPolicyError(); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ToolPolicyError();
  const payload = body as Record<string, unknown>;
  if (/\/reports\/?$/.test(endpoint)) {
    if (payload.method !== undefined) throw new ToolPolicyError();
  } else if (payload.method !== 'get') throw new ToolPolicyError();
}

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
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

const WRITE_TOOLS = new Set([
  'yandex_direct_upload_image', 'yandex_direct_create_campaign', 'yandex_direct_create_adgroup',
  'yandex_direct_create_ad_unified', 'yandex_direct_link_metrika_goals', 'yandex_direct_pause_campaigns',
  'yandex_direct_resume_campaigns', 'yandex_direct_moderate_ads', 'yandex_direct_delete_campaigns',
  'yandex_direct_negative_keywords_add', 'yandex_direct_update_budgets', 'yandex_direct_create_sitelinks_set',
  'yandex_direct_create_promo_extension', 'yandex_direct_update_adgroup_autotargeting',
  'yandex_direct_set_bid_modifiers', 'yandex_direct_update_campaign', 'yandex_direct_update_adgroup',
  'yandex_direct_update_ad', 'yandex_direct_feeds',
  'gsc_submit_sitemap', 'gsc_delete_sitemap', 'gsc_indexing_publish',
  'gtm_create_workspace', 'gtm_create_tag', 'gtm_create_trigger', 'gtm_create_variable',
  'gtm_update_tag', 'gtm_delete_tag', 'gtm_create_version', 'gtm_publish_version', 'gtm_rollback',
]);
const GENERIC_TOOLS = new Set(['yandex_metrika_api', 'yandex_webmaster_api', 'yandex_direct_api']);

/** Add the gateway's confirmation fields to discovery, not just to execution. */
export function hostedTool(tool: Tool): Tool {
  if (!WRITE_TOOLS.has(tool.name) && !GENERIC_TOOLS.has(tool.name)) return tool;
  const properties = { ...tool.inputSchema.properties };
  properties.confirm ??= { type: 'boolean', description: 'Explicit confirmation of this write operation. Reads do not require it.' };
  if (GENERIC_TOOLS.has(tool.name)) properties.acknowledge_live = {
    type: 'string', description: 'For writes, echo "METHOD /endpoint" exactly (e.g. "POST /v4/user/123/hosts" or "UPDATE /json/v5/campaigns").',
  };
  return { ...tool, inputSchema: { ...tool.inputSchema, properties },
    description: `${tool.description ?? ''} Hosted writes require confirm:true; generic API writes also require acknowledge_live="METHOD /endpoint".`,
    annotations: { ...tool.annotations, readOnlyHint: false },
  };
}

function requireWriteConfirmation(args: Record<string, unknown>, target?: string): void {
  if (args.confirm !== true) throw new ToolPolicyError('Для записи требуется confirm:true.');
  if (target && args.acknowledge_live !== target) throw new ToolPolicyError(`Для этой операции требуется acknowledge_live="${target}".`);
}

export function isHostedTool(name: string): boolean { return READ_TOOLS.has(name) || WRITE_TOOLS.has(name); }

export class ToolPolicyError extends Error {
  constructor(message = 'Операция недоступна в облачном MCP: доступ к файлам сервера и управление OAuth выполняются отдельно.') { super(message); }
}

export function assertHostedCall(name: string, args: Record<string, unknown>): void {
  if (!isHostedTool(name)) throw new ToolPolicyError();
  if (WRITE_TOOLS.has(name)) {
    if (name === 'yandex_direct_upload_image' && (args.file_path !== undefined || args.url !== undefined || typeof args.base64 !== 'string')) throw new ToolPolicyError('В облаке передайте изображение через base64; серверные пути и скачивание произвольных URL недоступны.');
    requireWriteConfirmation(args);
  }
  if (!GENERIC_TOOLS.has(name)) return;
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
    const method = args.method ?? 'GET';
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(String(method))) throw new ToolPolicyError();
    if (method === 'GET') { if (args.body !== undefined) throw new ToolPolicyError(); }
    else requireWriteConfirmation(args, `${method} ${endpoint}`);
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
  } else if (payload.method !== 'get') {
    if (typeof payload.method !== 'string' || !/^[a-z][a-zA-Z]*$/.test(payload.method)) throw new ToolPolicyError();
    requireWriteConfirmation(args, `${payload.method.toUpperCase()} ${endpoint}`);
  }
}

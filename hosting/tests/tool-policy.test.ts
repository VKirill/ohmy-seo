import { describe, expect, it } from 'vitest';
import { assertHostedCall, isHostedTool, hostedTool } from '../apps/gateway/src/tool-policy';
import { WindowLimiter } from '../apps/gateway/src/request-security';

describe('hosted tool authorization', () => {
  it('hosts every Google write tool backing a requested scope, each behind confirm:true', () => {
    const writes = ['gsc_submit_sitemap', 'ga4_update_property', 'ga4_create_custom_dimension', 'ga4_update_custom_dimension',
      'ga4_archive_custom_dimension', 'ga4_create_key_event', 'ga4_delete_key_event', 'ga4_update_data_retention',
      'gtm_create_container', 'gtm_delete_container', 'gtm_update_account', 'gtm_create_user_permission',
      'gtm_update_user_permission', 'gtm_delete_user_permission', 'gtm_create_version', 'gtm_publish_version'];
    for (const name of writes) {
      expect(isHostedTool(name)).toBe(true);
      expect(() => assertHostedCall(name, {})).toThrow('confirm');
      expect(() => assertHostedCall(name, { confirm: true })).not.toThrow();
    }
    expect(() => assertHostedCall('gtm_list_user_permissions', {})).not.toThrow();
    expect(isHostedTool('gsc_indexing_publish')).toBe(false);
    expect(() => assertHostedCall('gtm_rollback', { to_version_id: '1' })).not.toThrow();
    expect(() => assertHostedCall('gtm_rollback', { to_version_id: '1', plan_id: 'p' })).toThrow('confirm');
  });
  it.each(['register_google_service_account', 'yandex_direct_render_to_xlsx', 'delete_account', 'start_oauth_flow',
    'yandex_direct_upload_from_yaml', 'unknown_tool'])('denies %s before execution', name => {
    expect(isHostedTool(name)).toBe(false);
    expect(() => assertHostedCall(name, {})).toThrow();
  });
  it.each(['yandex_metrika_api', 'yandex_webmaster_api'])('permits GET and requires explicit confirmation for writes in %s', name => {
    expect(() => assertHostedCall(name, { endpoint: '/v4/user' })).not.toThrow();
    for (const method of ['POST', 'PUT', 'DELETE', 'get']) expect(() => assertHostedCall(name, { endpoint: '/v4/user', method })).toThrow();
    expect(() => assertHostedCall(name, { endpoint: '/v4/user', body: { method: 'delete' } })).toThrow();
  });
  it.each(['/../user', '/%2e%2e/user', '/%252e%252e/user', '//evil.test', '/test?method=delete', '/test#x', '/test\\x', '/test%0ax'])('rejects ambiguous endpoint %s', endpoint => {
    expect(() => assertHostedCall('yandex_webmaster_api', { endpoint })).toThrow();
  });
  it('allows Direct reads including JSON strings, legacy params promotion and reports', () => {
    for (const args of [{ body: { method: 'get' } }, { body: '{"method":"get"}' }, { params: { method: 'get' } }]) {
      expect(() => assertHostedCall('yandex_direct_api', { endpoint: '/json/v5/campaigns', ...args })).not.toThrow();
    }
    expect(() => assertHostedCall('yandex_direct_api', { endpoint: '/json/v5/reports', body: { params: { ReportType: 'CAMPAIGN_PERFORMANCE_REPORT' } } })).not.toThrow();
  });
  it('rejects Direct writes through every body representation and endpoint escape', () => {
    for (const method of ['add', 'update', 'delete', 'suspend', 'resume', 'Get']) {
      for (const args of [{ body: { method } }, { body: JSON.stringify({ method }) }, { params: { method } }]) {
        expect(() => assertHostedCall('yandex_direct_api', { endpoint: '/json/v5/campaigns', ...args })).toThrow();
      }
    }
    expect(() => assertHostedCall('yandex_direct_api', { endpoint: '/json/v5/campaigns/reports', body: {} })).toThrow();
    expect(() => assertHostedCall('yandex_direct_api', { endpoint: '/json/v5/campaigns', body: { method: 'delete' }, params: { method: 'get' } })).toThrow();
  });
});

describe('bounded request quotas', () => {
  it('limits a client, isolates other clients, expires windows and bounds memory', () => {
    const limiter = new WindowLimiter(2, 100, 2);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 1)).toBe(true);
    expect(limiter.allow('a', 2)).toBe(false);
    expect(limiter.allow('b', 2)).toBe(true);
    expect(limiter.allow('c', 3)).toBe(false);
    expect(limiter.allow('c', 103)).toBe(true);
    expect(limiter.allow('a', 104)).toBe(true);
  });
});

it('restores dedicated mutations with confirmation and advertises the gateway fields', () => {
  for (const name of ['yandex_direct_update_budgets', 'gtm_publish_version', 'gsc_submit_sitemap']) {
    expect(isHostedTool(name)).toBe(true);
    expect(() => assertHostedCall(name, {})).toThrow('confirm');
    expect(() => assertHostedCall(name, { confirm: true })).not.toThrow();
    expect(hostedTool({ name, inputSchema: { type: 'object', properties: {} } }).inputSchema.properties).toHaveProperty('confirm');
  }
});
it('allows confirmed Webmaster, Metrika and Direct writes through all accepted body forms', () => {
  for (const name of ['yandex_webmaster_api', 'yandex_metrika_api']) {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect(() => assertHostedCall(name, { endpoint: '/v4/user/123/hosts', method, confirm: true, acknowledge_live: `${method} /v4/user/123/hosts` })).not.toThrow();
      expect(() => assertHostedCall(name, { endpoint: '/v4/user/123/hosts', method, confirm: true, acknowledge_live: `${method} /wrong` })).toThrow();
    }
  }
  for (const payload of [{ body: { method: 'update' } }, { body: '{"method":"update"}' }, { params: { method: 'update' } }]) {
    expect(() => assertHostedCall('yandex_direct_api', { endpoint: '/json/v5/campaigns', confirm: true, acknowledge_live: 'UPDATE /json/v5/campaigns', ...payload })).not.toThrow();
  }
});
it('allows image data but rejects server-file and arbitrary-URL uploads', () => {
  expect(() => assertHostedCall('yandex_direct_upload_image', { base64: 'test', confirm: true })).not.toThrow();
  for (const args of [{ file_path: '/etc/passwd' }, { url: 'http://127.0.0.1/' }]) {
    expect(() => assertHostedCall('yandex_direct_upload_image', { ...args, confirm: true })).toThrow();
  }
});

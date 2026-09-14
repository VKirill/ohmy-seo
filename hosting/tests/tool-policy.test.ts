import { describe, expect, it } from 'vitest';
import { assertHostedCall, isHostedTool } from '../apps/gateway/src/tool-policy';
import { WindowLimiter } from '../apps/gateway/src/request-security';

describe('hosted tool authorization', () => {
  it.each(['register_google_service_account', 'yandex_direct_render_to_xlsx', 'delete_account', 'start_oauth_flow',
    'yandex_direct_upload_from_yaml', 'gtm_publish_version', 'yandex_direct_update_budgets', 'unknown_tool'])('denies %s before execution', name => {
    expect(isHostedTool(name)).toBe(false);
    expect(() => assertHostedCall(name, {})).toThrow();
  });
  it.each(['yandex_metrika_api', 'yandex_webmaster_api'])('permits GET only for %s', name => {
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

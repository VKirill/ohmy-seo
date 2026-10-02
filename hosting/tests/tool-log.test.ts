import { describe, expect, it } from 'vitest';
import { exceptionCodes, failureCodes } from '../apps/gateway/src/tool-log';

const text = (payload: unknown) => ({ isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }] });

describe('failureCodes', () => {
  it('reads status and error_code from a report failure', () => {
    expect(failureCodes(text({ ok: false, status: 400, error_code: 9000, error: { error: { error_code: 9000, error_detail: 'secret' } } })))
      .toBe('status=400 error_code=9000');
  });

  it('falls back to the nested Direct error_code and flags timeouts', () => {
    expect(failureCodes(text({ status: 400, error: { error: { error_code: 52 } } }))).toBe('status=400 error_code=52');
    expect(failureCodes(text({ ok: false, status: 0, error: 'timeout' }))).toBe('status=0 reason=timeout');
  });

  it('never echoes free text', () => {
    expect(failureCodes({ isError: true, content: [{ type: 'text', text: 'Ошибка: token abc' }] })).toBe('');
    expect(failureCodes(undefined)).toBe('');
  });
});

describe('exceptionCodes', () => {
  it('logs the error class and MCP code, not the message', () => {
    const e = Object.assign(new Error('child said: token abc'), { name: 'McpError', code: -32001 });
    expect(exceptionCodes(e)).toBe('reason=McpError code=-32001');
  });
});

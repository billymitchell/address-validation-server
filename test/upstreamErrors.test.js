import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAddress } from '../src/services/addressValidation.js';

test('Google errors provide actionable diagnostics without leaking upstream data', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const cases = [
    [403, 'SERVICE_DISABLED', /not enabled/],
    [403, 'BILLING_DISABLED', /Billing is not enabled/],
    [400, 'API_KEY_INVALID', /key is invalid/],
    [403, 'API_KEY_SERVICE_BLOCKED', /does not allow Address Validation/],
    [403, 'API_KEY_HTTP_REFERRER_BLOCKED', /referrer restrictions/],
    [403, 'API_KEY_IP_ADDRESS_BLOCKED', /server IP/],
    [403, 'UNKNOWN_REASON', /Google denied/],
    [400, 'UNKNOWN_REASON', /Google rejected/],
    [429, 'UNKNOWN_REASON', /quota or rate limit/],
    [500, 'UNKNOWN_REASON', /service returned an error/],
  ];
  let upstreamStatus;
  let upstreamReason;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    error: {
      message: 'private-address secret-key',
      details: [{ reason: upstreamReason, metadata: { key: 'secret-key' } }],
    },
  }), { status: upstreamStatus }));
  for (const [status, reason, expected] of cases) {
    upstreamStatus = status;
    upstreamReason = reason;
    await assert.rejects(
      validateAddress({ regionCode: 'US', addressLines: ['private-address'] }, { apiKey: 'secret-key', timeoutMs: 1000 }),
      (error) => {
        assert.equal(error.statusCode, 502);
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /private-address|secret-key/);
        return true;
      },
    );
  }
  assert.doesNotMatch(JSON.stringify(logs), /private-address|secret-key|UNKNOWN_REASON/);
  assert.equal(logs[0][1].httpStatus, 403);
  assert.equal(logs[0][1].reason, 'SERVICE_DISABLED');
});

test('non-JSON Google errors still return a controlled API error', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('Bad Gateway', { status: 502 }));
  await assert.rejects(
    validateAddress({ regionCode: 'US' }, { apiKey: 'secret-key', timeoutMs: 1000 }),
    { statusCode: 502, message: 'Address validation service returned an error.' },
  );
});

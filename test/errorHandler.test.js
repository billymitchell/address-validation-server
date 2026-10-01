import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../src/middleware/errorHandler.js';

test('unexpected error logs only a bounded category and server request ID', (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const error = new TypeError('secret-token customer-address');
  error.payload = { apiKey: 'secret-token' };
  let status;
  let payload;
  const res = { status(value) { status = value; return this; }, json(value) { payload = value; } };
  errorHandler(error, { requestId: 'server-generated-id', body: { address: 'customer-address' } }, res);
  assert.equal(status, 500);
  assert.equal(payload.requestId, 'server-generated-id');
  assert.deepEqual(logs[0][1], { category: 'type_error', requestId: 'server-generated-id' });
  assert.doesNotMatch(JSON.stringify(logs), /secret-token|customer-address|payload|stack/);
});

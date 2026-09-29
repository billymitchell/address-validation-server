import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWithSmarty } from '../src/services/smartyAddressValidation.js';

const smartyOptions = {
  smartyAuthId: 'smarty-id',
  smartyAuthToken: 'smarty-token',
  timeoutMs: 1_000,
};

test('validates US addresses through the Smarty US Street SDK', async (t) => {
  let requestUrl;
  t.mock.method(globalThis, 'fetch', async (url) => {
    requestUrl = new URL(url);
    return new Response(JSON.stringify([{
      delivery_line_1: '1600 Amphitheatre Pkwy',
      last_line: 'Mountain View CA 94043-1351',
      components: {
        city_name: 'Mountain View',
        state_abbreviation: 'CA',
        zipcode: '94043',
        plus4_code: '1351',
      },
      analysis: {
        dpv_match_code: 'Y',
        components: {
          street_name: { change: ['Pkwy'] },
        },
      },
    }]), { headers: { 'Content-Type': 'application/json' } });
  });

  const result = await validateWithSmarty({
    regionCode: 'US',
    addressLines: ['1600 Amphitheatre Pkwy'],
    locality: 'Mountain View',
    administrativeArea: 'CA',
    postalCode: '94043',
  }, smartyOptions);

  assert.match(requestUrl.href, /^https:\/\/us-street\.api\.smarty\.com\//);
  assert.equal(requestUrl.searchParams.get('street'), '1600 Amphitheatre Pkwy');
  assert.equal(result.status, 'corrected');
  assert.equal(result.verdict.hasReplacedComponents, true);
  assert.equal(result.suggestedAddress.postalCode, '94043-1351');
  assert.equal(result.suggestedAddress.regionCode, 'US');
});

test('validates non-US addresses through the Smarty International Street SDK', async (t) => {
  let requestUrl;
  t.mock.method(globalThis, 'fetch', async (url) => {
    requestUrl = new URL(url);
    return new Response(JSON.stringify([{
      address1: '2 rue Léon Blum',
      address2: '92800 Puteaux',
      components: {
        locality: 'Puteaux',
        administrative_area: 'Île-de-France',
        postal_code: '92800',
      },
      analysis: {
        verification_status: 'Verified',
        address_precision: 'Premise',
      },
    }]), { headers: { 'Content-Type': 'application/json' } });
  });

  const result = await validateWithSmarty({
    regionCode: 'FR',
    addressLines: ['2 rue Léon Blum'],
    locality: 'Puteaux',
    administrativeArea: 'Île-de-France',
    postalCode: '92800',
  }, smartyOptions);

  assert.match(requestUrl.href, /^https:\/\/international-street\.api\.smarty\.com\//);
  assert.equal(requestUrl.searchParams.get('country'), 'FR');
  assert.equal(requestUrl.searchParams.get('locality'), 'Puteaux');
  assert.equal(result.status, 'confirmed');
  assert.equal(result.suggestedAddress.regionCode, 'FR');
  assert.deepEqual(result.suggestedAddress.addressLines, ['2 rue Léon Blum', '92800 Puteaux']);
});

test('returns a normalized invalid result when Smarty has no candidates', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('[]', {
    headers: { 'Content-Type': 'application/json' },
  }));

  const result = await validateWithSmarty({
    regionCode: 'US',
    addressLines: ['No Such Road'],
  }, smartyOptions);

  assert.equal(result.status, 'invalid');
  assert.equal(result.verdict.addressComplete, false);
  assert.ok(result.messages.length > 0);
});

test('reports credential errors without returning Smarty response details', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    error: 'private address and credential details',
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }));

  await assert.rejects(
    validateWithSmarty({ regionCode: 'US', addressLines: ['1 Main St'] }, smartyOptions),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /credentials and account access/);
      assert.doesNotMatch(error.message, /private address|credential details/);
      return true;
    },
  );
  assert.doesNotMatch(JSON.stringify(logs), /private address|credential details/);
});

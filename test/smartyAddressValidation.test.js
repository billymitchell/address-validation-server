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


test('partially verified international addresses require review rather than being invalid', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{
    address1: 'Main Street',
    analysis: { verification_status: 'Partial', address_precision: 'Thoroughfare' },
  }]), { headers: { 'Content-Type': 'application/json' } }));
  const result = await validateWithSmarty({ regionCode: 'GB', addressLines: ['Main Street'] }, smartyOptions);
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.verdict.addressComplete, false);
});


test('exposes all ambiguous international candidates for shopper selection', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
    { address1: '1 Main St', analysis: { verification_status: 'Ambiguous' } },
    { address1: '2 Main St', analysis: { verification_status: 'Ambiguous' } },
  ]), { headers: { 'Content-Type': 'application/json' } }));
  const result = await validateWithSmarty({ regionCode: 'GB', addressLines: ['Main St'] }, smartyOptions);
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates[1].addressLines, ['2 Main St']);
});

test('detects US corrections without change metadata and preserves formatting equivalence', async (t) => {
  let candidate;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([candidate]), {
    headers: { 'Content-Type': 'application/json' },
  }));
  const original = { regionCode: 'US', addressLines: ['123 Main Street', 'Apartment 4'], locality: 'Reston', administrativeArea: 'Virginia', postalCode: '20191' };
  const base = { delivery_line_1: '123 MAIN ST APT 4', components: { city_name: 'RESTON', state_abbreviation: 'VA', zipcode: '20191', plus4_code: '1234' }, analysis: { dpv_match_code: 'Y' } };
  candidate = base;
  assert.equal((await validateWithSmarty(original, smartyOptions)).status, 'confirmed');
  for (const change of [
    { delivery_line_1: '132 Main St Apt 4' },
    { delivery_line_1: '123 Other St Apt 4' },
    { delivery_line_1: '123 Main St Apt 5' },
    { delivery_line_1: '123 Main St' },
    { components: { ...base.components, city_name: 'Herndon' } },
    { components: { ...base.components, zipcode: '20190' } },
  ]) {
    candidate = { ...base, ...change };
    const result = await validateWithSmarty(original, smartyOptions);
    assert.equal(result.status, 'corrected');
    assert.equal(result.verdict.hasReplacedComponents, true);
  }
  candidate = { ...base, delivery_line_1: '132 Main St', analysis: { dpv_match_code: 'D' } };
  assert.equal((await validateWithSmarty(original, smartyOptions)).status, 'unconfirmed');
});

test('international comparisons ignore mailing locality lines but detect field and unit corrections', async (t) => {
  let candidate;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([candidate]), {
    headers: { 'Content-Type': 'application/json' },
  }));
  const original = { regionCode: 'FR', addressLines: ['2 rue Léon Blum', 'Appartement 4'], locality: 'Puteaux', postalCode: '92800' };
  const base = { address1: '2 rue Léon Blum', address2: 'Appartement 4', address3: '92800 Puteaux', components: { locality: 'Puteaux', postal_code: '92800' }, analysis: { verification_status: 'Verified', changes: { components: { thoroughfare: 'Verified', premise: 'Identical' } } } };
  candidate = base;
  assert.equal((await validateWithSmarty(original, smartyOptions)).status, 'confirmed');
  for (const change of [
    { address1: '3 rue Léon Blum' },
    { address2: 'Appartement 5' },
    { components: { locality: 'Paris', postal_code: '92800' } },
    { components: { locality: 'Puteaux', postal_code: '92801' } },
    { analysis: { verification_status: 'Verified', changes: { components: { postal_code: 'SmallChange' } } } },
    { analysis: { verification_status: 'Verified', changes: { components: { premise: 'LargeChange' } } } },
  ]) {
    candidate = { ...base, ...change };
    assert.equal((await validateWithSmarty(original, smartyOptions)).status, 'corrected');
  }
  candidate = { ...base, analysis: { verification_status: 'Partial', changes: { components: { premise: 'LargeChange' } } } };
  assert.equal((await validateWithSmarty(original, smartyOptions)).status, 'unconfirmed');
});

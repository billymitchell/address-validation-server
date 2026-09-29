import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('uses configured domestic and international providers for their region codes', async (t) => {
  const requests = [];
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const requestUrl = new URL(url);
    if (requestUrl.hostname === '127.0.0.1') return realFetch(url, options);
    requests.push(requestUrl.hostname);
    if (requestUrl.hostname === 'us-street.api.smarty.com') {
      return new Response(JSON.stringify([{
        delivery_line_1: '1 Main St',
        last_line: 'Anytown CA 90001',
        components: { city_name: 'Anytown', state_abbreviation: 'CA', zipcode: '90001' },
        analysis: { dpv_match_code: 'Y' },
      }]), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      result: {
        verdict: {
          validationGranularity: 'PREMISE',
          addressComplete: true,
        },
        address: {
          postalAddress: { regionCode: 'CA', addressLines: ['1 Main St'] },
          formattedAddress: '1 Main St, Toronto, Canada',
        },
      },
    }), { headers: { 'Content-Type': 'application/json' } });
  });

  const app = createApp({
    domesticProvider: 'smarty',
    internationalProvider: 'google',
    googleApiKey: 'google-test-key',
    smartyAuthId: 'smarty-test-id',
    smartyAuthToken: 'smarty-test-token',
    allowedOrigins: ['https://store.example'],
    rateLimitWindowMs: 60_000,
    rateLimitMax: 10,
    googleApiTimeoutMs: 1_000,
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const regionCode of ['US', 'CA']) {
    const response = await fetch(`${baseUrl}/api/validate-address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://store.example',
      },
      body: JSON.stringify({ regionCode, addressLines: ['1 Main St'] }),
    });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(requests, [
    'us-street.api.smarty.com',
    'addressvalidation.googleapis.com',
  ]);
});

test('normalizes all storefront military state labels for Smarty without changing city or unit', async (t) => {
  const requests = [];
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const requestUrl = new URL(url);
    if (requestUrl.hostname === '127.0.0.1') return realFetch(url, options);
    requests.push({
      state: requestUrl.searchParams.get('state'),
      city: requestUrl.searchParams.get('city'),
      street: requestUrl.searchParams.get('street'),
    });
    return new Response(JSON.stringify([{
      delivery_line_1: 'Unit 45013 Box 2666',
      last_line: 'APO AP 96338',
      components: {
        city_name: 'APO',
        state_abbreviation: 'AP',
        zipcode: '96338',
      },
      analysis: { dpv_match_code: 'Y' },
    }]), { headers: { 'Content-Type': 'application/json' } });
  });

  const app = createApp({
    domesticProvider: 'smarty',
    internationalProvider: 'google',
    smartyAuthId: 'smarty-test-id',
    smartyAuthToken: 'smarty-test-token',
    allowedOrigins: ['https://store.example'],
    rateLimitWindowMs: 60_000,
    rateLimitMax: 10,
    googleApiTimeoutMs: 1_000,
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const militaryAddresses = [
    ['APO', 'Armed Forces Americas (except Canada)', 'AA'],
    ['FPO', 'Armed Forces Africa, Canada, Europe, Middle East', 'AE'],
    ['DPO', 'Armed Forces Pacific', 'AP'],
  ];

  for (const [locality, administrativeArea] of militaryAddresses) {
    const response = await fetch(`${baseUrl}/api/validate-address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://store.example',
      },
      body: JSON.stringify({
        regionCode: 'US',
        addressLines: ['Unit 45013 Box 2666'],
        locality,
        administrativeArea,
        postalCode: '96338',
      }),
    });
    assert.equal(response.status, 200);
  }

  assert.deepEqual(requests, militaryAddresses.map(([city, , state]) => ({
    state,
    city,
    street: 'Unit 45013 Box 2666',
  })));
});

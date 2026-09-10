import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

const GOOGLE_URL_PREFIX = 'https://addressvalidation.googleapis.com';

const baseConfig = {
  googleApiKey: 'test-key',
  allowedOrigins: ['https://store1.com', 'https://store2.com'],
  port: 0,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 100,
  googleApiTimeoutMs: 1_000,
};

const validBody = {
  regionCode: 'US',
  addressLines: ['1600 Amphitheatre Pkwy'],
  locality: 'Mountain View',
  administrativeArea: 'CA',
  postalCode: '94043',
};

function googleResponse(overrides = {}) {
  return {
    result: {
      verdict: {
        validationGranularity: 'PREMISE',
        addressComplete: true,
        hasUnconfirmedComponents: false,
        hasInferredComponents: false,
        hasReplacedComponents: false,
        ...(overrides.verdict ?? {}),
      },
      address: {
        postalAddress: {
          regionCode: 'US',
          postalCode: '94043',
          administrativeArea: 'CA',
          locality: 'Mountain View',
          addressLines: ['1600 Amphitheatre Pkwy'],
          ...(overrides.postalAddress ?? {}),
        },
        formattedAddress: '1600 Amphitheatre Parkway, Mountain View, CA 94043, USA',
        addressComponents: overrides.addressComponents ?? [],
      },
    },
  };
}

function mockGoogleFetch(handler) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(GOOGLE_URL_PREFIX)) {
      return handler(url, options);
    }
    return realFetch(url, options);
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}

async function withServer(config, run) {
  const app = createApp(config);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function postAddress(baseUrl, body, headers = {}) {
  return fetch(`${baseUrl}/api/validate-address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://store1.com', ...headers },
    body: JSON.stringify(body),
  });
}

test('health check is open and returns ok', async () => {
  await withServer(baseConfig, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });
});

test('returns confirmed for a clean address', async () => {
  const restore = mockGoogleFetch(async () => new Response(JSON.stringify(googleResponse()), { status: 200 }));
  try {
    await withServer(baseConfig, async (baseUrl) => {
      const res = await postAddress(baseUrl, validBody);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'confirmed');
      assert.equal(body.suggestedAddress.postalCode, '94043');
      assert.equal(body.verdict.addressComplete, true);
      assert.deepEqual(body.messages, []);
    });
  } finally {
    restore();
  }
});

test('organization is optional and blank values are omitted from the upstream request', async () => {
  const upstreamAddresses = [];
  const restore = mockGoogleFetch(async (url, options) => {
    upstreamAddresses.push(JSON.parse(options.body).address);
    return new Response(JSON.stringify(googleResponse()), { status: 200 });
  });
  try {
    await withServer(baseConfig, async (baseUrl) => {
      for (const organization of [undefined, '', '   ', ' Example Company ']) {
        const res = await postAddress(baseUrl, { ...validBody, organization });
        assert.equal(res.status, 200);
        const upstream = upstreamAddresses.at(-1);
        if (organization?.trim()) {
          assert.equal(upstream.organization, 'Example Company');
        } else {
          assert.equal(Object.hasOwn(upstream, 'organization'), false);
        }
      }
      const res = await postAddress(baseUrl, { ...validBody, organization: 123 });
      assert.equal(res.status, 400);
      assert.equal(upstreamAddresses.length, 4);
    });
  } finally {
    restore();
  }
});

test('returns corrected with messages and suggestion', async () => {
  const corrected = googleResponse({
    verdict: { hasReplacedComponents: true },
    postalAddress: { postalCode: '94043-1351' },
    addressComponents: [
      { componentName: { text: 'Main Stret' }, componentType: 'route', spellCorrected: true, confirmationLevel: 'CONFIRMED' },
    ],
  });
  const restore = mockGoogleFetch(async () => new Response(JSON.stringify(corrected), { status: 200 }));
  try {
    await withServer(baseConfig, async (baseUrl) => {
      const res = await postAddress(baseUrl, validBody);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'corrected');
      assert.equal(body.suggestedAddress.postalCode, '94043-1351');
      assert.ok(body.messages.some((m) => m.includes('corrected')));
      assert.ok(body.messages.some((m) => m.includes('Main Stret')));
    });
  } finally {
    restore();
  }
});

test('international addresses may omit or leave optional locality, state and postal fields blank', async () => {
  const restore = mockGoogleFetch(async (url, options) => {
    const address = JSON.parse(options.body).address;
    assert.equal(address.regionCode, 'HK');
    for (const field of ['locality', 'administrativeArea', 'postalCode', 'organization']) {
      assert.equal(Object.hasOwn(address, field), false);
    }
    return new Response(JSON.stringify(googleResponse()), { status: 200 });
  });
  try {
    await withServer(baseConfig, async (baseUrl) => {
      for (const optionalFields of [{}, { locality: '', administrativeArea: ' ', postalCode: '', organization: '' }]) {
        const response = await postAddress(baseUrl, { regionCode: 'HK', addressLines: ['123 Example Road'], ...optionalFields });
        assert.equal(response.status, 200);
      }
      const invalid = await postAddress(baseUrl, { regionCode: 'HK', addressLines: ['123 Example Road'], administrativeArea: 12 });
      assert.equal(invalid.status, 400);
    });
  } finally {
    restore();
  }
});

test('returns invalid when Google cannot resolve the address', async () => {
  const unresolved = googleResponse({ verdict: { validationGranularity: 'OTHER', addressComplete: false } });
  const restore = mockGoogleFetch(async () => new Response(JSON.stringify(unresolved), { status: 200 }));
  try {
    await withServer(baseConfig, async (baseUrl) => {
      const res = await postAddress(baseUrl, validBody);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'invalid');
    });
  } finally {
    restore();
  }
});

test('rejects requests with a disallowed origin', async () => {
  await withServer(baseConfig, async (baseUrl) => {
    const res = await postAddress(baseUrl, validBody, { Origin: 'https://evil.example.com' });
    assert.equal(res.status, 403);
  });
});

test('rejects requests with no origin or referer', async () => {
  await withServer(baseConfig, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/validate-address`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    assert.equal(res.status, 403);
  });
});

test('accepts a whitelisted second storefront origin', async () => {
  const restore = mockGoogleFetch(async () => new Response(JSON.stringify(googleResponse()), { status: 200 }));
  try {
    await withServer(baseConfig, async (baseUrl) => {
      const res = await postAddress(baseUrl, validBody, { Origin: 'https://store2.com' });
      assert.equal(res.status, 200);
    });
  } finally {
    restore();
  }
});

test('accepts an allowed origin via Referer header', async () => {
  const restore = mockGoogleFetch(async () => new Response(JSON.stringify(googleResponse()), { status: 200 }));
  try {
    await withServer(baseConfig, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/validate-address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Referer: 'https://store1.com/checkout' },
        body: JSON.stringify(validBody),
      });
      assert.equal(res.status, 200);
    });
  } finally {
    restore();
  }
});

test('rejects body without regionCode', async () => {
  await withServer(baseConfig, async (baseUrl) => {
    const res = await postAddress(baseUrl, { postalCode: '94043' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /regionCode/);
  });
});

test('rejects body with neither addressLines nor postalCode', async () => {
  await withServer(baseConfig, async (baseUrl) => {
    const res = await postAddress(baseUrl, { regionCode: 'US', locality: 'Mountain View' });
    assert.equal(res.status, 400);
  });
});

test('maps Google API failure to 502', async () => {
  const restore = mockGoogleFetch(async () => new Response('denied', { status: 403 }));
  try {
    await withServer(baseConfig, async (baseUrl) => {
      const res = await postAddress(baseUrl, validBody);
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.ok(!JSON.stringify(body).includes('test-key'));
    });
  } finally {
    restore();
  }
});

test('rate limits after exceeding max requests', async () => {
  const restore = mockGoogleFetch(async () => new Response(JSON.stringify(googleResponse()), { status: 200 }));
  const config = { ...baseConfig, rateLimitMax: 3 };
  try {
    await withServer(config, async (baseUrl) => {
      for (let i = 0; i < 3; i += 1) {
        const res = await postAddress(baseUrl, validBody);
        assert.equal(res.status, 200);
      }
      const blocked = await postAddress(baseUrl, validBody);
      assert.equal(blocked.status, 429);
    });
  } finally {
    restore();
  }
});

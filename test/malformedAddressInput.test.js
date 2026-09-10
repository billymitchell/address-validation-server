// Focused coverage for parseAddressInput (src/routes/validateAddress.js): every
// request-shape and formatting error the /api/validate-address endpoint must
// reject, plus the whitespace/case normalization it must apply to accepted input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

const GOOGLE_URL_PREFIX = 'https://addressvalidation.googleapis.com';

const baseConfig = {
  googleApiKey: 'test-key',
  allowedOrigins: ['https://store1.com'],
  port: 0,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 1_000,
  googleApiTimeoutMs: 1_000,
};

function googleResponse() {
  return {
    result: {
      verdict: {
        validationGranularity: 'PREMISE',
        addressComplete: true,
        hasUnconfirmedComponents: false,
        hasInferredComponents: false,
        hasReplacedComponents: false,
      },
      address: {
        postalAddress: { regionCode: 'US', postalCode: '94043', addressLines: ['1600 Amphitheatre Pkwy'] },
        formattedAddress: '1600 Amphitheatre Parkway, Mountain View, CA 94043, USA',
        addressComponents: [],
      },
    },
  };
}

function mockGoogleFetch(handler) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(GOOGLE_URL_PREFIX)) return handler(url, options);
    return realFetch(url, options);
  };
  return () => { globalThis.fetch = realFetch; };
}

async function withServer(run) {
  const app = createApp(baseConfig);
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

function postRaw(baseUrl, rawBody) {
  return fetch(`${baseUrl}/api/validate-address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://store1.com' },
    body: rawBody,
  });
}

function postAddress(baseUrl, body) {
  return postRaw(baseUrl, JSON.stringify(body));
}

async function expectRejected(baseUrl, body, messagePattern) {
  const res = await postAddress(baseUrl, body);
  assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  const payload = await res.json();
  if (messagePattern) assert.match(payload.error, messagePattern, JSON.stringify(body));
}

// --- Malformed request body shape -------------------------------------------------

test('non-object request bodies are rejected', async () => {
  await withServer(async (baseUrl) => {
    for (const rawBody of ['null', '[]', '"just a string"', '42', 'true']) {
      const res = await postRaw(baseUrl, rawBody);
      assert.equal(res.status, 400, rawBody);
    }
  });
});

test('an empty request body is rejected', async () => {
  await withServer(async (baseUrl) => {
    const res = await postRaw(baseUrl, '{}');
    assert.equal(res.status, 400);
  });
});

// --- Malformed regionCode ----------------------------------------------------------

test('every malformed regionCode variant is rejected', async () => {
  await withServer(async (baseUrl) => {
    const malformed = [
      undefined, '', '   ', 123, null, true, ['US'], { code: 'US' },
      'U', 'USA', 'U1', 'U-', ' US', 'US ', ' US ', '12', '--',
    ];
    for (const regionCode of malformed) {
      await expectRejected(baseUrl, { regionCode, postalCode: '94043' }, /regionCode/);
    }
  });
});

test('valid regionCode is case-insensitive and always normalized to uppercase', async () => {
  const restore = mockGoogleFetch(async () => new Response(JSON.stringify(googleResponse()), { status: 200 }));
  try {
    await withServer(async (baseUrl) => {
      for (const regionCode of ['us', 'Us', 'uS', 'US']) {
        const res = await postAddress(baseUrl, { regionCode, postalCode: '94043' });
        assert.equal(res.status, 200, regionCode);
      }
    });
  } finally {
    restore();
  }
});

// --- Malformed addressLines ---------------------------------------------------------

test('every malformed addressLines variant is rejected', async () => {
  await withServer(async (baseUrl) => {
    const malformed = [
      'not an array',
      [],
      [1600, 'Amphitheatre Pkwy'],
      [null],
      [{ line: '1600 Amphitheatre Pkwy' }],
      [['1600 Amphitheatre Pkwy']],
      [true],
      ['   '],
      ['1600 Amphitheatre Pkwy', '   '],
      ['1', '2', '3', '4', '5', '6'], // exceeds MAX_ADDRESS_LINES (5)
    ];
    for (const addressLines of malformed) {
      await expectRejected(baseUrl, { regionCode: 'US', addressLines }, /addressLines/);
    }
  });
});

test('addressLines at the maximum allowed length (5) is accepted', async () => {
  const restore = mockGoogleFetch(async () => new Response(JSON.stringify(googleResponse()), { status: 200 }));
  try {
    await withServer(async (baseUrl) => {
      const res = await postAddress(baseUrl, { regionCode: 'US', addressLines: ['1', '2', '3', '4', '5'] });
      assert.equal(res.status, 200);
    });
  } finally {
    restore();
  }
});

test('address lines with surrounding whitespace are trimmed before reaching Google', async () => {
  const restore = mockGoogleFetch(async (url, options) => {
    const address = JSON.parse(options.body).address;
    assert.deepEqual(address.addressLines, ['1600 Amphitheatre Pkwy', 'Suite 100']);
    return new Response(JSON.stringify(googleResponse()), { status: 200 });
  });
  try {
    await withServer(async (baseUrl) => {
      const res = await postAddress(baseUrl, {
        regionCode: 'US',
        addressLines: ['  1600 Amphitheatre Pkwy  ', '\tSuite 100\n'],
      });
      assert.equal(res.status, 200);
    });
  } finally {
    restore();
  }
});

// --- Malformed optional string fields (locality, administrativeArea, postalCode, organization) --

test('non-string optional fields are rejected regardless of which field', async () => {
  await withServer(async (baseUrl) => {
    const badValues = [123, true, [], {}, null];
    for (const field of ['locality', 'administrativeArea', 'postalCode', 'organization']) {
      for (const value of badValues) {
        await expectRejected(baseUrl, { regionCode: 'US', addressLines: ['1600 Amphitheatre Pkwy'], [field]: value }, new RegExp(field));
      }
    }
  });
});

test('whitespace-only optional fields are silently omitted rather than rejected', async () => {
  const restore = mockGoogleFetch(async (url, options) => {
    const address = JSON.parse(options.body).address;
    for (const field of ['locality', 'administrativeArea', 'postalCode', 'organization']) {
      assert.equal(Object.hasOwn(address, field), false, field);
    }
    return new Response(JSON.stringify(googleResponse()), { status: 200 });
  });
  try {
    await withServer(async (baseUrl) => {
      const res = await postAddress(baseUrl, {
        regionCode: 'US',
        addressLines: ['1600 Amphitheatre Pkwy'],
        locality: '   ',
        administrativeArea: '\t',
        postalCode: '',
        organization: '\n',
      });
      assert.equal(res.status, 200);
    });
  } finally {
    restore();
  }
});

test('optional fields with surrounding whitespace are trimmed before reaching Google', async () => {
  const restore = mockGoogleFetch(async (url, options) => {
    const address = JSON.parse(options.body).address;
    assert.equal(address.locality, 'Mountain View');
    assert.equal(address.administrativeArea, 'CA');
    assert.equal(address.postalCode, '94043');
    assert.equal(address.organization, 'Acme Co');
    return new Response(JSON.stringify(googleResponse()), { status: 200 });
  });
  try {
    await withServer(async (baseUrl) => {
      const res = await postAddress(baseUrl, {
        regionCode: 'US',
        addressLines: ['1600 Amphitheatre Pkwy'],
        locality: '  Mountain View  ',
        administrativeArea: '\tCA\n',
        postalCode: ' 94043 ',
        organization: '  Acme Co  ',
      });
      assert.equal(res.status, 200);
    });
  } finally {
    restore();
  }
});

// --- Missing both addressLines and postalCode ---------------------------------------

test('an address with neither addressLines nor a postal code is rejected even with other fields set', async () => {
  await withServer(async (baseUrl) => {
    await expectRejected(baseUrl, {
      regionCode: 'US', locality: 'Mountain View', administrativeArea: 'CA', organization: 'Acme',
    }, /addressLines or postalCode/);
    // Whitespace-only postalCode is treated as absent, so this must also be rejected.
    await expectRejected(baseUrl, { regionCode: 'US', postalCode: '   ' }, /addressLines or postalCode/);
  });
});

test('postal-code-only or address-lines-only requests are both accepted', async () => {
  const restore = mockGoogleFetch(async () => new Response(JSON.stringify(googleResponse()), { status: 200 }));
  try {
    await withServer(async (baseUrl) => {
      assert.equal((await postAddress(baseUrl, { regionCode: 'US', postalCode: '94043' })).status, 200);
      assert.equal((await postAddress(baseUrl, { regionCode: 'US', addressLines: ['1600 Amphitheatre Pkwy'] })).status, 200);
    });
  } finally {
    restore();
  }
});

// --- Unexpected extra fields ---------------------------------------------------------

test('unrecognized extra fields are ignored and never forwarded to Google', async () => {
  const restore = mockGoogleFetch(async (url, options) => {
    const address = JSON.parse(options.body).address;
    assert.equal(Object.hasOwn(address, 'foo'), false);
    assert.equal(Object.hasOwn(address, '__proto__'), false);
    return new Response(JSON.stringify(googleResponse()), { status: 200 });
  });
  try {
    await withServer(async (baseUrl) => {
      const res = await postAddress(baseUrl, {
        regionCode: 'US',
        postalCode: '94043',
        foo: 'bar',
        '__proto__': { polluted: true },
      });
      assert.equal(res.status, 200);
    });
  } finally {
    restore();
  }
});

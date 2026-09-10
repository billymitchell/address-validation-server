import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../address-validation.js', import.meta.url), 'utf8');
const storefront = JSON.parse(readFileSync(new URL('./fixtures/storefront-regions.json', import.meta.url), 'utf8'));

function checkout(countryValue, regionAttribute, suggestedRegion, companyValue, suggestedPostalCode, stateConfig = {}) {
  const handlers = {};
  const requests = [];
  const errors = [];
  const zip = { value: '20191', addEventListener() {} };
  const option = (value, code) => ({ value, textContent: value, getAttribute: () => code });
  const changes = [];
  let state = {
    value: stateConfig.value ?? 'Maryland',
    options: stateConfig.options?.map(([name, code]) => option(name, code)),
    addEventListener() {},
    dispatchEvent(event) { changes.push(['state', event.type]); },
  };
  const country = {
    value: countryValue,
    options: [option(countryValue, regionAttribute), option('Canada')],
    get selectedIndex() { return this.options.findIndex((option) => option.value === this.value); },
    addEventListener() {},
    dispatchEvent(event) {
      changes.push(['country', event.type]);
      if (stateConfig.replaceOnCountryChange) {
        state = { ...state, value: '', options: stateConfig.replaceOnCountryChange.map(([name, code]) => option(name, code)) };
      }
    },
  };
  let submissions = 0;
  const form = {
    dataset: {},
    querySelector: () => null,
    addEventListener: (name, callback) => { handlers[name] = callback; },
    prepend: (element) => errors.push(element),
    requestSubmit() { submissions++; },
  };
  const modalNodes = {};
  const modal = {
    setAttribute() {},
    remove() {},
    querySelector(selector) {
      return modalNodes[selector] ||= {
        focus() {},
        addEventListener(name, callback) { this[name] = callback; },
      };
    },
  };
  runInNewContext(script, {
    Event,
    ...(stateConfig.useStorefront ? {
      country_arr: storefront.countries.map((country) => country.name),
      get_country_id: (name) => storefront.countries.findIndex((country) => country.name === name) + 1,
      get_states: (id) => storefront.countries[id - 1]?.states || [],
    } : {}),
    console: { log() {} },
    document: {
      readyState: 'complete',
      getElementById(id) {
        if (id === 'checkout-form') return form;
        if (id.endsWith('_country')) return country;
        if (id.endsWith('_zip')) return zip;
        if (id.endsWith('_state')) return state;
        if (id.endsWith('_company') && companyValue !== undefined) {
          return { value: companyValue, addEventListener() {} };
        }
        if (id.endsWith('_first_address')) return { value: '123 Main St', addEventListener() {} };
        return null;
      },
      createElement: (tag) => tag === 'div' ? modal : { dataset: {}, setAttribute() {} },
      body: { appendChild() {} },
      head: { appendChild() {} },
    },
    fetch: async (url, options) => {
      const address = JSON.parse(options.body);
      requests.push(address);
      return {
        ok: true,
        json: async () => suggestedRegion || suggestedPostalCode !== undefined || stateConfig.suggested !== undefined
          ? { status: 'corrected', suggestedAddress: {
            ...address,
            regionCode: suggestedRegion || address.regionCode,
            postalCode: suggestedPostalCode ?? address.postalCode,
            administrativeArea: stateConfig.suggested ?? address.administrativeArea,
          } }
          : { status: 'confirmed' },
      };
    },
  });
  return {
    country, zip, get state() { return state; }, get submissions() { return submissions; }, changes, requests, errors, modalNodes,
    async submit() {
      handlers.submit({ preventDefault() {} });
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('frontend converts storefront country names and codes before calling the API', async () => {
  for (const [name, code] of [
    ['United States', 'US'], ['Canada', 'CA'], ['United Kingdom', 'GB'],
    [' Germany ', 'DE'], ['us', 'US'], ['Åland Islands', 'AX'],
    ['Congo', 'CG'], ['Congo, The Democratic Republic of the', 'CD'],
    ['Korea, Republic of', 'KR'], ["Korea, Democratic People's Republic of", 'KP'],
    ['Virgin Islands, British', 'VG'], ['Virgin Islands, U.S.', 'VI'],
    ['Benin', 'BJ'], ['Burkina Faso', 'BF'], ['France', 'FR'],
    ['Russia', 'RU'], ['Serbia', 'RS'], ['Timor-Leste', 'TL'],
  ]) {
    const page = checkout(name);
    await page.submit();
    assert.equal(page.requests[0].regionCode, code, name);
    assert.equal(page.country.value, name);
  }
});

test('explicit region attribute takes precedence and is normalized', async () => {
  const page = checkout('Custom country name', ' ca ');
  await page.submit();
  assert.equal(page.requests[0].regionCode, 'CA');
});

test('frontend omits a missing or blank company and includes a supplied company', async () => {
  for (const company of [undefined, '', '   ', ' Example Company ']) {
    const page = checkout('United States', undefined, undefined, company);
    await page.submit();
    if (company?.trim()) {
      assert.equal(page.requests[0].organization, 'Example Company');
    } else {
      assert.equal(Object.hasOwn(page.requests[0], 'organization'), false);
    }
  }
});

test('unknown or empty countries are rejected without an API call', async () => {
  for (const name of ['', 'Unknown country', 'constructor', '__proto__']) {
    const page = checkout(name);
    await page.submit();
    assert.equal(page.requests.length, 0);
    assert.match(page.errors[0].textContent, /recognized country/);
  }
});

test('accepting a suggested country selects the corresponding full-name option', async () => {
  const page = checkout('United States', undefined, 'CA');
  await page.submit();
  page.modalNodes['[data-use-updated]'].click();
  assert.equal(page.country.value, 'Canada');
});

test('suggested ZIP displays and applies all digits without a dash', async () => {
  for (const suggestedZip of ['20191-1441', '201911441', '20190']) {
    const page = checkout('United States', undefined, undefined, undefined, suggestedZip);
    await page.submit();
    const expected = suggestedZip.replace(/-/g, '');
    assert.ok(page.modalNodes['[data-suggested-address]'].textContent.includes(expected));
    assert.ok(!page.modalNodes['[data-suggested-address]'].textContent.includes('-'));
    page.modalNodes['[data-use-updated]'].click();
    assert.equal(page.zip.value, expected);
  }
});

test('choosing the previous address preserves the original ZIP', async () => {
  const page = checkout('United States', undefined, undefined, undefined, '20191-1441');
  page.zip.value = '20191-1000';
  await page.submit();
  page.modalNodes['[data-use-previous]'].click();
  assert.equal(page.zip.value, '20191-1000');
});

test('suggestions show and apply full US state and country names', async () => {
  const page = checkout('United States', undefined, 'US', undefined, undefined, {
    value: 'Maryland', suggested: 'VA', options: [['Maryland'], ['Virginia']],
  });
  await page.submit();
  assert.equal(page.requests[0].regionCode, 'US');
  const display = page.modalNodes['[data-suggested-address]'].textContent;
  assert.match(display, /Virginia/);
  assert.match(display, /United States/);
  assert.doesNotMatch(display, /\bVA\b|\bUS\b/);
  page.modalNodes['[data-use-updated]'].click();
  assert.equal(page.country.value, 'United States');
  assert.equal(page.state.value, 'Virginia');
  assert.deepEqual(page.changes, [['state', 'change']]);
});

test('state mapping is scoped by country and supports Canadian provinces', async () => {
  const page = checkout('Canada', undefined, undefined, undefined, undefined, {
    value: 'Ontario', suggested: 'BC', options: [['Ontario'], ['British Columbia']],
  });
  await page.submit();
  assert.match(page.modalNodes['[data-suggested-address]'].textContent, /British Columbia/);
  page.modalNodes['[data-use-updated]'].click();
  assert.equal(page.state.value, 'British Columbia');
});

test('custom state codes resolve to the dropdown full name', async () => {
  const page = checkout('Australia', undefined, undefined, undefined, undefined, {
    value: 'Victoria', suggested: 'NSW', options: [['Victoria', 'VIC'], ['New South Wales', 'NSW']],
  });
  await page.submit();
  page.modalNodes['[data-use-updated]'].click();
  assert.equal(page.state.value, 'New South Wales');
});

test('abbreviation alone does not prompt for a change to the same state', async () => {
  const page = checkout('United States', undefined, undefined, undefined, undefined, {
    value: 'Virginia', suggested: 'VA', options: [['Virginia']],
  });
  await page.submit();
  assert.equal(page.modalNodes['[data-suggested-address]'], undefined);
  assert.equal(page.state.value, 'Virginia');
});

test('unknown state codes do not clear a full-name dropdown', async () => {
  const page = checkout('Canada', undefined, undefined, undefined, undefined, {
    value: 'Ontario', suggested: 'CA', options: [['Ontario']],
  });
  await page.submit();
  page.modalNodes['[data-use-updated]'].click();
  assert.equal(page.state.value, 'Ontario');
  assert.match(page.errors[0].textContent, /full state or province/);
  assert.equal(page.submissions, 0);
});

test('all 248 live storefront country names are accepted without changing their values', async () => {
  for (const country of storefront.countries) {
    const page = checkout(country.name, undefined, undefined, undefined, undefined, {
      value: country.states[0] || '', options: country.states.map((name) => [name]), useStorefront: true,
    });
    await page.submit();
    assert.match(page.requests[0]?.regionCode || '', /^[A-Z]{2}$/, country.name);
    assert.equal(page.country.value, country.name);
    assert.equal(page.state.value, country.states[0] || '', country.name);
    assert.equal(page.submissions, 1, country.name);
  }
});

test('global codes map to exact full-name values in the live storefront asset', async () => {
  const cases = [
    ['United States', 'US-VA', 'Virginia'], ['Canada', 'YT', 'Yukon Territory'],
    ['Australia', 'NSW', 'New South Wales'], ['Germany', 'BY', 'Bayern'],
    ['Brazil', 'SP', 'São Paulo'], ['India', 'MH', 'Maharashtra'],
    ['South Africa', 'NW', 'North-West (South Africa)'],
    ['Japan', 'JP-13', 'Tokyo'], ['United Arab Emirates', 'AZ', 'Abū Ȥaby [Abu Dhabi]'],
    ['France', 'IDF', 'Île-de-France'], ['Mexico', 'JAL', 'Jalisco'],
  ];
  for (const [countryName, code, expected] of cases) {
    const country = storefront.countries.find((country) => country.name === countryName);
    assert.ok(country.states.includes(expected), expected);
    const page = checkout(countryName, undefined, undefined, undefined, '20190', {
      value: country.states.find((name) => name !== expected),
      options: country.states.map((name) => [name]), suggested: code, useStorefront: true,
    });
    await page.submit();
    assert.ok(page.modalNodes['[data-suggested-address]'].textContent.includes(expected), `${countryName}: ${code}`);
    page.modalNodes['[data-use-updated]'].click();
    assert.equal(page.state.value, expected);
    assert.equal(page.submissions, 1);
  }
});

test('text state fields use the storefront name instead of the general dataset spelling', async () => {
  const page = checkout('Canada', undefined, undefined, undefined, undefined, {
    value: 'Ontario', suggested: 'YT', useStorefront: true,
  });
  await page.submit();
  page.modalNodes['[data-use-updated]'].click();
  assert.equal(page.state.value, 'Yukon Territory');
});

test('a merged modern region is not arbitrarily assigned to one of the legacy storefront regions', async () => {
  const country = storefront.countries.find((country) => country.name === 'France');
  const page = checkout('France', undefined, undefined, undefined, undefined, {
    value: 'Auvergne', suggested: 'ARA', options: country.states.map((name) => [name]), useStorefront: true,
  });
  await page.submit();
  page.modalNodes['[data-use-updated]'].click();
  assert.equal(page.state.value, 'Auvergne');
  assert.equal(page.submissions, 0);
  assert.match(page.errors[0].textContent, /full state or province/);
});

test('an exact legacy state selection is preserved despite modern region mergers', async () => {
  const country = storefront.countries.find((country) => country.name === 'France');
  const page = checkout('France', undefined, undefined, undefined, undefined, {
    value: 'Auvergne', options: country.states.map((name) => [name]), useStorefront: true,
  });
  await page.submit();
  assert.equal(page.state.value, 'Auvergne');
  assert.equal(page.submissions, 1);
});

test('country changes use a newly populated state dropdown', async () => {
  const page = checkout('United States', undefined, 'CA', undefined, undefined, {
    value: 'Virginia', options: [['Virginia']], suggested: 'BC',
    replaceOnCountryChange: [['Ontario'], ['British Columbia']], useStorefront: true,
  });
  await page.submit();
  page.modalNodes['[data-use-updated]'].click();
  assert.equal(page.country.value, 'Canada');
  assert.equal(page.state.value, 'British Columbia');
  assert.equal(page.submissions, 1);
});

test('empty international optional fields are omitted from the request', async () => {
  const page = checkout('Hong Kong', undefined, undefined, undefined, undefined, { value: '' });
  page.zip.value = '';
  await page.submit();
  for (const field of ['administrativeArea', 'postalCode', 'locality', 'organization']) {
    assert.equal(Object.hasOwn(page.requests[0], field), false);
  }
  assert.equal(page.submissions, 1);
});

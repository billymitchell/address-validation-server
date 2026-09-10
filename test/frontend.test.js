import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../address-validation.js', import.meta.url), 'utf8');

function checkout(countryValue, regionAttribute, suggestedRegion) {
  const handlers = {};
  const requests = [];
  const errors = [];
  const option = (value, code) => ({ value, getAttribute: () => code });
  const country = {
    value: countryValue,
    options: [option(countryValue, regionAttribute), option('Canada')],
    selectedIndex: 0,
    addEventListener() {},
  };
  const form = {
    dataset: {},
    querySelector: () => null,
    addEventListener: (name, callback) => { handlers[name] = callback; },
    prepend: (element) => errors.push(element),
    requestSubmit() {},
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
    console: { log() {} },
    document: {
      readyState: 'complete',
      getElementById(id) {
        if (id === 'checkout-form') return form;
        if (id.endsWith('_country')) return country;
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
        json: async () => suggestedRegion
          ? { status: 'corrected', suggestedAddress: { ...address, regionCode: suggestedRegion } }
          : { status: 'confirmed' },
      };
    },
  });
  return {
    country, requests, errors, modalNodes,
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

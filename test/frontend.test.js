import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../address-validation.js', import.meta.url), 'utf8');
const storefront = JSON.parse(readFileSync(new URL('./fixtures/storefront-regions.json', import.meta.url), 'utf8'));

function checkout(countryValue, regionAttribute, suggestedRegion, companyValue, suggestedPostalCode, stateConfig = {}, fieldOverrides = {}) {
  const handlers = {};
  const addressField = (value) => ({
    value,
    addEventListener(name, callback) { this[name] = callback; },
    dispatchEvent(event) { this[event.type]?.(event); },
    parentNode: { appendChild: (element) => hintNodes.push(element) },
  });
  const company = companyValue === undefined ? null : addressField(companyValue);
  const addressLine1 = addressField(fieldOverrides.addressLine1 ?? '123 Main St');
  const addressLine2 = addressField(fieldOverrides.addressLine2 ?? '');
  const requests = [];
  const errors = [];
  const hintNodes = [];
  const zip = {
    value: fieldOverrides.zip ?? '20191',
    addEventListener() {},
    parentNode: { appendChild: (element) => hintNodes.push(element) },
  };
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
  const button = { tagName: 'BUTTON', textContent: 'Place order', dataset: {}, disabled: false, focus() { activeElement = this; } };
  let activeElement = button;
  const form = {
    dataset: { validationTimeoutMs: stateConfig.timeoutMs },
    querySelector: (selector) => selector.includes('submit') ? button : errors[0] || null,
    addEventListener: (name, callback) => { handlers[name] = callback; },
    prepend: (element) => errors.push(element),
    requestSubmit() { submissions++; handlers.submit({ preventDefault() { throw new Error("Native submission was intercepted"); } }); },
  };
  const modalNodes = {};
  const modal = {
    addEventListener(name, callback) { this[name] = callback; },
    setAttribute() {},
    remove() { this.removed = true; },
    querySelector(selector) {
      return modalNodes[selector] ||= {
        textContent: '',
        hidden: false,
        focus() { activeElement = this; },
        appendChild(element) { (this.children ||= []).push(element); },
        addEventListener(name, callback) { this[name] = callback; },
      };
    },
  };
  runInNewContext(script, {
    Event, AbortController, setTimeout, clearTimeout,
    ...(stateConfig.useStorefront ? {
      country_arr: storefront.countries.map((country) => country.name),
      get_country_id: (name) => storefront.countries.findIndex((country) => country.name === name) + 1,
      get_states: (id) => storefront.countries[id - 1]?.states || [],
    } : {}),
    console: { log() {} },
    document: {
      readyState: 'complete',
      get activeElement() { return activeElement; },
      getElementById(id) {
        if (id === 'checkout-form') return form;
        if (id.endsWith('_country')) return country;
        if (id.endsWith('_zip')) return zip;
        if (id.endsWith('_state')) return state;
        if (id.endsWith('_company')) return company;
        if (id.endsWith('_first_address')) return addressLine1;
        if (id.endsWith('_second_address')) return addressLine2;
        if (id.endsWith('_city') && fieldOverrides.city !== undefined) {
          return { value: fieldOverrides.city, addEventListener() {} };
        }
        return null;
      },
      createElement: (tag) => tag === 'div' ? modal : { dataset: {}, setAttribute() {} },
      body: { appendChild() {} },
      head: { appendChild() {} },
    },
    fetch: async (url, options) => {
      const address = JSON.parse(options.body);
      requests.push(address);
      if (stateConfig.abortNext) {
        stateConfig.abortNext = false;
        await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      }
      if (stateConfig.fetchGate) await stateConfig.fetchGate;
      return {
        ok: true,
        json: async () => {
          const hasSuggestion = stateConfig.suggestedLines || suggestedRegion || suggestedPostalCode !== undefined || stateConfig.suggested !== undefined;
          const suggestedAddress = hasSuggestion ? {
            ...address,
            ...(stateConfig.suggestedLines ? { addressLines: stateConfig.suggestedLines, organization: undefined } : {}),
            regionCode: suggestedRegion || address.regionCode,
            postalCode: suggestedPostalCode ?? address.postalCode,
            administrativeArea: stateConfig.suggested ?? address.administrativeArea,
          } : undefined;
          if (stateConfig.resultStatus) {
            return {
              status: stateConfig.resultStatus,
              ...(stateConfig.candidates ? { candidates: stateConfig.candidates } : {}),
              messages: stateConfig.resultMessages || ['Please review your address.'],
              ...(suggestedAddress ? { suggestedAddress } : {}),
            };
          }
          return suggestedAddress
            ? { status: 'corrected', suggestedAddress }
            : { status: 'confirmed' };
        },
      };
    },
  });
  return {
    modal, button, get activeElement() { return activeElement; }, company, addressLine1, addressLine2, country, zip, get state() { return state; }, get submissions() { return submissions; }, changes, requests, errors, modalNodes,
    get companyHint() { return hintNodes.find((hint) => hint.className.includes('address-validation-hint--company')); },
    get hints() { return hintNodes; },
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

test('suggested US ZIP displays and applies only the five-digit ZIP code', async () => {
  for (const suggestedZip of ['20192-1441', '201921441', '20190']) {
    const page = checkout('United States', undefined, undefined, undefined, suggestedZip);
    await page.submit();
    const expected = suggestedZip.replace(/\D/g, '').slice(0, 5);
    assert.ok(page.modalNodes['[data-suggested-address]'].textContent.includes(expected));
    assert.doesNotMatch(page.modalNodes['[data-suggested-address]'].textContent, /\b20192-1441\b|\b201921441\b/);
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

test('unconfirmed results warn and let the shopper continue with the original address', async () => {
  const page = checkout('United States', undefined, undefined, undefined, undefined, {
    resultStatus: 'unconfirmed',
    resultMessages: ['Unit number could not be confirmed.'],
  });
  await page.submit();

  assert.equal(page.submissions, 0);
  assert.equal(page.modalNodes['[data-validation-message]'].textContent, 'Unit number could not be confirmed.');
  assert.equal(page.modalNodes['[data-use-updated]'].hidden, true);
  page.modalNodes['[data-use-previous]'].click();
  assert.equal(page.submissions, 1);
});

test('invalid result with a candidate lets the shopper choose candidate or review', async () => {
  const page = checkout('United States', undefined, undefined, undefined, '20192', {
    resultStatus: 'invalid',
    resultMessages: ['The address could not be verified.'],
    suggested: 'VA',
    value: 'Virginia',
    options: [['Virginia']],
  });
  await page.submit();

  assert.equal(page.submissions, 0);
  assert.equal(page.modalNodes['[data-use-updated]'].hidden, false);
  page.modalNodes['[data-review-address]'].click();
  assert.equal(page.modalNodes['[data-validation-message]'].textContent, 'The address could not be verified.');
  assert.equal(page.submissions, 0);
  assert.equal(page.state.value, 'Virginia');
});

test('shopper can explicitly accept a candidate for an invalid result', async () => {
  const page = checkout('United States', undefined, undefined, undefined, '20192', {
    resultStatus: 'invalid',
    resultMessages: ['The address could not be verified.'],
    suggested: 'VA',
    value: 'Maryland',
    options: [['Maryland'], ['Virginia']],
  });
  await page.submit();

  page.modalNodes['[data-use-updated]'].click();
  assert.equal(page.state.value, 'Virginia');
  assert.equal(page.submissions, 1);
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

test('military state-code suggestions map back to storefront state labels', async () => {
  const militaryStates = [
    ['AA', 'Armed Forces Americas (except Canada)'],
    ['AE', 'Armed Forces Africa, Canada, Europe, Middle East'],
    ['AP', 'Armed Forces Pacific'],
  ];
  for (const [code, name] of militaryStates) {
    const page = checkout('United States', undefined, undefined, undefined, undefined, {
      value: 'California',
      suggested: code,
      options: [['California'], ...militaryStates.map(([, stateName]) => [stateName])],
      useStorefront: true,
    });
    await page.submit();
    assert.ok(page.modalNodes['[data-suggested-address]'].textContent.includes(name));
    assert.doesNotMatch(page.modalNodes['[data-suggested-address]'].textContent, new RegExp(`\\b${code}\\b`));
    page.modalNodes['[data-use-updated]'].click();
    assert.equal(page.state.value, name);
  }
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

test('whitespace-only address and blank postal code is rejected without an API call', async () => {
  for (const blank of ['', '   ', '\t\n']) {
    const page = checkout('United States', undefined, undefined, undefined, undefined, {}, {
      addressLine1: blank, addressLine2: blank, city: blank, zip: blank,
    });
    await page.submit();
    assert.equal(page.requests.length, 0);
    assert.match(page.errors[0].textContent, /Enter an address or postal code/);
  }
});

test('a postal-code-only submission is accepted with no address lines', async () => {
  const page = checkout('United States', undefined, undefined, undefined, undefined, {}, {
    addressLine1: '   ', addressLine2: '', zip: '20191',
  });
  await page.submit();
  assert.equal(page.requests.length, 1);
  assert.deepEqual(page.requests[0].addressLines, []);
  assert.equal(page.requests[0].postalCode, '20191');
});

test('leading/trailing whitespace is trimmed from every field before submission', async () => {
  const page = checkout('United States', undefined, undefined, '  Acme Co  ', undefined, {}, {
    addressLine1: '  123 Main St  ', addressLine2: '  Apt 4  ', city: '  Reston  ', zip: '  20191  ',
  });
  await page.submit();
  const request = page.requests[0];
  assert.deepEqual(request.addressLines, ['123 Main St', 'Apt 4']);
  assert.equal(request.locality, 'Reston');
  assert.equal(request.postalCode, '20191');
  assert.equal(request.organization, 'Acme Co');
});

test('a blank second address line is dropped while the first line is kept', async () => {
  const page = checkout('United States', undefined, undefined, undefined, undefined, {}, {
    addressLine1: '123 Main St', addressLine2: '   ',
  });
  await page.submit();
  assert.deepEqual(page.requests[0].addressLines, ['123 Main St']);
});

test('country names resolve regardless of case, internal whitespace, or diacritics', async () => {
  for (const name of [' UnItEd   StAtEs \t', 'UNITED STATES', '  United States of America  ', 'México', 'MEXICO']) {
    const page = checkout(name);
    await page.submit();
    assert.equal(page.requests.length, 1, name);
    assert.ok(['US', 'MX'].includes(page.requests[0].regionCode), name);
  }
});

test('organization with only whitespace is omitted while surrounding whitespace is trimmed otherwise', async () => {
  for (const [company, expectedOmitted] of [['   ', true], ['\t\n', true], ['  Acme  ', false]]) {
    const page = checkout('United States', undefined, undefined, company, undefined, {}, { zip: '20191' });
    await page.submit();
    if (expectedOmitted) {
      assert.equal(Object.hasOwn(page.requests[0], 'organization'), false);
    } else {
      assert.equal(page.requests[0].organization, 'Acme');
    }
  }
});

// --- Company-in-address-line-1 inline hint ----------------------------------------

test('shows an inline hint when a company name looks like it was entered in address line 1', () => {
  const page = checkout('United States', undefined, undefined, undefined, undefined, {}, {
    addressLine1: 'Acme Corporation', addressLine2: '1600 Amphitheatre Pkwy',
  });
  assert.equal(page.companyHint.textContent, 'This looks like a company name. Did you mean to enter it in the Company field instead of Address line 1?');
});

test('shows a review hint before relocating an already supplied company', () => {
  const page = checkout('United States', undefined, undefined, 'Acme Corporation', undefined, {}, {
    addressLine1: 'Acme Corporation', addressLine2: '1600 Amphitheatre Pkwy',
  });
  assert.ok(page.companyHint.textContent.length > 0);
});

test('does not show the hint for an ordinary two-line address', () => {
  const page = checkout('United States', undefined, undefined, undefined, undefined, {}, {
    addressLine1: '123 Main St', addressLine2: 'Apt 4',
  });
  assert.equal(page.companyHint.textContent, '');
});

test('the hint never blocks form submission', async () => {
  const page = checkout('United States', undefined, undefined, undefined, undefined, {}, {
    addressLine1: 'Acme Corporation', addressLine2: '1600 Amphitheatre Pkwy',
  });
  assert.ok(page.companyHint.textContent.length > 0);
  await page.submit();
  assert.equal(page.submissions, 1);
});

test('shows unit-entry guidance without requiring an apartment or suite', () => {
  const page = checkout('United States', undefined, undefined, undefined, undefined, {}, {
    addressLine1: '123 Main St',
    addressLine2: '',
  });
  assert.ok(page.hints.some((hint) => hint.textContent.includes('Apartment, suite, unit')));
});

test('warns for malformed US ZIP formats but does not block submission', async () => {
  const page = checkout('United States', undefined, undefined, undefined, undefined, {}, {
    zip: '12A4',
  });
  const zipHint = page.hints.find((hint) => hint.textContent.includes('U.S. ZIP codes'));
  assert.ok(zipHint);
  await page.submit();
  assert.equal(page.submissions, 1);
});

test('does not enforce US ZIP syntax on international postal codes', () => {
  const page = checkout('Canada', undefined, undefined, undefined, undefined, {}, {
    zip: 'K1A 0B1',
  });
  assert.equal(page.hints.some((hint) => hint.textContent.includes('U.S. ZIP codes')), false);
  assert.ok(page.hints.some((hint) => hint.textContent.includes('format used in this country')));
});

test('warns when street address and PO Box are both entered', () => {
  const page = checkout('United States', undefined, undefined, undefined, undefined, {}, {
    addressLine1: '123 Main St',
    addressLine2: 'PO Box 45',
  });
  assert.ok(page.hints.some((hint) => hint.textContent.includes('both a PO Box and a street address')));
});

test('PO Box and street warning does not block the shopper', async () => {
  const page = checkout('United States', undefined, undefined, undefined, undefined, {}, {
    addressLine1: '123 Main St',
    addressLine2: 'PO Box 45',
  });
  await page.submit();
  assert.ok(page.hints.some((hint) => hint.textContent.includes('both a PO Box and a street address')));
  assert.equal(page.submissions, 1);
});

test('does not warn about PO Box with an apartment line or a standalone PO Box', () => {
  for (const [addressLine1, addressLine2] of [
    ['123 Main St', 'Apt 4'],
    ['PO Box 45', ''],
  ]) {
    const page = checkout('United States', undefined, undefined, undefined, undefined, {}, {
      addressLine1,
      addressLine2,
    });
    assert.equal(page.hints.some((hint) => hint.textContent.includes('both a PO Box and a street address')), false);
  }
});


test('relocates a misplaced company and street before validation and submission', async () => {
  for (const existing of ['', '  ', 'Acme Corporation']) {
    const page = checkout('United States', undefined, undefined, existing, undefined, {}, {
      addressLine1: ' Acme Corporation ', addressLine2: ' 1600 Amphitheatre Pkwy Suite 4 ',
    });
    await page.submit();
    assert.equal(page.company.value, 'Acme Corporation');
    assert.equal(page.addressLine1.value, '1600 Amphitheatre Pkwy Suite 4');
    assert.equal(page.addressLine2.value, '');
    assert.equal(page.requests[0].organization, 'Acme Corporation');
    assert.deepEqual(page.requests[0].addressLines, ['1600 Amphitheatre Pkwy Suite 4']);
    assert.equal(page.submissions, 1);
  }
});

test('relocates on completed edits but waits while the customer types', () => {
  const page = checkout('United States', undefined, undefined, '', undefined, {}, {
    addressLine1: 'Acme Corporation', addressLine2: '',
  });
  page.addressLine2.value = '123 Main St';
  page.addressLine2.input();
  assert.equal(page.company.value, '');
  page.addressLine2.change();
  assert.equal(page.company.value, 'Acme Corporation');
  assert.equal(page.addressLine1.value, '123 Main St');
  assert.equal(page.addressLine2.value, '');
});

test('preserves conflicting companies and ordinary two-line addresses', async () => {
  for (const [company, line1, line2] of [
    ['Other Company', 'Acme Corporation', '123 Main St'],
    ['', '123 Company Road', '456 Main St'],
    ['', '123 Main St', 'Apt 4'],
  ]) {
    const page = checkout('United States', undefined, undefined, company, undefined, {}, {
      addressLine1: line1, addressLine2: line2,
    });
    await page.submit();
    assert.equal(page.company.value, company);
    assert.equal(page.addressLine1.value, line1);
    assert.equal(page.addressLine2.value, line2);
  }
});


test('ignores duplicate submissions and rejects stale validation results', async () => {
  let release;
  const fetchGate = new Promise((resolve) => { release = resolve; });
  const page = checkout('United States', undefined, undefined, '', undefined, { fetchGate });
  await page.submit();
  await page.submit();
  assert.equal(page.requests.length, 1);
  page.addressLine1.value = '456 New St';
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.submissions, 0);
  assert.equal(page.addressLine1.value, '456 New St');
  assert.match(page.errors[0].textContent, /changed during validation/);
  await page.submit();
  assert.equal(page.submissions, 1);
});

test('preserves all suggested address lines and company in review', async () => {
  const page = checkout('United States', undefined, undefined, 'Acme', undefined, {
    suggestedLines: ['456 New St', 'Building A', 'Suite 4'],
  });
  await page.submit();
  assert.match(page.modalNodes['[data-suggested-address]'].textContent, /^Acme/);
  await page.submit();
  assert.equal(page.requests.length, 1);
  page.modalNodes['[data-use-updated]'].click();
  assert.equal(page.addressLine2.value, 'Building A, Suite 4');
  assert.equal(page.company.value, 'Acme');
});

test('unexpected validation statuses do not submit checkout', async () => {
  const page = checkout('United States', undefined, undefined, '', undefined, { resultStatus: 'unknown' });
  await page.submit();
  assert.equal(page.submissions, 0);
  assert.match(page.errors[0].textContent, /unexpected response/);
});

test('PO boxes are not relocated into the company field', async () => {
  const page = checkout('United States', undefined, undefined, '', undefined, {}, {
    addressLine1: 'PO Box 123', addressLine2: '456 Main St',
  });
  await page.submit();
  assert.equal(page.company.value, '');
  assert.equal(page.addressLine1.value, 'PO Box 123');
});


test('revalidates a retry when native checkout submission does not navigate', async () => {
  const page = checkout('United States');
  await page.submit();
  await page.submit();
  assert.equal(page.requests.length, 2);
  assert.equal(page.submissions, 2);
});


test('timeout restores the visible button label and permits retry', async () => {
  const page = checkout('United States', undefined, undefined, '', undefined, { timeoutMs: 5, abortNext: true });
  await page.submit();
  assert.equal(page.button.textContent, 'Verifying address...');
  assert.equal(page.button.disabled, true);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.match(page.errors[0].textContent, /timed out.*try again/);
  assert.equal(page.button.textContent, 'Place order');
  assert.equal(page.button.disabled, false);
  assert.equal(page.submissions, 0);
  await page.submit();
  assert.equal(page.submissions, 1);
  assert.equal(page.errors[0].textContent, '');
});

test('candidate selector applies the chosen candidate and dialog traps keyboard focus', async () => {
  const page = checkout('United States', undefined, undefined, 'Acme', undefined, {
    resultStatus: 'unconfirmed',
    candidates: [
      { regionCode: 'US', addressLines: ['111 Main St'], administrativeArea: 'Maryland' },
      { regionCode: 'US', addressLines: ['222 Main St'], administrativeArea: 'Maryland' },
    ],
  });
  await page.submit();
  const selector = page.modalNodes['[data-address-candidate]'];
  assert.equal(selector.children.length, 2);
  let prevented = false;
  page.modal.keydown({ key: 'Tab', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(page.activeElement, selector);
  page.modal.keydown({ key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(page.activeElement, page.modalNodes['[data-use-updated]']);
  selector.value = '1';
  selector.change();
  assert.match(page.modalNodes['[data-suggested-address]'].textContent, /222 Main St/);
  page.modalNodes['[data-use-updated]'].click();
  assert.equal(page.addressLine1.value, '222 Main St');
  assert.equal(page.submissions, 1);
});

test('Escape closes review, restores focus, and allows another validation', async () => {
  const page = checkout('United States', undefined, undefined, '', undefined, { resultStatus: 'unconfirmed' });
  await page.submit();
  page.modal.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(page.modal.removed, true);
  assert.equal(page.activeElement, page.button);
  assert.equal(page.submissions, 0);
  await page.submit();
  assert.equal(page.requests.length, 2);
});

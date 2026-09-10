// Check the pinned storefront snapshot against the actual frontend resolver.
import fs from 'node:fs';
import vm from 'node:vm';
const fixture = JSON.parse(fs.readFileSync(new URL('../test/fixtures/storefront-regions.json', import.meta.url)));
const script = fs.readFileSync(new URL('../address-validation.js', import.meta.url), 'utf8');
const countries = fixture.countries.map((country) => country.name);
const context = {
  console: { log() {} },
  country_arr: countries,
  get_country_id: (name) => countries.indexOf(name) + 1,
  get_states: (id) => fixture.countries[id - 1]?.states || [],
  document: {
    readyState: 'complete',
    getElementById: (id) => id === 'checkout-form'
      ? { dataset: {}, querySelector() {}, addEventListener() {} } : null,
  },
};
vm.runInNewContext(script.replace('  bindAddressChangeListeners();',
  '  globalThis.audit = { resolveCountryCode, stateRecord, storefrontStateName, subdivisionData };\n  bindAddressChangeListeners();'), context);
const { resolveCountryCode, stateRecord, storefrontStateName, subdivisionData } = context.audit;
const report = {
  source: fixture.source,
  sha256: fixture.sha256,
  countryCount: countries.length,
  stateEntryCount: fixture.countries.reduce((sum, country) => sum + country.states.length, 0),
  unmappedCountries: [],
  stateEntriesWithCodeMapping: 0,
  stateEntriesWithoutCodeMapping: [],
  fullNamePreservationFailures: [],
  matchedCodeCount: 0,
  countries: [],
};
for (const country of fixture.countries) {
  const code = resolveCountryCode(country.name);
  if (!code) report.unmappedCountries.push(country.name);
  const matches = [];
  for (const subdivisionCode of Object.keys(subdivisionData[code] || {})) {
    if (!/^[A-Z0-9]{1,3}$/.test(subdivisionCode)) continue;
    const name = storefrontStateName(subdivisionCode, code);
    if (name) matches.push({ code: subdivisionCode, value: name });
  }
  for (const state of country.states) {
    if (storefrontStateName(state, code) !== state) report.fullNamePreservationFailures.push({ country: country.name, state });
    if (matches.some((match) => match.value === state)) report.stateEntriesWithCodeMapping++;
    else report.stateEntriesWithoutCodeMapping.push({ country: country.name, state });
  }
  report.matchedCodeCount += matches.length;
  report.countries.push({ name: country.name, code, matches });
}
const output = new URL('../reports/storefront-compatibility.json', import.meta.url);
fs.mkdirSync(new URL('../reports/', import.meta.url), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  countries: report.countryCount,
  unmappedCountries: report.unmappedCountries,
  stateEntries: report.stateEntryCount,
  stateEntriesWithCodeMapping: report.stateEntriesWithCodeMapping,
  stateEntriesWithoutCodeMapping: report.stateEntriesWithoutCodeMapping.length,
  fullNamePreservationFailures: report.fullNamePreservationFailures.length,
  matchedCodeCount: report.matchedCodeCount,
}, null, 2));

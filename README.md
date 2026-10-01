# Address Validation Server

A small Express API that validates postal addresses (domestic and international) for an
e-commerce checkout, backed by Google's Address Validation API and/or Smarty's Street
APIs.

The front-end calls it when the shopper finishes entering their address — once for the
shipping address and once for the billing address (the two calls can be fired in
parallel). The server returns a normalized verdict plus a suggested/corrected address
when the selected provider finds issues, so the UI can show a "Did you mean…?" prompt.

## API

### `POST /api/validate-address`

US addresses use the configured domestic provider. Addresses for every other
`regionCode` use the configured international provider. Smarty is the default for
both. Set the providers independently to `google` or `smarty`; for example, Smarty
for US addresses and Google internationally:

```dotenv
DOMESTIC_VALIDATION_PROVIDER=smarty
INTERNATIONAL_VALIDATION_PROVIDER=google
```

Smarty uses its US Street API for US addresses and its International Street API for
all other countries. Its results are normalized to the same response shape used by
Google. A Smarty US result is confirmed only when its DPV match code is `Y`;
ambiguous or non-deliverable results are marked for review or invalid.

### APO/FPO/DPO military addresses

Enter military mail as a US address (`regionCode: "US"`), regardless of where the
recipient is stationed. Use `APO`, `FPO`, or `DPO` for `locality`, the military unit,
PSC, ship, or box in `addressLines`, and the military ZIP code in `postalCode`.
Do not enter the overseas base or country as the destination.

The storefront may send the long state labels **Armed Forces Americas (except Canada)**,
**Armed Forces Africa, Canada, Europe, Middle East**, or **Armed Forces Pacific**. Before
validation, the API converts those labels to USPS state codes `AA`, `AE`, or `AP`,
respectively. Already-abbreviated codes are also accepted. This normalization applies
to both configured domestic providers, Google and Smarty. Provider results that return
the codes are mapped back to the storefront's long labels by the frontend.

Use USPS-eligible delivery for these addresses; military mail routing and carrier
serviceability are separate from address validation. Follow [USPS military and
diplomatic mail guidance](https://www.usps.com/ship/apo-fpo-dpo.htm) and [Publication
28's military address format](https://pe.usps.com/text/pub28/28c2_010.htm).

Request body (the same address fields are normalized for the selected provider):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `regionCode` | string | ✅ | 2-letter country code, e.g. `"US"`, `"CA"`, `"GB"` |
| `addressLines` | string[] | one of these | Up to 5 non-empty street lines |
| `postalCode` | string | one of these | ZIP / postal code |
| `locality` | string | | City / town |
| `administrativeArea` | string | | State / province / region |
| `organization` | string | No | Optional company name; blank values are ignored |

Example request:

```bash
curl -X POST https://your-app.herokuapp.com/api/validate-address \
  -H "Content-Type: application/json" \
  -H "Origin: https://your-store.com" \
  -d '{"regionCode":"US","addressLines":["1600 Amphitheatre Pkwy"],"locality":"Mountain View","administrativeArea":"CA","postalCode":"94043"}'
```

Example response:

```json
{
  "status": "confirmed",
  "suggestedAddress": {
    "formattedAddress": "1600 Amphitheatre Parkway, Mountain View, CA 94043, USA",
    "regionCode": "US",
    "postalCode": "94043",
    "administrativeArea": "CA",
    "locality": "Mountain View",
    "addressLines": ["1600 Amphitheatre Pkwy"]
  },
  "verdict": {
    "addressComplete": true,
    "validationGranularity": "PREMISE",
    "hasUnconfirmedComponents": false,
    "hasInferredComponents": false,
    "hasReplacedComponents": false
  },
  "messages": []
}
```

`status` is one of:

- `confirmed` — address is complete and verified
- `corrected` — the provider corrected components; show `suggestedAddress` for confirmation
- `unconfirmed` — some components couldn't be confirmed; the checkout warns and lets the shopper review or choose whether to continue
- `invalid` — address could not be resolved to a deliverable location; the checkout warns and asks the shopper to review or explicitly continue

### Address-formatting variation tests

Enter these variations in order, submitting each as a separate request to
`POST /api/validate-address`. Keep the address fields the same except for the
formatting change in each step:

1. **Baseline:** `1600 Amphitheatre Pkwy`, Mountain View, CA `94043`, country `US`.
2. **Expanded street suffix:** change the street to `1600 Amphitheatre Parkway`.
3. **Different capitalization:** enter `1600 AMPHITHEATRE PKWY`.
4. **Punctuation:** enter `1600 Amphitheatre Pkwy.`.
5. **ZIP+4:** keep the baseline street and city, but enter `94043-1351` as the postal
   code.

For each submission, expect HTTP `200` for a well-formed request, then inspect
`status`, `suggestedAddress`, and `messages`. The provider may return a normalized
spelling or postal code, or may leave the entered formatting unchanged; exact response
text is provider-dependent. These examples test formatting acceptance, not whether the
API itself rewrites every input.

### Manual address-entry tests

After starting the server, enter the following addresses in the sample storefront or
send them to `POST /api/validate-address`. Replace `https://your-app.herokuapp.com`
with the local or deployed API URL. Requests need an `Origin` that is listed in
`ALLOWED_ORIGINS`.

```bash
API_URL=http://localhost:3000
ORIGIN=https://store1.com

validate() {
  curl --silent --show-error --fail-with-body \
    -X POST "$API_URL/api/validate-address" \
    -H "Content-Type: application/json" \
    -H "Origin: $ORIGIN" \
    -d "$1"
  printf '\n\n'
}
```

Run these cases and inspect the returned `status`, `suggestedAddress`, `verdict`,
and `messages` fields:

| Test | Address data to enter | Expected result |
| --- | --- | --- |
| Valid U.S. address | `1600 Amphitheatre Pkwy`, Mountain View, CA `94043`, country `US` | HTTP `200`; normally `confirmed` |
| U.S. address with a company | Organization `Acme Corporation`; address lines `Acme Corporation` and `1600 Amphitheatre Pkwy`; Mountain View, CA `94043`, country `US` | HTTP `200`; the provider receives both address lines and the optional organization |
| Corrected U.S. address | `1600 Amphitheatre Pkwy`, Mountain View, CA `94043`, country `US` (also try a deliberate typo such as `1600 Amphitheatre Pk` or `Main Stret`) | HTTP `200`; `corrected` when the provider replaces a component, with a `suggestedAddress` |
| International address | `2 rue Léon Blum`, Puteaux, Île-de-France `92800`, country `FR` | HTTP `200`; normally `confirmed` or `corrected`, depending on the provider |
| Address with optional fields blank | `123 Example Road`, country `HK`; leave locality, region, and postal code blank | HTTP `200` if the configured provider supports the country and address |
| APO/FPO/DPO address | `Unit 45013 Box 2666`, `APO`, state `Armed Forces Africa, Canada, Europe, Middle East`, ZIP `96338`, country `US` | HTTP `200`; the API normalizes the state to `AE` before provider validation |
| Unresolvable address | `No Such Road`, country `US` | HTTP `200`; `invalid` or `unconfirmed`, with a review message |
| Missing country | Any postal code, but omit `regionCode` | HTTP `400`; an error explaining that `regionCode` is required |
| Missing address data | Country `US`, but leave both address lines and postal code blank | HTTP `400`; an error explaining that one of `addressLines` or `postalCode` is required |

Example requests for the most important cases:

```bash
# Confirmed U.S. address
validate '{"regionCode":"US","addressLines":["1600 Amphitheatre Pkwy"],"locality":"Mountain View","administrativeArea":"CA","postalCode":"94043"}'

# International address
validate '{"regionCode":"FR","addressLines":["2 rue Léon Blum"],"locality":"Puteaux","administrativeArea":"Île-de-France","postalCode":"92800"}'

# APO address using the long storefront state label
validate '{"regionCode":"US","addressLines":["Unit 45013 Box 2666"],"locality":"APO","administrativeArea":"Armed Forces Africa, Canada, Europe, Middle East","postalCode":"96338"}'

# Invalid request: no country code
validate '{"postalCode":"94043"}'
```

Also verify the surrounding system behavior:

1. Submit the same address through both the shipping and billing forms and confirm
   that each request is validated independently.
2. When a correction is returned, compare the entered and suggested addresses, then
   accept the suggestion and confirm that the corrected values are applied to the form.
3. Try an origin that is not in `ALLOWED_ORIGINS`; the API should return HTTP `403`.
4. Request `GET /health`; it should return HTTP `200` and `{ "status": "ok" }`.

Provider coverage and response wording can vary by country and by configured provider.
Treat the expected statuses above as acceptance criteria for the user experience,
while checking the returned suggestion and messages for the exact provider result.

### `GET /health`

Liveness probe, returns `{ "status": "ok" }`. Not rate-limited or origin-restricted.

## Security

- **Origin whitelist:** requests must include an `Origin` (or `Referer`) header matching
  `ALLOWED_ORIGINS`, and browsers are restricted via CORS to the same list. Entries
  such as `https://*.mybrightsites.com` allow only HTTPS subdomains of that domain.
  Everything else gets `403`.
- **Rate limiting:** per client IP (defaults: 100 requests / 15 minutes).
- Request bodies are capped at 10 KB and strictly validated.
- Google and Smarty credentials live only in server-side environment variables and
  are never sent to clients.
- Upstream calls have a configurable timeout (default 10 s).

## Front-end integration

`address-validation.js` intercepts the sample checkout form's Continue action. It:

1. Prevents the normal submission while the address is validated.
2. Shows the entered and suggested addresses when a provider returns a correction.
   For `unconfirmed` or `invalid` results, it warns the shopper and offers review,
   explicit continuation with the entered address, or the candidate suggestion when
   one is available.
3. Applies the shopper's selected address to the existing form, then resumes its
   native submission.

The form also reminds shoppers to include apartment, suite, unit, floor, or building
details when applicable. It gives U.S.-specific ZIP format guidance, uses country-neutral
postal-code guidance elsewhere, and warns without blocking when a street address and
PO Box are both entered. When Address Line 1 contains a likely company name and Address Line 2 contains
a street address, completing an edit or submitting moves the company to the Company
field, moves the street to Address Line 1, and clears Address Line 2. A different
existing company is preserved; a non-blocking hint remains for review. These hints do not replace provider validation or carrier checks.

Suggested ZIP/postal codes have hyphens removed before display and application
to the form. All digits are retained: `20191-1441` becomes `201911441`.

The comparison displays full country names and resolves state/province codes
worldwide using bundled Unicode CLDR, Google postal metadata, and Carmen aliases.
No additional runtime API call or script include is needed for those mappings.
API requests still use two-letter country codes.

Your storefront's `country_states.js.liquid` / `country_states.js` controls the
accepted names. When available, the script reads its `country_arr`,
`get_country_id()`, and `get_states()` helpers at runtime. Load that theme asset
before this script. Suggestions are matched to the existing dropdown values,
preserving exact spellings such as `Bayern`, `Yukon Territory`, and
`North-West (South Africa)`. Applying a suggestion fires change events to refresh
Select2 and checks the current state field after a country change.

If a storefront populates states asynchronously, an unavailable option is flagged
for review; submission does not proceed with an unmatched state. The script never
adds a guessed state option. Exact existing selections are preserved, including
legacy region names. For custom names not covered by the aliases, a state option
can explicitly declare its code:

```html
<option value="New South Wales" data-state-code="AU-NSW">New South Wales</option>
```

Countries without a state or postal code can leave those optional fields blank.
Global name conversion does not expand Google's address-validation coverage:
see [Google's supported regions](https://developers.google.com/maps/documentation/address-validation/coverage).

### Storefront compatibility audit

The [test fixture](test/fixtures/storefront-regions.json) records the exact live
`country_states.js` URL supplied for this integration and its SHA-256 hash.
It contains 248 countries and 3,776 state/province entries. The current resolver
recognizes every country and preserves every existing full state name. Of those
state entries, 3,720 have a code mapping to an exact storefront value; 56 do not
have an unambiguous mapping. These include legacy regions, merged regions, and
spelling variants. Do not treat them as verified automatic conversions.

Inspect [the full audit](reports/storefront-compatibility.json), especially
`stateEntriesWithoutCodeMapping`, for the exceptions and each country's mappings.
For example, a modern merged French region may correspond to multiple old
dropdown options; the shopper must review that case. The theme's original
country/state data is not modified by this integration.

Run `node scripts/audit-storefront-regions.mjs` to repeat the audit against the
saved fixture. It does not fetch the live asset; refresh the fixture and its hash
when that asset changes. Run `python3 scripts/build-address-regions.py` to rebuild
the bundled mappings from pinned sources (Python 3 and Ruby required only for
regeneration). Sources, licenses, and modifications are in
[the data attribution](licenses/address-data.md).

Link to the script through GitHub Pages in your frontend Liquid template and
configure the API URL on the form:

```html
<form id="checkout-form"
      data-validation-api="https://your-app.herokuapp.com"
      action="/checkout/address"
      method="post">
  ...
</form>
<script
  src="https://billymitchell.github.io/address-validation-server/address-validation.js?v={{ 'now' | date: '%Y%m%d%H%M%S' }}"
></script>
```

The Liquid timestamp adds a cache-busting query parameter when the template is
rendered. For plain HTML, omit `?v={{ 'now' | date: '%Y%m%d%H%M%S' }}`.
The script waits until the DOM is ready before initializing.

The script converts the storefront's country names into two-letter `regionCode`
values for the API (for example, `United States` becomes `US`). It includes all
249 countries and territories in the sample dropdown, supports the legacy names
in `country_states.js`, and also accepts two-letter option values. The form's
country values remain unchanged.

For custom or translated country names, add a `data-region-code` attribute
containing the ISO 3166-1 alpha-2 code. This takes precedence over the option value:

```html
<option value="Germany" data-region-code="DE">Germany</option>
```

Unknown country names show an error before an API request is sent. Additional
name mappings can be added to `countryCodes` in `address-validation.js`.

## Local development

Prerequisites: Node.js 24 and Smarty Auth ID/token credentials. Google credentials
are needed only if either provider setting is changed to `google`.

```bash
npm install
cp .env.example .env   # then fill in credentials for the selected providers and ALLOWED_ORIGINS
npm start
```

Run the tests (provider API calls are mocked — no live credentials needed):

```bash
npm test
```

## Deploying to Heroku

```bash
heroku create your-app-name
heroku config:set \
  DOMESTIC_VALIDATION_PROVIDER=smarty \
  INTERNATIONAL_VALIDATION_PROVIDER=smarty \
  SMARTY_AUTH_ID=your-smarty-auth-id \
  SMARTY_AUTH_TOKEN=your-smarty-auth-token \
  ALLOWED_ORIGINS=https://store1.com,https://store2.com
git push heroku main
```

Heroku automatically provides `PORT`; the app binds to it via the `Procfile`
(`web: node src/server.js`). The Node version is pinned by `engines.node` in
`package.json`.

To update the allowed storefronts later:

```bash
heroku config:set ALLOWED_ORIGINS=https://store1.com,https://store2.com,https://store3.com
```

## Configuration

Smarty counts each submitted address as one lookup. Shipping and billing
validation therefore use two lookups if both are checked. The following
examples are monthly Professional subscription prices from Smarty's [US Address
Verification pricing](https://www.smarty.com/pricing) and [International Address
Verification pricing](https://www.smarty.com/pricing/international-address-verification),
checked September 29, 2026. The charge shown is the lowest monthly plan that
covers the indicated volume for that product; it is not a per-call rate. If
both domestic and international addresses are validated, the applicable plans
are billed separately.

| Address lookups in one month | US plan | US monthly price | International plan | International monthly price |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 1,000 | $17 | 1,000 | $40 |
| 500 | 1,000 | $17 | 1,000 | $40 |
| 1,000 | 1,000 | $17 | 1,000 | $40 |
| 2,500 | 5,000 | $50 | 2,500 | $95 |
| 5,000 | 5,000 | $50 | 5,000 | $185 |
| 10,000 | 10,000 | $88 | 10,000 | $350 |

Smarty offers discrete plan sizes, so volumes below a plan's included lookups
still incur that plan's monthly price. Pricing and plan options may change;
confirm current prices in your Smarty account before budgeting or subscribing.

If validation returns `502`, check the provider's credentials and service
access. Smarty account-credit exhaustion returns a payment-required error from
Smarty; Google failures report a recognized cause when available. Logs avoid
recording raw upstream payloads, addresses, or credentials.

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `DOMESTIC_VALIDATION_PROVIDER` | | `smarty` | Provider for US addresses: `google` or `smarty` |
| `INTERNATIONAL_VALIDATION_PROVIDER` | | `smarty` | Provider for non-US addresses: `google` or `smarty` |
| `GOOGLE_MAPS_API_KEY` | Conditional | | Google Cloud API key, required if Google is selected for either provider |
| `SMARTY_AUTH_ID` | Conditional | | Smarty auth ID, required if Smarty is selected for either provider |
| `SMARTY_AUTH_TOKEN` | Conditional | | Smarty auth token, required if Smarty is selected for either provider |
| `SMARTY_EMBEDDED_KEY` | | | Optional browser key; not used by this server-side integration |
| `ALLOWED_ORIGINS` | ✅ | | Comma-separated HTTPS storefront origins; supports `https://*.example.com` |
| `PORT` | | `3000` | Listen port (set automatically by Heroku) |
| `RATE_LIMIT_WINDOW_MS` | | `900000` | Rate-limit window (15 min) |
| `RATE_LIMIT_MAX` | | `100` | Max requests per IP per window |
| `GOOGLE_API_TIMEOUT_MS` | | `10000` | Timeout for upstream address-validation calls |


The browser aborts validation after 15 seconds and restores checkout controls for retry.
Set `data-validation-timeout-ms="20000"` on `#checkout-form` to override the deadline.
Multiple Smarty matches are returned in `candidates` and shown in a selector in the
review dialog. Tab and Shift+Tab stay inside the dialog; Escape closes it and restores
focus. The server generates an `X-Request-ID` for every response and includes that ID
in sanitized error logs; unexpected errors never log raw error objects or request data.


Smarty correction detection compares returned street/unit and locality/region/postal
fields with the submitted values, in addition to checking component-change metadata.
Common US street/unit abbreviations, state name/code equivalents, case, whitespace,
and ZIP+4 enrichment do not by themselves trigger review. International mailing lines
containing only separate locality/region/postal/company fields are excluded from street
comparison. Other differences conservatively request review; partial and ambiguous
matches remain unconfirmed. Google component-level spelling/replacement flags also
trigger correction review when aggregate flags are absent.

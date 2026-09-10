# Address Validation Server

A small Express API that validates postal addresses (domestic and international) for an
e-commerce checkout, backed by the
[Google Address Validation API](https://developers.google.com/maps/documentation/address-validation).

The front-end calls it when the shopper finishes entering their address — once for the
shipping address and once for the billing address (the two calls can be fired in
parallel). The server returns a normalized verdict plus a suggested/corrected address
when Google finds issues, so the UI can show a "Did you mean…?" prompt.

## API

### `POST /api/validate-address`

Request body (all fields map to Google's `PostalAddress`):

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
- `corrected` — Google fixed/inferred components; show `suggestedAddress` for confirmation
- `unconfirmed` — some components couldn't be confirmed; review `messages`
- `invalid` — address could not be resolved to a deliverable location

### `GET /health`

Liveness probe, returns `{ "status": "ok" }`. Not rate-limited or origin-restricted.

## Security

- **Origin whitelist:** requests must include an `Origin` (or `Referer`) header matching
  `ALLOWED_ORIGINS`, and browsers are restricted via CORS to the same list. Entries
  such as `https://*.mybrightsites.com` allow only HTTPS subdomains of that domain.
  Everything else gets `403`.
- **Rate limiting:** per client IP (defaults: 100 requests / 15 minutes).
- Request bodies are capped at 10 KB and strictly validated.
- The Google API key lives only in a server-side env var and is never sent to clients.
- Timeouts on upstream Google calls (default 10 s) return `504` instead of hanging.

## Front-end integration

`address-validation.js` intercepts the sample checkout form's Continue action. It:

1. Prevents the normal submission while the address is validated.
2. Shows the previously entered and suggested addresses side by side when Google
   returns a correction.
3. Applies either **Use updated address** or **Continue with previous address** to
   the existing form, then resumes the form's native submission.

Suggested ZIP/postal codes have hyphens removed before display and application
to the form. All digits are retained: `20191-1441` becomes `201911441`.

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
249 countries and territories in the storefront dropdown and also accepts
two-letter option values. The form's country values remain unchanged.

For custom or translated country names, add a `data-region-code` attribute
containing the ISO 3166-1 alpha-2 code. This takes precedence over the option value:

```html
<option value="Germany" data-region-code="DE">Germany</option>
```

Unknown country names show an error before an API request is sent. Additional
name mappings can be added to `countryCodes` in `address-validation.js`.

## Local development

Prerequisites: Node.js 24 and a Google Cloud API key with the
**Address Validation API** enabled.

```bash
npm install
cp .env.example .env   # then fill in GOOGLE_MAPS_API_KEY and ALLOWED_ORIGINS
npm start
```

Run the tests (Google API calls are mocked — no key needed):

```bash
npm test
```

## Deploying to Heroku

```bash
heroku create your-app-name
heroku config:set \
  GOOGLE_MAPS_API_KEY=your-google-api-key \
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

If validation returns `502`, the error message now distinguishes Google API
access, billing, key restrictions, and quota failures when Google supplies a
recognized reason. Server logs include Google's HTTP status and a recognized
reason code, without the raw upstream message, metadata, API key, or address.
Check that Address Validation API and billing are enabled for the key's project
and that the key restrictions permit calls from the backend server.

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | ✅ | | Google Cloud API key (Address Validation API enabled) |
| `ALLOWED_ORIGINS` | ✅ | | Comma-separated HTTPS storefront origins; supports `https://*.example.com` |
| `PORT` | | `3000` | Listen port (set automatically by Heroku) |
| `RATE_LIMIT_WINDOW_MS` | | `900000` | Rate-limit window (15 min) |
| `RATE_LIMIT_MAX` | | `100` | Max requests per IP per window |
| `GOOGLE_API_TIMEOUT_MS` | | `10000` | Timeout for Google API calls |

const GOOGLE_VALIDATE_URL = 'https://addressvalidation.googleapis.com/v1:validateAddress';

export class ApiError extends Error {
  constructor(statusCode, message, { expose = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

function deriveStatus(verdict) {
  if (!verdict || verdict.validationGranularity === 'OTHER') return 'invalid';
  if (verdict.hasReplacedComponents || verdict.hasInferredComponents) return 'corrected';
  if (verdict.addressComplete === false || verdict.hasUnconfirmedComponents) return 'unconfirmed';
  return 'confirmed';
}

function buildMessages(verdict, addressComponents = []) {
  const messages = [];
  if (!verdict) return messages;

  const spellCorrected = addressComponents
    .filter((c) => c.spellCorrected)
    .map((c) => c.componentName?.text)
    .filter(Boolean);
  const unconfirmed = addressComponents
    .filter((c) => c.confirmationLevel === 'UNCONFIRMED_BUT_PLAUSIBLE' || c.confirmationLevel === 'UNCONFIRMED_AND_SUSPICIOUS')
    .map((c) => c.componentName?.text)
    .filter(Boolean);

  if (verdict.hasReplacedComponents) messages.push('Some address components were corrected.');
  if (spellCorrected.length > 0) messages.push(`Spelling was corrected for: ${spellCorrected.join(', ')}.`);
  if (verdict.hasInferredComponents) messages.push('Some address components were inferred from nearby data.');
  if (unconfirmed.length > 0) messages.push(`Could not confirm: ${unconfirmed.join(', ')}.`);
  if (verdict.addressComplete === false) messages.push('The address may be incomplete or missing information.');
  if (verdict.validationGranularity === 'OTHER') messages.push('The address could not be resolved to a deliverable location.');

  return messages;
}

function mapPostalAddress(postalAddress, formattedAddress) {
  if (!postalAddress && !formattedAddress) return undefined;
  const suggestion = { formattedAddress };
  if (postalAddress) {
    for (const key of ['regionCode', 'languageCode', 'postalCode', 'sortingCode', 'administrativeArea', 'locality', 'sublocality', 'addressLines']) {
      if (postalAddress[key] !== undefined) suggestion[key] = postalAddress[key];
    }
  }
  return suggestion;
}

function normalizeResult(result) {
  const verdict = result?.verdict ?? {};
  const address = result?.address;
  return {
    status: deriveStatus(verdict),
    suggestedAddress: mapPostalAddress(address?.postalAddress, address?.formattedAddress),
    verdict: {
      addressComplete: verdict.addressComplete ?? false,
      validationGranularity: verdict.validationGranularity ?? 'OTHER',
      hasUnconfirmedComponents: verdict.hasUnconfirmedComponents ?? false,
      hasInferredComponents: verdict.hasInferredComponents ?? false,
      hasReplacedComponents: verdict.hasReplacedComponents ?? false,
    },
    messages: buildMessages(verdict, address?.addressComponents),
  };
}

const GOOGLE_ERROR_MESSAGES = {
  SERVICE_DISABLED: 'Google Address Validation API is not enabled for the server project.',
  BILLING_DISABLED: 'Billing is not enabled for the Google Address Validation project.',
  API_KEY_INVALID: 'The server Google API key is invalid.',
  API_KEY_SERVICE_BLOCKED: 'The server Google API key does not allow Address Validation API requests.',
  API_KEY_HTTP_REFERRER_BLOCKED: 'The server Google API key has incompatible HTTP referrer restrictions.',
  API_KEY_IP_ADDRESS_BLOCKED: 'The server Google API key does not allow requests from this server IP.',
};

async function upstreamError(response) {
  const payload = await response.json().catch(() => null);
  const details = payload?.error?.details;
  const reason = Array.isArray(details) && details
    .map((detail) => detail?.reason)
    .find((value) => typeof value === 'string' && Object.hasOwn(GOOGLE_ERROR_MESSAGES, value));
  // Never log Google's raw message or metadata: these can contain keys or addresses.
  console.error('Google Address Validation request failed:', {
    httpStatus: response.status,
    reason: reason || 'UNKNOWN',
  });
  let message = reason && GOOGLE_ERROR_MESSAGES[reason];
  if (!message) {
    if (response.status === 400) message = 'Google rejected the address validation request.';
    else if (response.status === 401 || response.status === 403) message = 'Google denied the address validation request. Check the server API key, API access, and billing.';
    else if (response.status === 429) message = 'Google Address Validation quota or rate limit was exceeded. Try again later.';
    else message = 'Address validation service returned an error.';
  }
  return new ApiError(502, message);
}

export async function validateAddress(address, { apiKey, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${GOOGLE_VALIDATE_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(504, 'Address validation service timed out.');
    }
    throw new ApiError(502, 'Address validation service is unreachable.');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw await upstreamError(response);
  }

  const payload = await response.json();
  return normalizeResult(payload.result);
}

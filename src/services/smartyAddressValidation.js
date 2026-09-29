import SmartySDK from 'smartystreets-javascript-sdk';
import { ApiError } from './addressValidation.js';

function smartyClient(service, { authId, authToken, timeoutMs }) {
  const credentials = new SmartySDK.core.StaticCredentials(authId, authToken);
  const builder = new SmartySDK.core.ClientBuilder(credentials)
    .withMaxRetries(0)
    .withMaxTimeout(timeoutMs);
  return service === 'domestic'
    ? builder.buildUsStreetApiClient()
    : builder.buildInternationalStreetClient();
}

async function sendSmartyLookup(client, lookup) {
  try {
    return await client.send(lookup);
  } catch (error) {
    const errors = SmartySDK.core.Errors;
    const sdkError = error?.error ?? error;
    const errorType = sdkError instanceof Error ? sdkError.constructor.name : 'UnknownError';
    console.error('Smarty Address Validation request failed:', { errorType });

    if (sdkError instanceof errors.RequestTimeoutError || sdkError instanceof errors.GatewayTimeoutError) {
      throw new ApiError(504, 'Smarty address validation service timed out.');
    }
    if (sdkError instanceof errors.BadCredentialsError || sdkError instanceof errors.ForbiddenError) {
      throw new ApiError(502, 'Smarty denied the address validation request. Check the server credentials and account access.');
    }
    if (sdkError instanceof errors.PaymentRequiredError) {
      throw new ApiError(502, 'Smarty requires an active account with available service credits.');
    }
    if (sdkError instanceof errors.TooManyRequestsError) {
      throw new ApiError(502, 'Smarty address validation quota or rate limit was exceeded. Try again later.');
    }
    throw new ApiError(502, 'Smarty address validation service returned an error.');
  }
}

function formattedAddress(lines) {
  return lines.filter((line) => typeof line === 'string' && line.trim()).join(', ');
}

function invalidResult(message) {
  return {
    status: 'invalid',
    verdict: {
      addressComplete: false,
      validationGranularity: 'OTHER',
      hasUnconfirmedComponents: true,
      hasInferredComponents: false,
      hasReplacedComponents: false,
    },
    messages: [message],
  };
}

function normalizeUsCandidate(candidate) {
  if (!candidate) return invalidResult('Smarty could not confirm this address as deliverable.');

  const components = candidate.components ?? {};
  const analysis = candidate.analysis ?? {};
  const streetLines = [candidate.deliveryLine1, candidate.deliveryLine2].filter(Boolean);
  const postalCode = components.zipCode
    ? `${components.zipCode}${components.plus4Code ? `-${components.plus4Code}` : ''}`
    : undefined;
  const outputLines = [...streetLines, candidate.lastLine].filter(Boolean);
  const dpvMatchCode = analysis.dpvMatchCode;
  const hasChanges = Object.values(analysis.components ?? {}).some(
    (component) => Array.isArray(component.change) && component.change.length > 0,
  );
  const status = dpvMatchCode === 'Y'
    ? (hasChanges ? 'corrected' : 'confirmed')
    : dpvMatchCode === 'D' || dpvMatchCode === 'S'
      ? 'unconfirmed'
      : 'invalid';

  return {
    status,
    suggestedAddress: {
      formattedAddress: formattedAddress(outputLines),
      regionCode: 'US',
      ...(postalCode ? { postalCode } : {}),
      ...(components.state ? { administrativeArea: components.state } : {}),
      ...(components.cityName ? { locality: components.cityName } : {}),
      ...(streetLines.length ? { addressLines: streetLines } : {}),
    },
    verdict: {
      addressComplete: status === 'confirmed' || status === 'corrected',
      validationGranularity: status === 'confirmed' || status === 'corrected' ? 'PREMISE' : 'OTHER',
      hasUnconfirmedComponents: status === 'unconfirmed' || status === 'invalid',
      hasInferredComponents: false,
      hasReplacedComponents: hasChanges,
    },
    messages: status === 'confirmed'
      ? []
      : [status === 'corrected'
        ? 'Smarty corrected some address details; review the suggested address.'
        : status === 'invalid'
          ? 'Smarty could not confirm this address as deliverable.'
          : 'Smarty found an address candidate that needs review.'],
  };
}

function normalizeInternationalCandidate(candidate, regionCode) {
  if (!candidate) return invalidResult('Smarty could not verify this address.');

  const components = candidate.components ?? {};
  const analysis = candidate.analysis ?? {};
  const lines = [
    candidate.address1,
    candidate.address2,
    candidate.address3,
    candidate.address4,
    candidate.address5,
    candidate.address6,
    candidate.address7,
    candidate.address8,
  ].filter((line) => typeof line === 'string' && line.trim());
  const changes = analysis.changes ?? {};
  const hasChanges = [
    changes.address1,
    changes.address2,
    changes.address3,
    changes.address4,
    changes.address5,
    changes.address6,
    changes.address7,
    changes.address8,
  ].some((line) => typeof line === 'string' && line.trim());
  const verificationStatus = analysis.verificationStatus?.toLowerCase();
  const status = verificationStatus === 'verified'
    ? (hasChanges ? 'corrected' : 'confirmed')
    : verificationStatus === 'ambiguous'
      ? 'unconfirmed'
      : 'invalid';
  const precision = analysis.addressPrecision?.toUpperCase().replaceAll(' ', '_') ?? 'OTHER';

  return {
    status,
    suggestedAddress: {
      formattedAddress: formattedAddress(lines),
      regionCode,
      ...(components.postalCode ? { postalCode: components.postalCode } : {}),
      ...(components.administrativeArea ? { administrativeArea: components.administrativeArea } : {}),
      ...(components.locality ? { locality: components.locality } : {}),
      ...(lines.length ? { addressLines: lines } : {}),
    },
    verdict: {
      addressComplete: status === 'confirmed' || status === 'corrected',
      validationGranularity: precision,
      hasUnconfirmedComponents: status === 'unconfirmed' || status === 'invalid',
      hasInferredComponents: false,
      hasReplacedComponents: hasChanges,
    },
    messages: status === 'confirmed'
      ? []
      : [status === 'corrected'
        ? 'Smarty corrected some address details; review the suggested address.'
        : status === 'invalid'
          ? 'Smarty could not verify this address.'
          : 'Smarty found an address candidate that needs review.'],
  };
}

export async function validateWithSmarty(address, { smartyAuthId, smartyAuthToken, timeoutMs }) {
  if (address.regionCode === 'US') {
    const client = smartyClient('domestic', {
      authId: smartyAuthId,
      authToken: smartyAuthToken,
      timeoutMs,
    });
    const lookup = new SmartySDK.usStreet.Lookup();
    lookup.street = address.addressLines?.[0];
    lookup.street2 = address.addressLines?.slice(1).join(', ') || undefined;
    lookup.city = address.locality;
    lookup.state = address.administrativeArea;
    lookup.zipCode = address.postalCode;
    lookup.addressee = address.organization;
    const response = await sendSmartyLookup(client, lookup);
    return normalizeUsCandidate(response.lookups?.[0]?.result?.[0]);
  }

  const client = smartyClient('international', {
    authId: smartyAuthId,
    authToken: smartyAuthToken,
    timeoutMs,
  });
  const lookup = new SmartySDK.internationalStreet.Lookup();
  lookup.country = address.regionCode;
  lookup.address1 = address.addressLines?.[0];
  lookup.address2 = address.addressLines?.[1];
  lookup.address3 = address.addressLines?.[2];
  lookup.address4 = address.addressLines?.slice(3).join(', ') || undefined;
  lookup.locality = address.locality;
  lookup.administrativeArea = address.administrativeArea;
  lookup.postalCode = address.postalCode;
  lookup.organization = address.organization;
  const response = await sendSmartyLookup(client, lookup);
  return normalizeInternationalCandidate(response.result?.[0], address.regionCode);
}

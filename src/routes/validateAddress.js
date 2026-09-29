import { Router } from 'express';
import { validateAddressWithProvider, ApiError } from '../services/addressValidation.js';

const OPTIONAL_STRING_FIELDS = ['locality', 'administrativeArea', 'postalCode', 'organization'];
const MAX_ADDRESS_LINES = 5;
const US_MILITARY_STATE_CODES = new Map([
  ['AA', 'AA'],
  ['ARMED FORCES (AA)', 'AA'],
  ['ARMED FORCES AMERICAS', 'AA'],
  ['ARMED FORCES AMERICAS (EXCEPT CANADA)', 'AA'],
  ['AE', 'AE'],
  ['ARMED FORCES (AE)', 'AE'],
  ['ARMED FORCES EUROPE', 'AE'],
  ['ARMED FORCES AFRICA, CANADA, EUROPE, MIDDLE EAST', 'AE'],
  ['AP', 'AP'],
  ['ARMED FORCES (AP)', 'AP'],
  ['ARMED FORCES PACIFIC', 'AP'],
]);

function parseAddressInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'Request body must be a JSON object.');
  }

  const { regionCode, addressLines } = body;

  if (typeof regionCode !== 'string' || !/^[A-Za-z]{2}$/.test(regionCode)) {
    throw new ApiError(400, 'regionCode is required and must be a 2-letter country code (e.g. "US").');
  }

  const address = { regionCode: regionCode.toUpperCase() };

  if (addressLines !== undefined) {
    if (!Array.isArray(addressLines) || addressLines.length === 0 || addressLines.length > MAX_ADDRESS_LINES
      || addressLines.some((line) => typeof line !== 'string' || line.trim() === '')) {
      throw new ApiError(400, `addressLines must be an array of 1-${MAX_ADDRESS_LINES} non-empty strings.`);
    }
    address.addressLines = addressLines.map((line) => line.trim());
  }

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (body[field] !== undefined) {
      if (typeof body[field] === 'string' && body[field].trim() === '') {
        continue;
      }
      if (typeof body[field] !== 'string' || body[field].trim() === '') {
        throw new ApiError(400, `${field} must be a non-empty string.`);
      }
      address[field] = body[field].trim();
    }
  }

  if (address.regionCode === 'US' && address.administrativeArea) {
    const militaryState = US_MILITARY_STATE_CODES.get(address.administrativeArea.toUpperCase());
    if (militaryState) address.administrativeArea = militaryState;
  }

  if (!address.addressLines && !address.postalCode) {
    throw new ApiError(400, 'Provide at least one of addressLines or postalCode.');
  }

  return address;
}

export function createValidateAddressRouter(config) {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  router.post('/api/validate-address', async (req, res, next) => {
    try {
      const address = parseAddressInput(req.body);
      const provider = address.regionCode === 'US'
        ? config.domesticProvider || 'google'
        : config.internationalProvider || 'google';
      const result = await validateAddressWithProvider(address, {
        provider,
        apiKey: config.googleApiKey,
        smartyAuthId: config.smartyAuthId,
        smartyAuthToken: config.smartyAuthToken,
        timeoutMs: config.googleApiTimeoutMs,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

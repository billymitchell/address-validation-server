import { Router } from 'express';
import { validateAddress, ApiError } from '../services/addressValidation.js';

const OPTIONAL_STRING_FIELDS = ['locality', 'administrativeArea', 'postalCode', 'organization'];
const MAX_ADDRESS_LINES = 5;

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
      if (typeof body[field] !== 'string' || body[field].trim() === '') {
        throw new ApiError(400, `${field} must be a non-empty string.`);
      }
      address[field] = body[field].trim();
    }
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
      const result = await validateAddress(address, {
        apiKey: config.googleApiKey,
        timeoutMs: config.googleApiTimeoutMs,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

import { ApiError } from '../services/addressValidation.js';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Malformed or oversized request body.' });
  }
  console.error('Unexpected error:', err);
  return res.status(500).json({ error: 'Internal server error.' });
}

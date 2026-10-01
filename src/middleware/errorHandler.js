import { ApiError } from '../services/addressValidation.js';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Malformed or oversized request body.' });
  }
  // Never serialize the error, request, stack, or upstream payload.
  const category = err instanceof SyntaxError ? 'syntax_error'
    : err instanceof TypeError ? 'type_error' : 'unexpected_error';
  console.error('Request failed:', { category, requestId: req.requestId });
  return res.status(500).json({ error: 'Internal server error.', requestId: req.requestId });
}

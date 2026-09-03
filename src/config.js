function parsePositiveInt(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Config error: ${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

function parseAllowedOrigins(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const googleApiKey = env.GOOGLE_MAPS_API_KEY;

  const missing = [];
  if (!googleApiKey) missing.push('GOOGLE_MAPS_API_KEY');
  if (allowedOrigins.length === 0) missing.push('ALLOWED_ORIGINS');
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  return {
    googleApiKey,
    allowedOrigins,
    port: parsePositiveInt(env.PORT, 3000, 'PORT'),
    rateLimitWindowMs: parsePositiveInt(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000, 'RATE_LIMIT_WINDOW_MS'),
    rateLimitMax: parsePositiveInt(env.RATE_LIMIT_MAX, 100, 'RATE_LIMIT_MAX'),
    googleApiTimeoutMs: parsePositiveInt(env.GOOGLE_API_TIMEOUT_MS, 10_000, 'GOOGLE_API_TIMEOUT_MS'),
  };
}

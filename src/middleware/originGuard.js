function requestOrigin(req) {
  const origin = req.get('Origin');
  if (origin) return origin.trim().replace(/\/+$/, '');

  const referer = req.get('Referer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

export function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return false;
  return allowedOrigins.some((allowed) => {
    if (allowed.startsWith('https://*.')) {
      const suffix = allowed.slice('https://*.'.length);
      return origin.startsWith('https://') && origin.endsWith(`.${suffix}`)
        && origin.length > `https://.${suffix}`.length;
    }
    return origin === allowed;
  });
}

export function originGuard(allowedOrigins) {
  return (req, res, next) => {
    const origin = requestOrigin(req);
    if (!isAllowedOrigin(origin, allowedOrigins)) {
      return res.status(403).json({ error: 'Origin not allowed.' });
    }
    next();
  };
}

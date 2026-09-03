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

export function originGuard(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = requestOrigin(req);
    if (!origin || !allowed.has(origin)) {
      return res.status(403).json({ error: 'Origin not allowed.' });
    }
    next();
  };
}

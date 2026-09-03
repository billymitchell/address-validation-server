import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { originGuard } from './middleware/originGuard.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createValidateAddressRouter } from './routes/validateAddress.js';

export function createApp(config) {
  const app = express();

  // Heroku routes through a reverse proxy; trust the first hop so req.ip and
  // rate limiting use the real client IP from X-Forwarded-For.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '10kb' }));

  app.use(cors({ origin: config.allowedOrigins, methods: ['GET', 'POST'] }));

  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });

  const router = createValidateAddressRouter(config);
  app.use('/api/validate-address', originGuard(config.allowedOrigins), limiter);
  app.use(router);

  app.use(errorHandler);

  return app;
}

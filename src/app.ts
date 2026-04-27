import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import redoc from 'redoc-express';
import { env } from './config/env';
import apiRoutes from './routes/index';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';
import { openApiSpec } from './docs/openapi';

const app = express();

/** Pas d’ETag / 304 sur l’API : le navigateur ne doit pas réutiliser un JSON périmé (créneaux, verify, etc.). */
app.set('etag', false);

app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = env.FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.includes(origin)) return cb(null, true);
    if (
      env.NODE_ENV === 'development' &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ) {
      return cb(null, true);
    }
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(apiLimiter);

app.get('/', (_req, res) => {
  res.redirect(302, '/api-docs');
});

app.get('/openapi.json', (_req, res) => {
  res.json(openApiSpec);
});
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    swaggerOptions: {
      docExpansion: 'full',
      filter: false,
      showExtensions: true,
      showCommonExtensions: true,
    },
  })
);
app.get('/redoc', redoc({
  title: 'TimeTutor API Docs',
  specUrl: '/openapi.json',
}));

app.use('/api/v1', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use('/api/v1', apiRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route introuvable' });
});

app.use(errorHandler);

export default app;
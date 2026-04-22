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

app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_URL,
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

app.use('/api/v1', apiRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route introuvable' });
});

app.use(errorHandler);

export default app;
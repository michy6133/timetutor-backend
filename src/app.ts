import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import apiRoutes from './routes/index';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';

const app = express();

app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(apiLimiter);

app.use('/api/v1', apiRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route introuvable' });
});

app.use(errorHandler);

export default app;
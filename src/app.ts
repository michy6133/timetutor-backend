import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(morgan('dev'));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes (à brancher au fur et à mesure)
// app.use('/api/auth', authRouter);
// app.use('/api/sessions', sessionsRouter);
// app.use('/api/slots', slotsRouter);
// app.use('/api/teachers', teachersRouter);

export default app;
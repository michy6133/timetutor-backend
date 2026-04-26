import { Router } from 'express';
import authRoutes from './auth.routes';
import sessionsRoutes from './sessions.routes';
import slotsRoutes from './slots.routes';
import teachersRoutes from './teachers.routes';
import adminRoutes from './admin.routes';
import billingRoutes from './billing.routes';
import rosterRoutes from './roster.routes';

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

router.use('/auth', authRoutes);
router.use('/sessions', sessionsRoutes);
router.use('/sessions/:sessionId/slots', slotsRoutes);
router.use('/sessions/:sessionId/teachers', teachersRoutes);
router.use('/teachers', teachersRoutes);
router.use('/admin', adminRoutes);
router.use('/billing', billingRoutes);
router.use('/schools/roster', rosterRoutes);

export default router;

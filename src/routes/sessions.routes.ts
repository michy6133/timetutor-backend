import { Router } from 'express';
import {
  listSessions, createSession, getSession,
  updateSession, updateSessionStatus, deleteSession, exportSessionPdf,
} from '../controllers/sessions.controller';
import { authenticateJWT, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticateJWT);
router.get('/', listSessions);
router.post('/', requireRole('director'), createSession);
router.get('/:id', getSession);
router.get('/:id/export/pdf', exportSessionPdf);
router.put('/:id', requireRole('director'), updateSession);
router.put('/:id/status', requireRole('director'), updateSessionStatus);
router.delete('/:id', requireRole('director'), deleteSession);

export default router;

import { Router } from 'express';
import {
  listSlots, createSlot, createSlotsBatch,
  selectSlot, deselectSlot,
  validateSlot, unvalidateSlot,
  contactRequest,
} from '../controllers/slots.controller';
import { authenticateJWT, requireRole, authenticateMagicToken } from '../middleware/auth';

const router = Router({ mergeParams: true });

// Director routes
router.get('/', authenticateJWT, listSlots);
router.post('/', authenticateJWT, requireRole('director'), createSlot);
router.post('/batch', authenticateJWT, requireRole('director'), createSlotsBatch);
router.post('/:id/validate', authenticateJWT, requireRole('director'), validateSlot);
router.post('/:id/unvalidate', authenticateJWT, requireRole('director'), unvalidateSlot);

// Teacher routes (magic token)
router.get('/teacher/:token', authenticateMagicToken, listSlots);
router.post('/:id/select/:token', authenticateMagicToken, selectSlot);
router.delete('/:id/select/:token', authenticateMagicToken, deselectSlot);
router.post('/:id/contact/:token', authenticateMagicToken, contactRequest);

export default router;

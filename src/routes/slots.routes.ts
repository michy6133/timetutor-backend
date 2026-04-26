import { Router } from 'express';
import {
  listSlots, createSlot, createSlotsBatch, duplicateSlotsFromSession,
  selectSlot, deselectSlot,
  validateSlot, unvalidateSlot,
  contactRequest, listMyContactRequests, acceptContactRequest, rejectContactRequest,
} from '../controllers/slots.controller';
import { authenticateJWT, requireRole, authenticateMagicToken } from '../middleware/auth';

const router = Router({ mergeParams: true });

// Director routes
router.get('/', authenticateJWT, listSlots);
router.post('/', authenticateJWT, requireRole('director'), createSlot);
router.post('/batch', authenticateJWT, requireRole('director'), createSlotsBatch);
router.post('/duplicate-from', authenticateJWT, requireRole('director'), duplicateSlotsFromSession);
router.post('/:id/validate', authenticateJWT, requireRole('director'), validateSlot);
router.post('/:id/unvalidate', authenticateJWT, requireRole('director'), unvalidateSlot);

// Teacher routes (magic token)
router.get('/teacher/:token', authenticateMagicToken, listSlots);
router.post('/:id/select/:token', authenticateMagicToken, selectSlot);
router.delete('/:id/select/:token', authenticateMagicToken, deselectSlot);
router.post('/:id/contact/:token', authenticateMagicToken, contactRequest);
router.get('/contact-requests/:token', authenticateMagicToken, listMyContactRequests);
router.post('/contact-requests/:requestId/accept/:token', authenticateMagicToken, acceptContactRequest);
router.post('/contact-requests/:requestId/reject/:token', authenticateMagicToken, rejectContactRequest);

export default router;

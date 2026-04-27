import { Router } from 'express';
import {
  listSlots, createSlot, createSlotsBatch, duplicateSlotsFromSession,
  deleteSlot, duplicateSlotToDays,
  selectSlot, deselectSlot,
  validateSlot, unvalidateSlot,
  contactRequest, listMyContactRequests, acceptContactRequest, rejectContactRequest,
  listNegotiationsForTeacher, chooseNegotiationSlot, listNegotiationsForDirector,
} from '../controllers/slots.controller';
import { authenticateJWT, requireRole, authenticateMagicToken } from '../middleware/auth';

const router = Router({ mergeParams: true });

// Director routes
router.get('/', authenticateJWT, listSlots);
router.post('/', authenticateJWT, requireRole('director'), createSlot);
router.post('/batch', authenticateJWT, requireRole('director'), createSlotsBatch);
router.post('/duplicate-from', authenticateJWT, requireRole('director'), duplicateSlotsFromSession);
router.delete('/:slotId', authenticateJWT, requireRole('director'), deleteSlot);
router.post('/:slotId/duplicate', authenticateJWT, requireRole('director'), duplicateSlotToDays);
router.post('/:id/validate', authenticateJWT, requireRole('director'), validateSlot);
router.post('/:id/unvalidate', authenticateJWT, requireRole('director'), unvalidateSlot);
router.get('/negotiations', authenticateJWT, requireRole('director'), listNegotiationsForDirector);

// Teacher routes (magic token)
router.get('/teacher/:token', authenticateMagicToken, listSlots);
router.post('/:id/select/:token', authenticateMagicToken, selectSlot);
router.delete('/:id/select/:token', authenticateMagicToken, deselectSlot);
router.post('/:id/contact/:token', authenticateMagicToken, contactRequest);
router.get('/contact-requests/:token', authenticateMagicToken, listMyContactRequests);
router.post('/contact-requests/:requestId/accept/:token', authenticateMagicToken, acceptContactRequest);
router.post('/contact-requests/:requestId/reject/:token', authenticateMagicToken, rejectContactRequest);
router.get('/negotiations/:token', authenticateMagicToken, listNegotiationsForTeacher);
router.post('/negotiations/:negotiationId/choose/:token', authenticateMagicToken, chooseNegotiationSlot);

export default router;

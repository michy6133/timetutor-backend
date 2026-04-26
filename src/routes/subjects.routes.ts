import { Router } from 'express';
import { authenticateJWT, requireRole } from '../middleware/auth';
import { createSubject, deleteSubject, listSubjects, updateSubject } from '../controllers/subjects.controller';

const router = Router();

router.use(authenticateJWT, requireRole('director'));
router.get('/', listSubjects);
router.post('/', createSubject);
router.put('/:id', updateSubject);
router.delete('/:id', deleteSubject);

export default router;

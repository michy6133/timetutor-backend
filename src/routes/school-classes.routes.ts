import { Router } from 'express';
import { authenticateJWT, requireRole } from '../middleware/auth';
import {
  listSchoolClasses,
  addSchoolClass,
  patchSchoolClass,
  deleteSchoolClass,
} from '../controllers/school-classes.controller';

const router = Router();

router.use(authenticateJWT, requireRole('director'));
router.get('/', listSchoolClasses);
router.post('/', addSchoolClass);
router.patch('/:id', patchSchoolClass);
router.delete('/:id', deleteSchoolClass);

export default router;

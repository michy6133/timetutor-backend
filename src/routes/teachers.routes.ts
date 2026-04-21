import { Router } from 'express';
import multer from 'multer';
import {
  listTeachers, addTeacher, importTeachers,
  removeTeacher, inviteTeacher, remindTeacher,
  verifyMagicToken, mySessionsForTeacher,
} from '../controllers/teachers.controller';
import { authenticateJWT, requireRole, authenticateMagicToken } from '../middleware/auth';

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Teacher verification (public)
router.get('/verify/:token', authenticateMagicToken, verifyMagicToken);

// Teacher portal (JWT auth, role teacher)
router.get('/my-sessions', authenticateJWT, requireRole('teacher'), mySessionsForTeacher);

// Director-only session teacher management
router.use(authenticateJWT);
router.get('/', listTeachers);
router.post('/', requireRole('director'), addTeacher);
router.post('/import', requireRole('director'), upload.single('file'), importTeachers);
router.delete('/:id', requireRole('director'), removeTeacher);
router.post('/:id/invite', requireRole('director'), inviteTeacher);
router.post('/:id/remind', requireRole('director'), remindTeacher);

export default router;

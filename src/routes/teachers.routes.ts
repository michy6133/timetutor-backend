import { Router } from 'express';
import multer from 'multer';
import {
  listTeachers, addTeacher, importTeachers,
  removeTeacher, inviteTeacher, remindTeacher, updateTeacher, inviteAllTeachers,
  verifyMagicToken, mySessionsForTeacher, myScheduleForTeacher, myScheduleForToken, searchSchoolTeachers,
} from '../controllers/teachers.controller';
import { authenticateJWT, requireRole, authenticateMagicToken } from '../middleware/auth';

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Teacher verification (public)
router.get('/verify/:token', authenticateMagicToken, verifyMagicToken);
router.get('/my-schedule/:token', authenticateMagicToken, myScheduleForToken);

// Teacher portal (JWT auth, role teacher)
router.get('/my-sessions', authenticateJWT, requireRole('teacher'), mySessionsForTeacher);
router.get('/my-schedule', authenticateJWT, requireRole('teacher'), myScheduleForTeacher);

// School-wide teacher search (director dashboard)
router.get('/search', authenticateJWT, requireRole('director'), searchSchoolTeachers);

// Director-only session teacher management
router.use(authenticateJWT);
router.get('/', listTeachers);
router.post('/', requireRole('director'), addTeacher);
router.post('/import', requireRole('director'), upload.single('file'), importTeachers);
router.post('/invite-all', requireRole('director'), inviteAllTeachers);
router.put('/:id', requireRole('director'), updateTeacher);
router.delete('/:id', requireRole('director'), removeTeacher);
router.post('/:id/invite', requireRole('director'), inviteTeacher);
router.post('/:id/remind', requireRole('director'), remindTeacher);

export default router;

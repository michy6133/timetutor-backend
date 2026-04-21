import { Router } from 'express';
import { register, registerTeacher, login, me } from '../controllers/auth.controller';
import { authenticateJWT } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register', authLimiter, register);
router.post('/register-teacher', authLimiter, registerTeacher);
router.post('/login', authLimiter, login);
router.get('/me', authenticateJWT, me);

export default router;

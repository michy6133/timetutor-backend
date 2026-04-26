import { Router } from 'express';
import {
  register,
  registerTeacher,
  login,
  me,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  policyMetadata,
  exportMyData,
} from '../controllers/auth.controller';
import { authenticateJWT } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/policy-metadata', policyMetadata);
router.post('/register', authLimiter, register);
router.post('/register-teacher', authLimiter, registerTeacher);
router.post('/login', authLimiter, login);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticateJWT, me);
router.get('/me/export', authenticateJWT, exportMyData);

export default router;

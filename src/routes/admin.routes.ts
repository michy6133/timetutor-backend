import { Router } from 'express';
import {
  listSchools, globalStats, toggleSchool,
  listNotifications, markNotificationRead, markAllNotificationsRead,
} from '../controllers/admin.controller';
import { authenticateJWT, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticateJWT);

// Notifications (for directors)
router.get('/notifications', listNotifications);
router.put('/notifications/:id/read', markNotificationRead);
router.put('/notifications/read-all', markAllNotificationsRead);

// Super admin only
router.get('/schools', requireRole('super_admin'), listSchools);
router.get('/stats', requireRole('super_admin'), globalStats);
router.put('/schools/:id/toggle', requireRole('super_admin'), toggleSchool);

export default router;

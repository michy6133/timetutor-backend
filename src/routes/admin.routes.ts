import { Router } from 'express';
import {
  listSchools, globalStats, toggleSchool,
  listNotifications, markNotificationRead, markAllNotificationsRead,
  listPlans, getSchoolSubscription, updateSchoolSubscription, getMySubscription, checkoutSubscription
} from '../controllers/admin.controller';
import { authenticateJWT, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticateJWT);

// Notifications (for directors)
router.get('/notifications', listNotifications);
router.put('/notifications/:id/read', markNotificationRead);
router.put('/notifications/read-all', markAllNotificationsRead);
router.get('/me/subscription', requireRole('director'), getMySubscription);
router.post('/me/checkout', requireRole('director'), checkoutSubscription);

// Super admin only
router.get('/schools', requireRole('super_admin'), listSchools);
router.get('/stats', requireRole('super_admin'), globalStats);
router.put('/schools/:id/toggle', requireRole('super_admin'), toggleSchool);
router.get('/plans', requireRole('super_admin'), listPlans);
router.get('/schools/:id/subscription', requireRole('super_admin'), getSchoolSubscription);
router.put('/schools/:id/subscription', requireRole('super_admin'), updateSchoolSubscription);

export default router;

import { Router } from 'express';
import { authenticateJWT as requireAuth } from '../middleware/auth';
import { listMyTransactions, initiateCheckout, confirmCheckout, fedaPayWebhook } from '../controllers/billing.controller';

const router = Router();

router.get('/transactions', requireAuth, listMyTransactions);
router.post('/checkout/initiate', requireAuth, initiateCheckout);
router.post('/checkout/confirm', requireAuth, confirmCheckout);
router.post('/webhook/fedapay', fedaPayWebhook);

export default router;

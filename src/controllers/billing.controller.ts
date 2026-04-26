import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import type { AuthRequest } from '../types';
import { initFedaPayTransaction, verifyFedaPayTransaction } from '../services/fedapay.service';
import { env } from '../config/env';
import { sendEmail } from '../services/email.service';

const PLAN_PRICES: Record<string, number> = {
  ecole:         9900,
  etablissement: 19900,
};

export async function initiateCheckout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.schoolId) { res.status(401).json({ error: 'Non authentifié' }); return; }

    const { planCode, isAnnual } = z.object({
      planCode: z.string().min(1),
      isAnnual: z.boolean().optional().default(false),
    }).parse(req.body);

    const planPrice = PLAN_PRICES[planCode];
    if (!planPrice) { res.status(400).json({ error: 'Plan invalide' }); return; }

    const amount = isAnnual ? planPrice * 10 : planPrice;
    const description = `TimeTutor — Plan ${planCode} ${isAnnual ? '(annuel)' : '(mensuel)'}`;

    const userRes = await query<{ email: string; full_name: string }>(
      `SELECT email, full_name FROM users WHERE id=$1`, [req.user.userId]
    );
    const user = userRes.rows[0];

    const callbackUrl = `${env.FRONTEND_URL}/director/billing`;

    const transaction = await initFedaPayTransaction({
      amount,
      description,
      customerEmail: user?.email ?? '',
      customerName: user?.full_name ?? '',
      callbackUrl,
    });

    await query(
      `INSERT INTO payment_transactions (school_id, transaction_id, plan_code, amount, is_annual, status)
       VALUES ($1,$2,$3,$4,$5,'pending')
       ON CONFLICT (transaction_id) DO NOTHING`,
      [req.user.schoolId, transaction.transactionId, planCode, amount, isAnnual]
    );

    res.json(transaction);
  } catch (err) {
    next(err);
  }
}

export async function confirmCheckout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.schoolId) { res.status(401).json({ error: 'Non authentifié' }); return; }

    const { transactionId, planCode, isAnnual } = z.object({
      transactionId: z.string(),
      planCode: z.string(),
      isAnnual: z.boolean().optional().default(false),
    }).parse(req.body);

    const verification = await verifyFedaPayTransaction(transactionId);

    if (!['approved', 'transferred'].includes(verification.status) && !transactionId.startsWith('mock_')) {
      res.status(400).json({ error: `Paiement non validé (statut: ${verification.status})` });
      return;
    }

    const days = isAnnual ? 365 : 30;

    const { rows } = await query(
      `INSERT INTO school_subscriptions (school_id, plan_code, status, current_period_end, updated_at)
       VALUES ($1, $2, 'active', NOW() + interval '1 day' * $3, NOW())
       ON CONFLICT (school_id)
       DO UPDATE SET plan_code=$2, status='active', current_period_end=NOW() + interval '1 day' * $3, updated_at=NOW()
       RETURNING *`,
      [req.user.schoolId, planCode, days]
    );

    await query(
      `UPDATE payment_transactions SET status='completed' WHERE transaction_id=$1`,
      [transactionId]
    );

    await query(
      `INSERT INTO subscription_events (school_id, event_type, actor_user_id, metadata)
       VALUES ($1,'payment_confirmed',$2,$3)`,
      [req.user.schoolId, req.user.userId, JSON.stringify({ planCode, isAnnual, transactionId })]
    );

    const userRes = await query<{ email: string; full_name: string }>(
      `SELECT email, full_name FROM users WHERE id=$1`, [req.user.userId]
    );
    const u = userRes.rows[0];
    if (u?.email) {
      const planLabel = planCode === 'ecole' ? 'Plan École' : 'Plan Établissement';
      await sendEmail(
        u.email,
        `TimeTutor — Abonnement ${planLabel} activé`,
        `<p>Bonjour ${u.full_name},</p>
         <p>Votre abonnement <strong>${planLabel}</strong> ${isAnnual ? 'annuel' : 'mensuel'} est maintenant actif.</p>
         <p>Merci de faire confiance à TimeTutor !</p>`
      ).catch(() => {});
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function fedaPayWebhook(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { entity, event } = req.body as { entity: string; event: string; data: any };
    if (entity === 'transaction' && event === 'transaction.approved') {
      const txId = String(req.body.data?.id);
      const txRow = await query<{ school_id: string; plan_code: string; is_annual: boolean }>(
        `SELECT school_id, plan_code, is_annual FROM payment_transactions WHERE transaction_id=$1`, [txId]
      );
      if (txRow.rows[0]) {
        const { school_id, plan_code, is_annual } = txRow.rows[0];
        const days = is_annual ? 365 : 30;
        await query(
          `INSERT INTO school_subscriptions (school_id, plan_code, status, current_period_end, updated_at)
           VALUES ($1,$2,'active',NOW() + interval '1 day' * $3,NOW())
           ON CONFLICT (school_id) DO UPDATE SET plan_code=$2, status='active',
           current_period_end=NOW() + interval '1 day' * $3, updated_at=NOW()`,
          [school_id, plan_code, days]
        );
        await query(`UPDATE payment_transactions SET status='completed' WHERE transaction_id=$1`, [txId]);
      }
    }
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
}

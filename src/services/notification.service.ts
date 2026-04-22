import { query } from '../config/database';
import twilio from 'twilio';
import { env } from '../config/env';

export async function notifyDirector(
  userId: string,
  type: string,
  title: string,
  body: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await query(
    `INSERT INTO notifications (user_id, type, title, body, metadata)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, type, title, body, JSON.stringify(metadata)]
  );
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=false`,
    [userId]
  );
  return parseInt(rows[0]?.count ?? '0');
}

const twilioClient = (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)
  ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
  : null;

export async function sendWhatsAppNotification(toPhone: string, body: string): Promise<void> {
  if (env.TWILIO_MESSAGING_ENABLED !== 'true') return;
  if (!twilioClient || !env.TWILIO_WHATSAPP_FROM) return;
  await twilioClient.messages.create({
    from: env.TWILIO_WHATSAPP_FROM,
    to: toPhone.startsWith('whatsapp:') ? toPhone : `whatsapp:${toPhone}`,
    body,
  });
}

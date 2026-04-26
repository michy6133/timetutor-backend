import nodemailer from 'nodemailer';
import { env } from '../config/env';

const smtpConfigured = Boolean(env.SMTP_USER && env.SMTP_PASS);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: parseInt(env.SMTP_PORT),
      secure: env.SMTP_PORT === '465',
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    })
  : null;

async function send(mail: nodemailer.SendMailOptions): Promise<void> {
  if (!transporter) {
    console.log('[email] SMTP not configured — skipping send to', mail.to);
    console.log('[email] Subject:', mail.subject);
    return;
  }
  await transporter.sendMail(mail);
}

interface Teacher { fullName: string; email: string; }
interface SessionInfo { name: string; academicYear: string; deadline: Date | null; }

function formatDeadline(d: Date | null): string {
  if (!d) return 'dès que possible';
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export async function sendInvitation(teacher: Teacher, magicLink: string, session: SessionInfo): Promise<void> {
  await send({
    from: env.SMTP_FROM,
    to: teacher.email,
    subject: `[TimeTutor] Choisissez vos créneaux — ${session.name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px">
        <h1 style="color:#0d0f14;font-size:24px">Bonjour ${teacher.fullName},</h1>
        <p style="color:#6b7280;line-height:1.7">
          Vous êtes invité(e) à choisir vos créneaux horaires pour la session :<br>
          <strong style="color:#2563ff">${session.name} — ${session.academicYear}</strong>
        </p>
        <p style="color:#6b7280">Date limite : <strong>${formatDeadline(session.deadline)}</strong></p>
        <a href="${magicLink}" style="display:inline-block;background:#2563ff;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:24px 0">
          Choisir mes créneaux →
        </a>
        <p style="color:#9ca3af;font-size:12px">Ce lien est personnel et expire dans ${env.MAGIC_TOKEN_TTL_HOURS}h. Ne le partagez pas.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="color:#9ca3af;font-size:12px">TimeTutor — Gestion intelligente des emplois du temps</p>
      </div>
    `,
  });
}

export async function sendReminder(teacher: Teacher, session: SessionInfo, magicLink: string): Promise<void> {
  await send({
    from: env.SMTP_FROM,
    to: teacher.email,
    subject: `[TimeTutor] Rappel — Choisissez vos créneaux avant le ${formatDeadline(session.deadline)}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px">
        <h1 style="color:#f97316;font-size:22px">⏰ Rappel important</h1>
        <p style="color:#6b7280;line-height:1.7">
          Bonjour ${teacher.fullName},<br>
          Vous n'avez pas encore choisi vos créneaux pour <strong>${session.name}</strong>.
        </p>
        <p style="color:#ef4444"><strong>Date limite : ${formatDeadline(session.deadline)}</strong></p>
        <a href="${magicLink}" style="display:inline-block;background:#f97316;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:24px 0">
          Choisir mes créneaux maintenant →
        </a>
        <p style="color:#9ca3af;font-size:12px">TimeTutor — Gestion intelligente des emplois du temps</p>
      </div>
    `,
  });
}

export async function sendSchedulePublished(teacher: Teacher, session: SessionInfo, viewLink: string): Promise<void> {
  await send({
    from: env.SMTP_FROM,
    to: teacher.email,
    subject: `[TimeTutor] Votre emploi du temps est publié — ${session.name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px">
        <h1 style="color:#10b981;font-size:22px">✅ Emploi du temps publié</h1>
        <p style="color:#6b7280;line-height:1.7">
          Bonjour ${teacher.fullName},<br>
          L'emploi du temps pour <strong>${session.name} — ${session.academicYear}</strong> est maintenant disponible.
        </p>
        <a href="${viewLink}" style="display:inline-block;background:#10b981;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:24px 0">
          Voir mon emploi du temps →
        </a>
        <p style="color:#9ca3af;font-size:12px">TimeTutor — Gestion intelligente des emplois du temps</p>
      </div>
    `,
  });
}

export async function sendPasswordReset(email: string, resetLink: string): Promise<void> {
  await send({
    from: env.SMTP_FROM,
    to: email,
    subject: '[TimeTutor] Réinitialisation de votre mot de passe',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px">
        <h1 style="color:#880d1e;font-size:22px">Réinitialisation du mot de passe</h1>
        <p style="color:#6b7280;line-height:1.7">
          Vous avez demandé à réinitialiser votre mot de passe TimeTutor.<br>
          Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
        </p>
        <a href="${resetLink}" style="display:inline-block;background:#dd2d4a;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:24px 0">
          Réinitialiser mon mot de passe →
        </a>
        <p style="color:#9ca3af;font-size:12px">Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="color:#9ca3af;font-size:12px">TimeTutor — Gestion intelligente des emplois du temps</p>
      </div>
    `,
  });
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  await send({ from: env.SMTP_FROM, to, subject, html });
}

export async function sendExchangeRequestToDirector(opts: {
  directorEmail: string;
  requesterName: string;
  holderName: string;
  slotInfo: string;
  sessionName: string;
  dashboardUrl: string;
}): Promise<void> {
  await send({
    from: env.SMTP_FROM,
    to: opts.directorEmail,
    subject: `[TimeTutor] Demande d'échange de créneau — ${opts.sessionName}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px">
        <h1 style="color:#B67332;font-size:22px">Demande d'échange de créneau</h1>
        <p style="color:#4a3316;line-height:1.7">
          <strong>${opts.requesterName}</strong> souhaite échanger le créneau <strong>${opts.slotInfo}</strong>
          actuellement attribué à <strong>${opts.holderName}</strong>.
        </p>
        <a href="${opts.dashboardUrl}" style="display:inline-block;background:#B67332;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:24px 0">
          Gérer la demande depuis le tableau de bord →
        </a>
        <p style="color:#9ca3af;font-size:12px">TimeTutor — Planification scolaire intelligente</p>
      </div>
    `,
  });
}

export async function sendContactRequest(
  requesterName: string,
  targetTeacher: Teacher,
  slotInfo: { dayOfWeek: string; startTime: string },
  message: string | null
): Promise<void> {
  await send({
    from: env.SMTP_FROM,
    to: targetTeacher.email,
    subject: `[TimeTutor] Demande de contact pour votre créneau ${slotInfo.dayOfWeek} ${slotInfo.startTime}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px">
        <h1 style="color:#8b5cf6;font-size:22px">💬 Demande de contact</h1>
        <p style="color:#6b7280;line-height:1.7">
          Bonjour ${targetTeacher.fullName},<br>
          <strong>${requesterName}</strong> souhaite récupérer votre créneau
          <strong>${slotInfo.dayOfWeek} à ${slotInfo.startTime}</strong>.
        </p>
        ${message ? `<blockquote style="border-left:3px solid #8b5cf6;padding-left:16px;color:#374151">${message}</blockquote>` : ''}
        <p style="color:#9ca3af;font-size:12px">
          Vous pouvez libérer ce créneau depuis votre lien d'invitation,
          ou l'ignorer pour le conserver. Tant que le créneau n'est pas validé, vous gardez la main.
        </p>
        <p style="color:#9ca3af;font-size:12px">TimeTutor — Gestion intelligente des emplois du temps</p>
      </div>
    `,
  });
}

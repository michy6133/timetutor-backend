import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import { query, getClient } from '../config/database';
import { lockSlot, unlockSlot } from '../services/slotLock.service';
import { notifyDirector } from '../services/notification.service';
import { sendContactRequest } from '../services/email.service';
import type { AuthRequest, TeacherRequest } from '../types';
import { createError } from '../middleware/errorHandler';

const slotSchema = z.object({
  subjectId: z.string().uuid().optional(),
  dayOfWeek: z.enum(['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  room: z.string().optional(),
}).refine(data => data.endTime > data.startTime, {
  message: "L'heure de fin doit être après l'heure de début",
  path: ['endTime']
});

export async function listSlots(
  req: AuthRequest | TeacherRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { sessionId } = req.params;
    const { rows } = await query(
      `SELECT ts.*, s.name AS subject_name, s.color AS subject_color,
        ss.teacher_id AS selected_by_teacher_id,
        t.full_name AS teacher_name,
        ss.validated_at
       FROM time_slots ts
       LEFT JOIN subjects s ON s.id = ts.subject_id
       LEFT JOIN slot_selections ss ON ss.slot_id = ts.id
       LEFT JOIN teachers t ON t.id = ss.teacher_id
       WHERE ts.session_id = $1
       ORDER BY CASE ts.day_of_week
         WHEN 'Lundi' THEN 1 WHEN 'Mardi' THEN 2 WHEN 'Mercredi' THEN 3
         WHEN 'Jeudi' THEN 4 WHEN 'Vendredi' THEN 5 WHEN 'Samedi' THEN 6 ELSE 7 END,
         ts.start_time`,
      [sessionId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function createSlot(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    const data = slotSchema.parse(req.body);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO time_slots (session_id, subject_id, day_of_week, start_time, end_time, room)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [sessionId, data.subjectId ?? null, data.dayOfWeek, data.startTime, data.endTime, data.room ?? null]
    );
    res.status(201).json({ id: rows[0]?.id, ...data });
  } catch (err) {
    next(err);
  }
}

export async function createSlotsBatch(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    const slots = z.array(slotSchema).parse(req.body);
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const ids: string[] = [];
      for (const s of slots) {
        const r = await client.query<{ id: string }>(
          `INSERT INTO time_slots (session_id, subject_id, day_of_week, start_time, end_time, room)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [sessionId, s.subjectId ?? null, s.dayOfWeek, s.startTime, s.endTime, s.room ?? null]
        );
        ids.push(r.rows[0]!.id);
      }
      await client.query('COMMIT');
      res.status(201).json({ created: ids.length, ids });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

export async function selectSlot(req: TeacherRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId, id: slotId } = req.params;
    const { teacherId } = req.teacher!;

    const ruleRes = await query<{ max_slots_per_teacher: number }>(
      `SELECT max_slots_per_teacher FROM session_rules WHERE session_id = $1`,
      [sessionId]
    );
    const maxSlots = ruleRes.rows[0]?.max_slots_per_teacher ?? 20;
    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) FROM slot_selections WHERE teacher_id = $1 AND session_id = $2`,
      [teacherId, sessionId]
    );
    if (parseInt(countRes.rows[0]?.count ?? '0') >= maxSlots) {
      throw createError(`Quota maximum de ${maxSlots} créneaux atteint`, 400);
    }

    const slotRes = await query<{ status: string }>(
      `SELECT status FROM time_slots WHERE id = $1 AND session_id = $2`,
      [slotId, sessionId]
    );
    const slot = slotRes.rows[0];
    if (!slot) throw createError('Créneau introuvable', 404);
    if (slot.status !== 'free') throw createError('Créneau déjà pris', 409);

    const locked = await lockSlot(slotId, teacherId);
    if (!locked) throw createError('Créneau pris par un autre enseignant', 409);

    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE time_slots SET status='taken', updated_at=NOW() WHERE id=$1`,
        [slotId]
      );
      await client.query(
        `INSERT INTO slot_selections (slot_id, teacher_id, session_id) VALUES ($1,$2,$3)`,
        [slotId, teacherId, sessionId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      await unlockSlot(slotId);
      throw err;
    } finally {
      client.release();
    }

    const dirRes = await query<{ created_by: string; name: string }>(
      `SELECT created_by, name FROM sessions WHERE id=$1`,
      [sessionId]
    );
    const sess = dirRes.rows[0];
    if (sess) {
      const tRes = await query<{ full_name: string; day_of_week: string; start_time: string }>(
        `SELECT t.full_name, ts.day_of_week, ts.start_time FROM teachers t, time_slots ts
         WHERE t.id=$1 AND ts.id=$2`,
        [teacherId, slotId]
      );
      const info = tRes.rows[0];
      if (info) {
        await notifyDirector(
          sess.created_by,
          'slot_selected',
          'Créneau sélectionné',
          `${info.full_name} a sélectionné le créneau ${info.day_of_week} ${info.start_time}`,
          { slotId, sessionId }
        );
      }
    }
    res.json({ message: 'Créneau sélectionné' });
  } catch (err) {
    next(err);
  }
}

export async function deselectSlot(req: TeacherRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId: _sessionId, id: slotId } = req.params;
    const { teacherId } = req.teacher!;

    const selRes = await query<{ validated_at: Date | null }>(
      `SELECT validated_at FROM slot_selections WHERE slot_id=$1 AND teacher_id=$2`,
      [slotId, teacherId]
    );
    const sel = selRes.rows[0];
    if (!sel) throw createError('Sélection introuvable', 404);
    if (sel.validated_at) throw createError('Créneau déjà validé — contactez le directeur', 409);

    await query(`DELETE FROM slot_selections WHERE slot_id=$1 AND teacher_id=$2`, [slotId, teacherId]);
    await query(`UPDATE time_slots SET status='free', updated_at=NOW() WHERE id=$1`, [slotId]);
    await unlockSlot(slotId);
    res.json({ message: 'Créneau libéré' });
  } catch (err) {
    next(err);
  }
}

export async function validateSlot(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: slotId } = req.params;
    await query(`UPDATE time_slots SET status='validated', updated_at=NOW() WHERE id=$1`, [slotId]);
    await query(
      `UPDATE slot_selections SET validated_at=NOW(), validated_by=$1 WHERE slot_id=$2`,
      [req.user!.userId, slotId]
    );
    await unlockSlot(slotId);
    res.json({ message: 'Créneau validé définitivement' });
  } catch (err) {
    next(err);
  }
}

export async function unvalidateSlot(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: slotId } = req.params;
    await query(`UPDATE time_slots SET status='taken', updated_at=NOW() WHERE id=$1`, [slotId]);
    await query(
      `UPDATE slot_selections SET validated_at=NULL, validated_by=NULL WHERE slot_id=$1`,
      [slotId]
    );
    res.json({ message: 'Validation retirée' });
  } catch (err) {
    next(err);
  }
}

export async function contactRequest(req: TeacherRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: slotId, sessionId } = req.params;
    const { teacherId } = req.teacher!;
    const { message } = z.object({ message: z.string().optional() }).parse(req.body);

    const slotRes = await query<{ status: string }>(
      `SELECT status FROM time_slots WHERE id=$1`,
      [slotId]
    );
    const slot = slotRes.rows[0];
    if (!slot || slot.status === 'free') throw createError('Créneau non pris', 400);
    if (slot.status === 'validated') throw createError('Créneau déjà validé — contact impossible', 409);

    const ruleRes = await query<{ allow_contact_request: boolean }>(
      `SELECT allow_contact_request FROM session_rules WHERE session_id=$1`,
      [sessionId]
    );
    // Default to allowed when no rules row exists
    const contactAllowed = ruleRes.rows[0] === undefined ? true : ruleRes.rows[0].allow_contact_request;
    if (!contactAllowed) throw createError('Demande de contact désactivée', 400);

    const selRes = await query<{ teacher_id: string }>(
      `SELECT teacher_id FROM slot_selections WHERE slot_id=$1`,
      [slotId]
    );
    const targetTeacherId = selRes.rows[0]?.teacher_id;
    if (!targetTeacherId) throw createError('Enseignant cible introuvable', 404);

    await query(
      `INSERT INTO contact_requests (slot_id, requester_teacher_id, target_teacher_id, session_id, message)
       VALUES ($1,$2,$3,$4,$5)`,
      [slotId, teacherId, targetTeacherId, sessionId, message ?? null]
    );

    // Notify target teacher by email
    const requesterRes = await query<{ full_name: string }>(
      `SELECT full_name FROM teachers WHERE id=$1`, [teacherId]
    );
    const targetRes = await query<{ full_name: string; email: string }>(
      `SELECT full_name, email FROM teachers WHERE id=$1`, [targetTeacherId]
    );
    const slotInfoRes = await query<{ day_of_week: string; start_time: string }>(
      `SELECT day_of_week, start_time FROM time_slots WHERE id=$1`, [slotId]
    );
    if (requesterRes.rows[0] && targetRes.rows[0] && slotInfoRes.rows[0]) {
      const slotInfo = slotInfoRes.rows[0];
      await sendContactRequest(
        requesterRes.rows[0].full_name,
        { fullName: targetRes.rows[0].full_name, email: targetRes.rows[0].email },
        { dayOfWeek: slotInfo.day_of_week, startTime: slotInfo.start_time },
        message ?? null
      );
    }

    const dirRes = await query<{ created_by: string }>(
      `SELECT created_by FROM sessions WHERE id=$1`,
      [sessionId]
    );
    if (dirRes.rows[0]) {
      await notifyDirector(
        dirRes.rows[0].created_by,
        'contact_request',
        'Demande de contact',
        `Un enseignant souhaite récupérer un créneau`,
        { slotId, sessionId }
      );
    }
    res.status(201).json({ message: 'Demande de contact envoyée' });
  } catch (err) {
    next(err);
  }
}

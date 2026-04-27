import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import { query, getClient } from '../config/database';
import { lockSlot, unlockSlot } from '../services/slotLock.service';
import { notifyDirector } from '../services/notification.service';
import { getSocketIo } from '../config/socket-io';
import {
  emitSlotSelected,
  emitSlotReleased,
  emitSlotValidated,
  emitSlotLocked,
  emitContactRequest,
  emitContactRequestsChanged,
  emitNegotiationUpdated,
} from '../socket/handler';
import { sendContactRequest, sendSwapAccepted, sendSwapRejected } from '../services/email.service';
import type { AuthRequest, TeacherRequest } from '../types';
import { createError } from '../middleware/errorHandler';

const TIGHT_CROSS_SCHOOL_GAP_MINUTES = 60;

type SlotStatus = 'free' | 'taken' | 'locked' | 'validated';

interface NegotiationRow {
  id: string;
  session_id: string;
  target_slot_id: string;
  status: 'active' | 'locked' | 'cancelled';
}

function timeToMinutes(t: string): number {
  const s = t.length >= 5 ? t.substring(0, 5) : t;
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Null if intervals overlap (strict overlap or nested). Non-negative gap in minutes if disjoint or merely touching. */
function gapMinutesBetweenIntervals(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): number | null {
  if (aStart < bEnd && aEnd > bStart) return null;
  if (aEnd <= bStart) return bStart - aEnd;
  if (bEnd <= aStart) return aStart - bEnd;
  return null;
}

function formatHm(t: string): string {
  return t.length >= 5 ? t.substring(0, 5) : t;
}

async function crossSchoolTightScheduleWarnings(
  teacherId: string,
  newSlotId: string
): Promise<string[]> {
  const slotRes = await query<{
    day_of_week: string;
    start_time: string;
    end_time: string;
    school_id: string;
  }>(
    `SELECT ts.day_of_week, ts.start_time::text, ts.end_time::text, sess.school_id
     FROM time_slots ts
     JOIN sessions sess ON sess.id = ts.session_id
     WHERE ts.id = $1`,
    [newSlotId]
  );
  const ns = slotRes.rows[0];
  if (!ns) return [];

  const emailRes = await query<{ email: string }>(
    `SELECT LOWER(TRIM(email)) AS email FROM teachers WHERE id = $1`,
    [teacherId]
  );
  const email = emailRes.rows[0]?.email;
  if (!email) return [];

  const others = await query<{
    day_of_week: string;
    start_time: string;
    end_time: string;
    school_name: string;
    school_id: string;
    session_name: string;
  }>(
    `SELECT ts.day_of_week, ts.start_time::text, ts.end_time::text,
            sch.name AS school_name, sch.id AS school_id, sess.name AS session_name
     FROM slot_selections ss
     JOIN teachers t ON t.id = ss.teacher_id
     JOIN time_slots ts ON ts.id = ss.slot_id
     JOIN sessions sess ON sess.id = ss.session_id
     JOIN schools sch ON sch.id = sess.school_id
     WHERE LOWER(TRIM(t.email)) = $1
       AND ts.id <> $2
       AND ts.day_of_week = $3`,
    [email, newSlotId, ns.day_of_week]
  );

  const warnings: string[] = [];
  const curSchool = ns.school_id;
  const nS = timeToMinutes(ns.start_time);
  const nE = timeToMinutes(ns.end_time);

  for (const o of others.rows) {
    if (o.school_id === curSchool) continue;
    const oS = timeToMinutes(o.start_time);
    const oE = timeToMinutes(o.end_time);
    const gap = gapMinutesBetweenIntervals(nS, nE, oS, oE);
    if (gap !== null && gap <= TIGHT_CROSS_SCHOOL_GAP_MINUTES) {
      warnings.push(
        `Même jour, une autre école (${o.school_name}) : « ${o.session_name} » ${formatHm(o.start_time)}–${formatHm(o.end_time)} est à moins d’1 h de ce créneau (${formatHm(ns.start_time)}–${formatHm(ns.end_time)}). Prévoyez le trajet.`
      );
    }
  }
  return [...new Set(warnings)];
}

async function getOrCreateActiveNegotiation(
  sessionId: string,
  targetSlotId: string,
  creatorTeacherId: string
): Promise<string> {
  const existing = await query<NegotiationRow>(
    `SELECT id, session_id, target_slot_id, status
     FROM slot_negotiations
     WHERE session_id = $1 AND target_slot_id = $2 AND status = 'active'
     LIMIT 1`,
    [sessionId, targetSlotId]
  );
  const current = existing.rows[0];
  if (current) return current.id;

  const created = await query<{ id: string }>(
    `INSERT INTO slot_negotiations (session_id, target_slot_id, created_by_teacher_id)
     VALUES ($1,$2,$3)
     RETURNING id`,
    [sessionId, targetSlotId, creatorTeacherId]
  );
  return created.rows[0]!.id;
}

async function ensureNegotiationParticipants(
  negotiationId: string,
  targetSlotId: string,
  requesterTeacherId: string
): Promise<void> {
  const ownerRes = await query<{ teacher_id: string }>(
    `SELECT teacher_id FROM slot_selections WHERE slot_id = $1`,
    [targetSlotId]
  );
  const ownerId = ownerRes.rows[0]?.teacher_id;
  if (!ownerId) {
    throw createError('Le créneau ciblé n’a pas de propriétaire', 409);
  }
  await query(
    `INSERT INTO slot_negotiation_participants (negotiation_id, teacher_id, role, desired_slot_id, resolved)
     VALUES ($1,$2,'owner',$3,false)
     ON CONFLICT (negotiation_id, teacher_id)
     DO UPDATE SET role = EXCLUDED.role`,
    [negotiationId, ownerId, targetSlotId]
  );
  await query(
    `INSERT INTO slot_negotiation_participants (negotiation_id, teacher_id, role, desired_slot_id, resolved)
     VALUES ($1,$2,'requester',$3,false)
     ON CONFLICT (negotiation_id, teacher_id)
     DO UPDATE SET desired_slot_id = EXCLUDED.desired_slot_id, resolved = false`,
    [negotiationId, requesterTeacherId, targetSlotId]
  );
}

async function maybeAutoLockNegotiation(negotiationId: string): Promise<{ locked: boolean; sessionId: string; targetSlotId: string }> {
  const infoRes = await query<NegotiationRow>(
    `SELECT id, session_id, target_slot_id, status
     FROM slot_negotiations WHERE id = $1 LIMIT 1`,
    [negotiationId]
  );
  const info = infoRes.rows[0];
  if (!info) throw createError('Négociation introuvable', 404);
  if (info.status !== 'active') return { locked: info.status === 'locked', sessionId: info.session_id, targetSlotId: info.target_slot_id };

  const openRequesters = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM slot_negotiation_participants
     WHERE negotiation_id = $1
       AND role = 'requester'
       AND resolved = false`,
    [negotiationId]
  );
  if (parseInt(openRequesters.rows[0]?.count ?? '0', 10) > 0) {
    return { locked: false, sessionId: info.session_id, targetSlotId: info.target_slot_id };
  }

  await query(
    `UPDATE slot_negotiations
     SET status = 'locked', locked_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [negotiationId]
  );
  await query(
    `UPDATE time_slots
     SET status = 'locked', updated_at = NOW()
     WHERE id = $1 AND status = 'taken'`,
    [info.target_slot_id]
  );

  return { locked: true, sessionId: info.session_id, targetSlotId: info.target_slot_id };
}

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
      `SELECT ts.id AS "id",
              ts.session_id AS "sessionId",
              ts.subject_id AS "subjectId",
              s.name AS "subjectName",
              s.color AS "subjectColor",
              ss.teacher_id AS "selectedByTeacherId",
              t.full_name AS "teacherName",
              ss.validated_at AS "validatedAt",
              ts.day_of_week AS "dayOfWeek",
              substring(ts.start_time::text, 1, 5) AS "startTime",
              substring(ts.end_time::text, 1, 5) AS "endTime",
              ts.room,
              ts.status
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

    // Check for overlapping slots on the same day
    const overlapCheck = await query<{ exists: boolean }>(
      `SELECT 1 FROM time_slots
       WHERE session_id=$1 AND day_of_week=$2 AND status != 'deleted'
       AND NOT (end_time <= $3::time OR start_time >= $4::time)
       LIMIT 1`,
      [sessionId, data.dayOfWeek, data.startTime, data.endTime]
    );
    if (overlapCheck.rows.length > 0) {
      res.status(409).json({ error: 'Chevauchement de créneaux détecté' });
      return;
    }

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

export async function deleteSlot(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId, slotId } = req.params;
    const slotRes = await query<{ status: string }>(
      `SELECT status FROM time_slots WHERE id=$1 AND session_id=$2`,
      [slotId, sessionId]
    );
    const slot = slotRes.rows[0];
    if (!slot) { res.status(404).json({ error: 'Créneau introuvable' }); return; }
    if (slot.status !== 'free') {
      res.status(409).json({ error: 'Seuls les créneaux libres peuvent être supprimés' });
      return;
    }
    await query(`DELETE FROM time_slots WHERE id=$1`, [slotId]);
    res.json({ message: 'Créneau supprimé' });
  } catch (err) {
    next(err);
  }
}

export async function duplicateSlotToDays(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId, slotId } = req.params;
    const { days } = z.object({
      days: z.array(z.enum(['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'])).min(1),
    }).parse(req.body);

    const srcRes = await query<{ subject_id: string | null; start_time: string; end_time: string; room: string | null }>(
      `SELECT subject_id, start_time::text, end_time::text, room FROM time_slots WHERE id=$1 AND session_id=$2`,
      [slotId, sessionId]
    );
    const src = srcRes.rows[0];
    if (!src) { res.status(404).json({ error: 'Créneau source introuvable' }); return; }

    const created: string[] = [];
    for (const day of days) {
      // Check overlap for this day
      const overlap = await query<{ id: string }>(
        `SELECT id FROM time_slots
         WHERE session_id=$1 AND day_of_week=$2 AND status != 'deleted'
         AND NOT (end_time <= $3::time OR start_time >= $4::time)
         LIMIT 1`,
        [sessionId, day, src.start_time.substring(0, 5), src.end_time.substring(0, 5)]
      );
      if (overlap.rows.length > 0) continue; // skip overlapping days silently

      const ins = await query<{ id: string }>(
        `INSERT INTO time_slots (session_id, subject_id, day_of_week, start_time, end_time, room)
         VALUES ($1,$2,$3,$4::time,$5::time,$6) RETURNING id`,
        [sessionId, src.subject_id, day, src.start_time.substring(0, 5), src.end_time.substring(0, 5), src.room]
      );
      if (ins.rows[0]) created.push(ins.rows[0].id);
    }
    res.status(201).json({ created: created.length, ids: created });
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

    const slotRes = await query<{ status: SlotStatus }>(
      `SELECT status FROM time_slots WHERE id = $1 AND session_id = $2`,
      [slotId, sessionId]
    );
    const slot = slotRes.rows[0];
    if (!slot) throw createError('Créneau introuvable', 404);
    if (slot.status !== 'free') throw createError('Créneau déjà pris', 409);

    const overlapRes = await query<{ count: string }>(
      `WITH teacher_identity AS (
         SELECT LOWER(email) AS email
         FROM teachers
         WHERE id = $1
       )
       SELECT COUNT(*)::text AS count
       FROM slot_selections ss
       JOIN teachers t ON t.id = ss.teacher_id
       JOIN teacher_identity ti ON LOWER(t.email) = ti.email
       JOIN time_slots existing_slot ON existing_slot.id = ss.slot_id
       JOIN time_slots target_slot ON target_slot.id = $2
       WHERE existing_slot.day_of_week = target_slot.day_of_week
         AND existing_slot.start_time < target_slot.end_time
         AND existing_slot.end_time > target_slot.start_time`,
      [teacherId, slotId]
    );
    if (parseInt(overlapRes.rows[0]?.count ?? '0', 10) > 0) {
      throw createError('Conflit détecté: vous avez déjà un créneau qui se chevauche (même dans une autre école)', 409);
    }

    const locked = await lockSlot(slotId, teacherId);
    if (!locked) throw createError('Créneau pris par un autre enseignant', 409);

    const client = await getClient();
    let committed = false;
    try {
      await client.query('BEGIN');
      const up = await client.query<{ id: string }>(
        `UPDATE time_slots SET status='taken', updated_at=NOW()
         WHERE id=$1 AND session_id=$2 AND status='free'
         RETURNING id`,
        [slotId, sessionId]
      );
      if (up.rowCount === 0) {
        await client.query('ROLLBACK');
        await unlockSlot(slotId);
        throw createError('Créneau déjà pris', 409);
      }
      await client.query(
        `INSERT INTO slot_selections (slot_id, teacher_id, session_id) VALUES ($1,$2,$3)`,
        [slotId, teacherId, sessionId]
      );
      await client.query('COMMIT');
      committed = true;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (!committed) await unlockSlot(slotId);
      throw err;
    } finally {
      client.release();
    }

    await unlockSlot(slotId);

    const io = getSocketIo();
    if (io) {
      const nameRes = await query<{ full_name: string }>(
        `SELECT full_name FROM teachers WHERE id=$1`,
        [teacherId]
      );
      emitSlotSelected(io, sessionId, {
        slotId,
        teacherName: nameRes.rows[0]?.full_name ?? '',
        status: 'taken',
      });
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
    const warnings = await crossSchoolTightScheduleWarnings(teacherId, slotId);
    res.json({ message: 'Créneau sélectionné', warnings });
  } catch (err) {
    next(err);
  }
}

export async function duplicateSlotsFromSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId: targetSessionId } = req.params;
    const { sourceSessionId } = z.object({ sourceSessionId: z.string().uuid() }).parse(req.body);
    const schoolId = req.user!.schoolId;
    if (!schoolId) throw createError('Non autorisé', 403);

    const pair = await query<{ t_school: string; s_school: string }>(
      `SELECT t.school_id AS t_school, s.school_id AS s_school
       FROM sessions t
       JOIN sessions s ON s.id = $2
       WHERE t.id = $1`,
      [targetSessionId, sourceSessionId]
    );
    const p = pair.rows[0];
    if (!p) throw createError('Session introuvable', 404);
    if (p.t_school !== schoolId || p.s_school !== schoolId) throw createError('Non autorisé', 403);

    const slots = await query<{
      subject_name: string | null;
      day_of_week: string;
      start_time: string;
      end_time: string;
      room: string | null;
    }>(
      `SELECT sub.name AS subject_name, ts.day_of_week, ts.start_time::text, ts.end_time::text, ts.room
       FROM time_slots ts
       LEFT JOIN subjects sub ON sub.id = ts.subject_id
       WHERE ts.session_id = $1
       ORDER BY ts.day_of_week, ts.start_time`,
      [sourceSessionId]
    );

    const client = await getClient();
    let created = 0;
    try {
      await client.query('BEGIN');
      for (const row of slots.rows) {
        let subjectId: string | null = null;
        if (row.subject_name) {
          const sub = await client.query<{ id: string }>(
            `SELECT id FROM subjects WHERE school_id = $1 AND name = $2 LIMIT 1`,
            [schoolId, row.subject_name]
          );
          subjectId = sub.rows[0]?.id ?? null;
        }
        await client.query(
          `INSERT INTO time_slots (session_id, subject_id, day_of_week, start_time, end_time, room, status)
           VALUES ($1,$2,$3,$4::time,$5::time,$6,'free')`,
          [targetSessionId, subjectId, row.day_of_week, row.start_time, row.end_time, row.room ?? null]
        );
        created++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.status(201).json({ duplicated: created });
  } catch (err) {
    next(err);
  }
}

export async function deselectSlot(req: TeacherRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId, id: slotId } = req.params;
    const { teacherId } = req.teacher!;

    const slotRes = await query<{ status: SlotStatus }>(
      `SELECT status FROM time_slots WHERE id=$1 AND session_id=$2`,
      [slotId, sessionId]
    );
    const slot = slotRes.rows[0];
    if (!slot) throw createError('Créneau introuvable', 404);
    if (slot.status === 'locked' || slot.status === 'validated') {
      throw createError('Créneau verrouillé/validé — modification impossible', 409);
    }

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

    const io = getSocketIo();
    if (io) emitSlotReleased(io, sessionId, slotId);

    res.json({ message: 'Créneau libéré' });
  } catch (err) {
    next(err);
  }
}

export async function validateSlot(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId, id: slotId } = req.params;
    await query(`UPDATE time_slots SET status='validated', updated_at=NOW() WHERE id=$1`, [slotId]);
    await query(
      `UPDATE slot_selections SET validated_at=NOW(), validated_by=$1 WHERE slot_id=$2`,
      [req.user!.userId, slotId]
    );
    await unlockSlot(slotId);

    const io = getSocketIo();
    if (io) emitSlotValidated(io, sessionId, slotId);

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

    const slotRes = await query<{ status: SlotStatus }>(
      `SELECT status FROM time_slots WHERE id=$1`,
      [slotId]
    );
    const slot = slotRes.rows[0];
    if (!slot || slot.status === 'free') throw createError('Créneau non pris', 400);
    if (slot.status === 'validated' || slot.status === 'locked') {
      throw createError('Créneau verrouillé/validé — négociation impossible', 409);
    }

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

    if (targetTeacherId === teacherId) throw createError('Vous possédez déjà ce créneau', 400);
    await query(
      `INSERT INTO contact_requests (slot_id, requester_teacher_id, target_teacher_id, session_id, message)
       VALUES ($1,$2,$3,$4,$5)`,
      [slotId, teacherId, targetTeacherId, sessionId, message ?? null]
    );

    const negotiationId = await getOrCreateActiveNegotiation(sessionId, slotId, teacherId);
    await ensureNegotiationParticipants(negotiationId, slotId, teacherId);

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

    const io = getSocketIo();
    if (io) {
      emitContactRequestsChanged(io, sessionId);
      emitNegotiationUpdated(io, sessionId, negotiationId);
      const rn = requesterRes.rows[0]?.full_name;
      if (rn) emitContactRequest(io, sessionId, { slotId, requesterName: rn });
    }

    res.status(201).json({ message: 'Demande envoyée au professeur concerné', negotiationId });
  } catch (err) {
    next(err);
  }
}

export async function listMyContactRequests(req: TeacherRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    const { teacherId } = req.teacher!;
    const incomingRes = await query(
      `SELECT cr.id,
              cr.status,
              cr.message,
              cr.created_at AS "createdAt",
              cr.slot_id AS "slotId",
              req_t.full_name AS "requesterName",
              ts.day_of_week AS "dayOfWeek",
              substring(ts.start_time::text, 1, 5) AS "startTime",
              substring(ts.end_time::text, 1, 5) AS "endTime"
       FROM contact_requests cr
       JOIN teachers req_t ON req_t.id = cr.requester_teacher_id
       JOIN time_slots ts ON ts.id = cr.slot_id
       WHERE cr.target_teacher_id = $1
         AND cr.session_id = $2
       ORDER BY cr.created_at DESC`,
      [teacherId, sessionId]
    );
    const outgoingRes = await query(
      `SELECT cr.id,
              cr.status,
              cr.message,
              cr.created_at AS "createdAt",
              cr.slot_id AS "slotId",
              tgt_t.full_name AS "targetName",
              ts.day_of_week AS "dayOfWeek",
              substring(ts.start_time::text, 1, 5) AS "startTime",
              substring(ts.end_time::text, 1, 5) AS "endTime"
       FROM contact_requests cr
       JOIN teachers tgt_t ON tgt_t.id = cr.target_teacher_id
       JOIN time_slots ts ON ts.id = cr.slot_id
       WHERE cr.requester_teacher_id = $1
         AND cr.session_id = $2
       ORDER BY cr.created_at DESC`,
      [teacherId, sessionId]
    );
    res.json({ incoming: incomingRes.rows, outgoing: outgoingRes.rows });
  } catch (err) {
    next(err);
  }
}

export async function acceptContactRequest(req: TeacherRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId, requestId } = req.params;
    const { teacherId } = req.teacher!;

    const requestRes = await query<{
      slot_id: string;
      requester_teacher_id: string;
      target_teacher_id: string;
      status: string;
      slot_status: string;
    }>(
      `SELECT cr.slot_id, cr.requester_teacher_id, cr.target_teacher_id, cr.status,
              ts.status AS slot_status
       FROM contact_requests cr
       JOIN time_slots ts ON ts.id = cr.slot_id
       WHERE cr.id = $1
         AND cr.session_id = $2`,
      [requestId, sessionId]
    );
    const request = requestRes.rows[0];
    if (!request) throw createError('Demande introuvable', 404);
    if (request.target_teacher_id !== teacherId) throw createError('Demande non autorisée', 403);
    if (request.status !== 'pending') throw createError('Demande déjà traitée', 409);
    if (request.slot_status === 'validated') throw createError('Créneau validé: négociation impossible', 409);

    const overlapRes = await query<{ count: string }>(
      `WITH requester_identity AS (
         SELECT LOWER(email) AS email
         FROM teachers
         WHERE id = $1
       )
       SELECT COUNT(*)::text AS count
       FROM slot_selections ss
       JOIN teachers t ON t.id = ss.teacher_id
       JOIN requester_identity ri ON LOWER(t.email) = ri.email
       JOIN time_slots existing_slot ON existing_slot.id = ss.slot_id
       JOIN time_slots target_slot ON target_slot.id = $2
       WHERE ss.slot_id != $2
         AND existing_slot.day_of_week = target_slot.day_of_week
         AND existing_slot.start_time < target_slot.end_time
         AND existing_slot.end_time > target_slot.start_time`,
      [request.requester_teacher_id, request.slot_id]
    );
    if (parseInt(overlapRes.rows[0]?.count ?? '0', 10) > 0) {
      throw createError('Impossible de transferer: le demandeur a déjà un créneau en conflit', 409);
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM slot_selections WHERE slot_id=$1 AND teacher_id=$2`,
        [request.slot_id, teacherId]
      );
      await client.query(
        `INSERT INTO slot_selections (slot_id, teacher_id, session_id) VALUES ($1,$2,$3)
         ON CONFLICT (slot_id) DO UPDATE SET teacher_id = EXCLUDED.teacher_id, session_id = EXCLUDED.session_id`,
        [request.slot_id, request.requester_teacher_id, sessionId]
      );
      await client.query(
        `UPDATE time_slots SET status='taken', updated_at=NOW() WHERE id=$1`,
        [request.slot_id]
      );
      await client.query(
        `UPDATE contact_requests
         SET status='accepted', updated_at=NOW()
         WHERE id=$1`,
        [requestId]
      );
      await client.query(
        `UPDATE contact_requests
         SET status='cancelled', updated_at=NOW()
         WHERE slot_id=$1 AND status='pending' AND id != $2`,
        [request.slot_id, requestId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Notify requester that their request was accepted
    const requesterInfoRes = await query<{ full_name: string; email: string; magic_token: string }>(
      `SELECT t.full_name, t.email, ss_t.token AS magic_token
       FROM teachers t
       LEFT JOIN session_slots_tokens ss_t ON ss_t.teacher_id = t.id AND ss_t.session_id = $2
       WHERE t.id = $1`,
      [request.requester_teacher_id, sessionId]
    );
    const slotInfoRes2 = await query<{ day_of_week: string; start_time: string; end_time: string }>(
      `SELECT day_of_week, start_time, end_time FROM time_slots WHERE id=$1`, [request.slot_id]
    );
    const requesterInfo = requesterInfoRes.rows[0];
    const slotInfo2 = slotInfoRes2.rows[0];
    if (requesterInfo && slotInfo2) {
      const magicLink = requesterInfo.magic_token
        ? `${process.env['FRONTEND_URL'] ?? 'http://localhost:4200'}/teacher/${requesterInfo.magic_token}`
        : '';
      sendSwapAccepted(
        { fullName: requesterInfo.full_name, email: requesterInfo.email },
        { dayOfWeek: slotInfo2.day_of_week, startTime: slotInfo2.start_time, endTime: slotInfo2.end_time },
        magicLink
      ).catch(() => undefined);
    }

    const io = getSocketIo();
    if (io) {
      const reqName = await query<{ full_name: string }>(
        `SELECT full_name FROM teachers WHERE id=$1`,
        [request.requester_teacher_id]
      );
      emitSlotSelected(io, sessionId, {
        slotId: request.slot_id,
        teacherName: reqName.rows[0]?.full_name ?? '',
        status: 'taken',
      });
      emitContactRequestsChanged(io, sessionId);
    }

    res.json({ message: 'Demande acceptée et créneau transféré' });
  } catch (err) {
    next(err);
  }
}

export async function rejectContactRequest(req: TeacherRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId, requestId } = req.params;
    const { teacherId } = req.teacher!;
    const result = await query(
      `UPDATE contact_requests
       SET status='rejected', updated_at=NOW()
       WHERE id=$1
         AND session_id=$2
         AND target_teacher_id=$3
         AND status='pending'`,
      [requestId, sessionId, teacherId]
    );
    if (result.rowCount === 0) throw createError('Demande introuvable ou déjà traitée', 404);

    // Notify requester that their request was rejected
    const rejectedReqRes = await query<{
      requester_teacher_id: string; slot_id: string;
    }>(
      `SELECT requester_teacher_id, slot_id FROM contact_requests WHERE id=$1`, [requestId]
    );
    const rejReq = rejectedReqRes.rows[0];
    if (rejReq) {
      const [reqTeacherRes, rejSlotRes] = await Promise.all([
        query<{ full_name: string; email: string }>(
          `SELECT full_name, email FROM teachers WHERE id=$1`, [rejReq.requester_teacher_id]
        ),
        query<{ day_of_week: string; start_time: string; end_time: string }>(
          `SELECT day_of_week, start_time, end_time FROM time_slots WHERE id=$1`, [rejReq.slot_id]
        ),
      ]);
      const rt = reqTeacherRes.rows[0];
      const rs = rejSlotRes.rows[0];
      if (rt && rs) {
        sendSwapRejected(
          { fullName: rt.full_name, email: rt.email },
          { dayOfWeek: rs.day_of_week, startTime: rs.start_time, endTime: rs.end_time }
        ).catch(() => undefined);
      }
    }

    const io = getSocketIo();
    if (io) emitContactRequestsChanged(io, sessionId);

    res.json({ message: 'Demande refusée' });
  } catch (err) {
    next(err);
  }
}

export async function listNegotiationsForTeacher(req: TeacherRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    const { teacherId } = req.teacher!;
    const negotiations = await query(
      `SELECT n.id,
              n.session_id AS "sessionId",
              n.target_slot_id AS "targetSlotId",
              n.status,
              n.locked_at AS "lockedAt",
              ts.day_of_week AS "dayOfWeek",
              substring(ts.start_time::text, 1, 5) AS "startTime",
              substring(ts.end_time::text, 1, 5) AS "endTime",
              owner_t.full_name AS "ownerName"
       FROM slot_negotiations n
       JOIN slot_negotiation_participants p ON p.negotiation_id = n.id
       JOIN time_slots ts ON ts.id = n.target_slot_id
       LEFT JOIN slot_selections owner_sel ON owner_sel.slot_id = n.target_slot_id
       LEFT JOIN teachers owner_t ON owner_t.id = owner_sel.teacher_id
       WHERE n.session_id = $1
         AND n.status IN ('active', 'locked')
         AND p.teacher_id = $2
       ORDER BY n.created_at DESC`,
      [sessionId, teacherId]
    );
    const participants = await query(
      `SELECT p.negotiation_id AS "negotiationId",
              p.teacher_id AS "teacherId",
              t.full_name AS "teacherName",
              p.role,
              p.resolved,
              p.desired_slot_id AS "desiredSlotId"
       FROM slot_negotiation_participants p
       JOIN teachers t ON t.id = p.teacher_id
       JOIN slot_negotiations n ON n.id = p.negotiation_id
       WHERE n.session_id = $1
         AND n.status IN ('active', 'locked')
       ORDER BY p.joined_at`,
      [sessionId]
    );
    const freeSlots = await query(
      `SELECT ts.id,
              ts.day_of_week AS "dayOfWeek",
              substring(ts.start_time::text, 1, 5) AS "startTime",
              substring(ts.end_time::text, 1, 5) AS "endTime",
              ts.room
       FROM time_slots ts
       WHERE ts.session_id = $1 AND ts.status = 'free'
       ORDER BY ts.day_of_week, ts.start_time`,
      [sessionId]
    );
    res.json({ negotiations: negotiations.rows, participants: participants.rows, freeSlots: freeSlots.rows });
  } catch (err) {
    next(err);
  }
}

export async function chooseNegotiationSlot(req: TeacherRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId, negotiationId, token } = req.params;
    const { teacherId } = req.teacher!;
    const { slotId } = z.object({ slotId: z.string().uuid() }).parse(req.body);

    const negotiationRes = await query<NegotiationRow>(
      `SELECT id, session_id, target_slot_id, status
       FROM slot_negotiations
       WHERE id = $1 AND session_id = $2`,
      [negotiationId, sessionId]
    );
    const negotiation = negotiationRes.rows[0];
    if (!negotiation) throw createError('Négociation introuvable', 404);
    if (negotiation.status !== 'active') throw createError('Négociation déjà verrouillée', 409);

    const participantRes = await query<{ id: string; role: 'owner' | 'requester' }>(
      `SELECT id, role
       FROM slot_negotiation_participants
       WHERE negotiation_id = $1 AND teacher_id = $2`,
      [negotiationId, teacherId]
    );
    const participant = participantRes.rows[0];
    if (!participant) throw createError('Vous ne participez pas à cette négociation', 403);

    if (slotId === negotiation.target_slot_id) {
      await query(
        `UPDATE slot_negotiation_participants
         SET desired_slot_id = $1, resolved = false
         WHERE negotiation_id = $2 AND teacher_id = $3`,
        [slotId, negotiationId, teacherId]
      );
      const io = getSocketIo();
      if (io) emitNegotiationUpdated(io, sessionId, negotiationId);
      res.json({ message: 'Choix mis à jour', locked: false });
      return;
    }

    const freeRes = await query<{ id: string; status: SlotStatus }>(
      `SELECT id, status
       FROM time_slots
       WHERE id = $1 AND session_id = $2`,
      [slotId, sessionId]
    );
    const freeSlot = freeRes.rows[0];
    if (!freeSlot) throw createError('Créneau introuvable', 404);
    if (freeSlot.status !== 'free') throw createError('Créneau non disponible', 409);

    const currentSelRes = await query<{ slot_id: string }>(
      `SELECT slot_id FROM slot_selections WHERE teacher_id = $1 AND session_id = $2 LIMIT 1`,
      [teacherId, sessionId]
    );
    const currentSlotId = currentSelRes.rows[0]?.slot_id;

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const lockRes = await client.query<{ id: string }>(
        `UPDATE time_slots
         SET status = 'taken', updated_at = NOW()
         WHERE id = $1 AND session_id = $2 AND status = 'free'
         RETURNING id`,
        [slotId, sessionId]
      );
      if (lockRes.rowCount === 0) {
        await client.query('ROLLBACK');
        throw createError('Créneau non disponible', 409);
      }

      if (currentSlotId) {
        await client.query(
          `UPDATE time_slots SET status = 'free', updated_at = NOW()
           WHERE id = $1 AND session_id = $2 AND status IN ('taken', 'locked')`,
          [currentSlotId, sessionId]
        );
        await client.query(`DELETE FROM slot_selections WHERE slot_id = $1 AND teacher_id = $2`, [currentSlotId, teacherId]);
      }

      await client.query(
        `INSERT INTO slot_selections (slot_id, teacher_id, session_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (slot_id)
         DO UPDATE SET teacher_id = EXCLUDED.teacher_id, session_id = EXCLUDED.session_id`,
        [slotId, teacherId, sessionId]
      );
      await client.query(
        `UPDATE slot_negotiation_participants
         SET desired_slot_id = $1, resolved = true
         WHERE negotiation_id = $2 AND teacher_id = $3`,
        [slotId, negotiationId, teacherId]
      );
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      throw err;
    } finally {
      client.release();
    }

    const lockState = await maybeAutoLockNegotiation(negotiationId);
    const io = getSocketIo();
    if (io) {
      emitSlotSelected(io, sessionId, { slotId, teacherName: '', status: 'taken' });
      if (currentSlotId) emitSlotReleased(io, sessionId, currentSlotId);
      emitNegotiationUpdated(io, sessionId, negotiationId);
      if (lockState.locked) emitSlotLocked(io, sessionId, lockState.targetSlotId);
      emitContactRequestsChanged(io, sessionId);
    }

    res.json({
      message: lockState.locked
        ? 'Choix enregistré. Conflit résolu et créneau verrouillé automatiquement.'
        : 'Choix enregistré.',
      locked: lockState.locked,
      negotiationId,
    });
  } catch (err) {
    next(err);
  }
}

export async function listNegotiationsForDirector(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    const rows = await query(
      `SELECT n.id,
              n.status,
              n.locked_at AS "lockedAt",
              n.target_slot_id AS "targetSlotId",
              ts.day_of_week AS "dayOfWeek",
              substring(ts.start_time::text, 1, 5) AS "startTime",
              substring(ts.end_time::text, 1, 5) AS "endTime",
              owner_t.full_name AS "ownerName",
              COUNT(p.id)::int AS "participantsCount",
              COUNT(*) FILTER (WHERE p.resolved = false AND p.role = 'requester')::int AS "pendingRequesters"
       FROM slot_negotiations n
       JOIN time_slots ts ON ts.id = n.target_slot_id
       LEFT JOIN slot_selections owner_sel ON owner_sel.slot_id = n.target_slot_id
       LEFT JOIN teachers owner_t ON owner_t.id = owner_sel.teacher_id
       LEFT JOIN slot_negotiation_participants p ON p.negotiation_id = n.id
       WHERE n.session_id = $1
       GROUP BY n.id, ts.day_of_week, ts.start_time, ts.end_time, owner_t.full_name
       ORDER BY n.created_at DESC`,
      [sessionId]
    );
    const freeSlots = await query(
      `SELECT id,
              day_of_week AS "dayOfWeek",
              substring(start_time::text, 1, 5) AS "startTime",
              substring(end_time::text, 1, 5) AS "endTime",
              room
       FROM time_slots
       WHERE session_id = $1 AND status = 'free'
       ORDER BY day_of_week, start_time`,
      [sessionId]
    );
    res.json({ negotiations: rows.rows, freeSlots: freeSlots.rows });
  } catch (err) {
    next(err);
  }
}

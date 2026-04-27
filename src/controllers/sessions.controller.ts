import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { query, getClient } from '../config/database';
import type { AuthRequest } from '../types';
import { createError } from '../middleware/errorHandler';
import { assertCanCreateSession, assertFeatureEnabled } from '../services/subscription.service';

const sessionSchema = z.object({
  name: z.string().min(2),
  academicYear: z.string().min(4),
  deadline: z.string().datetime().optional(),
  schoolClassId: z.string().uuid().nullable().optional(),
  rules: z.object({
    minSlotsPerTeacher: z.number().int().min(1).default(1),
    maxSlotsPerTeacher: z.number().int().min(1).default(20),
    allowContactRequest: z.boolean().default(true),
    notifyDirectorOnSelection: z.boolean().default(true),
    notifyDirectorOnContact: z.boolean().default(true),
    autoRemindAfterDays: z.number().int().min(1).default(3),
  }).optional(),
});

export async function listSessions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const schoolId = req.user!.schoolId;
    const classFilter = typeof req.query.schoolClassId === 'string' && z.string().uuid().safeParse(req.query.schoolClassId).success
      ? req.query.schoolClassId
      : null;
    const { rows } = await query(
      `SELECT s.*, sr.min_slots_per_teacher, sr.max_slots_per_teacher,
        sc.name AS school_class_name,
        (SELECT COUNT(*) FROM time_slots WHERE session_id = s.id) AS total_slots,
        (SELECT COUNT(*) FROM time_slots WHERE session_id = s.id AND status != 'free') AS taken_slots,
        (SELECT COUNT(*) FROM teachers WHERE session_id = s.id) AS total_teachers
       FROM sessions s
       LEFT JOIN session_rules sr ON sr.session_id = s.id
       LEFT JOIN school_classes sc ON sc.id = s.school_class_id
       WHERE s.school_id = $1
         AND ($2::uuid IS NULL OR s.school_class_id = $2)
       ORDER BY s.created_at DESC`,
      [schoolId, classFilter]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

export async function createSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = sessionSchema.parse(req.body);
    const { schoolId, userId } = req.user!;
    if (!schoolId) throw createError('Utilisateur non rattaché à une école', 403);
    await assertCanCreateSession(schoolId);
    let schoolClassId: string | null = data.schoolClassId ?? null;
    if (schoolClassId) {
      const cls = await query<{ id: string }>(
        `SELECT id FROM school_classes WHERE id = $1 AND school_id = $2 AND is_active = true`,
        [schoolClassId, schoolId]
      );
      if (!cls.rows[0]) throw createError('Classe invalide ou inactive', 400);
    }
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const sess = await client.query<{ id: string }>(
        `INSERT INTO sessions (school_id, created_by, name, academic_year, deadline, school_class_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [schoolId, userId, data.name, data.academicYear, data.deadline ?? null, schoolClassId]
      );
      const sessionId = sess.rows[0]!.id;
      const r = data.rules ?? ({} as any);
      await client.query(
        `INSERT INTO session_rules (session_id, min_slots_per_teacher, max_slots_per_teacher,
          allow_contact_request, notify_director_on_selection, notify_director_on_contact, auto_remind_after_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sessionId, r.minSlotsPerTeacher ?? 1, r.maxSlotsPerTeacher ?? 20,
         r.allowContactRequest ?? true, r.notifyDirectorOnSelection ?? true,
         r.notifyDirectorOnContact ?? true, r.autoRemindAfterDays ?? 3]
      );
      await client.query('COMMIT');
      res.status(201).json({ id: sessionId, ...data });
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (err) { next(err); }
}

export async function getSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT s.*, sr.*,
        sc.name AS school_class_name,
        (SELECT COUNT(*) FROM time_slots WHERE session_id = s.id) AS total_slots,
        (SELECT COUNT(*) FROM time_slots WHERE session_id = s.id AND status = 'taken') AS taken_slots,
        (SELECT COUNT(*) FROM time_slots WHERE session_id = s.id AND status = 'validated') AS validated_slots,
        (SELECT COUNT(*) FROM teachers WHERE session_id = s.id) AS total_teachers,
        (SELECT COUNT(*) FROM teachers WHERE session_id = s.id AND status != 'pending') AS responded_teachers
       FROM sessions s
       LEFT JOIN session_rules sr ON sr.session_id = s.id
       LEFT JOIN school_classes sc ON sc.id = s.school_class_id
       WHERE s.id = $1 AND s.school_id = $2`,
      [id, req.user!.schoolId]
    );
    if (!rows[0]) throw createError('Session introuvable', 404);
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const data = sessionSchema.partial().parse(req.body);
    const schoolId = req.user!.schoolId;

    if (Object.prototype.hasOwnProperty.call(data, 'schoolClassId') && data.schoolClassId != null) {
      const cls = await query<{ id: string }>(
        `SELECT id FROM school_classes WHERE id = $1 AND school_id = $2 AND is_active = true`,
        [data.schoolClassId, schoolId]
      );
      if (!cls.rows[0]) throw createError('Classe invalide ou inactive', 400);
    }

    const fragments: string[] = [];
    const values: unknown[] = [];
    const add = (col: string, val: unknown) => {
      fragments.push(`${col} = $${values.length + 1}`);
      values.push(val);
    };
    if (data.name !== undefined) add('name', data.name);
    if (data.academicYear !== undefined) add('academic_year', data.academicYear);
    if (data.deadline !== undefined) add('deadline', data.deadline);
    if (Object.prototype.hasOwnProperty.call(data, 'schoolClassId')) add('school_class_id', data.schoolClassId ?? null);

    if (fragments.length === 0) {
      res.json({ message: 'Session mise à jour' });
      return;
    }
    fragments.push('updated_at = NOW()');
    values.push(id, schoolId);
    await query(
      `UPDATE sessions SET ${fragments.join(', ')} WHERE id = $${values.length - 1} AND school_id = $${values.length}`,
      values
    );
    res.json({ message: 'Session mise à jour' });
  } catch (err) { next(err); }
}

export async function updateSessionStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { status } = z.object({ status: z.enum(['draft','open','closed','published']) }).parse(req.body);
    await query(
      `UPDATE sessions SET status=$1, updated_at=NOW() WHERE id=$2 AND school_id=$3`,
      [status, id, req.user!.schoolId]
    );
    res.json({ message: `Session passée en statut "${status}"` });
  } catch (err) { next(err); }
}

export async function deleteSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    await query(`DELETE FROM sessions WHERE id=$1 AND school_id=$2`, [id, req.user!.schoolId]);
    res.json({ message: 'Session supprimée' });
  } catch (err) { next(err); }
}

interface ScheduleRow {
  day_of_week: string;
  start_time: string;
  end_time: string;
  room: string | null;
  status: string;
  teacher_name: string | null;
  teacher_email: string | null;
  teacher_phone: string | null;
  subject_name: string | null;
  subject_color: string | null;
}

const DAY_ORDER = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const HEX_BRICK = '#dd2d4a';
const HEX_CRIMSON = '#880d1e';
const HEX_NAVY = '#1a0204';
const HEX_MUTED = '#6b7280';
const HEX_MINT = '#cbeef3';
const HEX_MINT_SOFT = '#eaf8fb';
const HEX_BLUSH_SOFT = '#fdecf3';
const HEX_BORDER = '#e5d4d8';

function normalizeTime(value: string | null | undefined): string {
  if (!value) return '';
  return value.length >= 5 ? value.substring(0, 5) : value;
}

function formatSlotKey(r: ScheduleRow): string {
  return `${normalizeTime(r.start_time)}-${normalizeTime(r.end_time)}`;
}

function buildScheduleMatrix(rows: ScheduleRow[]): {
  days: string[];
  times: { start: string; end: string; key: string }[];
  map: Map<string, ScheduleRow>;
} {
  const daysSet = new Set<string>();
  const timesMap = new Map<string, { start: string; end: string; key: string }>();
  const map = new Map<string, ScheduleRow>();

  for (const r of rows) {
    daysSet.add(r.day_of_week);
    const key = formatSlotKey(r);
    if (!timesMap.has(key)) {
      timesMap.set(key, {
        start: normalizeTime(r.start_time),
        end: normalizeTime(r.end_time),
        key,
      });
    }
    map.set(`${r.day_of_week}|${key}`, r);
  }

  const days = DAY_ORDER.filter((d) => daysSet.has(d));
  const times = Array.from(timesMap.values()).sort((a, b) => a.start.localeCompare(b.start));
  return { days, times, map };
}

export async function exportSessionPdf(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user?.schoolId) await assertFeatureEnabled(req.user.schoolId, 'pdfExport');
    const { id } = req.params;
    const include = z.object({
      includeTeacherName: z.coerce.boolean().default(true),
      includeContact: z.coerce.boolean().default(true),
      includeEmail: z.coerce.boolean().default(true),
      includeSubject: z.coerce.boolean().default(true),
      includeRoom: z.coerce.boolean().default(true),
    }).parse(req.query);

    const sessionRes = await query<{ name: string; academic_year: string; status: string; deadline: Date | null; school_name: string }>(
      `SELECT s.name, s.academic_year, s.status, s.deadline, sch.name AS school_name
       FROM sessions s
       JOIN schools sch ON sch.id = s.school_id
       WHERE s.id = $1 AND s.school_id = $2`,
      [id, req.user!.schoolId]
    );
    if (!sessionRes.rows[0]) throw createError('Session introuvable', 404);
    const session = sessionRes.rows[0];

    const rowsRes = await query<ScheduleRow>(
      `SELECT ts.day_of_week, ts.start_time::text AS start_time, ts.end_time::text AS end_time,
              ts.room, ts.status,
              t.full_name AS teacher_name, t.email AS teacher_email, t.phone AS teacher_phone,
              sb.name AS subject_name, sb.color AS subject_color
       FROM time_slots ts
       LEFT JOIN slot_selections ss ON ss.slot_id = ts.id
       LEFT JOIN teachers t ON t.id = ss.teacher_id
       LEFT JOIN subjects sb ON sb.id = ts.subject_id
       WHERE ts.session_id = $1
       ORDER BY ts.day_of_week, ts.start_time`,
      [id]
    );
    const rows = rowsRes.rows;

    const teacherCountRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM teachers
       WHERE session_id = $1`,
      [id]
    );
    const teacherCount = parseInt(teacherCountRes.rows[0]?.count ?? '0', 10);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="emploi-du-temps-${session.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${session.academic_year.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf"`
    );

    const doc = new PDFDocument({
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      size: 'A4',
      layout: 'landscape',
      bufferPages: true,
    });
    doc.pipe(res);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const marginX = 32;
    const marginY = 32;
    const contentWidth = pageWidth - marginX * 2;
    const generatedAt = new Date();

    const drawPageChrome = (subtitle: string): void => {
      drawHeaderBand(doc, {
        title: session.name,
        subtitle,
        schoolName: session.school_name,
        marginX,
        marginY,
        contentWidth,
      });
    };

    const matrix = buildScheduleMatrix(rows);

    if (rows.length === 0 || matrix.days.length === 0 || matrix.times.length === 0) {
      drawPageChrome(`Emploi du temps · ${session.academic_year}`);
      let cursorY = marginY + 70;
      cursorY = drawMetaStrip(doc, cursorY, marginX, contentWidth, {
        school: session.school_name,
        status: session.status,
        deadline: session.deadline,
        totalSlots: rows.length,
        filledSlots: rows.filter((r) => r.teacher_name).length,
        teachers: teacherCount,
        generatedAt,
      });
      cursorY += 12;
      doc
        .fillColor(HEX_MUTED)
        .fontSize(11)
        .text('Aucun créneau configuré pour cette session.', marginX, cursorY, {
          width: contentWidth,
          align: 'center',
        });
      drawLegend(doc, { x: marginX, y: pageHeight - 70, width: contentWidth });
      drawFooter(doc, { x: marginX, y: pageHeight - 32, width: contentWidth });
    } else {
      const ROW_H = 62;
      const HEADER_H = 24;
      const META_H = 38;
      const META_GAP = 12;
      const LEGEND_RESERVE = 90;

      const firstPageTop = marginY + 70;
      const firstBodyTop = firstPageTop + META_H + META_GAP;
      const firstBodyHeight = pageHeight - firstBodyTop - LEGEND_RESERVE - HEADER_H;
      const nextBodyTop = marginY + 70 + 8;
      const nextBodyHeight = pageHeight - nextBodyTop - LEGEND_RESERVE - HEADER_H;

      const firstPageRows = Math.max(1, Math.floor(firstBodyHeight / ROW_H));
      const nextPageRows = Math.max(1, Math.floor(nextBodyHeight / ROW_H));

      const timeChunks: Array<typeof matrix.times> = [];
      let cursor = 0;
      while (cursor < matrix.times.length) {
        const size = timeChunks.length === 0 ? firstPageRows : nextPageRows;
        timeChunks.push(matrix.times.slice(cursor, cursor + size));
        cursor += size;
      }

      timeChunks.forEach((chunk, chunkIdx) => {
        if (chunkIdx > 0) doc.addPage();
        const partLabel =
          timeChunks.length > 1 ? ` · Partie ${chunkIdx + 1}/${timeChunks.length}` : '';
        drawPageChrome(
          `Emploi du temps · ${session.academic_year}${partLabel}`
        );

        let cursorY = marginY + 70;
        if (chunkIdx === 0) {
          cursorY = drawMetaStrip(doc, cursorY, marginX, contentWidth, {
            school: session.school_name,
            status: session.status,
            deadline: session.deadline,
            totalSlots: rows.length,
            filledSlots: rows.filter((r) => r.teacher_name).length,
            teachers: teacherCount,
            generatedAt,
          });
          cursorY += META_GAP;
        } else {
          cursorY += 8;
        }

        drawScheduleGrid(
          doc,
          { days: matrix.days, times: chunk, map: matrix.map },
          {
            x: marginX,
            y: cursorY,
            width: contentWidth,
            rowHeight: ROW_H,
            headerHeight: HEADER_H,
            include,
          }
        );

        drawLegend(doc, { x: marginX, y: pageHeight - 70, width: contentWidth });
        drawFooter(doc, { x: marginX, y: pageHeight - 32, width: contentWidth });
      });
    }

    const pageRange = doc.bufferedPageRange();
    for (let i = 0; i < pageRange.count; i++) {
      doc.switchToPage(pageRange.start + i);
      doc
        .fillColor(HEX_MUTED)
        .fontSize(8)
        .text(
          `Page ${i + 1} / ${pageRange.count}`,
          pageWidth - marginX - 80,
          pageHeight - 24,
          { width: 80, align: 'right' }
        );
    }

    doc.end();
  } catch (err) {
    next(err);
  }
}

function drawHeaderBand(
  doc: PDFKit.PDFDocument,
  opts: { title: string; subtitle: string; schoolName: string; marginX: number; marginY: number; contentWidth: number }
): void {
  const { title, subtitle, schoolName, marginX, marginY, contentWidth } = opts;
  doc.save();
  doc.rect(marginX, marginY, contentWidth, 54).fill(HEX_CRIMSON);
  doc.rect(marginX, marginY + 54, contentWidth, 4).fill(HEX_BRICK);
  doc.restore();

  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(title, marginX + 18, marginY + 10, { width: contentWidth - 220, lineBreak: false, ellipsis: true });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#ffffff')
    .opacity(0.85)
    .text(subtitle, marginX + 18, marginY + 32, { width: contentWidth - 220, lineBreak: false, ellipsis: true });
  doc.opacity(1);

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#ffffff')
    .text(schoolName, marginX, marginY + 12, {
      width: contentWidth - 18,
      align: 'right',
      lineBreak: false,
      ellipsis: true,
    });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#ffffff')
    .opacity(0.85)
    .text('TimeTutor · Gestion des emplois du temps', marginX, marginY + 32, {
      width: contentWidth - 18,
      align: 'right',
      lineBreak: false,
    });
  doc.opacity(1).fillColor(HEX_NAVY);
}

function drawMetaStrip(
  doc: PDFKit.PDFDocument,
  y: number,
  x: number,
  width: number,
  info: {
    school: string;
    status: string;
    deadline: Date | null;
    totalSlots: number;
    filledSlots: number;
    teachers: number;
    generatedAt: Date;
  }
): number {
  const boxHeight = 38;
  doc.save();
  doc.roundedRect(x, y, width, boxHeight, 6).fill(HEX_MINT_SOFT);
  doc.restore();

  const items = [
    { label: 'Statut', value: sessionStatusLabel(info.status) },
    { label: 'Créneaux', value: `${info.filledSlots} / ${info.totalSlots}` },
    { label: 'Enseignants', value: String(info.teachers) },
    { label: 'Deadline', value: info.deadline ? new Date(info.deadline).toLocaleDateString('fr-FR') : '—' },
    { label: 'Généré le', value: info.generatedAt.toLocaleString('fr-FR') },
  ];

  const itemWidth = width / items.length;
  items.forEach((item, idx) => {
    const ix = x + idx * itemWidth;
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(HEX_MUTED)
      .text(item.label.toUpperCase(), ix + 10, y + 8, { width: itemWidth - 12, lineBreak: false, ellipsis: true });
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(HEX_NAVY)
      .text(item.value, ix + 10, y + 20, { width: itemWidth - 12, lineBreak: false, ellipsis: true });
    if (idx > 0) {
      doc.save();
      doc.strokeColor('#d9e8ec').lineWidth(0.6).moveTo(ix, y + 8).lineTo(ix, y + boxHeight - 8).stroke();
      doc.restore();
    }
  });

  return y + boxHeight;
}

function sessionStatusLabel(status: string): string {
  return ({ draft: 'Brouillon', open: 'Ouverte', closed: 'Fermée', published: 'Publiée' } as Record<string, string>)[
    status
  ] ?? status;
}

function drawScheduleGrid(
  doc: PDFKit.PDFDocument,
  matrix: { days: string[]; times: { start: string; end: string; key: string }[]; map: Map<string, ScheduleRow> },
  opts: {
    x: number;
    y: number;
    width: number;
    rowHeight: number;
    headerHeight: number;
    include: {
      includeTeacherName: boolean;
      includeContact: boolean;
      includeEmail: boolean;
      includeSubject: boolean;
      includeRoom: boolean;
    };
  }
): void {
  const { x, y, width, rowHeight, headerHeight, include } = opts;
  const { days, times, map } = matrix;
  if (days.length === 0 || times.length === 0) return;

  const timeColWidth = 70;
  const dayColWidth = (width - timeColWidth) / days.length;

  doc.save();
  doc.roundedRect(x, y, width, headerHeight, 5).fill(HEX_CRIMSON);
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#ffffff')
    .text('HORAIRES', x + 6, y + 8, { width: timeColWidth - 10, align: 'center', lineBreak: false });

  days.forEach((day, i) => {
    const dx = x + timeColWidth + i * dayColWidth;
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#ffffff')
      .text(day.toUpperCase(), dx, y + 7, { width: dayColWidth, align: 'center', lineBreak: false });
  });

  let cy = y + headerHeight;
  times.forEach((time, rowIdx) => {
    const rowY = cy;
    const rowIsAlt = rowIdx % 2 === 0;

    doc.save();
    doc.rect(x, rowY, timeColWidth, rowHeight).fill(HEX_MINT);
    doc.restore();

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(HEX_CRIMSON)
      .text(time.start, x, rowY + rowHeight / 2 - 12, { width: timeColWidth, align: 'center', lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(HEX_MUTED)
      .text(time.end, x, rowY + rowHeight / 2 + 2, { width: timeColWidth, align: 'center', lineBreak: false });

    days.forEach((day, colIdx) => {
      const cx = x + timeColWidth + colIdx * dayColWidth;
      const cell = map.get(`${day}|${time.key}`);

      doc.save();
      doc.rect(cx, rowY, dayColWidth, rowHeight).fill(rowIsAlt ? '#ffffff' : HEX_BLUSH_SOFT);
      doc.restore();

      doc.save();
      doc.strokeColor(HEX_BORDER).lineWidth(0.4);
      doc.moveTo(cx, rowY).lineTo(cx, rowY + rowHeight).stroke();
      doc.moveTo(cx, rowY + rowHeight).lineTo(cx + dayColWidth, rowY + rowHeight).stroke();
      doc.restore();

      if (cell) {
        drawSlotCell(doc, cell, cx, rowY, dayColWidth, rowHeight, include);
      }
    });

    cy += rowHeight;
  });

  doc.save();
  doc
    .strokeColor(HEX_CRIMSON)
    .lineWidth(0.8)
    .roundedRect(x, y, width, headerHeight + rowHeight * times.length, 5)
    .stroke();
  doc.restore();
}

function drawSlotCell(
  doc: PDFKit.PDFDocument,
  cell: ScheduleRow,
  cx: number,
  cy: number,
  cellWidth: number,
  cellHeight: number,
  include: {
    includeTeacherName: boolean;
    includeContact: boolean;
    includeEmail: boolean;
    includeSubject: boolean;
    includeRoom: boolean;
  }
): void {
  const pad = 5;
  const isFree = !cell.teacher_name;

  if (isFree) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor('#9ca3af')
      .text('Libre', cx, cy + cellHeight / 2 - 5, { width: cellWidth, align: 'center', lineBreak: false });
    return;
  }

  const accent = cell.subject_color ?? HEX_BRICK;
  doc.save();
  doc.rect(cx + 3, cy + 3, 3, cellHeight - 6).fill(accent);
  doc.restore();

  let textY = cy + pad;
  const textX = cx + pad + 6;
  const textWidth = cellWidth - pad * 2 - 6;

  if (include.includeSubject && cell.subject_name) {
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(accent)
      .text(cell.subject_name, textX, textY, { width: textWidth, ellipsis: true, lineBreak: false });
    textY += 14;
  }

  if (include.includeTeacherName && cell.teacher_name) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(HEX_NAVY)
      .text(cell.teacher_name, textX, textY, { width: textWidth, ellipsis: true, lineBreak: false });
    textY += 11;
  }

  if (include.includeRoom && cell.room) {
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(HEX_MUTED)
      .text(`Salle ${cell.room}`, textX, textY, { width: textWidth, ellipsis: true, lineBreak: false });
    textY += 9;
  }

  if (include.includeContact && cell.teacher_phone) {
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(HEX_MUTED)
      .text(`☎ ${cell.teacher_phone}`, textX, textY, { width: textWidth, ellipsis: true, lineBreak: false });
    textY += 9;
  }

  if (include.includeEmail && cell.teacher_email) {
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(HEX_MUTED)
      .text(cell.teacher_email, textX, textY, { width: textWidth, ellipsis: true, lineBreak: false });
  }
}

function drawLegend(doc: PDFKit.PDFDocument, opts: { x: number; y: number; width: number }): void {
  const { x, y, width } = opts;
  const items = [
    { label: 'Créneau attribué', color: HEX_CRIMSON },
    { label: 'Créneau libre', color: '#d1d5db' },
  ];
  let ix = x;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(HEX_MUTED).text('LÉGENDE', x, y, { width: 60, lineBreak: false });
  ix = x + 60;
  items.forEach((item) => {
    doc.save();
    doc.roundedRect(ix, y - 1, 9, 9, 2).fill(item.color);
    doc.restore();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(HEX_NAVY)
      .text(item.label, ix + 12, y, { width: 110, lineBreak: false });
    ix += 130;
  });
  doc
    .font('Helvetica-Oblique')
    .fontSize(7)
    .fillColor(HEX_MUTED)
    .text(
      'Document officiel TimeTutor · Conservez-le dans un lieu sûr.',
      x,
      y + 14,
      { width, lineBreak: false, ellipsis: true }
    );
}

function drawFooter(doc: PDFKit.PDFDocument, opts: { x: number; y: number; width: number }): void {
  const { x, y, width } = opts;
  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(HEX_MUTED)
    .text(
      `TimeTutor · Exporté le ${new Date().toLocaleString('fr-FR')}`,
      x,
      y,
      { width, align: 'left', lineBreak: false }
    );
}


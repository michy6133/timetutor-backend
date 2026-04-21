import type { Request } from 'express';

// ─── Entities ─────────────────────────────────────────────────────────────────

export interface School {
  id: string;
  name: string;
  slug: string;
  subscriptionPlan: string;
  subscriptionExpiresAt: Date | null;
  maxSessions: number;
  maxTeachersPerSession: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  schoolId: string | null;
  email: string;
  passwordHash: string;
  fullName: string;
  role: 'super_admin' | 'director';
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionStatus = 'draft' | 'open' | 'closed' | 'published';

export interface Session {
  id: string;
  schoolId: string;
  createdBy: string;
  name: string;
  academicYear: string;
  status: SessionStatus;
  deadline: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRule {
  id: string;
  sessionId: string;
  minSlotsPerTeacher: number;
  maxSlotsPerTeacher: number;
  allowContactRequest: boolean;
  notifyDirectorOnSelection: boolean;
  notifyDirectorOnContact: boolean;
  autoRemindAfterDays: number;
}

export interface Subject {
  id: string;
  schoolId: string;
  name: string;
  color: string;
  createdAt: Date;
}

export type SlotStatus = 'free' | 'taken' | 'validated';

export interface TimeSlot {
  id: string;
  sessionId: string;
  subjectId: string | null;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  room: string | null;
  status: SlotStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Teacher {
  id: string;
  sessionId: string;
  fullName: string;
  email: string;
  phone: string | null;
  subjectIds: string[];
  invitationSentAt: Date | null;
  lastSeenAt: Date | null;
  status: 'pending' | 'active' | 'done';
  createdAt: Date;
  updatedAt: Date;
}

export interface MagicToken {
  id: string;
  teacherId: string;
  sessionId: string;
  token: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface SlotSelection {
  id: string;
  slotId: string;
  teacherId: string;
  sessionId: string;
  selectedAt: Date;
  validatedAt: Date | null;
  validatedBy: string | null;
}

export interface ContactRequest {
  id: string;
  slotId: string;
  requesterTeacherId: string;
  targetTeacherId: string;
  sessionId: string;
  message: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

export interface Notification {
  id: string;
  userId: string;
  sessionId: string | null;
  type: string;
  title: string;
  body: string | null;
  isRead: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ─── Request augmentation ────────────────────────────────────────────────────

export interface AuthPayload {
  userId: string;
  schoolId: string;
  role: 'super_admin' | 'director';
}

export interface TeacherPayload {
  teacherId: string;
  sessionId: string;
  token: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

export interface TeacherRequest extends Request {
  teacher?: TeacherPayload;
}

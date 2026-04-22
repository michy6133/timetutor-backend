import { redisClient, isRedisAvailable } from '../config/redis';
import { env } from '../config/env';

const TTL = parseInt(env.SLOT_LOCK_TTL_SECONDS);
// In-memory fallback when Redis is unavailable
const memLocks = new Map<string, { teacherId: string; expiresAt: number }>();

function key(slotId: string): string {
  return `slot_lock:${slotId}`;
}

function isRedisReady(): boolean {
  return isRedisAvailable() && redisClient.isReady;
}

function memLock(slotId: string, teacherId: string): boolean {
  const existing = memLocks.get(slotId);
  if (existing && existing.expiresAt > Date.now()) return false;
  memLocks.set(slotId, { teacherId, expiresAt: Date.now() + TTL * 1000 });
  return true;
}

export async function lockSlot(slotId: string, teacherId: string): Promise<boolean> {
  if (!isRedisReady()) return memLock(slotId, teacherId);
  const result = await redisClient.set(key(slotId), teacherId, { NX: true, EX: TTL });
  return result === 'OK';
}

export async function unlockSlot(slotId: string): Promise<void> {
  memLocks.delete(slotId);
  if (isRedisReady()) await redisClient.del(key(slotId));
}

export async function getSlotLock(slotId: string): Promise<string | null> {
  if (!isRedisReady()) return memLocks.get(slotId)?.teacherId ?? null;
  return redisClient.get(key(slotId));
}

export async function isSlotLocked(slotId: string): Promise<boolean> {
  if (!isRedisReady()) {
    const lock = memLocks.get(slotId);
    return lock != null && lock.expiresAt > Date.now();
  }
  const val = await redisClient.exists(key(slotId));
  return val === 1;
}

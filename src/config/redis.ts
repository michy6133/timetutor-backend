import { createClient } from 'redis';
import { env } from './env';

export const redisClient = createClient({
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy: false, // disable auto-reconnect when not available
  },
});

redisClient.on('error', () => { /* suppressed — handled at connect time */ });
redisClient.on('connect', () => console.log('✅ Redis connecté'));

let redisAvailable = false;

export function isRedisAvailable(): boolean {
  return redisAvailable;
}

export async function connectRedis(): Promise<void> {
  try {
    await redisClient.connect();
    redisAvailable = true;
  } catch {
    console.warn('[Redis] Non disponible — verrous en mémoire (dev mode)');
    redisAvailable = false;
  }
}

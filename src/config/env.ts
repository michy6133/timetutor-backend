import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  COOKIE_SECURE: z.string().default('false'),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.string().default('587'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('TimeTutor <noreply@timetutor.app>'),
  FRONTEND_URL: z.string().default('http://localhost:4200'),
  MAGIC_LINK_BASE_URL: z.string().default('http://localhost:4200/teacher'),
  MAGIC_TOKEN_TTL_HOURS: z.string().default('72'),
  SLOT_LOCK_TTL_SECONDS: z.string().default('30'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  TWILIO_MESSAGING_ENABLED: z.string().default('false'),
  FEDAPAY_SECRET_KEY: z.string().default(''),
  FEDAPAY_PUBLIC_KEY: z.string().default(''),
  FEDAPAY_ENV: z.enum(['sandbox', 'live']).default('live'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

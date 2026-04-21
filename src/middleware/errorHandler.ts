import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Données invalides', details: err.flatten().fieldErrors });
    return;
  }
  if (err instanceof Error) {
    const status = (err as Error & { status?: number }).status ?? 500;
    const isDev = process.env.NODE_ENV === 'development';
    res.status(status).json({
      error: status >= 500 ? 'Erreur serveur interne' : err.message,
      ...(isDev && { stack: err.stack }),
    });
    return;
  }
  res.status(500).json({ error: 'Erreur inconnue' });
}

export function createError(message: string, status: number): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

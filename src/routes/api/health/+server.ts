import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Liveness probe for the container healthcheck (docker-compose wgets this).
// Public + unauthenticated by design — hooks.server.ts exempts /api/health
// from the auth gate and rate limiter so the healthcheck never 401s/429s.
export const GET: RequestHandler = () => json({ status: 'ok' });

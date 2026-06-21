import { auth } from '$lib/server/auth/better-auth';
import { toSvelteKitHandler } from 'better-auth/svelte-kit';
import type { RequestHandler } from './$types';

// Better Auth's endpoints (/api/auth/sign-in/username, /sign-out, /get-session,
// OIDC callbacks, etc.). The specific /api/auth/logout route still wins for the
// legacy logout during the coexistence transition.
const handler = toSvelteKitHandler(auth);
export const GET: RequestHandler = (event) => handler(event);
export const POST: RequestHandler = (event) => handler(event);

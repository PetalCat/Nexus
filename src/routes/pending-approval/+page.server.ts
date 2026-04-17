/**
 * /pending-approval — lifecycle gates (no-user → /login, approved user → /)
 * live in resolveRedirect (#32). The route itself has no server-side data
 * to load; the page renders a static "waiting for approval" card that
 * points to /api/auth/logout.
 *
 * Kept as a module (vs. deleted) so the route directory structure stays
 * explicit and so any future page-specific data loads have an obvious home.
 */
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {};
};

import { json } from '@sveltejs/kit';
import { startPlexPin, pollPlexPin, listPlexResources } from '$lib/adapters/plex';
import type { RequestHandler } from './$types';

/**
 * Plex PIN flow (plex.tv/link).
 *
 * POST /api/plex/pin           → request a new PIN. Returns { id, code }.
 * GET  /api/plex/pin?id=123    → poll for the auth token once the user enters
 *                                the code at plex.tv/link. Returns { token?, servers? }.
 *                                Token is null until the user completes the link.
 *
 * Admin-only — this is part of the setup/onboarding wizard.
 */

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Admin required' }, { status: 403 });
	try {
		const pin = await startPlexPin();
		return json(pin);
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
	}
};

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Admin required' }, { status: 403 });
	const idStr = url.searchParams.get('id');
	if (!idStr) return json({ error: 'Missing id' }, { status: 400 });
	const id = Number(idStr);
	if (!Number.isFinite(id)) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const token = await pollPlexPin(id);
		if (!token) return json({ token: null });

		// Once we have a token, enumerate the Plex servers the user can access
		// so the admin UI can show a picker instead of requiring URL entry.
		let servers: Array<{ name: string; clientIdentifier: string; connections: Array<{ uri: string; local: boolean }> }> = [];
		try {
			servers = await listPlexResources(token);
		} catch {
			// Non-fatal — the admin can still paste a URL manually.
		}
		return json({ token, servers });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
	}
};

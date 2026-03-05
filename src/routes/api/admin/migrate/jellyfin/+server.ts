import { json } from '@sveltejs/kit';
import { getJellyfinUsers } from '$lib/server/services';
import { createUser, getUserByUsername, upsertUserCredential } from '$lib/server/auth';
import { randomBytes } from 'crypto';
import type { RequestHandler } from './$types';

// GET /api/admin/migrate/jellyfin — Preview: list all Jellyfin users
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	try {
		const jfUsers = await getJellyfinUsers();
		return json(jfUsers);
	} catch (e) {
		console.error('[API] Jellyfin user list error', e);
		return json({ error: 'Failed to fetch Jellyfin users' }, { status: 500 });
	}
};

// POST /api/admin/migrate/jellyfin — Import Jellyfin users into Nexus
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const body = await request.json().catch(() => ({}));
	// body.users = array of { externalId, username, serviceId } to import
	// If not provided, import ALL Jellyfin users
	let toImport: Array<{ externalId: string; username: string; serviceId: string }>;

	if (body.users && Array.isArray(body.users)) {
		toImport = body.users;
	} else {
		const jfUsers = await getJellyfinUsers();
		toImport = jfUsers.map((u) => ({
			externalId: u.externalId,
			username: u.username,
			serviceId: u.serviceId
		}));
	}

	const results: Array<{ username: string; status: string; nexusId?: string }> = [];

	for (const jfUser of toImport) {
		try {
			// Check if Nexus user with this username already exists
			const existing = getUserByUsername(jfUser.username);
			if (existing) {
				// Just link the credential if not already linked
				upsertUserCredential(existing.id, jfUser.serviceId, {
					externalUserId: jfUser.externalId,
					externalUsername: jfUser.username
				});
				results.push({ username: jfUser.username, status: 'linked', nexusId: existing.id });
				continue;
			}

			// Create a new Nexus account with a random password
			// User will need an invite link to set their own password, or admin resets it
			const tempPassword = randomBytes(24).toString('base64url');
			const nexusId = createUser(
				jfUser.username,
				jfUser.username, // displayName = username initially
				tempPassword,
				false, // not admin
				{ authProvider: 'jellyfin', externalId: jfUser.externalId }
			);

			// Link the Jellyfin credential
			upsertUserCredential(nexusId, jfUser.serviceId, {
				externalUserId: jfUser.externalId,
				externalUsername: jfUser.username
			});

			results.push({ username: jfUser.username, status: 'created', nexusId });
		} catch (e) {
			results.push({ username: jfUser.username, status: `error: ${String(e)}` });
		}
	}

	return json({ imported: results.length, results });
};

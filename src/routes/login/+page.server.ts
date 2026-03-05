import { fail, redirect } from '@sveltejs/kit';
import { COOKIE_NAME, createSession, getUserByUsername, getUserCount, getUserCredentialForService, upsertUserCredential, verifyPassword } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getServiceConfigs } from '$lib/server/services';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (getUserCount() === 0) throw redirect(303, '/setup');
	if (locals.user) throw redirect(303, url.searchParams.get('next') || '/');
	return {};
};

/**
 * After login, silently auto-link any Overseerr services that use Jellyfin auth,
 * provided the user already has a Jellyfin credential linked.
 * Runs fire-and-forget — never blocks the login redirect.
 */
async function autoLinkOverseerr(userId: string) {
	try {
		const services = getServiceConfigs();

		// Find the user's linked Jellyfin external ID (from any Jellyfin service)
		let jellyfinExternalId: string | null = null;
		for (const svc of services) {
			if (svc.type === 'jellyfin') {
				const cred = getUserCredentialForService(userId, svc.id);
				if (cred?.externalUserId) { jellyfinExternalId = cred.externalUserId; break; }
			}
		}
		if (!jellyfinExternalId) return; // no Jellyfin linked, nothing to auto-link

		// For each Overseerr service in Jellyfin auth mode that isn't linked yet
		for (const svc of services) {
			if (svc.type !== 'overseerr' || !svc.username) continue; // not Jellyfin auth mode
			if (getUserCredentialForService(userId, svc.id)) continue; // already linked

			const adapter = registry.get('overseerr');
			if (!adapter?.getUsers) continue;

			const users = await adapter.getUsers(svc);
			const match = users.find((u) => u.jellyfinUserId === jellyfinExternalId);
			if (match) {
				upsertUserCredential(userId, svc.id, {
					accessToken: '',
					externalUserId: match.externalId,
					externalUsername: match.username
				});
			}
		}
	} catch (e) {
		// Silently ignore — auto-link failure should never break login
		console.error('[autoLinkOverseerr]', e);
	}
}

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const username = (data.get('username') as string)?.trim();
		const password = data.get('password') as string;

		if (!username || !password) {
			return fail(400, { error: 'Username and password are required' });
		}

		const user = getUserByUsername(username);
		if (!user || !verifyPassword(password, user.passwordHash)) {
			return fail(401, { error: 'Invalid username or password' });
		}

		const token = createSession(user.id);
		cookies.set(COOKIE_NAME, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});

		// Fire-and-forget: auto-link Overseerr if Jellyfin creds are present
		autoLinkOverseerr(user.id);

		const next = url.searchParams.get('next') || '/';
		throw redirect(303, next);
	}
};

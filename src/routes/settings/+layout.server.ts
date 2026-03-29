import { registry } from '$lib/adapters/registry';
import { getUserCredentials, getUserCredentialForService } from '$lib/server/auth';
import { getServiceConfigs, autoLinkJellyfinServices } from '$lib/server/services';
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const services = getServiceConfigs();

	// Silently auto-link Overseerr (and similar) via Jellyfin credentials
	if (locals.user) {
		await autoLinkJellyfinServices(locals.user.id).catch(() => {});
	}

	// Current user's linked credentials — re-read after auto-link above
	const myCredentials = locals.user
		? getUserCredentials(locals.user.id).map((c) => ({
				serviceId: c.serviceId,
				externalUserId: c.externalUserId,
				externalUsername: c.externalUsername,
				linkedAt: c.linkedAt
		  }))
		: [];

	// Which services are user-linkable and configured
	const linkableServices = services
		.filter((s) => {
			const adapter = registry.get(s.type);
			return (adapter?.userLinkable || s.type === 'streamystats') && s.enabled;
		})
		.map((s) => {
			const adapter = registry.get(s.type);

			// StreamyStats: auto-connected via Jellyfin token, no stored cred needed
			if (s.type === 'streamystats') {
				return {
					id: s.id, name: s.name, type: s.type,
					authUsernameLabel: 'Username',
					authMode: 'auto-jellyfin' as const
				};
			}

			// Overseerr in Jellyfin auth mode: auto-connected
			if (s.type === 'overseerr' && s.username) {
				return {
					id: s.id, name: s.name, type: s.type,
					authUsernameLabel: 'Jellyfin Username',
					authMode: 'auto-jellyfin' as const
				};
			}

			// Jellyfin: if the admin provisioned or migrated this user, a cred already exists.
			if (s.type === 'jellyfin' && locals.user) {
				const existing = getUserCredentialForService(locals.user.id, s.id);
				if (existing?.externalUserId) {
					if (!existing.accessToken) {
						return {
							id: s.id, name: s.name, type: s.type,
							authUsernameLabel: 'Username',
							authMode: 'needs-reauth' as const,
							prefillUsername: existing.externalUsername ?? ''
						};
					}
					return {
						id: s.id, name: s.name, type: s.type,
						authUsernameLabel: 'Username',
						authMode: 'auto-provisioned' as const
					};
				}
			}

			return {
				id: s.id,
				name: s.name,
				type: s.type,
				authUsernameLabel: adapter?.authUsernameLabel ?? 'Username',
				authMode: 'local' as const
			};
		});

	const isAdmin = locals.user?.isAdmin ?? false;

	// For each linkable service the user doesn't have a credential for,
	// count unclaimed accounts for the account picker
	const unclaimedCounts: Record<string, number> = {};
	for (const svc of linkableServices) {
		if (myCredentials.some(c => c.serviceId === svc.id)) continue;
		const svcConfig = services.find(s => s.id === svc.id);
		if (!svcConfig) continue;
		const adapter = registry.get(svcConfig.type);
		if (!adapter?.getUsers || !adapter?.resetPassword || !adapter?.authenticateUser) continue;
		try {
			const db = getDb();
			const allCreds = db.select({ externalUserId: schema.userServiceCredentials.externalUserId })
				.from(schema.userServiceCredentials)
				.where(eq(schema.userServiceCredentials.serviceId, svc.id))
				.all();
			const claimedIds = new Set(allCreds.map(c => c.externalUserId).filter(Boolean));
			const allUsers = await adapter.getUsers(svcConfig);
			unclaimedCounts[svc.id] = allUsers.filter(u => !claimedIds.has(u.externalId)).length;
		} catch {
			// Ignore errors — service may be offline
		}
	}

	// Build adapter metadata map for UI (colors, abbreviations)
	const adapterMeta: Record<string, { color?: string; abbreviation?: string }> = {};
	for (const a of registry.all()) {
		adapterMeta[a.id] = { color: a.color, abbreviation: a.abbreviation };
	}

	return { services, myCredentials, linkableServices, isAdmin, unclaimedCounts, adapterMeta };
};

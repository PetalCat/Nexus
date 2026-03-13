import { registry } from '$lib/adapters/registry';
import { getUserCredentials, getUserCredentialForService } from '$lib/server/auth';
import { getServiceConfigs, autoLinkJellyfinServices } from '$lib/server/services';
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

	return { services, myCredentials, linkableServices, isAdmin };
};

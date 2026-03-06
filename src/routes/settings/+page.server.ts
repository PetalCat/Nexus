import { registry } from '$lib/adapters/registry';
import { getAllUsers, getAllSettings, getInviteLinks, getPendingUsers, getUserCredentials, getUserCredentialForService } from '$lib/server/auth';
import { checkAllServices, getServiceConfigs, autoLinkJellyfinServices, getUserLinkableServices } from '$lib/server/services';
import type { PageServerLoad } from './$types';

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------

export const load: PageServerLoad = async ({ locals }) => {
	const services = getServiceConfigs();
	const available = registry.all().map((a) => ({
		id: a.id,
		displayName: a.displayName,
		defaultPort: a.defaultPort,
		icon: a.icon,
		mediaTypes: a.mediaTypes,
		userLinkable: a.userLinkable ?? false
	}));

	// Health check for all configured services (cached 30s inside checkAllServices)
	const health = services.length > 0 ? await checkAllServices() : [];

	// Admin-only data
	const isAdmin = locals.user?.isAdmin ?? false;
	const users = isAdmin ? getAllUsers() : [];
	const invites = isAdmin ? getInviteLinks() : [];
	const settings = isAdmin ? getAllSettings() : {};
	const pendingUsers = isAdmin ? getPendingUsers() : [];

	// Per-user credential map for admin Users tab (which services each user has linked)
	const allUserCredentials: Record<string, Array<{ serviceId: string; serviceType: string; externalUsername: string }>> = {};
	const provisionableServices = isAdmin ? getUserLinkableServices() : [];
	if (isAdmin) {
		for (const u of users) {
			const creds = getUserCredentials(u.id);
			allUserCredentials[u.id] = creds.map((c) => {
				const svc = services.find((s) => s.id === c.serviceId);
				return {
					serviceId: c.serviceId,
					serviceType: svc?.type ?? 'unknown',
					externalUsername: c.externalUsername ?? ''
				};
			});
		}
	}

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

			// Overseerr in Jellyfin auth mode: auto-connected (credential stored by autoLinkJellyfinServices above)
			if (s.type === 'overseerr' && s.username) {
				return {
					id: s.id, name: s.name, type: s.type,
					authUsernameLabel: 'Jellyfin Username',
					authMode: 'auto-jellyfin' as const
				};
			}

			// Jellyfin: if the admin provisioned or migrated this user, a cred already exists.
			// Show as auto-connected when token is valid; needs-reauth when token is empty (migrated users).
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

	return { services, available, health, isAdmin, users, invites, myCredentials, linkableServices, settings, pendingUsers, allUserCredentials, provisionableServices };
};

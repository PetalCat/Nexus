/**
 * Derived Service Auto-Linker
 *
 * When a parent credential (e.g. Jellyfin) is stored, this module automatically
 * links derived services (e.g. Overseerr, StreamyStats) that depend on the parent.
 *
 * Two linking strategies:
 *   A) authVia delegation — copy parent token (StreamyStats pattern)
 *   B) User matching — find user by jellyfinUserId/plexUserId (Overseerr pattern)
 *
 * All linking is best-effort: errors are caught and logged but never thrown.
 */

import { registry } from '../adapters/registry';
import { importJellyfinUser } from '../adapters/overseerr';
import type { ServiceConfig, UserCredential } from '../adapters/types';
import { getEnabledConfigs, getServiceConfig } from './services';
import { getUserCredentialForService, upsertUserCredential } from './auth';

/**
 * Attempt to auto-link all derived services after a parent credential is stored.
 *
 * @param userId        - Nexus user ID
 * @param parentServiceId   - The service whose credential was just stored
 * @param parentServiceType - The adapter type of the parent service (e.g. 'jellyfin')
 */
export async function linkDerivedServices(
	userId: string,
	parentServiceId: string,
	parentServiceType: string
): Promise<void> {
	const configs = getEnabledConfigs();
	const parentCred = getUserCredentialForService(userId, parentServiceId);
	if (!parentCred) return;

	for (const config of configs) {
		// Skip the parent service itself
		if (config.id === parentServiceId) continue;

		const adapter = registry.get(config.type);
		if (!adapter) continue;

		// Only process adapters that declare this parent as a derivation source
		if (!adapter.derivedFrom?.includes(parentServiceType)) continue;

		// Skip if user already has credentials for this service
		const existing = getUserCredentialForService(userId, config.id);
		if (existing?.externalUserId) continue;

		try {
			if (adapter.authVia === parentServiceType && parentCred.accessToken) {
				// Strategy A: authVia delegation (e.g. StreamyStats uses Jellyfin token)
				await linkViaAuthDelegation(userId, config, parentCred);
			} else if (adapter.getUsers) {
				// Strategy B: User matching (e.g. Overseerr matches by jellyfinUserId)
				await linkViaUserMatching(userId, config, adapter, parentCred);
			}
		} catch (e) {
			// Best-effort — swallow all errors
			console.warn(
				`[derived-linker] Failed to auto-link ${config.type} (${config.id}) for user ${userId}:`,
				e instanceof Error ? e.message : e
			);
		}
	}
}

/**
 * Strategy A: Validate the parent token against the derived service, then store it.
 * Mirrors the StreamyStats auto-link pattern from the credential API.
 */
async function linkViaAuthDelegation(
	userId: string,
	config: ServiceConfig,
	parentCred: UserCredential
): Promise<void> {
	if (config.type === 'streamystats') {
		// StreamyStats-specific validation: test the Jellyfin token against its recommendations API
		const jfUrl = (config.username ?? '').replace(/\/+$/, '');
		const testUrl = new URL(`${config.url.replace(/\/+$/, '')}/api/recommendations`);
		testUrl.searchParams.set('serverUrl', jfUrl);
		testUrl.searchParams.set('limit', '1');

		const res = await fetch(testUrl.toString(), {
			headers: { Authorization: `MediaBrowser Token="${parentCred.accessToken}"` },
			signal: AbortSignal.timeout(8000)
		});

		if (!res.ok) {
			console.warn(
				`[derived-linker] StreamyStats rejected parent token (${res.status}) for service ${config.id}`
			);
			return;
		}
	}

	// Token validated (or no specific validation needed) — store the credential
	upsertUserCredential(
		userId,
		config.id,
		{
			accessToken: parentCred.accessToken,
			externalUserId: parentCred.externalUserId,
			externalUsername: parentCred.externalUsername
		},
		{ managed: true, linkedVia: config.type, skipDerivedLink: true }
	);
}

/**
 * Strategy B: Look up users on the derived service and match by parent external ID.
 * Mirrors the Overseerr auto-link pattern from the credential API.
 */
async function linkViaUserMatching(
	userId: string,
	config: ServiceConfig,
	adapter: { getUsers?: (config: ServiceConfig) => Promise<Array<{ externalId: string; username: string; jellyfinUserId?: string }>> },
	parentCred: UserCredential
): Promise<void> {
	if (!adapter.getUsers || !parentCred.externalUserId) return;

	let users = await adapter.getUsers(config);
	let match = users.find((u) => u.jellyfinUserId === parentCred.externalUserId);

	// If no match and this is Overseerr, try importing the Jellyfin user first
	if (!match && config.type === 'overseerr') {
		const imported = await importJellyfinUser(config, parentCred.externalUserId!);
		if (imported) {
			users = await adapter.getUsers(config);
			match = users.find((u) => u.jellyfinUserId === parentCred.externalUserId);
		}
	}

	if (!match) return;

	upsertUserCredential(
		userId,
		config.id,
		{
			accessToken: '',
			externalUserId: match.externalId,
			externalUsername: match.username
		},
		{ managed: true, linkedVia: config.type, skipDerivedLink: true }
	);
}

/**
 * Server-side helper: build AccountServiceSummary objects from services +
 * user_service_credentials + adapter capabilities. Consumed by the settings
 * pages and any consumer page that renders the shared account-linking UI
 * components (SignInCard, StaleCredentialBanner, AccountLinkModal).
 *
 * Never includes raw access tokens or stored passwords — only metadata and
 * state. Safe to pass to the client.
 */

import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { registry } from '../adapters/registry';
import { getServiceConfig, getEnabledConfigs } from './services';
import type { AccountServiceSummary } from '../components/account-linking/types';

function fallbackCapabilities() {
	return {} as AccountServiceSummary['capabilities'];
}

/**
 * Load a single AccountServiceSummary by service id for a specific user.
 * Returns null if the service doesn't exist.
 */
export function buildAccountServiceSummary(
	userId: string | null,
	serviceId: string
): AccountServiceSummary | null {
	const config = getServiceConfig(serviceId);
	if (!config) return null;
	return buildFromConfig(userId, config);
}

/**
 * Load AccountServiceSummary objects for every enabled service of a given
 * adapter type. Useful for consumer pages that need to render SignInCards
 * for all configured instances of one service.
 */
export function buildAccountServiceSummariesForType(
	userId: string | null,
	serviceType: string
): AccountServiceSummary[] {
	return getEnabledConfigs()
		.filter((c) => c.type === serviceType)
		.map((c) => buildFromConfig(userId, c))
		.filter((s): s is AccountServiceSummary => s !== null);
}

/**
 * Load AccountServiceSummary objects for every enabled service the current
 * user could link. Used by the accounts page.
 */
export function buildAllAccountServiceSummaries(userId: string): AccountServiceSummary[] {
	return getEnabledConfigs()
		.map((c) => buildFromConfig(userId, c))
		.filter((s): s is AccountServiceSummary => s !== null);
}

function buildFromConfig(
	userId: string | null,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	config: any
): AccountServiceSummary | null {
	const adapter = registry.get(config.type);
	if (!adapter) return null;

	const capabilities = adapter.capabilities ?? fallbackCapabilities();

	// Look up the user's credential row for this service, if any.
	let isLinked = false;
	let staleSince: string | null = null;
	let externalUsername: string | null = null;
	let nexusManaged = false;
	let autoLinked = false;
	let hasStoredPassword = false;
	let parentServiceId: string | null = null;

	if (userId) {
		const db = getDb();
		const row = db
			.select({
				accessToken: schema.userServiceCredentials.accessToken,
				externalUsername: schema.userServiceCredentials.externalUsername,
				externalUserId: schema.userServiceCredentials.externalUserId,
				staleSince: schema.userServiceCredentials.staleSince,
				managed: schema.userServiceCredentials.managed,
				autoLinked: schema.userServiceCredentials.autoLinked,
				storedPassword: schema.userServiceCredentials.storedPassword,
				parentServiceId: schema.userServiceCredentials.parentServiceId
			})
			.from(schema.userServiceCredentials)
			.where(
				and(
					eq(schema.userServiceCredentials.userId, userId),
					eq(schema.userServiceCredentials.serviceId, config.id)
				)
			)
			.get();
		if (row) {
			isLinked = !!(row.accessToken || row.externalUserId);
			staleSince = row.staleSince ?? null;
			externalUsername = row.externalUsername ?? null;
			nexusManaged = !!row.managed;
			autoLinked = !!row.autoLinked;
			hasStoredPassword = !!row.storedPassword;
			parentServiceId = row.parentServiceId ?? null;
		}
	}

	// If the credential points at a parent, resolve the parent's display name
	// so the UI can show "Linked via Jellyfin" with the actual service name.
	let parentServiceName: string | null = null;
	if (parentServiceId) {
		const parent = getServiceConfig(parentServiceId);
		parentServiceName = parent?.name ?? null;
	}

	return {
		id: config.id,
		name: config.name,
		type: config.type,
		url: config.url,
		color: adapter.color ?? '#888',
		abbreviation: adapter.abbreviation ?? config.type.slice(0, 2).toUpperCase(),
		icon: adapter.icon,
		capabilities,
		isLinked,
		staleSince,
		externalUsername,
		nexusManaged,
		autoLinked,
		hasStoredPassword,
		parentServiceName
	};
}

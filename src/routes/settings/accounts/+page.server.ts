import { registry } from '$lib/adapters/registry';
import { getUserCredentials, getUserCredentialForService } from '$lib/server/auth';
import { getEnabledConfigs } from '$lib/server/services';
import { buildAllAccountServiceSummaries } from '$lib/server/account-services';
import type { AccountServiceSummary } from '$lib/components/account-linking/types';
import type { PageServerLoad } from './$types';

export interface AccountService {
	id: string;
	name: string;
	type: string;
	userLinkable: boolean;
	derivedFrom: string[] | null;
	parentRequired: boolean;
	canCreateUser: boolean;
	canAuthenticate: boolean;
	isLinked: boolean;
	managed: boolean;
	linkedVia: string | null;
	externalUsername: string | null;
	parentLinked: boolean;
	parentServiceName: string | null;
	authUsernameLabel: string;
	color: string;
	abbreviation: string;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		return {
			accountServices: [] as AccountService[],
			accountSummaries: [] as AccountServiceSummary[],
			isAdmin: false
		};
	}

	const configs = getEnabledConfigs();
	const credentials = getUserCredentials(user.id);
	const credMap = new Map(credentials.map((c) => [c.serviceId, c]));

	// Build a map of which parent adapter types the user has linked
	const linkedTypes = new Set<string>();
	const linkedTypeNames = new Map<string, string>();
	for (const config of configs) {
		const cred = credMap.get(config.id);
		if (cred?.accessToken || cred?.externalUserId) {
			linkedTypes.add(config.type);
			linkedTypeNames.set(config.type, config.name);
		}
	}

	const accountServices: AccountService[] = [];

	for (const config of configs) {
		const adapter = registry.get(config.type);
		if (!adapter) continue;

		const userLinkable = adapter.userLinkable ?? false;
		const derivedFrom = adapter.derivedFrom ?? null;

		// Only show services where userLinkable === true OR derivedFrom is set
		if (!userLinkable && !derivedFrom) continue;

		// Skip enrichment-only services (Bazarr, Prowlarr) — users don't interact with these
		if (adapter.isEnrichmentOnly) continue;

		const cred = credMap.get(config.id);
		const isLinked = !!(cred?.accessToken || cred?.externalUserId);

		// Check if any parent service is linked
		let parentLinked = false;
		let parentServiceName: string | null = null;
		if (derivedFrom) {
			for (const parentType of derivedFrom) {
				if (linkedTypes.has(parentType)) {
					parentLinked = true;
					parentServiceName = linkedTypeNames.get(parentType) ?? parentType;
					break;
				}
			}
		}

		accountServices.push({
			id: config.id,
			name: config.name,
			type: config.type,
			userLinkable,
			derivedFrom,
			parentRequired: adapter.parentRequired ?? false,
			canCreateUser: typeof adapter.createUser === 'function',
			canAuthenticate: typeof adapter.authenticateUser === 'function',
			isLinked,
			managed: (cred as any)?.managed ?? false,
			linkedVia: (cred as any)?.linkedVia ?? null,
			externalUsername: cred?.externalUsername ?? null,
			parentLinked,
			parentServiceName,
			authUsernameLabel: adapter.authUsernameLabel ?? 'Username',
			color: adapter.color ?? 'var(--color-accent)',
			abbreviation: adapter.abbreviation ?? config.type.slice(0, 2).toUpperCase()
		});
	}

	// New normalized summary shape for the shared AccountLinkModal component.
	// Runs in parallel with the legacy accountServices shape the existing
	// page rendering still depends on — both are kept during the transition.
	const accountSummaries = buildAllAccountServiceSummaries(user.id);

	return {
		accountServices,
		accountSummaries,
		isAdmin: user.isAdmin ?? false
	};
};

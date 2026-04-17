import { unifiedSearch } from '$lib/server/search';
import { getEnabledConfigs } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	const typeFilter = url.searchParams.get('type')?.trim() || undefined;

	if (query.length < 2) {
		return { query, typeFilter, items: [], total: 0 };
	}

	const items = await unifiedSearch({
		query,
		userId: locals.user?.id,
		scope: 'all',
		type: typeFilter
	});

	// Mark items produced by a request-provider adapter so the UI can split
	// library vs requestable without hardcoding `serviceType === 'overseerr'`.
	const requestProviderTypes = new Set(
		getEnabledConfigs()
			.filter((c) => !!registry.get(c.type)?.getRequests)
			.map((c) => c.type)
	);
	const tagged = items.map((i) => ({
		...i,
		_requestable: requestProviderTypes.has(i.serviceType) && i.status !== 'available'
	}));

	return { query, typeFilter, items: tagged, total: tagged.length };
};

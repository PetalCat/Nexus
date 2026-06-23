import { error } from '@sveltejs/kit';
import { registryV2 } from '$lib/adapters/v2';
import { resolveServiceConfig } from '$lib/server/v2-services';
import type { PageServerLoad } from './$types';

/**
 * An immutable collection view — a series' episodes, an album's tracks. Read-only:
 * the children come straight from the backend (adapter.getChildren), nothing is
 * stored. Mutable playlists are a separate, persisted feature.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const backend = params.backend;
	const adapter = registryV2.get(backend);
	if (!adapter) throw error(404, `Unknown backend "${backend}"`);
	const config = resolveServiceConfig(backend);
	if (!config) throw error(404, `Backend "${backend}" is not configured`);

	// The parent (for the header) drives the type so getChildren picks the right
	// backend call; fetch it first, then its children.
	const item = adapter.getItem ? await adapter.getItem(config, params.id) : null;
	const children = adapter.getChildren
		? await adapter.getChildren(config, params.id, item?.type)
		: [];

	if (!item && children.length === 0) throw error(404, 'Collection not found');

	return { backend, item, children };
};

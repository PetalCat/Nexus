import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getMusicAlbumDetail, getMusicAlbums } from '$lib/server/music';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const userId = locals.user?.id;
	if (!userId) throw error(401);

	const serviceId = url.searchParams.get('service') ?? '';

	// Get album tracks
	const detail = await getMusicAlbumDetail(userId, params.id, serviceId);
	if (!detail) throw error(404, 'Album not found');

	// Fetch the album item itself (not included in detail)
	let album = null;
	const configs = getEnabledConfigs();
	const config = serviceId
		? configs.find((c) => c.id === serviceId)
		: configs.find((c) => c.type === 'jellyfin');

	if (config) {
		const adapter = registry.get(config.type);
		const cred = getUserCredentialForService(userId, config.id);
		if (adapter?.getItem && cred) {
			album = await adapter.getItem(config, params.id, cred);
		}
	}

	if (!album) throw error(404, 'Album not found');

	// More by this artist
	let moreByArtist: typeof detail.tracks = [];
	const artistId = album.metadata?.artistId as string | undefined;
	if (artistId) {
		try {
			const result = await getMusicAlbums(userId, { artistId, limit: 10 });
			const items = result.items ?? [];
			moreByArtist = items.filter((a) => a.sourceId !== params.id).slice(0, 6);
		} catch {
			// ignore
		}
	}

	return { album, tracks: detail.tracks ?? [], moreByArtist, serviceId };
};

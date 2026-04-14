import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { normalizeVideo } from '$lib/adapters/invidious';
import { invidiousCookieHeaders } from '$lib/adapters/invidious/client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const userId = locals.user?.id;
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return { playlist: null };

	const config = configs[0];
	const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;

	try {
		const url = `${config.url}/api/v1/playlists/${encodeURIComponent(params.id)}`;
		const headers: Record<string, string> = { ...invidiousCookieHeaders(cred) };

		const res = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(8000)
		});

		if (!res.ok) return { playlist: null };

		const raw = await res.json();

		const videos = (raw.videos ?? []).map(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(v: any, i: number) => ({
				...normalizeVideo(config, v),
				// Invidious uses the index ID for removal
				_indexId: v.indexId ?? String(i)
			})
		);

		return {
			playlist: {
				id: raw.playlistId ?? params.id,
				title: raw.title ?? 'Untitled',
				videoCount: raw.videoCount ?? videos.length,
				privacy: raw.privacy ?? 'private',
				videos
			}
		};
	} catch {
		return { playlist: null };
	}
};

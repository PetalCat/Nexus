import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { normalizeVideo } from '$lib/adapters/invidious';
import { invidiousCookieHeaders } from '$lib/adapters/invidious/client';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';

interface InvidiousSearchResult {
	type: string;
	title?: string;
	videoId?: string;
	author?: string;
	authorId?: string;
	authorUrl?: string;
	authorThumbnails?: { url: string; width: number; height: number }[];
	subCount?: number;
	videoCount?: number;
	description?: string;
	descriptionHtml?: string;
	// video fields
	videoThumbnails?: { quality: string; url: string; width: number; height: number }[];
	published?: number;
	publishedText?: string;
	lengthSeconds?: number;
	viewCount?: number;
	viewCountText?: string;
	authorVerified?: boolean;
	[key: string]: unknown;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const query = url.searchParams.get('q')?.trim();
	if (!query || query.length < 2) return json({ items: [], channels: [], total: 0 });

	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ items: [], channels: [], total: 0 });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;

	try {
		const result = await withCache(`video:search:${query.toLowerCase()}`, 60_000, async () => {
			const params = new URLSearchParams({ q: query });
			const headers: Record<string, string> = { ...invidiousCookieHeaders(userCred) };

			const res = await fetch(`${config.url}/api/v1/search?${params}`, {
				headers,
				signal: AbortSignal.timeout(8000)
			});
			if (!res.ok) throw new Error(`Search failed: ${res.status}`);
			return res.json() as Promise<InvidiousSearchResult[]>;
		});

		let videos = result
			.filter((r) => r.type === 'video' && r.videoId)
			.map((v) => normalizeVideo(config, v as any));

		// Apply DeArrow enrichment if available
		const adapter = registry.get(config.type);
		if (adapter?.enrichItem) {
			videos = await Promise.all(
				videos.map(item => adapter.enrichItem!(config, item, 'dearrow'))
			);
		}

		const channels = result
			.filter((r) => r.type === 'channel' && r.authorId)
			.map((c) => {
				let thumbnail = c.authorThumbnails?.[c.authorThumbnails.length - 1]?.url ?? '';
				if (thumbnail.startsWith('//')) thumbnail = `https:${thumbnail}`;
				return {
					id: c.authorId!,
					name: c.author ?? '',
					thumbnail,
					subscribers: c.subCount ?? 0,
					videoCount: c.videoCount ?? 0,
					description: c.description ?? ''
				};
			});

		return json({ items: videos, channels, total: videos.length + channels.length });
	} catch (e) {
		console.error('[API] video search error', e);
		return json({ error: 'Search failed' }, { status: 500 });
	}
};

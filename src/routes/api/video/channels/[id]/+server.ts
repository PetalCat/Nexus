import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getChannel, getChannelVideos, normalizeVideo } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });
	const config = configs[0];
	const sort = url.searchParams.get('sort') ?? undefined;

	const [channel, videosRes] = await Promise.all([
		getChannel(config, params.id),
		getChannelVideos(config, params.id, sort)
	]);

	return json({
		author: channel.author,
		authorId: channel.authorId,
		description: channel.description,
		subCount: channel.subCount,
		totalViews: channel.totalViews,
		authorVerified: channel.authorVerified,
		tags: channel.tags,
		banner: channel.authorBanners?.[0]?.url,
		thumbnail: channel.authorThumbnails?.find((t: any) => t.width >= 100)?.url,
		videos: videosRes.videos?.map((v: any) => normalizeVideo(config, v)) ?? [],
		relatedChannels: channel.relatedChannels
	});
};

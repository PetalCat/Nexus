import { getEnabledConfigs } from '$lib/server/services';
import { getChannel, getChannelVideos, normalizeVideo, getSubscriptions } from '$lib/adapters/invidious';
import { getUserCredentialForService } from '$lib/server/auth';
import { isChannelNotifyEnabled } from '$lib/server/video-notifications';
import { withCache } from '$lib/server/cache';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const configs = getEnabledConfigs().filter((c) => c.type === 'invidious');
	if (configs.length === 0) throw error(404, 'No Invidious service configured');

	const config = configs[0];
	const channelId = params.id;
	const sort = url.searchParams.get('sort') ?? undefined;

	const channelData = await withCache(`channel:${channelId}:${sort ?? 'default'}`, 120_000, async () => {
		const [channel, videosRes] = await Promise.all([
			getChannel(config, channelId),
			getChannelVideos(config, channelId, sort)
		]);

		return {
			author: channel.author as string,
			authorId: channel.authorId as string,
			description: (channel.description ?? '') as string,
			subCount: (channel.subCount ?? 0) as number,
			totalViews: (channel.totalViews ?? 0) as number,
			authorVerified: (channel.authorVerified ?? false) as boolean,
			tags: (channel.tags ?? []) as string[],
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			banner: (() => {
				const url = (channel.authorBanners?.find((b: any) => b.width >= 1024)?.url ??
					channel.authorBanners?.[0]?.url ?? '') as string;
				return url.startsWith('//') ? `https:${url}` : url;
			})(),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			thumbnail: (() => {
				const url = (channel.authorThumbnails?.find((t: any) => t.width >= 100)?.url ?? '') as string;
				return url.startsWith('//') ? `https:${url}` : url;
			})(),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			videos: (videosRes.videos?.map((v: any) => normalizeVideo(config, v)) ?? []),
			serviceId: config.id
		};
	});

	const userId = locals.user?.id;
	const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
	const hasLinkedAccount = !!cred?.accessToken;
	let isSubscribed = false;
	if (hasLinkedAccount && cred) {
		try {
			const subs = await getSubscriptions(config, cred);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			isSubscribed = subs.some((s: any) => s.authorId === channelId);
		} catch { /* silent */ }
	}

	const notifyEnabled = userId ? isChannelNotifyEnabled(userId, channelId) : false;

	return { channel: channelData, sort: sort ?? 'newest', isSubscribed, hasLinkedAccount, notifyEnabled };
};

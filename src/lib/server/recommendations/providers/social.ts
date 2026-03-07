import { getRawDb } from '$lib/db';
import type {
	RecommendationProvider,
	RecommendationContext,
	ScoredRecommendation,
	ProviderCategory
} from '../types';

// ---------------------------------------------------------------------------
// Social Signals Provider
// ---------------------------------------------------------------------------

function getFriendIds(userId: string): string[] {
	const raw = getRawDb();
	const rows = raw.prepare(
		`SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END as fid
		 FROM friendships
		 WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'`
	).all(userId, userId, userId) as Array<{ fid: string }>;
	return rows.map((r) => r.fid);
}

export const socialProvider: RecommendationProvider = {
	id: 'social',
	displayName: 'From Friends',
	category: 'social' as ProviderCategory,

	isReady(ctx: RecommendationContext): boolean {
		return getFriendIds(ctx.userId).length > 0;
	},

	async getRecommendations(ctx: RecommendationContext): Promise<ScoredRecommendation[]> {
		const raw = getRawDb();
		const friendIds = getFriendIds(ctx.userId);
		if (friendIds.length === 0) return [];

		const results: ScoredRecommendation[] = [];
		const seen = new Set<string>();

		const consumed = new Set(
			(raw.prepare(`SELECT DISTINCT media_id FROM media_events WHERE user_id = ?`).all(ctx.userId) as Array<{ media_id: string }>)
				.map((r) => r.media_id)
		);

		const placeholders = friendIds.map(() => '?').join(',');

		// 1. Items shared TO the user (highest signal: 0.9)
		const shared = raw.prepare(
			`SELECT media_id, media_type, media_title, media_poster, from_user_id, service_id
			 FROM shared_items
			 WHERE to_user_id = ?
			 ORDER BY created_at DESC LIMIT 20`
		).all(ctx.userId) as Array<{
			media_id: string;
			media_type: string;
			media_title: string;
			media_poster: string | null;
			from_user_id: string;
			service_id: string;
		}>;

		for (const item of shared) {
			if (consumed.has(item.media_id) || ctx.excludeIds.has(item.media_id) || seen.has(item.media_id)) continue;
			if (ctx.mediaType && item.media_type !== ctx.mediaType) continue;
			seen.add(item.media_id);

			results.push({
				item: {
					id: `${item.media_id}:${item.service_id}`,
					sourceId: item.media_id,
					serviceId: item.service_id,
					serviceType: 'social',
					type: item.media_type as any,
					title: item.media_title,
					poster: item.media_poster ?? undefined
				},
				score: 0.9,
				confidence: 0.85,
				provider: 'social',
				reason: `Shared with you by a friend`,
				reasonType: 'friend_shared'
			});
		}

		// 2. Items friends completed + liked recently (signal: 0.5)
		const typeFilter = ctx.mediaType ? `AND me.media_type = ?` : '';
		const friendEventParams: (string | number)[] = [...friendIds];
		if (ctx.mediaType) friendEventParams.push(ctx.mediaType);
		friendEventParams.push(Date.now() - 14 * 24 * 60 * 60 * 1000);

		const friendLiked = raw.prepare(
			`SELECT DISTINCT me.media_id, me.media_type, me.media_title, me.media_year, me.media_genres
			 FROM media_events me
			 WHERE me.user_id IN (${placeholders})
			   AND me.event_type IN ('complete', 'like', 'favorite')
			   ${typeFilter}
			   AND me.timestamp > ?
			 ORDER BY me.timestamp DESC
			 LIMIT 50`
		).all(...friendEventParams) as Array<{
			media_id: string;
			media_type: string;
			media_title: string | null;
			media_year: number | null;
			media_genres: string | null;
		}>;

		for (const item of friendLiked) {
			if (consumed.has(item.media_id) || ctx.excludeIds.has(item.media_id) || seen.has(item.media_id)) continue;
			seen.add(item.media_id);

			let genres: string[] = [];
			try { genres = item.media_genres ? JSON.parse(item.media_genres) : []; } catch { /* */ }
			if (ctx.profile.genreBans?.some((ban) => genres.includes(ban))) continue;

			const cached = raw.prepare(
				`SELECT * FROM media_items WHERE source_id = ? LIMIT 1`
			).get(item.media_id) as any;

			results.push({
				item: cached
					? {
							id: cached.id,
							sourceId: cached.source_id,
							serviceId: cached.service_id,
							serviceType: 'jellyfin',
							type: cached.type,
							title: cached.title,
							description: cached.description ?? undefined,
							poster: cached.poster ?? undefined,
							backdrop: cached.backdrop ?? undefined,
							year: cached.year ?? undefined,
							rating: cached.rating ?? undefined,
							genres: cached.genres ? JSON.parse(cached.genres) : genres,
							duration: cached.duration ?? undefined
					  }
					: {
							id: `${item.media_id}:social`,
							sourceId: item.media_id,
							serviceId: '',
							serviceType: 'unknown',
							type: item.media_type as any,
							title: item.media_title ?? 'Unknown',
							year: item.media_year ?? undefined,
							genres
					  },
				score: 0.5,
				confidence: 0.6,
				provider: 'social',
				reason: `Liked by your friends`,
				reasonType: 'friend_watched'
			});
		}

		// 3. Items in friends' collections (signal: 0.6)
		const friendCollections = raw.prepare(
			`SELECT ci.media_id, ci.media_type, ci.media_title, ci.media_poster, ci.service_id
			 FROM collection_items ci
			 JOIN collections c ON c.id = ci.collection_id
			 WHERE c.creator_id IN (${placeholders}) AND c.visibility IN ('friends', 'public')
			 ORDER BY ci.created_at DESC LIMIT 30`
		).all(...friendIds) as Array<{
			media_id: string;
			media_type: string;
			media_title: string;
			media_poster: string | null;
			service_id: string;
		}>;

		for (const item of friendCollections) {
			if (consumed.has(item.media_id) || ctx.excludeIds.has(item.media_id) || seen.has(item.media_id)) continue;
			if (ctx.mediaType && item.media_type !== ctx.mediaType) continue;
			seen.add(item.media_id);

			results.push({
				item: {
					id: `${item.media_id}:${item.service_id}`,
					sourceId: item.media_id,
					serviceId: item.service_id,
					serviceType: 'social',
					type: item.media_type as any,
					title: item.media_title,
					poster: item.media_poster ?? undefined
				},
				score: 0.6,
				confidence: 0.5,
				provider: 'social',
				reason: `In a friend's collection`,
				reasonType: 'friend_shared'
			});
		}

		return results.sort((a, b) => b.score - a.score).slice(0, ctx.limit);
	}
};

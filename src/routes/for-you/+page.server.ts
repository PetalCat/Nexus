import { getRecommendations } from '$lib/server/recommendations/aggregator';
import { recRegistry } from '$lib/server/recommendations/registry';
import { getRawDb } from '$lib/db';
import { DEFAULT_PROFILE } from '$lib/server/recommendations/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	if (!userId) return { rows: [], providers: [] };

	const raw = getRawDb();

	// Get user's profile
	const profileRow = raw.prepare(
		`SELECT config FROM user_rec_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1`
	).get(userId) as { config: string } | undefined;
	const profile = profileRow?.config
		? { ...DEFAULT_PROFILE, ...JSON.parse(profileRow.config) }
		: DEFAULT_PROFILE;

	// Get all available profiles
	const profiles = raw.prepare(
		`SELECT id, name, is_default FROM user_rec_profiles WHERE user_id = ? ORDER BY is_default DESC`
	).all(userId) as Array<{ id: string; name: string; is_default: number }>;

	// Provider status
	const ctx = { userId, limit: 0, profile, excludeIds: new Set<string>() };
	const providers = recRegistry.all().map((p) => ({
		id: p.id,
		displayName: p.displayName,
		category: p.category,
		ready: p.isReady(ctx)
	}));

	// Fetch recommendations by type
	const [movieRecs, showRecs] = await Promise.allSettled([
		getRecommendations(userId, 'movie', 30),
		getRecommendations(userId, 'show', 30)
	]);

	const movies = movieRecs.status === 'fulfilled' ? movieRecs.value : [];
	const shows = showRecs.status === 'fulfilled' ? showRecs.value : [];

	// Build categorized rows
	type Row = { id: string; title: string; subtitle?: string; items: any[] };
	const rows: Row[] = [];

	// Top pick hero
	const topRec = [...movies, ...shows].sort((a, b) => b.score - a.score)[0] ?? null;

	// Group by reason type
	const genreMatches = [...movies, ...shows].filter((r) => r.reasonType === 'genre_match');
	const friendRecs = [...movies, ...shows].filter((r) => r.reasonType === 'friend_shared' || r.reasonType === 'friend_watched');
	const trendingRecs = [...movies, ...shows].filter((r) => r.reasonType === 'trending');
	const timeRecs = [...movies, ...shows].filter((r) => r.reasonType === 'time_pattern');

	if (movies.length > 0) {
		rows.push({
			id: 'for-you-movies',
			title: 'For You — Movies',
			subtitle: 'Personalized movie picks',
			items: movies.map((r) => ({
				...r.item,
				metadata: { ...r.item.metadata, recReason: r.reason, recScore: r.score, recProvider: r.provider }
			}))
		});
	}

	if (shows.length > 0) {
		rows.push({
			id: 'for-you-shows',
			title: 'For You — Shows',
			subtitle: 'Personalized show picks',
			items: shows.map((r) => ({
				...r.item,
				metadata: { ...r.item.metadata, recReason: r.reason, recScore: r.score, recProvider: r.provider }
			}))
		});
	}

	if (friendRecs.length > 0) {
		rows.push({
			id: 'friend-recs',
			title: 'From Your Friends',
			subtitle: 'What people in your circle are watching',
			items: friendRecs.map((r) => ({
				...r.item,
				metadata: { ...r.item.metadata, recReason: r.reason, recScore: r.score }
			}))
		});
	}

	if (trendingRecs.length > 0) {
		rows.push({
			id: 'trending-recs',
			title: 'Trending Now',
			subtitle: 'Popular across Nexus right now',
			items: trendingRecs.map((r) => ({
				...r.item,
				metadata: { ...r.item.metadata, recReason: r.reason, recScore: r.score }
			}))
		});
	}

	if (genreMatches.length > 0) {
		// Group by top genre for "Because you like X" rows
		const byGenre = new Map<string, typeof genreMatches>();
		for (const r of genreMatches) {
			const basedGenre = r.basedOn?.[0] ?? 'your favorites';
			if (!byGenre.has(basedGenre)) byGenre.set(basedGenre, []);
			byGenre.get(basedGenre)!.push(r);
		}

		for (const [genre, recs] of byGenre) {
			if (recs.length < 3) continue;
			rows.push({
				id: `genre-${genre.toLowerCase().replace(/\s/g, '-')}`,
				title: `Because You Like ${genre}`,
				items: recs.slice(0, 20).map((r) => ({
					...r.item,
					metadata: { ...r.item.metadata, recReason: r.reason, recScore: r.score }
				}))
			});
		}
	}

	if (timeRecs.length > 0) {
		rows.push({
			id: 'right-time',
			title: 'Perfect for Right Now',
			subtitle: 'Based on what you usually watch at this time',
			items: timeRecs.map((r) => ({
				...r.item,
				metadata: { ...r.item.metadata, recReason: r.reason, recScore: r.score }
			}))
		});
	}

	return {
		rows,
		hero: topRec
			? {
					...topRec.item,
					metadata: { ...topRec.item.metadata, recReason: topRec.reason, recProvider: topRec.provider }
			  }
			: null,
		providers,
		profiles: profiles.map((p) => ({ id: p.id, name: p.name, isDefault: !!p.is_default })),
		activeProfile: profile
	};
};

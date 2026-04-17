import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const mediaId = url.searchParams.get('mediaId');
	const mediaType = url.searchParams.get('type') ?? undefined;
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '12', 10), 50);

	if (!mediaId) return json({ error: 'mediaId required' }, { status: 400 });

	const raw = getRawDb();

	// Look up the source media item
	const source = raw.prepare(
		`SELECT * FROM media_items WHERE source_id = ? LIMIT 1`
	).get(mediaId) as any;

	if (!source) return json({ error: 'Media item not found' }, { status: 404 });

	let sourceGenres: string[] = [];
	try { sourceGenres = source.genres ? JSON.parse(source.genres) : []; } catch { /* */ }
	const sourceYear: number | null = source.year ?? null;
	const sourceType: string = mediaType ?? source.type;

	// Find similar items: same type, overlapping genres, similar year range
	const typeFilter = sourceType ? `AND type = ?` : '';
	const params: (string | number)[] = [];
	if (sourceType) params.push(sourceType);

	const candidates = raw.prepare(
		`SELECT * FROM media_items WHERE source_id != ? AND genres IS NOT NULL ${typeFilter}
		 ORDER BY cached_at DESC LIMIT 500`
	).all(mediaId, ...params) as any[];

	const scored: Array<{ item: any; score: number; genreOverlap: number }> = [];

	for (const c of candidates) {
		let genres: string[] = [];
		try { genres = JSON.parse(c.genres); } catch { continue; }

		// Count genre overlap
		const overlapCount = genres.filter((g: string) => sourceGenres.includes(g)).length;
		if (overlapCount === 0) continue;

		// Year proximity bonus (0 to 1, max when within 5 years)
		let yearBonus = 0.5;
		if (sourceYear != null && c.year != null) {
			const diff = Math.abs(c.year - sourceYear);
			yearBonus = diff <= 5 ? 1.0 : Math.max(0, 1.0 - (diff - 5) / 20);
		}

		const score = overlapCount * 0.7 + yearBonus * 0.3;
		scored.push({
			item: {
				id: c.id,
				sourceId: c.source_id,
				serviceId: c.service_id,
				serviceType: 'jellyfin',
				type: c.type,
				title: c.title,
				description: c.description ?? undefined,
				poster: c.poster ?? undefined,
				backdrop: c.backdrop ?? undefined,
				year: c.year ?? undefined,
				rating: c.rating ?? undefined,
				genres,
				duration: c.duration ?? undefined
			},
			score,
			genreOverlap: overlapCount
		});
	}

	scored.sort((a, b) => b.score - a.score);
	const top = scored.slice(0, limit);

	return json({
		similar: top.map((r) => ({
			item: r.item,
			score: r.score,
			reason: `${r.genreOverlap} shared genre${r.genreOverlap > 1 ? 's' : ''}`,
			provider: 'content-similar'
		}))
	});
};

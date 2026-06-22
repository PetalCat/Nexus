import { withStaleCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

// Missing-art fallback. When a backend has no artwork for an item, fetch a cover
// from a free external source by metadata. v1 = the iTunes Search API (no key
// required) for music + albums — the real gap, since Jellyfin movies/shows
// almost always already carry posters. Video fallback (TMDb) is a follow-up
// (needs an API key). Server-side fetch keeps the viewer's IP off Apple's CDN
// and lets us cache; the proxy tries Jellyfin first, this only fires on a gap.

const FRESH = 24 * 60 * 60 * 1000; // cache a found cover 1 day
const STALE = 7 * 24 * 60 * 60 * 1000;

type Art = { ok: true; body: ArrayBuffer; contentType: string } | { ok: false };

async function fetchItunesArt(term: string, entity: string): Promise<Art> {
	try {
		const search = await fetch(
			`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=1`,
			{ signal: AbortSignal.timeout(8000) }
		);
		if (!search.ok) return { ok: false };
		const data = (await search.json()) as { results?: Array<{ artworkUrl100?: string }> };
		const small = data.results?.[0]?.artworkUrl100;
		if (!small) return { ok: false };
		// iTunes returns 100×100; swap the segment for a larger render.
		const big = small.replace('100x100bb', '600x600bb');
		const img = await fetch(big, { signal: AbortSignal.timeout(10_000) });
		if (!img.ok) return { ok: false };
		return {
			ok: true,
			body: await img.arrayBuffer(),
			contentType: img.headers.get('Content-Type') ?? 'image/jpeg'
		};
	} catch {
		return { ok: false };
	}
}

export const GET: RequestHandler = async ({ url }) => {
	const type = url.searchParams.get('type') ?? '';
	const title = (url.searchParams.get('title') ?? '').trim();
	const artist = (url.searchParams.get('artist') ?? '').trim();
	if (!title) return new Response('Missing title', { status: 400 });
	// v1: music/album only.
	if (type !== 'album' && type !== 'music') {
		return new Response('No fallback for this type', { status: 404 });
	}

	const entity = type === 'music' ? 'musicTrack' : 'album';
	const term = [artist, title].filter(Boolean).join(' ');
	// Negative results get a short TTL so newly-tagged items recover quickly;
	// found covers cache for a day.
	const art = await withStaleCache<Art>(
		`art:${entity}:${term.toLowerCase()}`,
		(v: Art) => (v.ok ? FRESH : 5 * 60 * 1000),
		STALE,
		() => fetchItunesArt(term, entity)
	);

	if (!art.ok) return new Response('Art not found', { status: 404 });
	return new Response(art.body, {
		headers: {
			'Content-Type': art.contentType,
			'Cache-Control': 'private, max-age=604800'
		}
	});
};

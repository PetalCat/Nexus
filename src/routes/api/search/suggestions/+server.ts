import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getDb, getRawDb, schema } from '$lib/db';
import { eq, desc } from 'drizzle-orm';

// GET /api/search/suggestions?q=xxx
// Returns suggestions from multiple sources (deduped, max 10)
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const query = url.searchParams.get('q')?.trim();
	if (!query || query.length < 1) {
		return json({ suggestions: [] });
	}

	const allSuggestions: string[] = [];

	// 1. Invidious search suggestions (if enabled)
	const invConfigs = getConfigsForMediaType('video');
	if (invConfigs.length > 0) {
		try {
			const adapter = registry.get(invConfigs[0].type);
			const result = await adapter?.getServiceData?.(invConfigs[0], 'search-suggestions', { query }) as { suggestions?: string[] } | null;
			if (result?.suggestions) {
				allSuggestions.push(...result.suggestions);
			}
		} catch {
			// Invidious suggestions are best-effort
		}
	}

	// 2. Recent search terms from interaction_events
	const db = getDb();
	const recentSearches = db
		.select({ query: schema.interactionEvents.searchQuery })
		.from(schema.interactionEvents)
		.where(eq(schema.interactionEvents.eventType, 'search'))
		.orderBy(desc(schema.interactionEvents.timestamp))
		.limit(100)
		.all();

	const queryLower = query.toLowerCase();
	for (const row of recentSearches) {
		if (row.query && row.query.toLowerCase().startsWith(queryLower)) {
			allSuggestions.push(row.query);
		}
	}

	// 3. Title prefix matches from recent play_sessions
	const raw = getRawDb();
	const recentMedia = raw.prepare(
		`SELECT DISTINCT media_title FROM play_sessions
		 WHERE media_title LIKE ? || '%'
		 ORDER BY started_at DESC LIMIT 20`
	).all(query) as Array<{ media_title: string | null }>;

	for (const row of recentMedia) {
		if (row.media_title) {
			allSuggestions.push(row.media_title);
		}
	}

	// Dedupe (case-insensitive) and limit to 10
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const s of allSuggestions) {
		const key = s.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			deduped.push(s);
			if (deduped.length >= 10) break;
		}
	}

	return json({ suggestions: deduped });
};

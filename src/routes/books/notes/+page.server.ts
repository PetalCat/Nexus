import { error } from '@sveltejs/kit';
import { getDb, schema } from '$lib/db';
import { eq, desc } from 'drizzle-orm';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { PageServerLoad } from './$types';
import type { UnifiedMedia } from '$lib/adapters/types';

type HL = typeof schema.bookHighlights.$inferSelect;
type NT = typeof schema.bookNotes.$inferSelect;
type BookRef = { id: string; title: string; author?: string; poster?: string | null };
type Group = { book: BookRef; bookId: string; highlights: HL[]; notes: NT[]; total: number };

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Login required');
	const db = getDb();
	const userId = locals.user.id;

	const highlights = db.select().from(schema.bookHighlights)
		.where(eq(schema.bookHighlights.userId, userId))
		.orderBy(desc(schema.bookHighlights.createdAt))
		.all();

	const notes = db.select().from(schema.bookNotes)
		.where(eq(schema.bookNotes.userId, userId))
		.orderBy(desc(schema.bookNotes.updatedAt))
		.all();

	// Group by bookId
	const byId = new Map<string, Group>();
	for (const h of highlights) {
		const g = byId.get(h.bookId) ?? { book: { id: h.bookId, title: h.bookId }, bookId: h.bookId, highlights: [], notes: [], total: 0 };
		g.highlights.push(h);
		g.total++;
		byId.set(h.bookId, g);
	}
	for (const n of notes) {
		const g = byId.get(n.bookId) ?? { book: { id: n.bookId, title: n.bookId }, bookId: n.bookId, highlights: [], notes: [], total: 0 };
		g.notes.push(n);
		g.total++;
		byId.set(n.bookId, g);
	}

	// Enrich with Calibre metadata (best-effort)
	const calibreConfig = getConfigsForMediaType('book')[0];
	if (calibreConfig) {
		const userCred = getUserCredentialForService(userId, calibreConfig.id) ?? undefined;
		const adapter = registry.get(calibreConfig.type);
		if (adapter?.getServiceData) {
			try {
				const allBooks = (await adapter.getServiceData(calibreConfig, 'all', {}, userCred) as UnifiedMedia[]) ?? [];
				const bookMap = new Map(allBooks.map(b => [b.sourceId, b]));
				for (const g of byId.values()) {
					const b = bookMap.get(g.bookId);
					if (b) g.book = { id: b.id, title: b.title, author: b.metadata?.author as string | undefined, poster: b.poster };
				}
			} catch { /* optional enrichment — page still renders without Calibre */ }
		}
	}

	// Sort groups by total desc, then cap per-group items at 8 (favorites first via note!=null, then newest)
	const groups = Array.from(byId.values())
		.sort((a, b) => b.total - a.total)
		.map(g => ({
			...g,
			highlights: g.highlights
				.sort((a, b) => (b.note ? 1 : 0) - (a.note ? 1 : 0) || b.createdAt - a.createdAt)
				.slice(0, 8),
			notes: g.notes.slice(0, 8)
		}));

	// Tag cloud from highlight.color
	const tagMap = new Map<string, number>();
	for (const h of highlights) {
		const t = h.color ?? 'yellow';
		tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
	}
	const tagCloud = Array.from(tagMap.entries())
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count);

	return {
		groups,
		totalHighlights: highlights.length,
		totalNotes: notes.length,
		totalBooks: groups.length,
		tagCloud,
		thisYear: highlights.filter(h => h.createdAt >= new Date(new Date().getFullYear(), 0, 1).getTime()).length
	};
};

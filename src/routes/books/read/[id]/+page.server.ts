import { error } from '@sveltejs/kit';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getDb, schema } from '$lib/db';
import { eq, and, desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401, 'Login required');
	const userId = locals.user.id;

	const serviceId = url.searchParams.get('service');
	const bookConfigs = getConfigsForMediaType('book');
	const calibreConfig = serviceId
		? bookConfigs.find(c => c.id === serviceId)
		: bookConfigs[0];

	if (!calibreConfig) throw error(404, 'No Calibre service configured');

	const adapter = registry.get('calibre');
	if (!adapter?.getItem) throw error(500, 'Calibre adapter not available');
	const userCred = getUserCredentialForService(userId, calibreConfig.id) ?? undefined;

	const item = await adapter.getItem(calibreConfig, params.id, userCred);
	if (!item) throw error(404, 'Book not found');

	const db = getDb();

	const sessionRow = db.select().from(schema.playSessions)
		.where(and(
			eq(schema.playSessions.userId, userId),
			eq(schema.playSessions.mediaId, params.id),
			eq(schema.playSessions.serviceId, calibreConfig.id),
			eq(schema.playSessions.mediaType, 'book')
		))
		.orderBy(desc(schema.playSessions.updatedAt))
		.get();

	const bookmarks = db.select().from(schema.bookBookmarks)
		.where(and(
			eq(schema.bookBookmarks.userId, userId),
			eq(schema.bookBookmarks.bookId, params.id),
			eq(schema.bookBookmarks.serviceId, calibreConfig.id)
		))
		.orderBy(desc(schema.bookBookmarks.createdAt))
		.all();

	const highlights = db.select().from(schema.bookHighlights)
		.where(and(
			eq(schema.bookHighlights.userId, userId),
			eq(schema.bookHighlights.bookId, params.id),
			eq(schema.bookHighlights.serviceId, calibreConfig.id)
		))
		.all();

	// Resume position (EPUB CFI or PDF page) lives in play_sessions.position.
	const savedPosition: string | undefined = sessionRow?.position ?? undefined;

	// Determine format to read — default to EPUB, allow ?format=pdf etc
	const requestedFormat = (url.searchParams.get('format') ?? 'epub').toLowerCase();
	const availableFormats = (item.metadata?.formats as string[]) ?? [];
	const format = availableFormats.map(f => f.toLowerCase()).includes(requestedFormat) ? requestedFormat : 'epub';
	const bookUrl = format === 'epub'
		? `/api/books/${params.id}/read`
		: `/api/books/${params.id}/download/${format}?view=true`;

	return {
		book: item,
		serviceId: calibreConfig.id,
		bookUrl,
		format,
		availableFormats: availableFormats.map(f => f.toLowerCase()),
		savedPosition,
		progress: sessionRow?.progress ?? 0,
		bookmarks,
		highlights
	};
};

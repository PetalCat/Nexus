import { error } from '@sveltejs/kit';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getDb, schema } from '$lib/db';
import { eq, and, desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401, 'Login required');
	const userId = locals.user.id;

	const serviceId = url.searchParams.get('service');
	const configs = getEnabledConfigs();
	const calibreConfig = serviceId
		? configs.find(c => c.id === serviceId && c.type === 'calibre')
		: configs.find(c => c.type === 'calibre');

	if (!calibreConfig) throw error(404, 'No Calibre service configured');

	const adapter = registry.get('calibre');
	if (!adapter?.getItem) throw error(500, 'Calibre adapter not available');
	const userCred = getUserCredentialForService(userId, calibreConfig.id) ?? undefined;

	const item = await adapter.getItem(calibreConfig, params.id, userCred);
	if (!item) throw error(404, 'Book not found');

	const db = getDb();

	const activityRow = db.select().from(schema.activity)
		.where(and(
			eq(schema.activity.userId, userId),
			eq(schema.activity.mediaId, params.id),
			eq(schema.activity.type, 'read')
		))
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

	// CFI is stored in the progress endpoint's metadata — we don't have a metadata column on activity,
	// so we fetch it from the progress API pattern. For now, use the activity row if it exists.
	const savedPosition: string | undefined = undefined;

	// Determine format to read — default to EPUB, allow ?format=pdf etc
	const requestedFormat = (url.searchParams.get('format') ?? 'epub').toLowerCase();
	const availableFormats = (item.metadata?.formats as string[]) ?? [];
	const format = availableFormats.map(f => f.toLowerCase()).includes(requestedFormat) ? requestedFormat : 'epub';
	const bookUrl = format === 'epub'
		? `/api/books/${params.id}/read`
		: `/api/books/${params.id}/download/${format}`;

	return {
		book: item,
		serviceId: calibreConfig.id,
		bookUrl,
		format,
		availableFormats: availableFormats.map(f => f.toLowerCase()),
		savedPosition,
		progress: activityRow?.progress ?? 0,
		bookmarks,
		highlights
	};
};

import { redirect } from '@sveltejs/kit';
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw redirect(302, '/login');

	if (url.pathname === '/activity' || url.pathname === '/activity/') {
		throw redirect(302, '/activity/insights');
	}

	const db = getDb();
	const ssService = db
		.select({ id: schema.services.id })
		.from(schema.services)
		.where(eq(schema.services.type, 'streamystats'))
		.limit(1)
		.all();
	const hasStreamyStats = ssService.length > 0;

	return { hasStreamyStats };
};

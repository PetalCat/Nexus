import { queryMediaEvents, countMediaEvents } from '$lib/server/analytics';
import { getDb, schema } from '$lib/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;

	const events = queryMediaEvents({
		userId,
		limit: 50,
		offset: 0
	});

	const total = countMediaEvents({ userId });

	const db = getDb();
	const serviceRows = db
		.select({ id: schema.services.id, name: schema.services.name, type: schema.services.type })
		.from(schema.services)
		.all();
	const services = serviceRows.map((s) => ({ id: s.id, name: s.name, type: s.type }));

	return { events, total, services };
};

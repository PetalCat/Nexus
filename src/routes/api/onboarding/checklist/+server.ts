import { json } from '@sveltejs/kit';
import { snoozeChecklist, dismissChecklist, resetChecklist } from '$lib/server/onboarding';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) {
		return json({ error: 'Admin only' }, { status: 403 });
	}

	const body = await request.json();
	const action = body.action as string;

	switch (action) {
		case 'snooze':
			snoozeChecklist();
			return json({ ok: true });
		case 'dismiss':
			dismissChecklist();
			return json({ ok: true });
		case 'reset':
			resetChecklist();
			return json({ ok: true });
		default:
			return json({ error: 'Unknown action' }, { status: 400 });
	}
};

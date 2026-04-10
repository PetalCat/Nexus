import { json } from '@sveltejs/kit';
import { snoozeChecklist, dismissChecklist, resetChecklist } from '$lib/server/onboarding';
import { setSetting } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const action = body.action as string;

	// setStep and complete are allowed during setup before full auth is established
	if (action === 'setStep') {
		const step = parseInt(body.step, 10);
		if (!isNaN(step) && step >= 0 && step <= 4) {
			setSetting('onboarding_step', String(step));
		}
		return json({ ok: true });
	}

	if (action === 'complete') {
		setSetting('onboarding_step', '4');
		setSetting('onboarding_complete', 'true');
		return json({ ok: true });
	}

	if (!locals.user?.isAdmin) {
		return json({ error: 'Admin only' }, { status: 403 });
	}

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

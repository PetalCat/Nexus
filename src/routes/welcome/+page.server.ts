/**
 * /welcome — non-admin first-run flow.
 *
 * Runs automatically once per user after they log in, if their users row
 * has welcomeCompletedAt = NULL. Walks them through linking their personal
 * credentials on every registered user-linkable service the admin has set
 * up. Admin users never see this page — they go through /setup instead.
 *
 * See docs/superpowers/specs/2026-04-14-service-account-umbrella-design.md
 * section "Onboarding narratives" for the design rationale.
 */

import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '$lib/db';
import { buildAccountServiceSummariesForType } from '$lib/server/account-services';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import type { AccountServiceSummary } from '$lib/components/account-linking/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw redirect(303, '/login');

	// Already completed? Allow force re-run via ?force=1 so users can re-enter
	// the flow from Settings → Linked accounts → "Run onboarding again".
	const db = getDb();
	const force = url.searchParams.get('force') === '1';
	const row = db
		.select({ welcomeCompletedAt: schema.users.welcomeCompletedAt, isAdmin: schema.users.isAdmin })
		.from(schema.users)
		.where(eq(schema.users.id, locals.user.id))
		.get();

	if (!row) throw redirect(303, '/login');
	if (row.isAdmin) {
		// Admins go through /setup, not /welcome — redirect them home.
		throw redirect(303, '/');
	}
	if (row.welcomeCompletedAt && !force) {
		throw redirect(303, '/');
	}

	// Build summaries for every registered user-linkable service the admin
	// has set up. These become the cards in the wizard's connection step.
	const configs = getEnabledConfigs();
	const linkableSummaries: AccountServiceSummary[] = [];
	for (const config of configs) {
		const adapter = registry.get(config.type);
		if (!adapter?.capabilities?.userAuth?.userLinkable) continue;
		const summaries = buildAccountServiceSummariesForType(locals.user.id, config.type);
		for (const s of summaries) {
			if (s.id === config.id) linkableSummaries.push(s);
		}
	}

	return {
		linkableSummaries,
		displayName: locals.user.displayName ?? locals.user.username ?? 'there'
	};
};

export const actions: Actions = {
	complete: async ({ locals }) => {
		if (!locals.user) throw redirect(303, '/login');
		const db = getDb();
		db.update(schema.users)
			.set({ welcomeCompletedAt: new Date().toISOString() })
			.where(eq(schema.users.id, locals.user.id))
			.run();
		throw redirect(303, '/');
	}
};

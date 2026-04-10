import { getSetting, setSetting } from './auth';
import { getEnabledConfigs } from './services';
import { registry } from '$lib/adapters/registry';
import type { OnboardingCategory } from '$lib/adapters/base';

export type ChecklistStatus = 'active' | 'snoozed' | 'dismissed';

export interface ChecklistState {
	status: ChecklistStatus;
	snoozedUntil: string | null;
	completedCategories: OnboardingCategory[];
	totalOnboardable: number;
}

export interface MissingCategory {
	category: OnboardingCategory;
	adapterName: string;
	description: string;
}

/**
 * Get the current state of the Getting Started checklist.
 * Cross-references the adapter registry with saved service configs.
 */
export function getChecklistState(): ChecklistState {
	const status = (getSetting('onboarding_checklist_status') ?? 'active') as ChecklistStatus;
	const snoozedUntil = getSetting('onboarding_checklist_snoozed_until');

	const configs = getEnabledConfigs();
	const connectedTypes = new Set(configs.map((c) => c.type));

	const onboardable = registry.onboardable();
	const categories = new Set(onboardable.map((a) => a.onboarding!.category));

	const completedCategories: OnboardingCategory[] = [];
	for (const cat of categories) {
		const adaptersInCategory = onboardable.filter((a) => a.onboarding!.category === cat);
		const hasConnected = adaptersInCategory.some((a) => connectedTypes.has(a.id));
		if (hasConnected) completedCategories.push(cat);
	}

	return {
		status,
		snoozedUntil,
		completedCategories,
		totalOnboardable: categories.size,
	};
}

/**
 * Check if the checklist should be visible right now.
 */
export function isChecklistVisible(): boolean {
	const state = getChecklistState();
	if (state.status === 'dismissed') return false;
	if (state.status === 'snoozed' && state.snoozedUntil) {
		return new Date() > new Date(state.snoozedUntil);
	}
	return true;
}

/**
 * Snooze the checklist for 7 days.
 */
export function snoozeChecklist(): void {
	setSetting('onboarding_checklist_status', 'snoozed');
	const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
	setSetting('onboarding_checklist_snoozed_until', until);
}

/**
 * Permanently dismiss the checklist.
 */
export function dismissChecklist(): void {
	setSetting('onboarding_checklist_status', 'dismissed');
}

/**
 * Reset the checklist to active (used from admin settings).
 */
export function resetChecklist(): void {
	setSetting('onboarding_checklist_status', 'active');
	setSetting('onboarding_checklist_snoozed_until', '');
}

/**
 * Given a list of needed onboarding categories for a page, return
 * the ones that have no connected services.
 */
export function getMissingCategories(needed: OnboardingCategory[]): MissingCategory[] {
	const configs = getEnabledConfigs();
	const connectedTypes = new Set(configs.map((c) => c.type));

	const missing: MissingCategory[] = [];
	for (const cat of needed) {
		const adapters = registry.byOnboardingCategory(cat);
		const hasConnected = adapters.some((a) => connectedTypes.has(a.id));
		if (!hasConnected && adapters.length > 0) {
			const first = adapters[0];
			missing.push({
				category: cat,
				adapterName: first.displayName,
				description: first.onboarding!.description,
			});
		}
	}
	return missing;
}

# Onboarding Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare-bones setup page with a guided wizard, homepage checklist, and contextual hints — all driven by adapter registry metadata.

**Architecture:** Extend `ServiceAdapter` with an optional `onboarding` block. The setup wizard reads the registry to build its service cards dynamically. The homepage checklist cross-references the registry with saved configs to show completion state. Contextual hints on empty-state pages declare needed adapter categories and render a `SetupHint` when those categories have no connected services.

**Tech Stack:** SvelteKit, Drizzle ORM (SQLite), existing Nexus CSS variables and component patterns.

**Spec:** `docs/superpowers/specs/2026-04-10-onboarding-redesign-design.md`

---

### Task 1: Extend ServiceAdapter Interface with Onboarding Metadata

**Files:**
- Modify: `src/lib/adapters/base.ts` (add `onboarding` to interface)

- [ ] **Step 1: Add the onboarding type and field to ServiceAdapter**

In `src/lib/adapters/base.ts`, add before the `ServiceAdapter` interface:

```ts
export type OnboardingCategory =
	| 'media-server'
	| 'automation'
	| 'requests'
	| 'subtitles'
	| 'analytics'
	| 'video'
	| 'games'
	| 'books'
	| 'indexer';

export interface OnboardingMeta {
	category: OnboardingCategory;
	description: string;
	priority: number;
	icon?: string;
	requiredFields: ('url' | 'apiKey' | 'username' | 'password')[];
	supportsAutoAuth?: boolean;
}
```

Then add to the `ServiceAdapter` interface, after `authUsernameLabel`:

```ts
readonly onboarding?: OnboardingMeta;
```

- [ ] **Step 2: Export the new types from registry**

In `src/lib/adapters/registry.ts`, update the export line:

```ts
export type { ServiceAdapter, OnboardingCategory, OnboardingMeta };
```

- [ ] **Step 3: Add registry helper for onboarding queries**

In `src/lib/adapters/registry.ts`, add to the `AdapterRegistry` class:

```ts
/** Adapters with onboarding metadata, grouped by category */
onboardable(): ServiceAdapter[] {
	return this.all().filter((a) => a.onboarding);
}

/** Adapters in a specific onboarding category */
byOnboardingCategory(category: OnboardingCategory): ServiceAdapter[] {
	return this.all().filter((a) => a.onboarding?.category === category);
}
```

Import `OnboardingCategory` at the top:

```ts
import type { ServiceAdapter, OnboardingCategory } from './base';
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/adapters/base.ts src/lib/adapters/registry.ts
git commit -m "feat(adapters): add onboarding metadata to ServiceAdapter interface"
```

---

### Task 2: Add Onboarding Metadata to All Adapters

**Files:**
- Modify: `src/lib/adapters/jellyfin.ts`
- Modify: `src/lib/adapters/plex.ts`
- Modify: `src/lib/adapters/radarr.ts`
- Modify: `src/lib/adapters/sonarr.ts`
- Modify: `src/lib/adapters/lidarr.ts`
- Modify: `src/lib/adapters/overseerr.ts`
- Modify: `src/lib/adapters/bazarr.ts`
- Modify: `src/lib/adapters/streamystats.ts`
- Modify: `src/lib/adapters/invidious.ts`
- Modify: `src/lib/adapters/romm.ts`
- Modify: `src/lib/adapters/calibre.ts`
- Modify: `src/lib/adapters/prowlarr.ts`

- [ ] **Step 1: Add onboarding to Jellyfin adapter**

Find the `jellyfinAdapter` export object and add:

```ts
onboarding: {
	category: 'media-server',
	description: 'Stream your movies, shows, and music library',
	priority: 1,
	requiredFields: ['url', 'username', 'password'],
	supportsAutoAuth: true,
},
```

- [ ] **Step 2: Add onboarding to Plex adapter**

```ts
onboarding: {
	category: 'media-server',
	description: 'Stream your Plex media library',
	priority: 2,
	requiredFields: ['url', 'username', 'password'],
	supportsAutoAuth: true,
},
```

- [ ] **Step 3: Add onboarding to Radarr adapter**

```ts
onboarding: {
	category: 'automation',
	description: 'Manage and monitor your movie collection',
	priority: 1,
	requiredFields: ['url', 'apiKey'],
},
```

- [ ] **Step 4: Add onboarding to Sonarr adapter**

```ts
onboarding: {
	category: 'automation',
	description: 'Manage and monitor your TV show collection',
	priority: 2,
	requiredFields: ['url', 'apiKey'],
},
```

- [ ] **Step 5: Add onboarding to Lidarr adapter**

```ts
onboarding: {
	category: 'automation',
	description: 'Manage and monitor your music collection',
	priority: 3,
	requiredFields: ['url', 'apiKey'],
},
```

- [ ] **Step 6: Add onboarding to Overseerr adapter**

```ts
onboarding: {
	category: 'requests',
	description: 'Let users request movies and shows',
	priority: 1,
	requiredFields: ['url', 'apiKey'],
},
```

Note: The Seerr registration in `registry.ts` uses spread (`{ ...overseerrAdapter, ... }`), so it will inherit the onboarding block. Update the spread to override the description:

In `registry.ts`, change the seerr registration:

```ts
.register({ ...overseerrAdapter, id: 'seerr', displayName: 'Seerr', color: '#6366f1', abbreviation: 'SR', onboarding: { ...overseerrAdapter.onboarding!, description: 'Let users request movies and shows' } })
```

- [ ] **Step 7: Add onboarding to Bazarr adapter**

```ts
onboarding: {
	category: 'subtitles',
	description: 'Manage subtitles across your library',
	priority: 1,
	requiredFields: ['url', 'apiKey'],
},
```

- [ ] **Step 8: Add onboarding to StreamyStats adapter**

```ts
onboarding: {
	category: 'analytics',
	description: 'Track viewing activity and statistics',
	priority: 1,
	requiredFields: ['url'],
},
```

- [ ] **Step 9: Add onboarding to Invidious adapter**

```ts
onboarding: {
	category: 'video',
	description: 'Privacy-friendly video streaming with ad-blocking',
	priority: 1,
	requiredFields: ['url'],
},
```

- [ ] **Step 10: Add onboarding to RomM adapter**

```ts
onboarding: {
	category: 'games',
	description: 'Browse and play your retro game collection',
	priority: 1,
	requiredFields: ['url', 'username', 'password'],
	supportsAutoAuth: true,
},
```

- [ ] **Step 11: Add onboarding to Calibre-Web adapter**

```ts
onboarding: {
	category: 'books',
	description: 'Read books, take notes, and track reading progress',
	priority: 1,
	requiredFields: ['url', 'username', 'password'],
	supportsAutoAuth: true,
},
```

- [ ] **Step 12: Add onboarding to Prowlarr adapter**

```ts
onboarding: {
	category: 'indexer',
	description: 'Unified indexer management for automation services',
	priority: 1,
	requiredFields: ['url', 'apiKey'],
},
```

- [ ] **Step 13: Commit**

```bash
git add src/lib/adapters/*.ts
git commit -m "feat(adapters): add onboarding metadata to all adapters"
```

---

### Task 3: Create Onboarding Server Helpers

**Files:**
- Create: `src/lib/server/onboarding.ts`

- [ ] **Step 1: Create onboarding server module**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/onboarding.ts
git commit -m "feat(server): add onboarding helpers for checklist state and missing categories"
```

---

### Task 4: Rewrite Setup Wizard — Server

**Files:**
- Modify: `src/routes/setup/+page.server.ts`

- [ ] **Step 1: Rewrite the setup server to support wizard steps**

The wizard uses client-side step transitions, but the server handles two form actions: account creation and service connection.

```ts
import { fail, redirect } from '@sveltejs/kit';
import { COOKIE_NAME, createSession, createUser, getUserCount } from '$lib/server/auth';
import { upsertService } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	if (getUserCount() > 0) {
		throw redirect(303, '/');
	}

	// Build adapter list for service selection steps
	const adapters = registry.onboardable().map((a) => ({
		id: a.id,
		displayName: a.displayName,
		color: a.color ?? '#888',
		abbreviation: a.abbreviation ?? a.id.slice(0, 2).toUpperCase(),
		onboarding: a.onboarding!,
	}));

	return { adapters };
};

export const actions: Actions = {
	createAccount: async ({ request, cookies }) => {
		if (getUserCount() > 0) {
			throw redirect(303, '/');
		}

		const data = await request.formData();
		const username = (data.get('username') as string)?.trim();
		const displayName = (data.get('displayName') as string)?.trim();
		const password = data.get('password') as string;
		const confirm = data.get('confirm') as string;

		if (!username || !displayName || !password) {
			return fail(400, { error: 'All fields are required', step: 'account' });
		}
		if (password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters', step: 'account' });
		}
		if (password !== confirm) {
			return fail(400, { error: 'Passwords do not match', step: 'account' });
		}

		const userId = createUser(username, displayName, password, true);
		const token = createSession(userId);

		cookies.set(COOKIE_NAME, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});

		return { success: true, step: 'account' };
	},

	connectService: async ({ request }) => {
		const data = await request.formData();
		const serviceType = data.get('type') as string;
		const url = (data.get('url') as string)?.trim().replace(/\/+$/, '');
		const apiKey = (data.get('apiKey') as string)?.trim() || undefined;
		const username = (data.get('username') as string)?.trim() || undefined;
		const password = (data.get('password') as string) || undefined;

		if (!serviceType || !url) {
			return fail(400, { error: 'Service type and URL are required', step: 'service' });
		}

		const adapter = registry.get(serviceType);
		if (!adapter) {
			return fail(400, { error: 'Unknown service type', step: 'service' });
		}

		const config = {
			id: serviceType,
			name: adapter.displayName,
			type: serviceType,
			url,
			apiKey: apiKey ?? null,
			username: username ?? null,
			password: password ?? null,
			enabled: true,
		};

		// Auto-auth if supported
		if (adapter.onboarding?.supportsAutoAuth && adapter.authenticateUser && username && password && !apiKey) {
			try {
				const cred = await adapter.authenticateUser(config, username, password);
				config.apiKey = cred.accessToken;
			} catch (e) {
				return fail(400, {
					error: `Connected but auto-authentication failed: ${e instanceof Error ? e.message : String(e)}. Try adding an API key instead.`,
					step: 'service',
					serviceType,
				});
			}
		}

		// Test connection
		try {
			const health = await adapter.ping(config);
			if (!health.healthy) {
				return fail(400, {
					error: `Connection failed: ${health.message ?? 'Unknown error'}`,
					step: 'service',
					serviceType,
				});
			}
		} catch (e) {
			return fail(400, {
				error: `Could not reach ${adapter.displayName} at ${url}`,
				step: 'service',
				serviceType,
			});
		}

		upsertService(config);

		return { success: true, step: 'service', serviceType, serviceName: adapter.displayName };
	},
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/setup/+page.server.ts
git commit -m "feat(setup): rewrite server to support multi-step wizard with service testing"
```

---

### Task 5: Create ServiceCard Component

**Files:**
- Create: `src/lib/components/onboarding/ServiceCard.svelte`

- [ ] **Step 1: Create the reusable service card with expand/connect/test**

```svelte
<script lang="ts">
	import type { OnboardingMeta } from '$lib/adapters/base';

	interface Props {
		adapterId: string;
		displayName: string;
		color: string;
		abbreviation: string;
		onboarding: OnboardingMeta;
		connected?: boolean;
		onConnect?: (data: { type: string; url: string; apiKey?: string; username?: string; password?: string }) => void;
	}

	let {
		adapterId,
		displayName,
		color,
		abbreviation,
		onboarding,
		connected = false,
		onConnect,
	}: Props = $props();

	let expanded = $state(false);
	let url = $state('');
	let apiKey = $state('');
	let username = $state('');
	let password = $state('');
	let testing = $state(false);
	let error = $state('');

	function toggle() {
		if (!connected) expanded = !expanded;
	}

	async function handleConnect() {
		if (!url.trim()) {
			error = 'URL is required';
			return;
		}
		error = '';
		testing = true;
		onConnect?.({
			type: adapterId,
			url: url.trim().replace(/\/+$/, ''),
			apiKey: apiKey.trim() || undefined,
			username: username.trim() || undefined,
			password: password || undefined,
		});
	}

	export function setError(msg: string) {
		error = msg;
		testing = false;
	}

	export function setConnected() {
		testing = false;
		expanded = false;
	}
</script>

<div
	class="rounded-xl border transition-all duration-200"
	style="border-color: {connected ? color + '40' : 'rgba(255,255,255,0.06)'}; background: {connected ? color + '08' : 'rgba(255,255,255,0.02)'}"
>
	<button
		class="flex w-full items-center gap-3 px-4 py-3 text-left"
		onclick={toggle}
		disabled={connected}
	>
		<div
			class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
			style="background: {color}"
		>
			{abbreviation}
		</div>
		<div class="min-w-0 flex-1">
			<div class="text-sm font-medium text-[var(--color-cream)]">{displayName}</div>
			<div class="text-xs text-[var(--color-muted)]">{onboarding.description}</div>
		</div>
		{#if connected}
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<circle cx="10" cy="10" r="10" fill="{color}30" />
				<path d="M6 10l3 3 5-5" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		{:else}
			<svg
				width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
				class="text-[var(--color-muted)] transition-transform {expanded ? 'rotate-180' : ''}"
			>
				<path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		{/if}
	</button>

	{#if expanded && !connected}
		<div class="border-t border-white/5 px-4 py-3 flex flex-col gap-3">
			{#if error}
				<div class="rounded-lg border border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 px-3 py-2 text-xs text-[var(--color-warm)]">
					{error}
				</div>
			{/if}

			{#if onboarding.requiredFields.includes('url')}
				<label class="flex flex-col gap-1">
					<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">URL</span>
					<input
						type="url"
						bind:value={url}
						placeholder="http://localhost:{adapterId === 'jellyfin' ? '8096' : '8080'}"
						class="input text-sm"
					/>
				</label>
			{/if}

			{#if onboarding.supportsAutoAuth}
				{#if onboarding.requiredFields.includes('username')}
					<label class="flex flex-col gap-1">
						<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Username</span>
						<input type="text" bind:value={username} placeholder="Your admin username" class="input text-sm" />
					</label>
				{/if}
				{#if onboarding.requiredFields.includes('password')}
					<label class="flex flex-col gap-1">
						<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Password</span>
						<input type="password" bind:value={password} placeholder="Your admin password" class="input text-sm" />
					</label>
				{/if}
			{:else if onboarding.requiredFields.includes('apiKey')}
				<label class="flex flex-col gap-1">
					<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">API Key</span>
					<input type="text" bind:value={apiKey} placeholder="Paste your API key" class="input text-sm font-mono" />
				</label>
			{/if}

			<button
				class="btn btn-primary mt-1 text-sm"
				onclick={handleConnect}
				disabled={testing}
			>
				{testing ? 'Testing connection…' : 'Connect'}
			</button>
		</div>
	{/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/onboarding/ServiceCard.svelte
git commit -m "feat(onboarding): create reusable ServiceCard component with connect/test flow"
```

---

### Task 6: Rewrite Setup Wizard — Client

**Files:**
- Modify: `src/routes/setup/+page.svelte`

- [ ] **Step 1: Rewrite the setup page as a multi-step wizard**

This is the largest file. It manages 5 steps client-side: Welcome, Account, Media Server, More Services, Done.

```svelte
<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import ServiceCard from '$lib/components/onboarding/ServiceCard.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let step = $state(0);
	let loading = $state(false);
	let connectedServices = $state<string[]>([]);

	// Group adapters by category for step 4
	const mediaServers = $derived(
		data.adapters.filter((a) => a.onboarding.category === 'media-server')
	);
	const otherAdapters = $derived(
		data.adapters
			.filter((a) => a.onboarding.category !== 'media-server')
			.sort((a, b) => a.onboarding.priority - b.onboarding.priority)
	);
	const categoryOrder: [string, string][] = [
		['automation', 'Automation'],
		['requests', 'Requests'],
		['subtitles', 'Subtitles'],
		['analytics', 'Analytics'],
		['video', 'Video'],
		['games', 'Games'],
		['books', 'Books'],
		['indexer', 'Indexers'],
	];
	const groupedAdapters = $derived(
		categoryOrder
			.map(([cat, label]) => ({
				category: cat,
				label,
				adapters: otherAdapters.filter((a) => a.onboarding.category === cat),
			}))
			.filter((g) => g.adapters.length > 0)
	);

	// Handle form results
	$effect(() => {
		if (form?.success && form.step === 'account') {
			step = 2;
			loading = false;
		}
		if (form?.success && form.step === 'service') {
			connectedServices = [...connectedServices, form.serviceType];
			loading = false;
		}
		if (form?.error) {
			loading = false;
		}
	});

	const totalSteps = 5;
	const dots = $derived(Array.from({ length: totalSteps }, (_, i) => i));

	async function connectService(serviceData: { type: string; url: string; apiKey?: string; username?: string; password?: string }) {
		loading = true;
		const formData = new FormData();
		formData.set('type', serviceData.type);
		formData.set('url', serviceData.url);
		if (serviceData.apiKey) formData.set('apiKey', serviceData.apiKey);
		if (serviceData.username) formData.set('username', serviceData.username);
		if (serviceData.password) formData.set('password', serviceData.password);

		const res = await fetch('?/connectService', { method: 'POST', body: formData });
		const result = await res.json();

		if (result.type === 'failure') {
			loading = false;
			return result.data?.error ?? 'Connection failed';
		}

		connectedServices = [...connectedServices, serviceData.type];
		loading = false;
		return null;
	}
</script>

<svelte:head>
	<title>Welcome to Nexus — Setup</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center px-4" style="background: radial-gradient(ellipse at 50% 0%, var(--color-accent)15 0%, transparent 60%), var(--color-void)">
	<!-- Progress dots -->
	<div class="mb-8 flex gap-2">
		{#each dots as i}
			<div
				class="h-2 w-2 rounded-full transition-all duration-300"
				style="background: {i === step ? 'var(--color-cream)' : i < step ? 'var(--color-accent)' : 'rgba(255,255,255,0.15)'}"
			></div>
		{/each}
	</div>

	<div class="w-full max-w-md">
		<!-- ═══ Step 0: Welcome ═══ -->
		{#if step === 0}
			<div class="flex flex-col items-center gap-6 text-center">
				<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent)] shadow-[0_0_40px_var(--color-accent)40]">
					<svg width="28" height="28" viewBox="-85 -754 1058 828" fill="none">
						<g transform="scale(1,-1)"><path d="M543 -5 275 483Q275 483 277.0 501.0Q279 519 281.0 542.5Q283 566 285.0 584.0Q287 602 287 602Q295 639 292.5 656.5Q290 674 272.5 680.5Q255 687 216 688L221 708Q237 707 260.5 706.0Q284 705 310 705Q357 705 391 708L615 272Q615 272 611.5 252.0Q608 232 602.0 200.5Q596 169 590.0 133.5Q584 98 578.0 66.5Q572 35 568.5 15.0Q565 -5 565 -5ZM851 737Q826 737 804.0 721.0Q782 705 766 682Q720 614 672.0 443.0Q624 272 565 -5L551 23Q566 90 583.0 167.5Q600 245 619.5 323.0Q639 401 659.5 472.0Q680 543 702.5 599.5Q725 656 748 690Q767 717 793.0 735.5Q819 754 856 754Q909 754 941.0 723.0Q973 692 973 647Q973 599 940.5 570.5Q908 542 861 542Q821 542 796.5 561.5Q772 581 772 616Q772 661 802.0 691.5Q832 722 876 729Q872 733 865.5 735.0Q859 737 851 737ZM37 -57Q65 -57 86.0 -41.5Q107 -26 123 -1Q152 45 181.5 143.0Q211 241 241.5 380.0Q272 519 303 685L320 664Q304 582 286.5 497.5Q269 413 251.0 332.5Q233 252 214.0 183.0Q195 114 176.0 63.5Q157 13 139 -11Q121 -35 96.5 -54.5Q72 -74 32 -74Q-21 -74 -53.0 -43.0Q-85 -12 -85 33Q-85 81 -52.0 109.5Q-19 138 27 138Q68 138 92.0 118.5Q116 99 116 64Q116 19 86.0 -11.0Q56 -41 12 -49Q16 -53 22.5 -55.0Q29 -57 37 -57Z" fill="white"/></g>
					</svg>
				</div>
				<div>
					<h1 class="text-display text-3xl font-bold">Welcome to Nexus</h1>
					<p class="mt-2 text-[var(--color-muted)]">Your media, unified.</p>
				</div>
				<p class="max-w-xs text-sm leading-relaxed text-[var(--color-muted)]">
					Nexus connects your media services into one interface. This takes about 2 minutes.
				</p>
				<button class="btn btn-primary mt-2 px-8" onclick={() => (step = 1)}>Get Started</button>
			</div>

		<!-- ═══ Step 1: Create Admin Account ═══ -->
		{:else if step === 1}
			<div class="flex flex-col items-center gap-6">
				<div class="text-center">
					<h2 class="text-display text-2xl font-bold">Create your account</h2>
					<p class="mt-1 text-sm text-[var(--color-muted)]">This is your admin account for managing Nexus.</p>
				</div>

				<form method="POST" action="?/createAccount" class="card w-full p-6 flex flex-col gap-4" onsubmit={() => (loading = true)}>
					{#if form?.error && form.step === 'account'}
						<div class="rounded-lg border border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 px-3 py-2 text-sm text-[var(--color-warm)]">
							{form.error}
						</div>
					{/if}

					<label class="flex flex-col gap-1.5">
						<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Username</span>
						<input name="username" class="input" placeholder="admin" autocomplete="username" required />
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Display Name</span>
						<input name="displayName" class="input" placeholder="Your name" required />
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</span>
						<input name="password" type="password" class="input" placeholder="••••••••" autocomplete="new-password" required />
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Confirm Password</span>
						<input name="confirm" type="password" class="input" placeholder="••••••••" autocomplete="new-password" required />
					</label>

					<button type="submit" class="btn btn-primary mt-2" disabled={loading}>
						{loading ? 'Creating account…' : 'Continue'}
					</button>
				</form>
			</div>

		<!-- ═══ Step 2: Connect Media Server ═══ -->
		{:else if step === 2}
			<div class="flex flex-col items-center gap-6">
				<div class="text-center">
					<h2 class="text-display text-2xl font-bold">Connect your media server</h2>
					<p class="mt-1 text-sm text-[var(--color-muted)]">This is how Nexus accesses your library.</p>
				</div>

				<div class="w-full flex flex-col gap-3">
					{#each mediaServers as adapter}
						<ServiceCard
							adapterId={adapter.id}
							displayName={adapter.displayName}
							color={adapter.color}
							abbreviation={adapter.abbreviation}
							onboarding={adapter.onboarding}
							connected={connectedServices.includes(adapter.id)}
							onConnect={async (data) => {
								const err = await connectService(data);
								if (err) { /* error is handled via form action */ }
							}}
						/>
					{/each}
				</div>

				<div class="flex w-full items-center justify-between">
					<button class="text-xs text-[var(--color-muted)] hover:text-[var(--color-cream)] transition-colors" onclick={() => (step = 3)}>
						Skip for now
					</button>
					{#if connectedServices.some((s) => mediaServers.some((ms) => ms.id === s))}
						<button class="btn btn-primary" onclick={() => (step = 3)}>Continue</button>
					{/if}
				</div>
			</div>

		<!-- ═══ Step 3: Connect More Services ═══ -->
		{:else if step === 3}
			<div class="flex flex-col items-center gap-6">
				<div class="text-center">
					<h2 class="text-display text-2xl font-bold">Connect more services</h2>
					<p class="mt-1 text-sm text-[var(--color-muted)]">Optional — you can always add these later.</p>
				</div>

				<div class="w-full flex flex-col gap-5 max-h-[50vh] overflow-y-auto pr-1">
					{#each groupedAdapters as group}
						<div>
							<h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{group.label}</h3>
							<div class="flex flex-col gap-2">
								{#each group.adapters as adapter}
									<ServiceCard
										adapterId={adapter.id}
										displayName={adapter.displayName}
										color={adapter.color}
										abbreviation={adapter.abbreviation}
										onboarding={adapter.onboarding}
										connected={connectedServices.includes(adapter.id)}
										onConnect={async (data) => {
											const err = await connectService(data);
											if (err) { /* handled inline */ }
										}}
									/>
								{/each}
							</div>
						</div>
					{/each}
				</div>

				<div class="flex w-full items-center justify-between">
					<button class="text-xs text-[var(--color-muted)] hover:text-[var(--color-cream)] transition-colors" onclick={() => (step = 4)}>
						Skip — I'll do this later
					</button>
					<button class="btn btn-primary" onclick={() => (step = 4)}>Continue</button>
				</div>
			</div>

		<!-- ═══ Step 4: Done ═══ -->
		{:else if step === 4}
			<div class="flex flex-col items-center gap-6 text-center">
				<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-500/20 text-green-400">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20 6L9 17l-5-5" />
					</svg>
				</div>
				<div>
					<h2 class="text-display text-2xl font-bold">You're all set</h2>
					<p class="mt-1 text-sm text-[var(--color-muted)]">
						{connectedServices.length === 0
							? 'No services connected yet — you can add them from your dashboard.'
							: `${connectedServices.length} service${connectedServices.length > 1 ? 's' : ''} connected.`}
					</p>
				</div>

				{#if connectedServices.length > 0}
					<div class="flex flex-wrap justify-center gap-2">
						{#each connectedServices as svcId}
							{@const adapter = data.adapters.find((a) => a.id === svcId)}
							{#if adapter}
								<span
									class="rounded-full px-3 py-1 text-xs font-medium text-white"
									style="background: {adapter.color}"
								>
									{adapter.displayName}
								</span>
							{/if}
						{/each}
					</div>
				{/if}

				<a href="/" class="btn btn-primary mt-2 px-8">Head to your dashboard</a>
				<p class="text-xs text-[var(--color-muted)]">
					Check the <strong class="text-[var(--color-fg)]">Getting Started</strong> guide on your homepage for more.
				</p>
			</div>
		{/if}
	</div>
</div>
```

- [ ] **Step 2: Verify the wizard works end-to-end**

Run: `pnpm dev` — navigate to `http://localhost:5173/setup` (requires fresh DB with 0 users).

Expected: 5-step wizard flow, service connection with inline testing.

- [ ] **Step 3: Commit**

```bash
git add src/routes/setup/+page.svelte
git commit -m "feat(setup): rewrite as guided multi-step wizard with service testing"
```

---

### Task 7: Create Getting Started Checklist Component

**Files:**
- Create: `src/lib/components/onboarding/GettingStartedChecklist.svelte`

- [ ] **Step 1: Create the checklist component**

```svelte
<script lang="ts">
	import type { OnboardingMeta } from '$lib/adapters/base';

	interface ChecklistAdapter {
		id: string;
		displayName: string;
		color: string;
		abbreviation: string;
		onboarding: OnboardingMeta;
	}

	interface ChecklistGroup {
		category: string;
		label: string;
		adapters: (ChecklistAdapter & { connected: boolean })[];
	}

	interface Props {
		groups: ChecklistGroup[];
		completedCount: number;
		totalCount: number;
		registrationConfigured: boolean;
	}

	let { groups, completedCount, totalCount, registrationConfigured }: Props = $props();

	let collapsed = $state(false);
	let dismissing = $state(false);

	async function snooze() {
		dismissing = true;
		await fetch('/api/onboarding/checklist', { method: 'POST', body: JSON.stringify({ action: 'snooze' }), headers: { 'Content-Type': 'application/json' } });
		location.reload();
	}

	async function dismiss() {
		dismissing = true;
		await fetch('/api/onboarding/checklist', { method: 'POST', body: JSON.stringify({ action: 'dismiss' }), headers: { 'Content-Type': 'application/json' } });
		location.reload();
	}
</script>

<div class="mx-4 mt-3 rounded-xl border border-white/[0.06] bg-[var(--color-surface)]">
	<!-- Header -->
	<button
		class="flex w-full items-center justify-between px-4 py-3"
		onclick={() => (collapsed = !collapsed)}
	>
		<div class="flex items-center gap-3">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
			</svg>
			<span class="text-sm font-semibold text-[var(--color-cream)]">Getting Started</span>
			<span class="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-[var(--color-muted)]">
				{completedCount} of {totalCount}
			</span>
		</div>
		<svg
			width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
			class="text-[var(--color-muted)] transition-transform {collapsed ? '' : 'rotate-180'}"
		>
			<path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	</button>

	{#if !collapsed}
		<div class="border-t border-white/5 px-4 py-3 flex flex-col gap-4">
			{#each groups as group}
				{#if group.adapters.length > 0}
					<div>
						<h4 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">{group.label}</h4>
						<div class="flex flex-col gap-1.5">
							{#each group.adapters as adapter}
								<div class="flex items-center gap-3 rounded-lg px-3 py-2" style="background: {adapter.connected ? adapter.color + '08' : 'transparent'}">
									<div
										class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
										style="background: {adapter.color}; opacity: {adapter.connected ? 1 : 0.4}"
									>
										{adapter.abbreviation}
									</div>
									<div class="min-w-0 flex-1">
										<span class="text-xs font-medium {adapter.connected ? 'text-[var(--color-cream)]' : 'text-[var(--color-muted)]'}">
											{adapter.displayName}
										</span>
									</div>
									{#if adapter.connected}
										<span class="text-[10px] font-medium" style="color: {adapter.color}">Connected</span>
									{:else}
										<a href="/admin/services?highlight={adapter.id}" class="text-[10px] font-medium text-[var(--color-accent)] hover:underline">Set up</a>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/each}

			<!-- Invite Users -->
			<div class="flex items-center gap-3 rounded-lg px-3 py-2">
				<div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-purple-500/40 text-[10px]">👥</div>
				<span class="flex-1 text-xs font-medium {registrationConfigured ? 'text-[var(--color-cream)]' : 'text-[var(--color-muted)]'}">
					Invite Users
				</span>
				{#if registrationConfigured}
					<span class="text-[10px] font-medium text-purple-400">Configured</span>
				{:else}
					<a href="/admin/users" class="text-[10px] font-medium text-[var(--color-accent)] hover:underline">Set up</a>
				{/if}
			</div>

			<!-- Actions -->
			<div class="flex items-center justify-end gap-3 pt-1 border-t border-white/5">
				<button
					class="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-cream)] transition-colors"
					onclick={snooze}
					disabled={dismissing}
				>
					Remind me later
				</button>
				<button
					class="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-cream)] transition-colors"
					onclick={dismiss}
					disabled={dismissing}
				>
					Dismiss
				</button>
			</div>
		</div>
	{/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/onboarding/GettingStartedChecklist.svelte
git commit -m "feat(onboarding): create GettingStartedChecklist component"
```

---

### Task 8: Create Checklist API Endpoint

**Files:**
- Create: `src/routes/api/onboarding/checklist/+server.ts`

- [ ] **Step 1: Create the checklist action endpoint**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/onboarding/checklist/+server.ts
git commit -m "feat(api): add checklist snooze/dismiss/reset endpoint"
```

---

### Task 9: Wire Checklist into Homepage

**Files:**
- Modify: `src/routes/+page.server.ts`
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Add checklist data to homepage load function**

In `src/routes/+page.server.ts`, add imports at the top:

```ts
import { getChecklistState, isChecklistVisible } from '$lib/server/onboarding';
import { getSetting } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
```

At the end of the `load` function, before the return statement, add:

```ts
// Onboarding checklist (admin only)
let checklistData = null;
if (locals.user?.isAdmin && isChecklistVisible()) {
	const state = getChecklistState();
	const configs = getEnabledConfigs();
	const connectedTypes = new Set(configs.map((c) => c.type));

	const categoryOrder: [string, string][] = [
		['media-server', 'Media Servers'],
		['automation', 'Automation'],
		['requests', 'Requests'],
		['subtitles', 'Subtitles'],
		['analytics', 'Analytics'],
		['video', 'Video'],
		['games', 'Games'],
		['books', 'Books'],
		['indexer', 'Indexers'],
	];

	const groups = categoryOrder
		.map(([cat, label]) => ({
			category: cat,
			label,
			adapters: registry.byOnboardingCategory(cat as any).map((a) => ({
				id: a.id,
				displayName: a.displayName,
				color: a.color ?? '#888',
				abbreviation: a.abbreviation ?? a.id.slice(0, 2).toUpperCase(),
				onboarding: a.onboarding!,
				connected: connectedTypes.has(a.id),
			})),
		}))
		.filter((g) => g.adapters.length > 0);

	const registrationConfigured =
		getSetting('registration_enabled') === 'true' ||
		// Check if any invite links exist (import from auth if needed)
		false;

	checklistData = {
		groups,
		completedCount: state.completedCategories.length,
		totalCount: state.totalOnboardable,
		registrationConfigured,
	};
}
```

Add `checklistData` to the return object.

- [ ] **Step 2: Add checklist component to homepage**

In `src/routes/+page.svelte`, add the import:

```ts
import GettingStartedChecklist from '$lib/components/onboarding/GettingStartedChecklist.svelte';
```

After the hero carousel block and before the unlinked services nudge, add:

```svelte
<!-- ═══ Getting Started Checklist (admin only) ═══ -->
{#if data.checklistData}
	<GettingStartedChecklist
		groups={data.checklistData.groups}
		completedCount={data.checklistData.completedCount}
		totalCount={data.checklistData.totalCount}
		registrationConfigured={data.checklistData.registrationConfigured}
	/>
{/if}
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.server.ts src/routes/+page.svelte
git commit -m "feat(homepage): wire Getting Started checklist into homepage for admins"
```

---

### Task 10: Create SetupHint Component and Wire Into Pages

**Files:**
- Create: `src/lib/components/onboarding/SetupHint.svelte`
- Modify: `src/routes/discover/+page.server.ts`
- Modify: `src/routes/calendar/+page.server.ts`

- [ ] **Step 1: Create the SetupHint component**

```svelte
<script lang="ts">
	interface MissingCategory {
		category: string;
		adapterName: string;
		description: string;
	}

	interface Props {
		missing: MissingCategory[];
	}

	let { missing }: Props = $props();

	let dismissed = $state<Set<string>>(new Set());

	function hide(cat: string) {
		dismissed = new Set([...dismissed, cat]);
	}
</script>

{#each missing as m}
	{#if !dismissed.has(m.category)}
		<div class="mx-4 mb-4 flex items-center justify-between gap-3 rounded-xl px-4 py-2.5" style="background: rgba(124,108,248,0.06); border: 1px solid rgba(124,108,248,0.12)">
			<p class="text-xs text-[var(--color-muted)]">
				{m.description} —
				<a href="/admin/services?highlight={m.adapterName.toLowerCase()}" class="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline">
					Connect {m.adapterName}
				</a>
			</p>
			<button
				onclick={() => hide(m.category)}
				class="flex-shrink-0 rounded-md p-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]"
				aria-label="Dismiss"
			>
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
					<path d="M2 2l8 8M10 2l-8 8" />
				</svg>
			</button>
		</div>
	{/if}
{/each}
```

- [ ] **Step 2: Add missing categories to discover page**

In `src/routes/discover/+page.server.ts`, add at top:

```ts
import { getMissingCategories } from '$lib/server/onboarding';
```

In the load function return, add:

```ts
missingCategories: locals.user?.isAdmin ? getMissingCategories(['requests']) : [],
```

In the corresponding `+page.svelte`, import and render:

```svelte
<script>
	import SetupHint from '$lib/components/onboarding/SetupHint.svelte';
</script>

{#if data.missingCategories?.length}
	<SetupHint missing={data.missingCategories} />
{/if}
```

- [ ] **Step 3: Add missing categories to calendar page**

Same pattern in `src/routes/calendar/+page.server.ts`:

```ts
import { getMissingCategories } from '$lib/server/onboarding';
```

```ts
missingCategories: locals.user?.isAdmin ? getMissingCategories(['automation']) : [],
```

And in the `+page.svelte`:

```svelte
{#if data.missingCategories?.length}
	<SetupHint missing={data.missingCategories} />
{/if}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/onboarding/SetupHint.svelte src/routes/discover/ src/routes/calendar/
git commit -m "feat(onboarding): add contextual SetupHint component and wire into discover/calendar"
```

---

### Task 11: Final Integration Test

- [ ] **Step 1: Reset database and test full flow**

```bash
cd ~/Developer/Nexus
rm nexus.db
pnpm db:migrate
pnpm dev
```

Navigate to `http://localhost:5173`. Verify:
1. Redirects to `/setup`
2. Welcome screen with "Get Started"
3. Account creation works
4. Media server step shows Jellyfin/Plex cards
5. More services step shows all other adapters grouped by category
6. Done step shows connected services
7. Homepage shows Getting Started checklist
8. Checklist snooze/dismiss works
9. Discover page shows hint about missing request manager

- [ ] **Step 2: Restore original database**

```bash
cp nexus.db.bak nexus.db
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(onboarding): complete setup wizard, homepage checklist, and contextual hints

Closes #57"
```

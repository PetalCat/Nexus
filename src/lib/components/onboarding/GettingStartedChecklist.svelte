<script lang="ts">
	import type { OnboardingMeta } from '$lib/adapters/base';
	import ServiceCard from './ServiceCard.svelte';

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
	let newlyConnected = $state<Set<string>>(new Set());

	async function connectService(serviceData: { type: string; url: string; apiKey?: string; username?: string; password?: string }): Promise<string | null> {
		const formData = new FormData();
		formData.set('type', serviceData.type);
		formData.set('url', serviceData.url);
		if (serviceData.apiKey) formData.set('apiKey', serviceData.apiKey);
		if (serviceData.username) formData.set('username', serviceData.username);
		if (serviceData.password) formData.set('password', serviceData.password);

		try {
			const res = await fetch('/api/services', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: serviceData.type,
					name: serviceData.type,
					type: serviceData.type,
					url: serviceData.url,
					apiKey: serviceData.apiKey,
					username: serviceData.username,
					password: serviceData.password,
					enabled: true,
				}),
			});
			const result = await res.json();

			if (result.error) {
				return result.error;
			}

			newlyConnected = new Set([...newlyConnected, serviceData.type]);
			return null;
		} catch {
			return 'Network error — check your connection';
		}
	}

	function isConnected(adapterId: string): boolean {
		return newlyConnected.has(adapterId);
	}

	const effectiveCompletedCount = $derived(completedCount + newlyConnected.size);

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
				{effectiveCompletedCount} of {totalCount}
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
			{#each groups as group (group.category)}
				{#if group.adapters.length > 0}
					<div>
						<h4 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">{group.label}</h4>
						<div class="flex flex-col gap-2">
							{#each group.adapters as adapter (adapter.id)}
								<ServiceCard
									adapterId={adapter.id}
									displayName={adapter.displayName}
									color={adapter.color}
									abbreviation={adapter.abbreviation}
									onboarding={adapter.onboarding}
									connected={adapter.connected || isConnected(adapter.id)}
									onConnect={async (svcData) => {
										const err = await connectService(svcData);
										if (err) {
											// ServiceCard handles error display internally
										}
									}}
								/>
							{/each}
						</div>
					</div>
				{/if}
			{/each}

			<!-- Invite Users -->
			<div class="rounded-xl border transition-all duration-200" style="border-color: {registrationConfigured ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.06)'}; background: {registrationConfigured ? 'rgba(168,85,247,0.05)' : 'rgba(255,255,255,0.02)'}">
				<a href="/admin/users" class="flex w-full items-center gap-3 px-4 py-3 text-left">
					<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white" style="background: rgba(168,85,247,0.6)">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
						</svg>
					</div>
					<div class="min-w-0 flex-1">
						<div class="text-sm font-medium text-[var(--color-cream)]">Invite Users</div>
						<div class="text-xs text-[var(--color-muted)]">Create invite links or enable registration</div>
					</div>
					{#if registrationConfigured}
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
							<circle cx="10" cy="10" r="10" fill="rgba(168,85,247,0.3)" />
							<path d="M6 10l3 3 5-5" stroke="rgb(168,85,247)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					{:else}
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="text-[var(--color-muted)]">
							<path d="M6 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					{/if}
				</a>
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

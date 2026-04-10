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
			{#each groups as group (group.category)}
				{#if group.adapters.length > 0}
					<div>
						<h4 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">{group.label}</h4>
						<div class="flex flex-col gap-1.5">
							{#each group.adapters as adapter (adapter.id)}
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

			<div class="flex items-center gap-3 rounded-lg px-3 py-2">
				<div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[10px] text-white" style="background: rgba(168,85,247,0.4)">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
					</svg>
				</div>
				<span class="flex-1 text-xs font-medium {registrationConfigured ? 'text-[var(--color-cream)]' : 'text-[var(--color-muted)]'}">
					Invite Users
				</span>
				{#if registrationConfigured}
					<span class="text-[10px] font-medium text-purple-400">Configured</span>
				{:else}
					<a href="/admin/users" class="text-[10px] font-medium text-[var(--color-accent)] hover:underline">Set up</a>
				{/if}
			</div>

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

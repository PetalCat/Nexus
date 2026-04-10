<script lang="ts">
	import type { OnboardingMeta } from '$lib/adapters/base';
	import ServiceIcon from './ServiceIcon.svelte';

	interface Props {
		adapterId: string;
		displayName: string;
		color: string;
		abbreviation: string;
		onboarding: OnboardingMeta;
		connected?: boolean;
		compact?: boolean;
		onConnect?: (data: { type: string; url: string; apiKey?: string; username?: string; password?: string }) => Promise<string | null>;
	}

	let {
		adapterId,
		displayName,
		color,
		abbreviation,
		onboarding,
		connected = false,
		compact = false,
		onConnect,
	}: Props = $props();

	let expanded = $state(false);
	let url = $state('');
	let apiKey = $state('');
	let username = $state('');
	let password = $state('');
	let testing = $state(false);
	let error = $state('');
	let justConnected = $state(false);

	function toggle() {
		if (!connected && !justConnected) expanded = !expanded;
	}

	async function handleConnect() {
		if (!url.trim()) {
			error = 'URL is required';
			return;
		}
		error = '';
		testing = true;

		const result = await onConnect?.({
			type: adapterId,
			url: url.trim().replace(/\/+$/, ''),
			apiKey: apiKey.trim() || undefined,
			username: username.trim() || undefined,
			password: password || undefined,
		});

		testing = false;
		if (result) {
			error = result;
		} else {
			justConnected = true;
			expanded = false;
		}
	}

	const isComplete = $derived(connected || justConnected);
</script>

<div
	class="group rounded-2xl border-2 transition-all duration-300 overflow-hidden"
	style="border-color: {isComplete ? color + '50' : expanded ? color + '30' : 'rgba(255,255,255,0.06)'}; background: {isComplete ? color + '08' : 'rgba(255,255,255,0.02)'}"
>
	<button
		class="flex w-full items-center gap-4 {compact ? 'px-4 py-3' : 'px-5 py-4'} text-left transition-colors hover:bg-white/[0.02]"
		onclick={toggle}
		disabled={isComplete}
	>
		<!-- Icon -->
		<div
			class="{compact ? 'h-10 w-10' : 'h-12 w-12'} flex flex-shrink-0 items-center justify-center rounded-xl transition-opacity"
			style="background: {color}20; color: {color}; opacity: {isComplete ? 1 : 0.8}"
		>
			<ServiceIcon type={adapterId} size={compact ? 20 : 24} />
		</div>

		<!-- Info -->
		<div class="min-w-0 flex-1">
			<div class="{compact ? 'text-sm' : 'text-base'} font-semibold text-[var(--color-cream)]">{displayName}</div>
			<div class="text-xs text-[var(--color-muted)] mt-0.5">{onboarding.description}</div>
		</div>

		<!-- Status -->
		{#if isComplete}
			<div class="flex items-center gap-1.5 rounded-full px-3 py-1" style="background: {color}15">
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<circle cx="7" cy="7" r="7" fill="{color}40" />
					<path d="M4 7l2 2 4-4" stroke="{color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				<span class="text-[11px] font-medium" style="color: {color}">Connected</span>
			</div>
		{:else}
			<div class="flex items-center gap-1 text-[var(--color-muted)] transition-all group-hover:text-[var(--color-cream)]">
				<span class="text-xs">{expanded ? '' : 'Set up'}</span>
				<svg
					width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
					class="transition-transform duration-200 {expanded ? 'rotate-180' : ''}"
				>
					<path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</div>
		{/if}
	</button>

	<!-- Expand form -->
	{#if expanded && !isComplete}
		<div class="border-t px-5 py-4 flex flex-col gap-3" style="border-color: rgba(255,255,255,0.06); background: rgba(0,0,0,0.15)">
			{#if error}
				<div class="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs text-red-400 flex items-start gap-2">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="flex-shrink-0 mt-0.5">
						<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
					</svg>
					<span>{error}</span>
				</div>
			{/if}

			{#if onboarding.requiredFields.includes('url')}
				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Server URL</span>
					<input
						type="url"
						bind:value={url}
						placeholder="http://192.168.1.100:8096"
						class="input text-sm"
					/>
				</label>
			{/if}

			{#if onboarding.supportsAutoAuth}
				<div class="grid grid-cols-2 gap-3">
					{#if onboarding.requiredFields.includes('username')}
						<label class="flex flex-col gap-1.5">
							<span class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Username</span>
							<input type="text" bind:value={username} placeholder="admin" class="input text-sm" />
						</label>
					{/if}
					{#if onboarding.requiredFields.includes('password')}
						<label class="flex flex-col gap-1.5">
							<span class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Password</span>
							<input type="password" bind:value={password} placeholder="••••••••" class="input text-sm" />
						</label>
					{/if}
				</div>
			{:else if onboarding.requiredFields.includes('apiKey')}
				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">API Key</span>
					<input type="text" bind:value={apiKey} placeholder="Paste your API key" class="input text-sm font-mono" />
					<span class="text-[10px] text-[var(--color-muted)]">Found in {displayName}'s Settings &rarr; General</span>
				</label>
			{/if}

			<button
				class="btn btn-primary mt-1"
				onclick={handleConnect}
				disabled={testing}
			>
				{#if testing}
					<span class="flex items-center gap-2">
						<svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
							<path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M7.76 7.76L4.93 4.93"/>
						</svg>
						Testing connection...
					</span>
				{:else}
					Connect {displayName}
				{/if}
			</button>
		</div>
	{/if}
</div>

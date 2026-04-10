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

	function handleConnect() {
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
						placeholder="http://localhost:8080"
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

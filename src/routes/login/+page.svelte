<script lang="ts">
	import type { PageData } from './$types';
	import CommunityLinks from '$lib/components/CommunityLinks.svelte';

	// Extended form type to cover all possible fail() return shapes
	type LoginForm = {
		error?: string;
		authType?: string;
		serviceId?: string;
		username?: string;
		needsNexusPassword?: boolean;
		collisionUsername?: string;
	} | null;

	let { data, form: rawForm }: { data: PageData; form: LoginForm } = $props();
	const form = $derived(rawForm as LoginForm);
	let loading = $state(false);

	/** Which service the user clicked to sign in with (null = local login) */
	let activeServiceId = $state<string | null>(null);
	let showNexusPassword = $state(false);

	// Sync state from server form response
	$effect(() => {
		if (form?.authType === 'service') {
			activeServiceId = form.serviceId ?? null;
		}
		showNexusPassword = form?.needsNexusPassword ?? false;
		loading = false;
	});

	function selectService(id: string) {
		activeServiceId = id;
		showNexusPassword = false;
		loading = false;
	}

	function backToLocal() {
		activeServiceId = null;
		showNexusPassword = false;
		loading = false;
	}

	const activeService = $derived(data.authServices.find((s) => s.id === activeServiceId));

	// Service type display helpers
	function serviceIcon(type: string) {
		if (type === 'jellyfin') return 'J';
		if (type === 'plex') return 'P';
		return '?';
	}

	function serviceColor(type: string) {
		if (type === 'jellyfin') return '#00a4dc';
		if (type === 'plex') return '#e5a00d';
		return 'var(--color-accent)';
	}
</script>

<svelte:head>
	<title>Sign In — Nexus</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4" style="background: radial-gradient(ellipse at 50% 0%, var(--color-accent)15 0%, transparent 60%), var(--color-void)">
	<div class="w-full max-w-sm">
		<!-- Logo -->
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-accent)] shadow-[0_0_40px_var(--color-accent)40]">
				<svg width="24" height="24" viewBox="-85 -754 1058 828" fill="none">
					<g transform="scale(1,-1)"><path d="M543 -5 275 483Q275 483 277.0 501.0Q279 519 281.0 542.5Q283 566 285.0 584.0Q287 602 287 602Q295 639 292.5 656.5Q290 674 272.5 680.5Q255 687 216 688L221 708Q237 707 260.5 706.0Q284 705 310 705Q357 705 391 708L615 272Q615 272 611.5 252.0Q608 232 602.0 200.5Q596 169 590.0 133.5Q584 98 578.0 66.5Q572 35 568.5 15.0Q565 -5 565 -5ZM851 737Q826 737 804.0 721.0Q782 705 766 682Q720 614 672.0 443.0Q624 272 565 -5L551 23Q566 90 583.0 167.5Q600 245 619.5 323.0Q639 401 659.5 472.0Q680 543 702.5 599.5Q725 656 748 690Q767 717 793.0 735.5Q819 754 856 754Q909 754 941.0 723.0Q973 692 973 647Q973 599 940.5 570.5Q908 542 861 542Q821 542 796.5 561.5Q772 581 772 616Q772 661 802.0 691.5Q832 722 876 729Q872 733 865.5 735.0Q859 737 851 737ZM37 -57Q65 -57 86.0 -41.5Q107 -26 123 -1Q152 45 181.5 143.0Q211 241 241.5 380.0Q272 519 303 685L320 664Q304 582 286.5 497.5Q269 413 251.0 332.5Q233 252 214.0 183.0Q195 114 176.0 63.5Q157 13 139 -11Q121 -35 96.5 -54.5Q72 -74 32 -74Q-21 -74 -53.0 -43.0Q-85 -12 -85 33Q-85 81 -52.0 109.5Q-19 138 27 138Q68 138 92.0 118.5Q116 99 116 64Q116 19 86.0 -11.0Q56 -41 12 -49Q16 -53 22.5 -55.0Q29 -57 37 -57Z" fill="white"/></g>
				</svg>
			</div>
			<div>
				<h1 class="text-display text-2xl font-bold">Nexus</h1>
				<p class="mt-1 text-sm text-[var(--color-muted)]">Sign in to your media OS.</p>
			</div>
		</div>

		{#if data.authServices.length > 0 && !activeServiceId}
			<!-- Service auth buttons -->
			<div class="flex flex-col gap-2 mb-4">
				{#each data.authServices as svc}
					<button
						type="button"
						class="card flex items-center gap-3 px-4 py-3 text-sm font-medium text-[var(--color-display)] transition-colors hover:bg-[var(--color-glass-bold)] cursor-pointer"
						onclick={() => selectService(svc.id)}
					>
						<span
							class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
							style="background: {serviceColor(svc.type)}"
						>
							{serviceIcon(svc.type)}
						</span>
						<span>Sign in with {svc.name}</span>
					</button>
				{/each}
			</div>

			<!-- Divider -->
			<div class="flex items-center gap-3 mb-4">
				<div class="h-px flex-1 bg-[var(--color-glass-bold)]"></div>
				<span class="text-xs text-[var(--color-muted)]">or sign in with password</span>
				<div class="h-px flex-1 bg-[var(--color-glass-bold)]"></div>
			</div>
		{/if}

		{#if activeServiceId && activeService}
			<!-- Service credential form -->
			<form method="POST" class="card p-6 flex flex-col gap-4" onsubmit={() => (loading = true)}>
				<input type="hidden" name="authType" value="service" />
				<input type="hidden" name="serviceId" value={activeServiceId} />

				<div class="flex items-center gap-3 mb-1">
					<span
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
						style="background: {serviceColor(activeService.type)}"
					>
						{serviceIcon(activeService.type)}
					</span>
					<div>
						<p class="text-sm font-semibold text-[var(--color-display)]">Sign in with {activeService.name}</p>
						<p class="text-xs text-[var(--color-muted)]">
							{#if activeService.type === 'plex'}
								Paste your Plex token (get one at plex.tv/security)
							{:else}
								Use your Jellyfin credentials
							{/if}
						</p>
					</div>
				</div>

				{#if form?.error && form?.authType === 'service'}
					<div class="rounded-lg border border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 px-3 py-2 text-sm text-[var(--color-warm)]">
						{form.error}
					</div>
				{/if}

				<div>
					<label for="service-username" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
						{activeService.type === 'plex' ? 'Plex Email' : 'Jellyfin Username'}
					</label>
					<input
						id="service-username"
						name="username"
						class="input"
						placeholder={activeService.type === 'plex' ? 'email@example.com' : 'username'}
						autocomplete="username"
						value={form?.username ?? ''}
						required
					/>
				</div>

				<div>
					<label for="service-password" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
						{activeService.type === 'plex' ? 'Plex Token' : 'Jellyfin Password'}
					</label>
					<input
						id="service-password"
						name="password"
						type="password"
						class="input"
						placeholder={activeService.type === 'plex' ? 'X-Plex-Token' : '••••••••'}
						autocomplete="current-password"
						required
					/>
				</div>

				{#if showNexusPassword || form?.needsNexusPassword}
					<div class="rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-body)]">
						A Nexus account with the username <strong>"{form?.collisionUsername}"</strong> already exists.
						Enter your Nexus password to link your {activeService.type === 'plex' ? 'Plex' : 'Jellyfin'} account.
					</div>
					<div>
						<label for="nexus-password" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
							Nexus Password
						</label>
						<input
							id="nexus-password"
							name="nexusPassword"
							type="password"
							class="input"
							placeholder="Your Nexus password"
							autocomplete="off"
							required
						/>
					</div>
				{/if}

				<button type="submit" class="btn btn-primary mt-2" disabled={loading}>
					{loading ? 'Signing in...' : 'Sign In'}
				</button>

				<button
					type="button"
					class="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
					onclick={backToLocal}
				>
					Back to all sign-in options
				</button>
			</form>
		{:else}
			<!-- Local login form -->
			<form method="POST" class="card p-6 flex flex-col gap-4" onsubmit={() => (loading = true)}>
				{#if form?.error && form?.authType !== 'service'}
					<div class="rounded-lg border border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 px-3 py-2 text-sm text-[var(--color-warm)]">
						{form.error}
					</div>
				{/if}

				<div>
					<label for="login-username" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Username</label>
					<input id="login-username" name="username" class="input" placeholder="admin" autocomplete="username" required />
				</div>
				<div>
					<label for="login-password" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</label>
					<input id="login-password" name="password" type="password" class="input" placeholder="••••••••" autocomplete="current-password" required />
				</div>

				<button type="submit" class="btn btn-primary mt-2" disabled={loading}>
					{loading ? 'Signing in...' : 'Sign In'}
				</button>
			</form>
		{/if}

		{#if data.registrationEnabled}
			<p class="mt-4 text-center text-xs text-[var(--color-muted)]">
				Don't have an account? <a href="/register" class="text-[var(--color-accent)] hover:underline">Create one</a>
			</p>
		{/if}

		<div class="mt-6">
			<CommunityLinks heading="Community" center />
		</div>
	</div>
</div>

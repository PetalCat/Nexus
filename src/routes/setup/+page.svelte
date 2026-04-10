<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import ServiceCard from '$lib/components/onboarding/ServiceCard.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let step = $state(0);
	let loading = $state(false);
	let connectedServices = $state<string[]>([]);

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

	async function connectService(serviceData: { type: string; url: string; apiKey?: string; username?: string; password?: string }): Promise<string | null> {
		loading = true;
		const formData = new FormData();
		formData.set('type', serviceData.type);
		formData.set('url', serviceData.url);
		if (serviceData.apiKey) formData.set('apiKey', serviceData.apiKey);
		if (serviceData.username) formData.set('username', serviceData.username);
		if (serviceData.password) formData.set('password', serviceData.password);

		try {
			const res = await fetch('?/connectService', {
				method: 'POST',
				body: formData,
			});
			const result = await res.json();

			if (result.type === 'failure') {
				loading = false;
				return result.data?.error ?? 'Connection failed';
			}

			connectedServices = [...connectedServices, serviceData.type];
			loading = false;
			return null;
		} catch {
			loading = false;
			return 'Network error — check your connection';
		}
	}
</script>

<svelte:head>
	<title>Welcome to Nexus — Setup</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center px-4" style="background: radial-gradient(ellipse at 50% 0%, var(--color-accent)15 0%, transparent 60%), var(--color-void)">
	<!-- Progress dots -->
	<div class="mb-8 flex gap-2">
		{#each dots as i (i)}
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
					{#each mediaServers as adapter (adapter.id)}
						<ServiceCard
							adapterId={adapter.id}
							displayName={adapter.displayName}
							color={adapter.color}
							abbreviation={adapter.abbreviation}
							onboarding={adapter.onboarding}
							connected={connectedServices.includes(adapter.id)}
							onConnect={async (svcData) => {
								const err = await connectService(svcData);
								if (err) {
									// Error displayed within ServiceCard via form action result
								}
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
					{#each groupedAdapters as group (group.category)}
						<div>
							<h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{group.label}</h3>
							<div class="flex flex-col gap-2">
								{#each group.adapters as adapter (adapter.id)}
									<ServiceCard
										adapterId={adapter.id}
										displayName={adapter.displayName}
										color={adapter.color}
										abbreviation={adapter.abbreviation}
										onboarding={adapter.onboarding}
										connected={connectedServices.includes(adapter.id)}
										onConnect={async (svcData) => {
											const err = await connectService(svcData);
											if (err) {
												// Error displayed within ServiceCard
											}
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
						{#each connectedServices as svcId (svcId)}
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

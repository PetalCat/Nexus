<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import ServiceCard from '$lib/components/onboarding/ServiceCard.svelte';
	import ServiceIcon from '$lib/components/onboarding/ServiceIcon.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let step = $state(0);
	let loading = $state(false);
	let connectedServices = $state<string[]>([]);
	let direction = $state(1);

	const mediaServers = $derived(
		data.adapters.filter((a) => a.onboarding.category === 'media-server')
	);
	const otherAdapters = $derived(
		data.adapters.filter((a) => a.onboarding.category !== 'media-server')
	);

	const categoryMeta: Record<string, { label: string; icon: string; description: string }> = {
		automation: { label: 'Library Management', icon: 'zap', description: 'Automate your media collection' },
		requests: { label: 'Content Requests', icon: 'film', description: 'Let users request content' },
		subtitles: { label: 'Subtitles', icon: 'chat', description: 'Automatic subtitle management' },
		analytics: { label: 'Analytics', icon: 'chart', description: 'Viewing stats and recommendations' },
		video: { label: 'Video', icon: 'shield', description: 'Privacy-friendly video streaming' },
		games: { label: 'Games', icon: 'gamepad', description: 'Retro gaming in your browser' },
		books: { label: 'Books', icon: 'book', description: 'Read and track your library' },
		indexer: { label: 'Indexers', icon: 'search', description: 'Unified indexer management' },
	};
	const categoryOrder = ['automation', 'requests', 'subtitles', 'analytics', 'video', 'games', 'books', 'indexer'];

	const groupedAdapters = $derived(
		categoryOrder
			.map((cat) => ({
				category: cat,
				...(categoryMeta[cat] ?? { label: cat, icon: 'gear', description: '' }),
				adapters: otherAdapters.filter((a) => a.onboarding.category === cat),
			}))
			.filter((g) => g.adapters.length > 0)
	);

	$effect(() => {
		if (form?.success && form.step === 'account') {
			goTo(2);
			loading = false;
		}
		if (form?.error) loading = false;
	});

	function goTo(next: number) {
		direction = next > step ? 1 : -1;
		step = next;
	}

	async function connectService(serviceData: { type: string; url: string; apiKey?: string; username?: string; password?: string }): Promise<string | null> {
		const formData = new FormData();
		formData.set('type', serviceData.type);
		formData.set('url', serviceData.url);
		if (serviceData.apiKey) formData.set('apiKey', serviceData.apiKey);
		if (serviceData.username) formData.set('username', serviceData.username);
		if (serviceData.password) formData.set('password', serviceData.password);

		try {
			const res = await fetch('?/connectService', { method: 'POST', body: formData });
			const text = await res.text();
			let result: any;
			try {
				const match = text.match(/data:\s*(\[.*\])/s);
				if (match) {
					const parsed = JSON.parse(match[1]);
					result = parsed[0]?.data ?? parsed[1]?.data;
				} else {
					result = JSON.parse(text);
				}
			} catch { result = {}; }

			if (result?.error || (res.status >= 400 && !result?.success)) {
				return result?.error ?? 'Connection failed -- check your URL and credentials';
			}
			connectedServices = [...connectedServices, serviceData.type];
			return null;
		} catch {
			return 'Network error -- check your connection';
		}
	}

	const hasMediaServer = $derived(connectedServices.some((s) => mediaServers.some((ms) => ms.id === s)));
	const addonCount = $derived(connectedServices.filter((s) => !mediaServers.some((ms) => ms.id === s)).length);

	const categoryIcons: Record<string, string> = {
		zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8',
		film: 'M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5',
		chat: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
		chart: 'M18 20V10M12 20V4M6 20v-6',
		shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
		gamepad: 'M6 12h4M8 10v4M15 13h.01M18 11h.01',
		book: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5A2.5 2.5 0 014 19.5z',
		search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
		gear: 'M12 15a3 3 0 100-6 3 3 0 000 6z',
	};
</script>

<svelte:head>
	<title>Welcome to Nexus</title>
</svelte:head>

<div class="flex min-h-screen flex-col" style="background: var(--color-void)">

	<!-- Subtle step dots -- only shown during active setup -->
	{#if step >= 1 && step <= 3}
		<div class="fixed top-6 left-1/2 -translate-x-1/2 z-10 flex gap-2">
			{#each [1, 2, 3] as i (i)}
				<div
					class="h-1.5 rounded-full transition-all duration-500"
					style="width: {i === step ? '24px' : '6px'}; background: {i === step ? 'var(--color-cream)' : i < step ? 'var(--color-accent)' : 'rgba(255,255,255,0.15)'}"
				></div>
			{/each}
		</div>
	{/if}

	<!-- Page container -->
	{#key step}
		<div
			class="flex flex-1 flex-col items-center justify-center px-6 pb-16 pt-12"
			style="animation: slideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)"
		>

			<!-- Step 0: Welcome -->
			{#if step === 0}
				<div class="flex flex-col items-center gap-10 text-center max-w-lg">
					<div class="relative">
						<div class="absolute -inset-8 rounded-full blur-[60px] animate-pulse-slow" style="background: var(--color-accent); opacity: 0.12"></div>
						<div class="relative flex h-28 w-28 items-center justify-center rounded-[2rem]" style="background: var(--color-accent)">
							<svg width="52" height="52" viewBox="-85 -754 1058 828" fill="none">
								<g transform="scale(1,-1)"><path d="M543 -5 275 483Q275 483 277.0 501.0Q279 519 281.0 542.5Q283 566 285.0 584.0Q287 602 287 602Q295 639 292.5 656.5Q290 674 272.5 680.5Q255 687 216 688L221 708Q237 707 260.5 706.0Q284 705 310 705Q357 705 391 708L615 272Q615 272 611.5 252.0Q608 232 602.0 200.5Q596 169 590.0 133.5Q584 98 578.0 66.5Q572 35 568.5 15.0Q565 -5 565 -5ZM851 737Q826 737 804.0 721.0Q782 705 766 682Q720 614 672.0 443.0Q624 272 565 -5L551 23Q566 90 583.0 167.5Q600 245 619.5 323.0Q639 401 659.5 472.0Q680 543 702.5 599.5Q725 656 748 690Q767 717 793.0 735.5Q819 754 856 754Q909 754 941.0 723.0Q973 692 973 647Q973 599 940.5 570.5Q908 542 861 542Q821 542 796.5 561.5Q772 581 772 616Q772 661 802.0 691.5Q832 722 876 729Q872 733 865.5 735.0Q859 737 851 737ZM37 -57Q65 -57 86.0 -41.5Q107 -26 123 -1Q152 45 181.5 143.0Q211 241 241.5 380.0Q272 519 303 685L320 664Q304 582 286.5 497.5Q269 413 251.0 332.5Q233 252 214.0 183.0Q195 114 176.0 63.5Q157 13 139 -11Q121 -35 96.5 -54.5Q72 -74 32 -74Q-21 -74 -53.0 -43.0Q-85 -12 -85 33Q-85 81 -52.0 109.5Q-19 138 27 138Q68 138 92.0 118.5Q116 99 116 64Q116 19 86.0 -11.0Q56 -41 12 -49Q16 -53 22.5 -55.0Q29 -57 37 -57Z" fill="white"/></g>
							</svg>
						</div>
					</div>

					<div>
						<h1 class="text-display text-5xl font-bold tracking-tight">Welcome to Nexus</h1>
						<p class="mt-4 text-xl text-[var(--color-muted)]">Your media, unified.</p>
					</div>

					<p class="text-base leading-relaxed text-[var(--color-muted)] max-w-md">
						Nexus brings all your media services together into one beautiful interface.
						Movies, shows, music, books, games -- everything in one place.
					</p>

					<div class="flex flex-col items-center gap-3 mt-2">
						<button class="btn btn-primary px-12 py-3.5 text-lg" onclick={() => goTo(1)}>
							Get Started
						</button>
						<span class="text-xs text-[var(--color-muted)] opacity-40">Takes about 2 minutes</span>
					</div>
				</div>

			<!-- Step 1: Create Account -->
			{:else if step === 1}
				<div class="flex flex-col items-center gap-10 text-center max-w-sm w-full">
					<div>
						<h2 class="text-display text-3xl font-bold">Create your account</h2>
						<p class="mt-3 text-[var(--color-muted)]">Your admin account for managing Nexus.</p>
					</div>

					<form method="POST" action="?/createAccount" class="w-full rounded-3xl border border-white/[0.06] bg-white/[0.02] p-8 flex flex-col gap-5" use:enhance={() => { loading = true; return async ({ update }) => { await update({ reset: false }); }; }}>
						{#if form?.error && form.step === 'account'}
							<div class="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{form.error}</div>
						{/if}

						<label class="flex flex-col gap-2">
							<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Username</span>
							<input name="username" class="input py-3" placeholder="admin" autocomplete="username" required />
						</label>
						<label class="flex flex-col gap-2">
							<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Display Name</span>
							<input name="displayName" class="input py-3" placeholder="Your name" required />
						</label>
						<div class="grid grid-cols-2 gap-4">
							<label class="flex flex-col gap-2">
								<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</span>
								<input name="password" type="password" class="input py-3" placeholder="--------" autocomplete="new-password" required />
							</label>
							<label class="flex flex-col gap-2">
								<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Confirm</span>
								<input name="confirm" type="password" class="input py-3" placeholder="--------" autocomplete="new-password" required />
							</label>
						</div>

						<button type="submit" class="btn btn-primary py-3 text-base mt-2" disabled={loading}>
							{loading ? 'Creating...' : 'Continue'}
						</button>
					</form>
				</div>

			<!-- Step 2: Media Server -->
			{:else if step === 2}
				<div class="flex flex-col items-center gap-10 text-center max-w-2xl w-full">
					<div>
						<h2 class="text-display text-3xl font-bold">Choose your media server</h2>
						<p class="mt-3 text-[var(--color-muted)]">The heart of Nexus -- where your movies, shows, and music live.</p>
					</div>

					<!-- Hero cards for media servers -->
					<div class="w-full grid {mediaServers.length > 1 ? 'grid-cols-2' : 'grid-cols-1 max-w-md'} gap-5">
						{#each mediaServers as adapter (adapter.id)}
							<ServiceCard
								adapterId={adapter.id}
								displayName={adapter.displayName}
								color={adapter.color}
								abbreviation={adapter.abbreviation}
								defaultPort={adapter.defaultPort}
								onboarding={adapter.onboarding}
								connected={connectedServices.includes(adapter.id)}
								hero
								onConnect={connectService}
							/>
						{/each}
					</div>

					<div class="flex w-full items-center {hasMediaServer ? 'justify-between' : 'justify-center'}">
						{#if !hasMediaServer}
							<button class="text-sm text-[var(--color-muted)] hover:text-[var(--color-cream)] transition-colors" onclick={() => goTo(3)}>
								I'll set this up later
							</button>
						{/if}
						{#if hasMediaServer}
							<div></div>
							<button class="btn btn-primary px-10 py-3" onclick={() => goTo(3)}>Continue</button>
						{/if}
					</div>
				</div>

			<!-- Step 3: Add-ons -->
			{:else if step === 3}
				<div class="flex flex-col items-center gap-10 text-center max-w-2xl w-full">
					<div>
						<h2 class="text-display text-3xl font-bold">Enhance your experience</h2>
						<p class="mt-3 text-[var(--color-muted)]">Connect additional services to unlock more features. All optional.</p>
					</div>

					<div class="w-full flex flex-col gap-8 max-h-[55vh] overflow-y-auto text-left pb-4 pr-1 scrollbar-hide">
						{#each groupedAdapters as group (group.category)}
							<div>
								<div class="flex items-center gap-3 mb-3 px-1">
									<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04]">
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-[var(--color-muted)]">
											<path d={categoryIcons[group.icon] ?? categoryIcons['gear']} />
										</svg>
									</div>
									<div>
										<h3 class="text-sm font-bold text-[var(--color-cream)]">{group.label}</h3>
										<p class="text-xs text-[var(--color-muted)]">{group.description}</p>
									</div>
								</div>
								<div class="flex flex-col gap-2">
									{#each group.adapters as adapter (adapter.id)}
										<ServiceCard
											adapterId={adapter.id}
											displayName={adapter.displayName}
											color={adapter.color}
											abbreviation={adapter.abbreviation}
											onboarding={adapter.onboarding}
											connected={connectedServices.includes(adapter.id)}
											onConnect={connectService}
										/>
									{/each}
								</div>
							</div>
						{/each}
					</div>

					<div class="flex w-full items-center justify-between">
						<button class="text-sm text-[var(--color-muted)] hover:text-[var(--color-cream)] transition-colors" onclick={() => goTo(4)}>
							{addonCount > 0 ? '' : "I'll do this later"}
						</button>
						<button class="btn btn-primary px-10 py-3" onclick={() => goTo(4)}>
							{addonCount > 0 ? 'Continue' : 'Finish Setup'}
						</button>
					</div>
				</div>

			<!-- Step 4: Done -->
			{:else if step === 4}
				<div class="flex flex-col items-center gap-10 text-center max-w-lg">
					<div class="relative">
						<div class="absolute -inset-8 rounded-full blur-[60px] animate-pulse-slow" style="background: #22c55e; opacity: 0.1"></div>
						<div class="relative flex h-24 w-24 items-center justify-center rounded-full bg-green-500/10">
							<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M20 6L9 17l-5-5" />
							</svg>
						</div>
					</div>

					<div>
						<h2 class="text-display text-4xl font-bold">You're all set</h2>
						<p class="mt-3 text-lg text-[var(--color-muted)]">
							{#if connectedServices.length === 0}
								You can connect services from your dashboard anytime.
							{:else}
								{connectedServices.length} service{connectedServices.length > 1 ? 's' : ''} connected and ready.
							{/if}
						</p>
					</div>

					{#if connectedServices.length > 0}
						<div class="flex flex-wrap justify-center gap-3">
							{#each connectedServices as svcId (svcId)}
								{@const adapter = data.adapters.find((a) => a.id === svcId)}
								{#if adapter}
									<div class="flex items-center gap-2 rounded-full px-4 py-2" style="background: {adapter.color}12; border: 1px solid {adapter.color}25">
										<div style="color: {adapter.color}"><ServiceIcon type={adapter.id} size={14} /></div>
										<span class="text-sm font-medium" style="color: {adapter.color}">{adapter.displayName}</span>
									</div>
								{/if}
							{/each}
						</div>
					{/if}

					<a href="/" class="btn btn-primary px-12 py-3.5 text-lg mt-2">
						Enter Nexus
					</a>
				</div>
			{/if}
		</div>
	{/key}
</div>

<style>
	@keyframes slideIn {
		from { opacity: 0; transform: translateY(20px); }
		to { opacity: 1; transform: translateY(0); }
	}

	:global(.animate-pulse-slow) {
		animation: pulseSlow 4s ease-in-out infinite;
	}

	@keyframes pulseSlow {
		0%, 100% { opacity: 0.12; }
		50% { opacity: 0.2; }
	}
</style>

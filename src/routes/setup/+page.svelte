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

	const categoryMeta: Record<string, { label: string; description: string }> = {
		automation: { label: 'Library Management', description: 'Manage downloads, monitor quality, and automate your collection' },
		requests: { label: 'Content Requests', description: 'Let your users request movies, shows, and music' },
		subtitles: { label: 'Subtitles', description: 'Automatic subtitle management for your library' },
		analytics: { label: 'Analytics', description: 'Track viewing activity and get personalized recommendations' },
		video: { label: 'Video', description: 'Privacy-friendly video streaming with ad-blocking' },
		games: { label: 'Games', description: 'Browse and play your retro game collection in-browser' },
		books: { label: 'Books', description: 'Read books, take notes, and track your reading' },
		indexer: { label: 'Indexers', description: 'Unified indexer management for your automation services' },
	};

	const categoryOrder = ['automation', 'requests', 'subtitles', 'analytics', 'video', 'games', 'books', 'indexer'];

	const groupedAdapters = $derived(
		categoryOrder
			.map((cat) => ({
				category: cat,
				...categoryMeta[cat],
				adapters: otherAdapters.filter((a) => a.onboarding.category === cat),
			}))
			.filter((g) => g.adapters.length > 0)
	);

	$effect(() => {
		if (form?.success && form.step === 'account') {
			step = 2;
			loading = false;
		}
		if (form?.error) {
			loading = false;
		}
	});

	const steps = ['Welcome', 'Account', 'Media Server', 'Add-ons', 'Done'];

	async function connectService(serviceData: { type: string; url: string; apiKey?: string; username?: string; password?: string }): Promise<string | null> {
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
			const text = await res.text();
			let result: any;
			try {
				// SvelteKit form action responses need special parsing
				const match = text.match(/data:\s*(\[.*\])/s);
				if (match) {
					const parsed = JSON.parse(match[1]);
					result = parsed[0]?.data ?? parsed[1]?.data;
				} else {
					result = JSON.parse(text);
				}
			} catch {
				result = {};
			}

			if (result?.error || (res.status >= 400 && !result?.success)) {
				return result?.error ?? 'Connection failed — check your URL and credentials';
			}

			connectedServices = [...connectedServices, serviceData.type];
			return null;
		} catch {
			return 'Network error — check your connection';
		}
	}

	const hasMediaServer = $derived(connectedServices.some((s) => mediaServers.some((ms) => ms.id === s)));
	const addonCount = $derived(connectedServices.filter((s) => !mediaServers.some((ms) => ms.id === s)).length);
</script>

<svelte:head>
	<title>Welcome to Nexus — Setup</title>
</svelte:head>

<div class="flex min-h-screen flex-col" style="background: var(--color-void)">
	<!-- Top bar with step indicator -->
	{#if step > 0 && step < 4}
		<div class="flex items-center justify-between px-6 py-4">
			<div class="flex items-center gap-2 text-[var(--color-muted)]">
				{#each steps as label, i (label)}
					{#if i > 0 && i < 4}
						<div class="flex items-center gap-2">
							{#if i > 1}
								<div class="h-px w-6" style="background: {i <= step ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)'}"></div>
							{/if}
							<div
								class="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-300"
								style="background: {i === step ? 'var(--color-accent)' : i < step ? 'var(--color-accent)' : 'rgba(255,255,255,0.06)'}; color: {i <= step ? 'white' : 'var(--color-muted)'}"
							>
								{#if i < step}
									<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6l3 3 5-5"/></svg>
								{:else}
									{i}
								{/if}
							</div>
							<span class="text-xs {i === step ? 'text-[var(--color-cream)] font-medium' : ''}">{label}</span>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}

	<div class="flex flex-1 flex-col items-center justify-center px-4 pb-12">

		<!-- Step 0: Welcome -->
		{#if step === 0}
			<div class="flex flex-col items-center gap-8 text-center" style="animation: fadeIn 0.6s ease-out">
				<div class="relative">
					<div class="absolute inset-0 rounded-3xl blur-3xl" style="background: var(--color-accent); opacity: 0.15"></div>
					<div class="relative flex h-24 w-24 items-center justify-center rounded-3xl" style="background: var(--color-accent)">
						<svg width="44" height="44" viewBox="-85 -754 1058 828" fill="none">
							<g transform="scale(1,-1)"><path d="M543 -5 275 483Q275 483 277.0 501.0Q279 519 281.0 542.5Q283 566 285.0 584.0Q287 602 287 602Q295 639 292.5 656.5Q290 674 272.5 680.5Q255 687 216 688L221 708Q237 707 260.5 706.0Q284 705 310 705Q357 705 391 708L615 272Q615 272 611.5 252.0Q608 232 602.0 200.5Q596 169 590.0 133.5Q584 98 578.0 66.5Q572 35 568.5 15.0Q565 -5 565 -5ZM851 737Q826 737 804.0 721.0Q782 705 766 682Q720 614 672.0 443.0Q624 272 565 -5L551 23Q566 90 583.0 167.5Q600 245 619.5 323.0Q639 401 659.5 472.0Q680 543 702.5 599.5Q725 656 748 690Q767 717 793.0 735.5Q819 754 856 754Q909 754 941.0 723.0Q973 692 973 647Q973 599 940.5 570.5Q908 542 861 542Q821 542 796.5 561.5Q772 581 772 616Q772 661 802.0 691.5Q832 722 876 729Q872 733 865.5 735.0Q859 737 851 737ZM37 -57Q65 -57 86.0 -41.5Q107 -26 123 -1Q152 45 181.5 143.0Q211 241 241.5 380.0Q272 519 303 685L320 664Q304 582 286.5 497.5Q269 413 251.0 332.5Q233 252 214.0 183.0Q195 114 176.0 63.5Q157 13 139 -11Q121 -35 96.5 -54.5Q72 -74 32 -74Q-21 -74 -53.0 -43.0Q-85 -12 -85 33Q-85 81 -52.0 109.5Q-19 138 27 138Q68 138 92.0 118.5Q116 99 116 64Q116 19 86.0 -11.0Q56 -41 12 -49Q16 -53 22.5 -55.0Q29 -57 37 -57Z" fill="white"/></g>
						</svg>
					</div>
				</div>
				<div>
					<h1 class="text-display text-4xl font-bold tracking-tight">Welcome to Nexus</h1>
					<p class="mt-3 text-lg text-[var(--color-muted)]">Your media, unified.</p>
				</div>
				<p class="max-w-sm text-sm leading-relaxed text-[var(--color-muted)]">
					Nexus brings all your media services together into one beautiful interface.
					Movies, shows, music, books, games — all in one place.
				</p>
				<button
					class="btn btn-primary mt-4 px-10 py-3 text-base"
					onclick={() => (step = 1)}
				>
					Get Started
				</button>
				<p class="text-xs text-[var(--color-muted)] opacity-50">Takes about 2 minutes</p>
			</div>

		<!-- Step 1: Create Admin Account -->
		{:else if step === 1}
			<div class="w-full max-w-sm flex flex-col items-center gap-8" style="animation: fadeIn 0.4s ease-out">
				<div class="text-center">
					<h2 class="text-display text-2xl font-bold">Create your account</h2>
					<p class="mt-2 text-sm text-[var(--color-muted)]">This is your admin account for managing Nexus and all its services.</p>
				</div>

				<form method="POST" action="?/createAccount" class="w-full rounded-2xl border border-white/[0.06] bg-[var(--color-surface)] p-6 flex flex-col gap-4" onsubmit={() => (loading = true)}>
					{#if form?.error && form.step === 'account'}
						<div class="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
							{form.error}
						</div>
					{/if}

					<label class="flex flex-col gap-1.5">
						<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">Username</span>
						<input name="username" class="input" placeholder="admin" autocomplete="username" required />
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">Display Name</span>
						<input name="displayName" class="input" placeholder="Your name" required />
					</label>
					<div class="grid grid-cols-2 gap-3">
						<label class="flex flex-col gap-1.5">
							<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</span>
							<input name="password" type="password" class="input" placeholder="••••••••" autocomplete="new-password" required />
						</label>
						<label class="flex flex-col gap-1.5">
							<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">Confirm</span>
							<input name="confirm" type="password" class="input" placeholder="••••••••" autocomplete="new-password" required />
						</label>
					</div>

					<button type="submit" class="btn btn-primary mt-2 py-2.5" disabled={loading}>
						{loading ? 'Creating account...' : 'Continue'}
					</button>
				</form>
			</div>

		<!-- Step 2: Media Server -->
		{:else if step === 2}
			<div class="w-full max-w-lg flex flex-col items-center gap-8" style="animation: fadeIn 0.4s ease-out">
				<div class="text-center">
					<h2 class="text-display text-2xl font-bold">Connect your media server</h2>
					<p class="mt-2 text-sm text-[var(--color-muted)]">This is the heart of Nexus — where your movies, shows, and music live.</p>
				</div>

				<div class="w-full flex flex-col gap-4">
					{#each mediaServers as adapter (adapter.id)}
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

				<div class="flex w-full items-center {hasMediaServer ? 'justify-between' : 'justify-center'}">
					<button
						class="text-sm text-[var(--color-muted)] hover:text-[var(--color-cream)] transition-colors"
						onclick={() => (step = 3)}
					>
						{hasMediaServer ? '' : 'Skip for now \u2192'}
					</button>
					{#if hasMediaServer}
						<button class="btn btn-primary px-8" onclick={() => (step = 3)}>
							Continue
						</button>
					{/if}
				</div>
			</div>

		<!-- Step 3: Add-ons -->
		{:else if step === 3}
			<div class="w-full max-w-2xl flex flex-col items-center gap-8" style="animation: fadeIn 0.4s ease-out">
				<div class="text-center">
					<h2 class="text-display text-2xl font-bold">Enhance your experience</h2>
					<p class="mt-2 text-sm text-[var(--color-muted)]">Connect additional services to unlock more features. All optional — you can add these later.</p>
				</div>

				<div class="w-full flex flex-col gap-8 max-h-[55vh] overflow-y-auto pr-1 pb-2">
					{#each groupedAdapters as group (group.category)}
						<div>
							<div class="mb-3">
								<h3 class="text-sm font-semibold text-[var(--color-cream)]">{group.label}</h3>
								<p class="text-xs text-[var(--color-muted)] mt-0.5">{group.description}</p>
							</div>
							<div class="flex flex-col gap-3">
								{#each group.adapters as adapter (adapter.id)}
									<ServiceCard
										adapterId={adapter.id}
										displayName={adapter.displayName}
										color={adapter.color}
										abbreviation={adapter.abbreviation}
										onboarding={adapter.onboarding}
										connected={connectedServices.includes(adapter.id)}
										compact
										onConnect={connectService}
									/>
								{/each}
							</div>
						</div>
					{/each}
				</div>

				<div class="flex w-full items-center justify-between">
					<button
						class="text-sm text-[var(--color-muted)] hover:text-[var(--color-cream)] transition-colors"
						onclick={() => (step = 4)}
					>
						{addonCount > 0 ? '' : "Skip — I'll do this later"}
					</button>
					<button class="btn btn-primary px-8" onclick={() => (step = 4)}>
						{addonCount > 0 ? 'Continue' : 'Finish Setup'}
					</button>
				</div>
			</div>

		<!-- Step 4: Done -->
		{:else if step === 4}
			<div class="w-full max-w-md flex flex-col items-center gap-8 text-center" style="animation: fadeIn 0.6s ease-out">
				<div class="relative">
					<div class="absolute inset-0 rounded-full blur-3xl" style="background: #22c55e; opacity: 0.1"></div>
					<div class="relative flex h-20 w-20 items-center justify-center rounded-full bg-green-500/15">
						<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M20 6L9 17l-5-5" />
						</svg>
					</div>
				</div>

				<div>
					<h2 class="text-display text-3xl font-bold">You're all set</h2>
					<p class="mt-2 text-[var(--color-muted)]">
						{#if connectedServices.length === 0}
							No services connected yet — you can add them from your dashboard anytime.
						{:else}
							{connectedServices.length} service{connectedServices.length > 1 ? 's' : ''} connected and ready to go.
						{/if}
					</p>
				</div>

				{#if connectedServices.length > 0}
					<div class="flex flex-wrap justify-center gap-2">
						{#each connectedServices as svcId (svcId)}
							{@const adapter = data.adapters.find((a) => a.id === svcId)}
							{#if adapter}
								<span
									class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white"
									style="background: {adapter.color}30; color: {adapter.color}"
								>
									<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="5" fill="currentColor" opacity="0.5"/></svg>
									{adapter.displayName}
								</span>
							{/if}
						{/each}
					</div>
				{/if}

				<a href="/" class="btn btn-primary mt-4 px-10 py-3 text-base">
					Enter Nexus
				</a>
			</div>
		{/if}
	</div>
</div>

<style>
	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(12px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>

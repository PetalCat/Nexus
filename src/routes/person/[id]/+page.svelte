<script lang="ts">
	import type { PageData } from './$types';
	import { ArrowLeft, User } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	interface Credit {
		id: number;
		media_type: string;
		title?: string;
		name?: string;
		poster_path?: string;
		character?: string;
		job?: string;
		department?: string;
		release_date?: string;
		first_air_date?: string;
		vote_average?: number;
		popularity?: number;
		mediaAvailability?: { status: number };
	}

	interface DepartmentGroup {
		department: string;
		credits: Credit[];
	}

	const person = $derived(data.person);

	const profileUrl = $derived(
		person?.profile_path
			? `https://image.tmdb.org/t/p/w300${person.profile_path}`
			: null
	);

	const birthday = $derived(
		person?.birthday
			? new Date(person.birthday).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
			: null
	);

	const age = $derived.by(() => {
		if (!person?.birthday) return null;
		const bday = new Date(person.birthday);
		const deathOrNow = person.deathday ? new Date(person.deathday) : new Date();
		let a = deathOrNow.getFullYear() - bday.getFullYear();
		const m = deathOrNow.getMonth() - bday.getMonth();
		if (m < 0 || (m === 0 && deathOrNow.getDate() < bday.getDate())) a--;
		return a;
	});

	const departments = $derived.by((): DepartmentGroup[] => {
		if (!data.credits) return [];

		const castCredits: Credit[] = (data.credits.cast ?? []).map((c: Credit) => ({
			...c,
			department: 'Acting'
		}));
		const crewCredits: Credit[] = (data.credits.crew ?? []).map((c: Credit) => ({
			...c,
			department: c.department ?? 'Other'
		}));

		const allCredits = [...castCredits, ...crewCredits];

		// Deduplicate by id + department
		const seen = new Set<string>();
		const unique = allCredits.filter((c) => {
			const key = `${c.id}-${c.department}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		// Group by department
		const groups = new Map<string, Credit[]>();
		for (const credit of unique) {
			const dept = credit.department ?? 'Other';
			if (!groups.has(dept)) groups.set(dept, []);
			groups.get(dept)!.push(credit);
		}

		// Sort credits within each group by popularity desc
		const deptOrder = ['Acting', 'Directing', 'Writing', 'Production', 'Other'];
		const result: DepartmentGroup[] = [];
		for (const dept of deptOrder) {
			if (groups.has(dept)) {
				const credits = groups.get(dept)!.sort(
					(a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)
				);
				result.push({ department: dept, credits });
				groups.delete(dept);
			}
		}
		// Remaining departments
		for (const [dept, credits] of groups) {
			credits.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
			result.push({ department: dept, credits });
		}

		return result;
	});

	function creditYear(credit: Credit): string {
		const date = credit.release_date ?? credit.first_air_date ?? '';
		return date ? date.slice(0, 4) : '';
	}

	function creditTitle(credit: Credit): string {
		return credit.title ?? credit.name ?? 'Unknown';
	}

	function creditPoster(credit: Credit): string | null {
		return credit.poster_path
			? `https://image.tmdb.org/t/p/w300${credit.poster_path}`
			: null;
	}

	function creditType(credit: Credit): string {
		return credit.media_type === 'tv' ? 'show' : 'movie';
	}

	function creditRole(credit: Credit): string {
		return credit.character ?? credit.job ?? '';
	}

	function isAvailable(credit: Credit): boolean {
		return (credit.mediaAvailability?.status ?? 0) >= 3;
	}

	function isRequestable(credit: Credit): boolean {
		const s = credit.mediaAvailability?.status ?? 0;
		return s > 0 && s < 3;
	}
</script>

<svelte:head>
	<title>{person?.name ?? 'Person'} — Nexus</title>
</svelte:head>

{#if !person}
	<div class="flex flex-col items-center justify-center px-3 py-24 text-center sm:px-4 lg:px-6">
		<div
			class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]"
		>
			<User size={28} strokeWidth={1.2} />
		</div>
		<p class="text-lg font-semibold text-[var(--color-cream)]">Person not found</p>
		<p class="mt-1 text-sm text-[var(--color-muted)]">This person could not be loaded.</p>
	</div>
{:else}
	<div class="pb-10">
		<!-- Header -->
		<div class="px-3 pb-6 pt-4 sm:px-4 lg:px-6">
			<button
				onclick={() => history.back()}
				class="mb-5 flex w-fit items-center gap-1.5 rounded-lg bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]"
				aria-label="Go back"
				type="button"
			>
				<ArrowLeft size={14} strokeWidth={2} />
				Back
			</button>

			<div class="flex flex-col gap-5 sm:flex-row sm:gap-6">
				<!-- Profile photo -->
				<div class="mx-auto flex-shrink-0 sm:mx-0">
					{#if profileUrl}
						<img
							src={profileUrl}
							alt={person.name}
							class="h-[150px] w-[100px] rounded-xl object-cover shadow-lg shadow-black/30"
							loading="eager"
						/>
					{:else}
						<div
							class="flex h-[150px] w-[100px] items-center justify-center rounded-xl bg-[var(--color-surface)]"
						>
							<User size={32} strokeWidth={1} class="text-[var(--color-muted)]" style="opacity: 0.4;" />
						</div>
					{/if}
				</div>

				<!-- Bio -->
				<div class="flex-1 text-center sm:text-left">
					<h1 class="text-display text-2xl font-bold sm:text-3xl">{person.name}</h1>

					{#if person.known_for_department}
						<span class="mt-1 inline-block text-sm font-medium text-[var(--color-accent)]">
							{person.known_for_department}
						</span>
					{/if}

					<div class="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted)] sm:justify-start">
						{#if birthday}
							<span>Born {birthday}{age !== null ? ` (age ${age})` : ''}</span>
						{/if}
						{#if person.place_of_birth}
							<span>{person.place_of_birth}</span>
						{/if}
						{#if person.deathday}
							<span>Died {new Date(person.deathday).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
						{/if}
					</div>

					{#if person.biography}
						<p class="mt-3 line-clamp-4 max-w-2xl text-sm leading-relaxed text-[var(--color-cream)]/70">
							{person.biography}
						</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- Filmography -->
		{#if departments.length > 0}
			<div class="mt-4 space-y-10 px-3 sm:px-4 lg:px-6">
				{#each departments as group (group.department)}
					<section>
						<div class="mb-4 flex items-baseline gap-2">
							<h2 class="text-display text-lg font-semibold">{group.department}</h2>
							<span class="text-xs text-[var(--color-muted)]">
								{group.credits.length} credit{group.credits.length === 1 ? '' : 's'}
							</span>
						</div>

						<div
							class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(130px,1fr))] sm:gap-4"
						>
							{#each group.credits as credit (credit.id)}
								{@const poster = creditPoster(credit)}
								{@const year = creditYear(credit)}
								{@const role = creditRole(credit)}
								{@const type = creditType(credit)}
								<a
									href="/media/{type}/{credit.id}?service=overseerr"
									class="group relative overflow-hidden rounded-xl border border-[rgba(240,235,227,0.04)] bg-[var(--color-surface)] transition-all duration-300 hover:border-[rgba(240,235,227,0.1)] hover:shadow-lg hover:shadow-black/20"
									aria-label="{creditTitle(credit)}{role ? `, ${role}` : ''}{year ? `, ${year}` : ''}"
								>
									<!-- Poster -->
									<div class="aspect-[2/3] overflow-hidden bg-[var(--color-raised)]">
										{#if poster}
											<img
												src={poster}
												alt=""
												class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
												loading="lazy"
											/>
										{:else}
											<div class="flex h-full w-full items-center justify-center" style="background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-raised) 100%);">
												<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.2;">
													<rect x="2" y="4" width="20" height="16" rx="2" />
													<path d="M10 4v16M2 12h20" />
												</svg>
											</div>
										{/if}

										<!-- Availability indicator -->
										{#if isAvailable(credit)}
											<div
												class="pointer-events-none absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/90 text-white"
												title="Available"
											>
												<svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
													<path d="M2 6l3 3 5-5" />
												</svg>
											</div>
										{:else if isRequestable(credit)}
											<div
												class="pointer-events-none absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-accent)]/90 text-white text-[9px] font-bold"
												title="Requestable"
											>
												+
											</div>
										{/if}
									</div>

									<!-- Info -->
									<div class="p-2">
										<h3 class="line-clamp-2 text-xs font-semibold leading-tight text-[var(--color-cream)] transition-colors duration-200 group-hover:text-[var(--color-accent)]">
											{creditTitle(credit)}
										</h3>
										{#if role}
											<p class="mt-0.5 line-clamp-1 text-[10px] text-[var(--color-accent)]/70">
												{role}
											</p>
										{/if}
										{#if year}
											<p class="mt-0.5 text-[10px] text-[var(--color-muted)]">{year}</p>
										{/if}
									</div>
								</a>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{:else}
			<div class="px-3 py-12 text-center sm:px-4 lg:px-6">
				<p class="text-sm text-[var(--color-muted)]">No filmography data available.</p>
			</div>
		{/if}
	</div>
{/if}

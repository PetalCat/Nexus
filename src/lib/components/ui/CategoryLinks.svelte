<script lang="ts">
	import { Film, Tv, Music, BookOpen, Gamepad2, Radio, ArrowRight } from 'lucide-svelte';

	interface CategoryItem {
		id: string;
		label: string;
		href: string;
		count: number;
		image?: string;
	}

	interface Props {
		categories: CategoryItem[];
	}

	let { categories }: Props = $props();

	const iconMap: Record<string, typeof Film> = {
		movies: Film,
		shows: Tv,
		music: Music,
		books: BookOpen,
		games: Gamepad2,
		live: Radio
	};

	const accentMap: Record<string, { gradient: string; glow: string; text: string; border: string }> = {
		movies: {
			gradient: 'from-accent/25 via-accent/5 to-transparent',
			glow: 'group-hover:shadow-[0_8px_40px_rgba(212,162,83,0.15)]',
			text: 'text-accent',
			border: 'border-accent/10 group-hover:border-accent/25'
		},
		shows: {
			gradient: 'from-steel/25 via-steel/5 to-transparent',
			glow: 'group-hover:shadow-[0_8px_40px_rgba(61,143,132,0.15)]',
			text: 'text-steel-light',
			border: 'border-steel/10 group-hover:border-steel/25'
		},
		music: {
			gradient: 'from-accent-dim/25 via-accent-dim/5 to-transparent',
			glow: 'group-hover:shadow-[0_8px_40px_rgba(184,134,46,0.15)]',
			text: 'text-accent',
			border: 'border-accent-dim/10 group-hover:border-accent-dim/25'
		},
		books: {
			gradient: 'from-steel-light/25 via-steel-light/5 to-transparent',
			glow: 'group-hover:shadow-[0_8px_40px_rgba(86,169,157,0.15)]',
			text: 'text-steel-light',
			border: 'border-steel-light/10 group-hover:border-steel-light/25'
		},
		games: {
			gradient: 'from-warm/25 via-warm/5 to-transparent',
			glow: 'group-hover:shadow-[0_8px_40px_rgba(196,92,92,0.15)]',
			text: 'text-warm-light',
			border: 'border-warm/10 group-hover:border-warm/25'
		},
		live: {
			gradient: 'from-warm/25 via-warm/5 to-transparent',
			glow: 'group-hover:shadow-[0_8px_40px_rgba(196,92,92,0.15)]',
			text: 'text-warm-light',
			border: 'border-warm/10 group-hover:border-warm/25'
		}
	};

	const defaultAccent = {
		gradient: 'from-cream/25 via-cream/5 to-transparent',
		glow: 'group-hover:shadow-[0_8px_40px_rgba(240,235,227,0.1)]',
		text: 'text-cream',
		border: 'border-cream/10 group-hover:border-cream/25'
	};
</script>

<section aria-label="Browse media library">
	<div class="mb-6 flex items-center gap-4">
		<div class="flex items-center gap-3">
			<div class="h-[18px] w-[3px] rounded-full bg-gradient-to-b from-accent to-accent-dim" aria-hidden="true"></div>
			<h2 class="font-display text-xl font-bold tracking-wide text-cream/90">
				Browse Library
			</h2>
		</div>
		<div class="h-px flex-1 bg-gradient-to-r from-cream/[0.04] to-transparent" aria-hidden="true"></div>
	</div>

	<div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4">
		{#each categories as cat (cat.id)}
			{@const Icon = iconMap[cat.id] ?? Film}
			{@const accent = accentMap[cat.id] ?? defaultAccent}
			<a
				href={cat.href}
				class="group relative flex min-h-[120px] flex-col justify-between overflow-hidden rounded-2xl border bg-nexus-base/80 p-5 transition-all duration-500 ease-out-expo hover:scale-[1.02] {accent.border} {accent.glow}"
				class:opacity-30={cat.count === 0}
				class:pointer-events-none={cat.count === 0}
				aria-label="{cat.label} — {cat.count} {cat.count === 1 ? 'item' : 'items'}"
			>
				<!-- Background image -->
				{#if cat.image}
					<img
						src={cat.image}
						alt=""
						class="absolute inset-0 h-full w-full object-cover opacity-[0.06] blur-[2px] transition-all duration-700 ease-out group-hover:opacity-[0.14] group-hover:blur-[1px] group-hover:scale-110"
						aria-hidden="true"
					/>
				{/if}

				<!-- Gradient overlay -->
				<div class="absolute inset-0 bg-gradient-to-br {accent.gradient} opacity-0 transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true"></div>

				<!-- Content -->
				<div class="relative z-10 flex items-start justify-between">
					<div
						class="flex h-10 w-10 items-center justify-center rounded-xl bg-cream/[0.04] transition-all duration-500 group-hover:bg-cream/[0.08] group-hover:scale-110"
					>
						<Icon size={20} strokeWidth={1.5} class="{accent.text} transition-all duration-300" />
					</div>
					<ArrowRight
						size={16}
						strokeWidth={1.5}
						class="text-faint/0 transition-all duration-500 group-hover:translate-x-1 group-hover:text-cream/40"
					/>
				</div>

				<div class="relative z-10 mt-auto">
					<h3 class="font-display text-[17px] font-bold text-cream transition-colors duration-300">
						{cat.label}
					</h3>
					<p class="mt-0.5 font-body text-xs text-faint transition-colors duration-300 group-hover:text-muted">
						{cat.count} {cat.count === 1 ? 'item' : 'items'}
					</p>
				</div>
			</a>
		{/each}
	</div>
</section>

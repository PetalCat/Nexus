<script lang="ts">
	import { Play, BookOpen, Gamepad2, Plus, Headphones, Radio } from 'lucide-svelte';
	import type { ActionType } from '$lib/types/media-ui';

	interface Props {
		action: ActionType;
		size?: 'sm' | 'md' | 'lg';
		onclick?: () => void;
	}

	let { action, size = 'md', onclick }: Props = $props();

	const config: Record<ActionType, { label: string; classes: string }> = {
		watch: {
			label: 'Watch',
			classes:
				'bg-accent text-nexus-void hover:bg-accent-light hover:shadow-[0_4px_24px_rgba(212,162,83,0.3)] active:shadow-[0_2px_12px_rgba(212,162,83,0.2)]'
		},
		read: {
			label: 'Read',
			classes:
				'bg-steel text-cream hover:bg-steel-light hover:shadow-[0_4px_24px_rgba(61,143,132,0.3)]'
		},
		play: {
			label: 'Play',
			classes:
				'bg-warm text-cream hover:bg-warm-light hover:shadow-[0_4px_24px_rgba(196,92,92,0.3)]'
		},
		request: {
			label: 'Request',
			classes:
				'bg-transparent text-accent ring-1 ring-accent/30 hover:ring-accent/60 hover:bg-accent/[0.06] hover:text-accent-light'
		},
		listen: {
			label: 'Listen',
			classes:
				'bg-accent text-nexus-void hover:bg-accent-light hover:shadow-[0_4px_24px_rgba(212,162,83,0.3)]'
		},
		stream: {
			label: 'Stream',
			classes:
				'bg-steel text-cream hover:bg-steel-light hover:shadow-[0_4px_24px_rgba(61,143,132,0.3)]'
		}
	};

	const icons: Record<ActionType, typeof Play> = {
		watch: Play,
		read: BookOpen,
		play: Gamepad2,
		request: Plus,
		listen: Headphones,
		stream: Radio
	};

	const sizeClasses: Record<string, string> = {
		sm: 'px-4 py-1.5 text-xs gap-1.5',
		md: 'px-6 py-2.5 text-sm gap-2',
		lg: 'px-8 py-3.5 text-[15px] gap-2.5'
	};

	const iconSizes: Record<string, number> = { sm: 13, md: 15, lg: 17 };

	const cfg = $derived(config[action]);
	const Icon = $derived(icons[action]);
</script>

<button
	class="inline-flex items-center rounded-full font-body font-semibold tracking-wide transition-all duration-300 ease-out-expo {cfg.classes} {sizeClasses[size]} active:scale-[0.97]"
	{onclick}
>
	<Icon size={iconSizes[size]} strokeWidth={action === 'watch' || action === 'listen' ? 0 : 2} class={action === 'watch' || action === 'listen' ? 'fill-current' : ''} />
	{cfg.label}
</button>

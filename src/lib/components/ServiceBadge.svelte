<script lang="ts">
	interface Props {
		type: string;
		name?: string;
	}
	let { type, name }: Props = $props();

	const colors: Record<string, string> = {
		jellyfin: '#00a4dc',
		calibre: '#7b68ee',
		romm: '#e84393',
		overseerr: '#f59e0b',
		radarr: '#fbbf24',
		sonarr: '#00d4aa',
		lidarr: '#1db954',
		prowlarr: '#ef4444'
	};

	const color = $derived(colors[type] ?? '#7c6cf8');
</script>

<span
	class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
	style="background: {color}20; color: {color}"
>
	{name ?? type}
</span>

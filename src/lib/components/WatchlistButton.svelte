<script lang="ts">
	import { Bookmark } from 'lucide-svelte';

	interface Props {
		mediaId: string;
		serviceId: string;
		mediaType: string;
		mediaTitle: string;
		mediaPoster?: string;
		inWatchlist?: boolean;
		watchlistItemId?: string | null;
	}

	let {
		mediaId,
		serviceId,
		mediaType,
		mediaTitle,
		mediaPoster,
		inWatchlist = $bindable(false),
		watchlistItemId = $bindable(null)
	}: Props = $props();

	let loading = $state(false);

	async function toggle() {
		if (loading) return;
		loading = true;
		try {
			if (inWatchlist && watchlistItemId) {
				const res = await fetch(`/api/user/watchlist?id=${encodeURIComponent(watchlistItemId)}`, {
					method: 'DELETE'
				});
				if (res.ok) {
					inWatchlist = false;
					watchlistItemId = null;
				}
			} else {
				const res = await fetch('/api/user/watchlist', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ mediaId, serviceId, mediaType, mediaTitle, mediaPoster })
				});
				if (res.ok) {
					const data = await res.json();
					inWatchlist = true;
					watchlistItemId = data.id;
				}
			}
		} finally {
			loading = false;
		}
	}
</script>

<button
	onclick={toggle}
	class="group/wl flex items-center justify-center rounded-xl p-2.5 transition-all duration-300
		{inWatchlist
		? 'bg-accent/15 text-accent hover:bg-accent/20'
		: 'bg-cream/[0.06] text-muted hover:bg-cream/[0.1] hover:text-cream'}"
	title={inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
	disabled={loading}
>
	<Bookmark
		size={18}
		strokeWidth={inWatchlist ? 2.5 : 1.5}
		fill={inWatchlist ? 'currentColor' : 'none'}
		class="transition-all duration-300 {inWatchlist ? 'scale-110' : 'group-hover/wl:scale-105'}"
	/>
</button>

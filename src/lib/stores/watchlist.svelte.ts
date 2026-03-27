import { browser } from '$app/environment';
import { toast } from '$lib/stores/toast.svelte';

interface WatchlistEntry {
	id: string;
	mediaId: string;
	serviceId: string;
	mediaType: string;
	mediaTitle: string;
	mediaPoster: string | null;
}

let watchlistItems = $state<WatchlistEntry[]>([]);
let loaded = $state(false);

// Index for O(1) lookup by mediaId:serviceId
const index = $derived.by(() => {
	const map = new Map<string, WatchlistEntry>();
	for (const f of watchlistItems) {
		map.set(`${f.mediaId}:${f.serviceId}`, f);
	}
	return map;
});

export const watchlistStore = {
	get favorites() { return watchlistItems; },
	get loaded() { return loaded; },

	isInWatchlist(mediaId: string, serviceId: string): boolean {
		return index.has(`${mediaId}:${serviceId}`);
	},

	getWatchlistItemId(mediaId: string, serviceId: string): string | null {
		return index.get(`${mediaId}:${serviceId}`)?.id ?? null;
	},

	async load() {
		if (!browser || loaded) return;
		try {
			const res = await fetch('/api/user/watchlist');
			if (res.ok) {
				watchlistItems = await res.json();
				loaded = true;
			}
		} catch { /* silent */ }
	},

	async toggle(item: { sourceId: string; serviceId: string; type: string; title: string; poster?: string | null }) {
		const key = `${item.sourceId}:${item.serviceId}`;
		const existing = index.get(key);

		if (existing) {
			// Remove — optimistic
			const prev = [...watchlistItems];
			watchlistItems = watchlistItems.filter((f) => f.id !== existing.id);
			try {
				const res = await fetch(`/api/user/watchlist?id=${existing.id}`, { method: 'DELETE' });
				if (!res.ok) { watchlistItems = prev; toast.error('Failed to remove from watchlist'); }
				else toast.info('Removed from watchlist');
			} catch {
				watchlistItems = prev;
				toast.error('Failed to remove from watchlist');
			}
		} else {
			// Add — optimistic
			const tempId = crypto.randomUUID();
			const entry: WatchlistEntry = {
				id: tempId,
				mediaId: item.sourceId,
				serviceId: item.serviceId,
				mediaType: item.type,
				mediaTitle: item.title,
				mediaPoster: item.poster ?? null
			};
			watchlistItems = [...watchlistItems, entry];
			try {
				const res = await fetch('/api/user/watchlist', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						mediaId: item.sourceId,
						serviceId: item.serviceId,
						mediaType: item.type,
						mediaTitle: item.title,
						mediaPoster: item.poster ?? null
					})
				});
				if (res.ok) {
					const { id } = await res.json();
					watchlistItems = watchlistItems.map((f) => f.id === tempId ? { ...f, id } : f);
					toast.success('Added to watchlist');
				} else {
					watchlistItems = watchlistItems.filter((f) => f.id !== tempId);
					toast.error('Failed to add to watchlist');
				}
			} catch {
				watchlistItems = watchlistItems.filter((f) => f.id !== tempId);
				toast.error('Failed to add to watchlist');
			}
		}
	}
};

import type { UnifiedMedia } from '$lib/adapters/types';
import type { UnifiedMedia as VideoCardMedia } from '$lib/types/media-ui';

export function formatDuration(secs?: number): string {
	if (!secs) return '';
	const h = Math.floor(secs / 3600);
	const m = Math.floor((secs % 3600) / 60);
	const s = secs % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatViews(views?: number): string {
	if (!views) return '';
	if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
	if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`;
	return `${views}`;
}

export function formatCount(n: number): string {
	if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return `${n}`;
}

export function toVideoCardMedia(item: UnifiedMedia): VideoCardMedia {
	return {
		id: item.id,
		type: 'video',
		title: item.title,
		description: item.description ?? '',
		image: item.poster ?? '',
		source: 'invidious',
		metadata: {
			channel: item.metadata?.author ?? '',
			views: formatViews(item.metadata?.viewCount as number | undefined),
			duration: formatDuration(item.duration),
			uploadDate: (() => {
				const pub = item.metadata?.published as number | undefined;
				if (!pub || typeof pub !== 'number') return '';
				const d = new Date(pub * 1000);
				return isNaN(d.getTime()) ? '' : d.toISOString();
			})()
		}
	};
}

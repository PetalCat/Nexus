import type { ServiceConfig } from '../types';
import type { UnifiedMedia } from '../types';
import type { CalibreFormat, OpdsEntry } from './types';

/** Convert an OPDS acquisition into Nexus's public format representation. */
export function acquisitionsToFormats(entry: OpdsEntry): CalibreFormat[] {
	const seen = new Set<string>();
	const out: CalibreFormat[] = [];
	for (const acq of entry.acquisitions) {
		const name = acq.format.toUpperCase();
		if (seen.has(name)) continue;
		seen.add(name);
		out.push({
			name,
			downloadUrl: `/api/books/${entry.id}/download/${name.toLowerCase()}`
		});
	}
	return out;
}

function proxiedCoverUrl(config: ServiceConfig, entry: OpdsEntry): string | undefined {
	const href = entry.coverHref ?? entry.thumbHref ?? (entry.id ? `/opds/cover/${entry.id}` : undefined);
	if (!href) return undefined;
	return `/api/media/image?service=${encodeURIComponent(config.id)}&path=${encodeURIComponent(href)}`;
}

export function opdsEntryToUnifiedMedia(config: ServiceConfig, entry: OpdsEntry): UnifiedMedia {
	const year = entry.published ? entry.published.getFullYear() : undefined;
	const rating = entry.ratingStars !== undefined ? entry.ratingStars * 2 : undefined;
	const formatCount = entry.acquisitions.length;

	return {
		id: `${entry.id}:${config.id}`,
		sourceId: entry.id,
		serviceId: config.id,
		serviceType: 'calibre',
		type: 'book',
		title: entry.title,
		description: entry.description,
		poster: proxiedCoverUrl(config, entry),
		year: year && !isNaN(year) ? year : undefined,
		rating,
		genres: entry.categories,
		status: 'available',
		metadata: {
			calibreId: entry.id,
			uuid: entry.uuid,
			author: entry.authors.join(', ') || undefined,
			authorSort: entry.authors.join(', ') || undefined,
			publisher: entry.publishers.join(', ') || undefined,
			language: entry.language && entry.language !== 'Unknown' ? entry.language : undefined,
			seriesName: entry.series,
			seriesIndex: entry.seriesIndex,
			formatCount,
			formats: acquisitionsToFormats(entry)
		},
		actionLabel: 'Read',
		actionUrl: `/books/read/${entry.id}?service=${config.id}`,
		streamUrl: formatCount > 0 ? `/api/books/${entry.id}/read` : undefined
	};
}

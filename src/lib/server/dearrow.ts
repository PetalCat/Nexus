import { withCache } from './cache';

interface DeArrowBranding {
	titles: Array<{ title: string; original: boolean; votes: number; locked: boolean }>;
	thumbnails: Array<{ timestamp?: number; original: boolean; votes: number; locked: boolean }>;
	videoDuration: number | null;
}

/**
 * Fetch DeArrow branding for a video ID.
 * Returns the best community title and thumbnail timestamp, or null if none.
 */
export async function getDeArrowBranding(videoId: string): Promise<{
	title?: string;
	thumbnailTimestamp?: number;
} | null> {
	return withCache(`dearrow:${videoId}`, 3_600_000, async () => {
		try {
			const res = await fetch(
				`https://sponsor.ajay.app/api/branding?videoID=${encodeURIComponent(videoId)}`,
				{ signal: AbortSignal.timeout(5000) }
			);
			if (!res.ok) return null;
			const data: DeArrowBranding = await res.json();

			// Best title: highest votes, non-original, or locked
			const bestTitle = data.titles
				?.filter(t => !t.original)
				?.sort((a, b) => (b.locked ? 1 : 0) - (a.locked ? 1 : 0) || b.votes - a.votes)?.[0];

			// Best thumbnail: highest votes, non-original
			const bestThumb = data.thumbnails
				?.filter(t => !t.original && t.timestamp != null)
				?.sort((a, b) => (b.locked ? 1 : 0) - (a.locked ? 1 : 0) || b.votes - a.votes)?.[0];

			if (!bestTitle && !bestThumb) return null;

			return {
				title: bestTitle?.title,
				thumbnailTimestamp: bestThumb?.timestamp
			};
		} catch {
			return null;
		}
	});
}

/**
 * Build a DeArrow thumbnail URL for an Invidious instance.
 * Uses the DeArrow API's thumbnail endpoint to get a frame at the specified timestamp.
 */
export function deArrowThumbnailUrl(videoId: string, timestamp: number): string {
	return `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${encodeURIComponent(videoId)}&time=${timestamp}`;
}

/**
 * SponsorBlock API client
 *
 * Uses the privacy-preserving SHA-256 prefix lookup API.
 * Docs: https://wiki.sponsor.ajay.app/w/API_Docs
 */

const SB_BASE = 'https://sponsor.ajay.app/api';

/** All SponsorBlock segment categories */
export const SB_CATEGORIES = [
	'sponsor',
	'selfpromo',
	'interaction',
	'intro',
	'outro',
	'preview',
	'music_offtopic',
	'filler',
	'poi_highlight',
	'chapter'
] as const;

export type SBCategory = (typeof SB_CATEGORIES)[number];

/** Action the user wants for each category */
export type SBAction = 'skip' | 'mute' | 'ask' | 'show' | 'off';

export type SBCategorySettings = Record<SBCategory, SBAction>;

/** A single segment from the API */
export interface SBSegment {
	UUID: string;
	category: SBCategory;
	actionType: 'skip' | 'mute' | 'full' | 'poi' | 'chapter';
	segment: [number, number]; // [start, end] in seconds
	videoDuration: number;
	locked: number;
	votes: number;
	description?: string;
}

/** Human-readable labels & colours for each category */
export const SB_CATEGORY_INFO: Record<SBCategory, { label: string; color: string; description: string }> = {
	sponsor: { label: 'Sponsor', color: '#00d400', description: 'Paid promotion, sponsorship, or endorsement' },
	selfpromo: { label: 'Self-Promotion', color: '#ffff00', description: 'Unpaid/self-promotion links or credits' },
	interaction: { label: 'Interaction', color: '#cc00ff', description: '"Subscribe", "like", notification bell reminders' },
	intro: { label: 'Intro', color: '#00ffff', description: 'Intro animation, title card, or opening' },
	outro: { label: 'Outro', color: '#0202ed', description: 'End cards, credits, outro' },
	preview: { label: 'Preview', color: '#008fd6', description: 'Collection of clips showing what\'s coming up' },
	music_offtopic: { label: 'Non-Music', color: '#ff9900', description: 'In music videos: tangent or non-music section' },
	filler: { label: 'Filler', color: '#7300FF', description: 'Tangential, filler, or off-topic content' },
	poi_highlight: { label: 'Highlight', color: '#ff1684', description: 'The point/highlight of the video' },
	chapter: { label: 'Chapter', color: '#ffd679', description: 'User-submitted chapters' }
};

export const DEFAULT_CATEGORY_SETTINGS: SBCategorySettings = {
	sponsor: 'skip',
	selfpromo: 'skip',
	interaction: 'skip',
	intro: 'off',
	outro: 'off',
	preview: 'off',
	music_offtopic: 'off',
	filler: 'off',
	poi_highlight: 'show',
	chapter: 'off'
};

/**
 * Fetch segments for a YouTube video using the privacy-preserving prefix API.
 * We compute a SHA-256 hash of the videoID and send the first 4 hex chars
 * so the server doesn't know the exact video being queried.
 */
export async function fetchSegments(videoId: string, categories?: SBCategory[]): Promise<SBSegment[]> {
	try {
		// Compute SHA-256 hash prefix for privacy
		const encoder = new TextEncoder();
		const data = encoder.encode(videoId);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
		const prefix = hashHex.slice(0, 4);

		const cats = categories ?? SB_CATEGORIES.filter(c => c !== 'chapter');
		const catParam = encodeURIComponent(JSON.stringify(cats));

		const url = `${SB_BASE}/skipSegments/${prefix}?categories=${catParam}`;
		console.log('[SB API] Fetching:', url);

		const res = await fetch(url, {
			headers: { 'Accept': 'application/json' },
			signal: AbortSignal.timeout(5000)
		});

		console.log('[SB API] Response status:', res.status);
		if (res.status === 404) { console.log('[SB API] No segments (404)'); return []; }
		if (!res.ok) { console.warn('[SB API] Error response:', res.status, res.statusText); return []; }

		const results: Array<{ videoID: string; segments: SBSegment[] }> = await res.json();
		console.log('[SB API] Results count:', results.length, 'Looking for videoId:', videoId);
		const match = results.find(r => r.videoID === videoId);
		console.log('[SB API] Matched segments:', match?.segments?.length ?? 0);
		return match?.segments ?? [];
	} catch (err) {
		console.error('[SB API] Error:', err);
		return [];
	}
}

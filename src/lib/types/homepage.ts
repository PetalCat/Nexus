// Shared homepage types — safe for both server and client imports

// Calendar items use a different shape than HomepageItem (they carry releaseDate/status).
// We import the shared CalendarItem type so a calendar row can be represented as just
// another HomepageRow in the canonical ordered list.
import type { CalendarItem } from '$lib/adapters/types';

export interface HeroItem {
	id: string;
	sourceId: string;
	serviceId: string;
	serviceType: string;
	title: string;
	year?: number;
	runtime?: string;
	rating?: number;
	overview?: string;
	backdrop?: string;
	poster?: string;
	mediaType: string;
	genres?: string[];
	reason: string;
	provider: string;
	streamUrl?: string;
	trailerVideo?: string;
	trailerAudio?: string | null;
}

export interface HomepageItem {
	id: string;
	sourceId: string;
	serviceId: string;
	serviceType: string;
	title: string;
	poster?: string;
	backdrop?: string;
	year?: number;
	mediaType: string;
	genres?: string[];
	rating?: number;
	context?: string;
	progress?: number;
	timeRemaining?: string;
	episodeInfo?: string;
	streamUrl?: string;
	description?: string;
}

export interface HomepageRow {
	id: string;
	title: string;
	subtitle?: string;
	// Row shape classes:
	//   'reason' — recommendation provider reason row (trending, friends, time-aware, recommended, external)
	//   'genre' — per-genre row, ordered by user affinity
	//   'system' — non-personalized shelves (continue, new-in-library, upcoming-*, suggestions)
	//   'calendar' — upcoming-releases calendar row (renders from calendarItems, not items)
	type: 'reason' | 'genre' | 'system' | 'calendar';
	items: HomepageItem[];
	// Populated only when type === 'calendar'. Distinct shape keeps rendering
	// specialized without forcing HomepageItem to carry release-date/status fields.
	calendarItems?: CalendarItem[];
}

export interface HomepageCache {
	hero: HeroItem[];
	rows: HomepageRow[];
	computedAt: number;
}

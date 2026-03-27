// Shared homepage types — safe for both server and client imports

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
	type: 'reason' | 'genre' | 'system';
	items: HomepageItem[];
}

export interface HomepageCache {
	hero: HeroItem[];
	rows: HomepageRow[];
	computedAt: number;
}

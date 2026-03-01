export type MediaType = 'movie' | 'show' | 'episode' | 'book' | 'game' | 'music' | 'album' | 'live';

export type MediaStatus = 'available' | 'requested' | 'downloading' | 'missing' | 'continuing';

export interface UnifiedMedia {
	id: string;
	sourceId: string;
	serviceId: string;
	serviceType: string;
	type: MediaType;
	title: string;
	sortTitle?: string;
	description?: string;
	poster?: string;
	backdrop?: string;
	year?: number;
	rating?: number;
	genres?: string[];
	studios?: string[];
	duration?: number; // seconds
	status?: MediaStatus;
	progress?: number; // 0-1
	metadata?: Record<string, unknown>;
	// Computed
	actionLabel?: string;
	actionUrl?: string;
}

export interface UnifiedSearchResult {
	items: UnifiedMedia[];
	total: number;
	source: string;
}

export interface ServiceConfig {
	id: string;
	name: string;
	type: string;
	url: string;
	apiKey?: string;
	username?: string;
	password?: string;
	enabled: boolean;
}

export interface DashboardRow {
	id: string;
	title: string;
	items: UnifiedMedia[];
}

export interface ServiceHealth {
	serviceId: string;
	name: string;
	type: string;
	online: boolean;
	latency?: number;
	error?: string;
}

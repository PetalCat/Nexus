/**
 * Base adapter interface for Nexus service integrations.
 *
 * To create a custom adapter:
 * 1. Create a new file in src/lib/adapters/ (e.g. my-service.ts)
 * 2. Implement the ServiceAdapter interface
 * 3. Register it in src/lib/adapters/registry.ts
 *
 * Only implement the methods your service supports — all are optional
 * except `ping`, `id`, `displayName`, and `defaultPort`.
 */

import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult } from './types';

export interface ServiceAdapter {
	/** Unique identifier matching the `type` field in the services table */
	readonly id: string;

	/** Human-readable name shown in the UI */
	readonly displayName: string;

	/** Default port for this service (used in setup wizard hints) */
	readonly defaultPort: number;

	/** Icon name or SVG string for the service */
	readonly icon?: string;

	/** Categories of media this adapter provides */
	readonly mediaTypes?: Array<'movie' | 'show' | 'book' | 'game' | 'music' | 'live' | 'other'>;

	/** Check if the service is reachable */
	ping(config: ServiceConfig): Promise<ServiceHealth>;

	/** Items the user is currently in progress on */
	getContinueWatching?(config: ServiceConfig): Promise<UnifiedMedia[]>;

	/** Recently added items */
	getRecentlyAdded?(config: ServiceConfig): Promise<UnifiedMedia[]>;

	/** Full-text search */
	search?(config: ServiceConfig, query: string): Promise<UnifiedSearchResult>;

	/** Fetch a single item by its source ID */
	getItem?(config: ServiceConfig, sourceId: string): Promise<UnifiedMedia | null>;

	/** Items currently being downloaded / in queue */
	getQueue?(config: ServiceConfig): Promise<UnifiedMedia[]>;

	/** Trending / recommended items */
	getTrending?(config: ServiceConfig): Promise<UnifiedMedia[]>;

	/** Submit a request for new media */
	requestMedia?(config: ServiceConfig, tmdbId: string, type: 'movie' | 'tv'): Promise<boolean>;
}

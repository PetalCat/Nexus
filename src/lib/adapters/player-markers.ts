/**
 * Server-side shapes for post-play data (#19).
 *
 * These intentionally mirror the UI-facing types in
 * src/lib/components/player/types.ts so the page-server loader can pass
 * adapter output through with minimal massaging. They're declared here
 * (not imported from the component file) to keep server modules free of
 * Svelte component deps.
 */

export interface NextItemData {
	/** sourceId on the adapter (not UnifiedMedia.id). */
	id: string;
	serviceId: string;
	title: string;
	subtitle?: string;
	poster?: string;
	/** seconds */
	duration?: number;
	/** 0..1 */
	progress?: number;
}

export interface SkipMarkerData {
	kind: 'intro' | 'credits' | 'recap';
	startSec: number;
	endSec: number;
	label?: string;
}

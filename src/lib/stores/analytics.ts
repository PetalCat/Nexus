import { browser } from '$app/environment';

interface PendingEvent {
	eventType: string;
	page?: string;
	target?: string;
	targetTitle?: string;
	referrer?: string;
	searchQuery?: string;
	position?: Record<string, unknown>;
	durationMs?: number;
	metadata?: Record<string, unknown>;
	timestamp: number;
}

const FLUSH_INTERVAL = 5000;
const MAX_BATCH = 200;

let queue: PendingEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let currentPage = '';
let pageEnteredAt = 0;

function enqueue(event: PendingEvent) {
	queue.push(event);
	if (queue.length >= MAX_BATCH) flush();
}

function flush() {
	if (queue.length === 0) return;
	const batch = queue.splice(0, MAX_BATCH);
	try {
		if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
			navigator.sendBeacon('/api/ingest/interactions', JSON.stringify({ events: batch }));
		} else {
			fetch('/api/ingest/interactions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ events: batch }),
				keepalive: true
			}).catch(() => {});
		}
	} catch {
		// Best-effort
	}
}

/**
 * Initialize the analytics collector. Call once from +layout.svelte.
 */
export function initAnalytics() {
	if (!browser) return;

	flushTimer = setInterval(flush, FLUSH_INTERVAL);

	window.addEventListener('beforeunload', () => {
		if (currentPage && pageEnteredAt) {
			enqueue({
				eventType: 'page_view',
				page: currentPage,
				durationMs: Date.now() - pageEnteredAt,
				timestamp: pageEnteredAt
			});
		}
		flush();
	});

	// Click tracking — captures clicks on elements with data-track attribute
	document.addEventListener(
		'click',
		(e) => {
			const target = (e.target as HTMLElement).closest('[data-track]');
			if (!target) return;

			const trackId = target.getAttribute('data-track') ?? '';
			const trackTitle = target.getAttribute('data-track-title') ?? '';
			const trackPosition = target.getAttribute('data-track-position');

			enqueue({
				eventType: 'click',
				page: window.location.pathname,
				target: trackId,
				targetTitle: trackTitle,
				position: trackPosition ? JSON.parse(trackPosition) : undefined,
				timestamp: Date.now()
			});
		},
		{ passive: true }
	);
}

/**
 * Track SvelteKit page navigation. Call from afterNavigate.
 */
export function trackPageView(toPath: string) {
	if (!browser) return;

	// Close previous page view
	if (currentPage && pageEnteredAt) {
		enqueue({
			eventType: 'page_view',
			page: currentPage,
			durationMs: Date.now() - pageEnteredAt,
			referrer: document.referrer || undefined,
			timestamp: pageEnteredAt
		});
	}

	currentPage = toPath;
	pageEnteredAt = Date.now();
}

/**
 * Track a search event.
 */
export function trackSearch(query: string, resultCount: number) {
	if (!browser) return;
	enqueue({
		eventType: 'search',
		page: window.location.pathname,
		searchQuery: query,
		metadata: { resultCount },
		timestamp: Date.now()
	});
}

/**
 * Track a custom interaction event.
 */
export function trackEvent(
	eventType: string,
	data?: {
		target?: string;
		targetTitle?: string;
		position?: Record<string, unknown>;
		metadata?: Record<string, unknown>;
	}
) {
	if (!browser) return;
	enqueue({
		eventType,
		page: window.location.pathname,
		target: data?.target,
		targetTitle: data?.targetTitle,
		position: data?.position,
		metadata: data?.metadata,
		timestamp: Date.now()
	});
}

export function destroyAnalytics() {
	if (flushTimer) clearInterval(flushTimer);
	flush();
}

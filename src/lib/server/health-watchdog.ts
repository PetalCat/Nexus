/**
 * Health Watchdog — background monitor that detects when backend services
 * recover from outages and instantly invalidates stale caches.
 *
 * Without this, a downed backend produces empty/partial data that gets cached
 * for the full TTL (30s–300s). The watchdog detects offline→online transitions
 * and flushes caches so the very next request picks up the recovered service.
 */

import { registry } from '../adapters/registry';
import type { ServiceConfig, ServiceHealth } from '../adapters/types';
import { getServiceConfigs } from './services';
import { invalidateAll, invalidatePrefix } from './cache';

// ── State ────────────────────────────────────────────────────────────────

/** Last known health per service ID: true = online, false = offline */
const lastKnown = new Map<string, boolean>();

let watchdogInterval: ReturnType<typeof setInterval> | null = null;

const WATCHDOG_INTERVAL_MS = 15_000; // Check every 15s
const PING_TIMEOUT_MS = 5_000;

/** Callback invoked when one or more services transition from offline → online */
let onRecovery: ((recovered: string[]) => void) | null = null;

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Register a callback that fires whenever services recover.
 * The callback receives an array of recovered service IDs.
 */
export function onServiceRecovery(cb: (recovered: string[]) => void): void {
	onRecovery = cb;
}

export function startHealthWatchdog(): void {
	if (watchdogInterval) return;
	console.log('[watchdog] Starting health watchdog (every 15s)');

	// Seed initial state (all unknown → first check populates it)
	runHealthCheck().catch(() => {});

	watchdogInterval = setInterval(() => {
		runHealthCheck().catch((e) =>
			console.error('[watchdog] Health check cycle error:', e)
		);
	}, WATCHDOG_INTERVAL_MS);
}

export function stopHealthWatchdog(): void {
	if (watchdogInterval) {
		clearInterval(watchdogInterval);
		watchdogInterval = null;
		console.log('[watchdog] Health watchdog stopped');
	}
}

/** Get current known health state for all tracked services */
export function getKnownHealth(): Map<string, boolean> {
	return new Map(lastKnown);
}

// ── Core ─────────────────────────────────────────────────────────────────

async function runHealthCheck(): Promise<void> {
	const configs = getServiceConfigs();
	if (configs.length === 0) return;

	const results = await Promise.allSettled(
		configs.map((config) => pingService(config))
	);

	const recovered: string[] = [];

	for (let i = 0; i < configs.length; i++) {
		const config = configs[i];
		const result = results[i];
		const isOnline = result.status === 'fulfilled' && result.value;

		const wasOnline = lastKnown.get(config.id);

		// Detect offline → online transition
		if (isOnline && wasOnline === false) {
			console.log(`[watchdog] Service recovered: ${config.name} (${config.type})`);
			recovered.push(config.id);
		}

		// Detect online → offline transition (log only)
		if (!isOnline && wasOnline === true) {
			console.warn(`[watchdog] Service went offline: ${config.name} (${config.type})`);
		}

		lastKnown.set(config.id, isOnline);
	}

	// Clean up entries for services that no longer exist
	for (const id of lastKnown.keys()) {
		if (!configs.some((c) => c.id === id)) {
			lastKnown.delete(id);
		}
	}

	if (recovered.length > 0) {
		handleRecovery(recovered, configs);
	}
}

async function pingService(config: ServiceConfig): Promise<boolean> {
	const adapter = registry.get(config.type);
	if (!adapter) return false;

	try {
		const ping = adapter.ping(config);
		const timeout = new Promise<ServiceHealth>((_, reject) =>
			setTimeout(() => reject(new Error('timeout')), PING_TIMEOUT_MS)
		);
		const result = await Promise.race([ping, timeout]);
		return result.online;
	} catch {
		return false;
	}
}

/**
 * When services recover, invalidate all caches that may contain stale
 * empty/partial data from when the service was down.
 */
function handleRecovery(recoveredIds: string[], configs: ServiceConfig[]): void {
	// Invalidate health cache so next health check returns fresh data
	invalidatePrefix('health');

	// Invalidate all content caches that aggregate across services
	invalidatePrefix('cw:');           // continue watching
	invalidatePrefix('new-in-library');
	invalidatePrefix('library:');
	invalidatePrefix('live-channels:');
	invalidatePrefix('queue');
	invalidatePrefix('admin-');
	invalidatePrefix('ss-recs-');
	invalidatePrefix('discover:');
	invalidatePrefix('trending:');
	invalidatePrefix('recently-added');

	// Invalidate search caches (if any)
	invalidatePrefix('search:');

	console.log(`[watchdog] Invalidated caches for ${recoveredIds.length} recovered service(s)`);

	// Notify via callback (used by WS to push to clients)
	if (onRecovery) {
		try {
			const names = recoveredIds.map((id) => {
				const cfg = configs.find((c) => c.id === id);
				return cfg?.name ?? id;
			});
			onRecovery(recoveredIds);
		} catch (e) {
			console.error('[watchdog] Recovery callback error:', e);
		}
	}
}

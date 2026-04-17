/**
 * Bounded, per-key TTL cache built on `lru-cache`.
 *
 * Survives across requests within the same Node process (dev + prod).
 *
 * Callers should ensure that user-scoped data is keyed by userId — the module
 * can't enforce that, but issue #4 in the Apr-17 security cluster was caused
 * by forgetting that rule. When in doubt, include `${userId ?? 'anon'}` in
 * the key.
 *
 * Configuration:
 *   NEXUS_CACHE_MAX_ENTRIES  -- hard cap on total keys (default 5000). When
 *                              exceeded, least-recently-used keys are evicted.
 */

import { LRUCache } from 'lru-cache';

interface CacheEntry<T> {
	data: T;
	expires: number;
}

// The longest stale-grace window any caller passes to `withStaleCache`. We use
// it as the `ttl` bound on the LRU so entries older than (fresh + stale) can
// be dropped regardless of LRU pressure. This mirrors the 30-minute ceiling
// used by services.ts:403.
const MAX_TOTAL_LIFETIME_MS = 60 * 60_000; // 60 min — headroom over 30-min stale ceiling

function resolveMaxEntries(): number {
	const raw = process.env.NEXUS_CACHE_MAX_ENTRIES;
	if (!raw) return 5000;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0) return 5000;
	return n;
}

// Module-scoped stores. `store` holds resolved data with a per-entry expires
// timestamp (we still honor these ourselves, since stale-while-revalidate
// callers need to read expired-but-usable entries). `inflight` dedupes
// concurrent misses so we never make two upstream calls for the same key.
const store = new LRUCache<string, CacheEntry<unknown>>({
	max: resolveMaxEntries(),
	ttl: MAX_TOTAL_LIFETIME_MS,
	// Let us read an entry even after `ttl` has elapsed — the
	// stale-while-revalidate path does this explicitly.
	allowStale: true,
	// We still look at `entry.expires` for our own freshness check; LRU
	// ttl is just a ceiling to prevent leaks for rarely-touched keys.
	updateAgeOnGet: true
});

const inflight = new Map<string, Promise<unknown>>();

// Lightweight counters for the debug hook (issue #8). Not exported; consumers
// go through `__debugCacheStats`.
let hits = 0;
let misses = 0;

// Background sweep — walks expired entries and evicts them so one-off
// parameterized keys (e.g. per-user calendar queries) don't linger until LRU
// pressure kicks in. Registered lazily so tests that import the module don't
// inherit a live timer by default.
let sweepInterval: ReturnType<typeof setInterval> | null = null;

function ensureSweep(): void {
	if (sweepInterval) return;
	const STALE_GRACE_MS = 30 * 60_000;
	sweepInterval = setInterval(() => {
		const cutoff = Date.now() - STALE_GRACE_MS;
		// Iterate a snapshot of keys — mutating during for-of on the live LRU
		// is officially supported but the snapshot is cheaper than re-reading.
		for (const key of [...store.keys()]) {
			const entry = store.peek(key) as CacheEntry<unknown> | undefined;
			if (entry && entry.expires < cutoff) store.delete(key);
		}
	}, 60_000);
	if (sweepInterval.unref) sweepInterval.unref();
}

/** TTL resolver — either a fixed number of ms or a function that computes
 *  a TTL from the resolved value (useful for short-TTL negative caching). */
export type TtlSpec<T> = number | ((data: T) => number);

function resolveTtl<T>(spec: TtlSpec<T>, data: T): number {
	return typeof spec === 'function' ? spec(data) : spec;
}

/**
 * Return cached value if fresh, otherwise call `fn`, cache the result, and
 * return it. `ttlMs` — how long to cache in milliseconds. May be a function
 * of the resolved value (used to cache negative results for a shorter window
 * than hits).
 */
export async function withCache<T>(
	key: string,
	ttlMs: TtlSpec<T>,
	fn: () => Promise<T>
): Promise<T> {
	ensureSweep();
	const hit = store.get(key) as CacheEntry<T> | undefined;
	if (hit && Date.now() < hit.expires) {
		hits++;
		return hit.data;
	}
	misses++;

	const pending = inflight.get(key);
	if (pending) return pending as Promise<T>;

	const request = (async () => {
		try {
			const data = await fn();
			store.set(key, { data, expires: Date.now() + resolveTtl(ttlMs, data) });
			return data;
		} finally {
			inflight.delete(key);
		}
	})();

	inflight.set(key, request);
	return request;
}

/**
 * Return fresh cached data when available. If the cached entry is stale but
 * still within the stale window, return it immediately and refresh in the
 * background.
 */
export async function withStaleCache<T>(
	key: string,
	ttlMs: TtlSpec<T>,
	staleMs: number,
	fn: () => Promise<T>
): Promise<T> {
	ensureSweep();
	// Use `peek` so we see stale entries without triggering LRU touch.
	const hit = store.peek(key) as CacheEntry<T> | undefined;
	const now = Date.now();

	if (hit && now < hit.expires) {
		hits++;
		// Bump recency — we served a fresh hit.
		store.get(key);
		return hit.data;
	}

	if (hit && now < hit.expires + staleMs) {
		hits++;
		// Kick a background refresh without awaiting it.
		if (!inflight.has(key)) {
			const refresh = (async () => {
				try {
					const data = await fn();
					store.set(key, { data, expires: Date.now() + resolveTtl(ttlMs, data) });
					return data;
				} finally {
					inflight.delete(key);
				}
			})();
			inflight.set(key, refresh);
			// Swallow background errors so we don't crash the process.
			refresh.catch(() => {});
		}
		return hit.data;
	}

	misses++;
	return withCache(key, ttlMs, fn);
}

/** Invalidate a single key (e.g. after a mutation). */
export function invalidate(key: string): void {
	store.delete(key);
	inflight.delete(key);
}

/** Invalidate all keys matching a prefix. */
export function invalidatePrefix(prefix: string): void {
	for (const key of [...store.keys()]) {
		if (key.startsWith(prefix)) store.delete(key);
	}
	for (const key of [...inflight.keys()]) {
		if (key.startsWith(prefix)) inflight.delete(key);
	}
}

/** Invalidate every cached entry. */
export function invalidateAll(): void {
	store.clear();
	inflight.clear();
	hits = 0;
	misses = 0;
}

/**
 * Debug-only hook for tests and ad-hoc admin diagnostics. Not wired into a
 * user-facing endpoint (parker's directive for cycle 1). Treat any non-test
 * callers as a code smell until we land a proper admin observability page.
 */
export function __debugCacheStats(): {
	size: number;
	max: number;
	hits: number;
	misses: number;
} {
	return { size: store.size, max: store.max, hits, misses };
}

/** Test-only: introspect current keys. Gated by NODE_ENV. */
export function __debugCacheKeys(): string[] {
	if (process.env.NODE_ENV !== 'test') return [];
	return [...store.keys()];
}

/** Test-only: stop the sweep timer so vitest can exit cleanly. */
export function __stopCacheSweep(): void {
	if (sweepInterval) {
		clearInterval(sweepInterval);
		sweepInterval = null;
	}
}

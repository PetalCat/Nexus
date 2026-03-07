/**
 * Simple in-process TTL cache for expensive server-side API calls.
 * Survives across requests within the same Node process (dev + prod).
 */

interface CacheEntry<T> {
	data: T;
	expires: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Return cached value if fresh, otherwise call `fn`, cache the result, and return it.
 * `ttlMs` — how long to cache in milliseconds.
 */
export async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
	const hit = store.get(key);
	if (hit && Date.now() < hit.expires) {
		return hit.data as T;
	}
	const data = await fn();
	store.set(key, { data, expires: Date.now() + ttlMs });
	return data;
}

/** Invalidate a single key (e.g. after a mutation). */
export function invalidate(key: string) {
	store.delete(key);
}

/** Invalidate all keys matching a prefix. */
export function invalidatePrefix(prefix: string) {
	for (const key of store.keys()) {
		if (key.startsWith(prefix)) store.delete(key);
	}
}

/** Invalidate every cached entry. */
export function invalidateAll() {
	store.clear();
}

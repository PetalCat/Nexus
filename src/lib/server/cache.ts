/**
 * Simple in-process TTL cache for expensive server-side API calls.
 * Survives across requests within the same Node process (dev + prod).
 */

interface CacheEntry<T> {
	data: T;
	expires: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Return cached value if fresh, otherwise call `fn`, cache the result, and return it.
 * `ttlMs` — how long to cache in milliseconds.
 */
export async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
	const hit = store.get(key);
	if (hit && Date.now() < hit.expires) {
		return hit.data as T;
	}

	const pending = inflight.get(key);
	if (pending) {
		return pending as Promise<T>;
	}

	const request = (async () => {
		try {
			const data = await fn();
			store.set(key, { data, expires: Date.now() + ttlMs });
			return data;
		} finally {
			inflight.delete(key);
		}
	})();

	inflight.set(key, request);
	return request;
}

/**
 * Return fresh cached data when available. If the cached entry is stale but still within the
 * stale window, return it immediately and refresh in the background.
 */
export async function withStaleCache<T>(
	key: string,
	ttlMs: number,
	staleMs: number,
	fn: () => Promise<T>
): Promise<T> {
	const hit = store.get(key) as CacheEntry<T> | undefined;
	const now = Date.now();

	if (hit && now < hit.expires) {
		return hit.data;
	}

	if (hit && now < hit.expires + staleMs) {
		if (!inflight.has(key)) {
			const refresh = (async () => {
				try {
					const data = await fn();
					store.set(key, { data, expires: Date.now() + ttlMs });
					return data;
				} finally {
					inflight.delete(key);
				}
			})();
			inflight.set(key, refresh);
		}
		return hit.data;
	}

	return withCache(key, ttlMs, fn);
}

/** Invalidate a single key (e.g. after a mutation). */
export function invalidate(key: string) {
	store.delete(key);
	inflight.delete(key);
}

/** Invalidate all keys matching a prefix. */
export function invalidatePrefix(prefix: string) {
	for (const key of store.keys()) {
		if (key.startsWith(prefix)) store.delete(key);
	}
	for (const key of inflight.keys()) {
		if (key.startsWith(prefix)) inflight.delete(key);
	}
}

/** Invalidate every cached entry. */
export function invalidateAll() {
	store.clear();
	inflight.clear();
}

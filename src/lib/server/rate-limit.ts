interface RateLimitEntry {
	timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(): void {
	if (cleanupInterval) return;
	cleanupInterval = setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of store) {
			entry.timestamps = entry.timestamps.filter((t) => now - t < 120_000);
			if (entry.timestamps.length === 0) store.delete(key);
		}
	}, 60_000);
	// Don't keep process alive for cleanup
	if (cleanupInterval.unref) cleanupInterval.unref();
}

/**
 * Returns true if the request is allowed, false if rate-limited.
 */
export function checkRateLimit(ip: string, maxRequests: number, windowMs: number): boolean {
	ensureCleanup();
	const now = Date.now();
	let entry = store.get(ip);
	if (!entry) {
		entry = { timestamps: [] };
		store.set(ip, entry);
	}

	// Remove timestamps outside the window
	entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

	if (entry.timestamps.length >= maxRequests) {
		return false;
	}

	entry.timestamps.push(now);
	return true;
}

export function resetRateLimiter(): void {
	store.clear();
	if (cleanupInterval) {
		clearInterval(cleanupInterval);
		cleanupInterval = null;
	}
}

/**
 * Resolve client IP, respecting X-Forwarded-For when behind a reverse proxy.
 */
export function getClientIp(request: Request): string {
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) {
		return forwarded.split(',')[0].trim();
	}
	// SvelteKit doesn't expose remoteAddress directly; fallback
	return '127.0.0.1';
}

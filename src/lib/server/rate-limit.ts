/**
 * In-memory per-IP rate limiter with trusted-proxy awareness.
 *
 * Issue #9: `X-Forwarded-For` was honored unconditionally, letting any caller
 * reset their bucket by sending a header. We now require explicit opt-in via
 * `NEXUS_TRUST_PROXY` and only trust XFF when the peer is inside a configured
 * trusted-proxy range.
 *
 * Configuration:
 *   NEXUS_TRUST_PROXY      -- '1'/'true' to honor XFF when peer is trusted.
 *                             Default: off (safer for homelab installs).
 *   NEXUS_TRUSTED_PROXIES  -- Comma-separated CIDRs or bare IPs that are
 *                             considered upstream proxies. When NEXUS_TRUST_PROXY
 *                             is on and this is unset, defaults to loopback +
 *                             RFC1918 private ranges.
 *
 * IPv4-only CIDR matching — see follow-up note in project memory if IPv6
 * deployments become common.
 */

import type { RequestEvent } from '@sveltejs/kit';

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
	if (cleanupInterval.unref) cleanupInterval.unref();
}

/** Returns true if the request is allowed, false if rate-limited. */
export function checkRateLimit(ip: string, maxRequests: number, windowMs: number): boolean {
	ensureCleanup();
	const now = Date.now();
	let entry = store.get(ip);
	if (!entry) {
		entry = { timestamps: [] };
		store.set(ip, entry);
	}
	entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
	if (entry.timestamps.length >= maxRequests) return false;
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

// ─────────────────────────────────────────────────────────────────────────────
// Trusted-proxy resolution
// ─────────────────────────────────────────────────────────────────────────────

interface Cidr {
	base: number; // big-endian uint32
	mask: number;
	bits: number;
}

const DEFAULT_TRUSTED_CIDRS = [
	'127.0.0.0/8',
	'10.0.0.0/8',
	'172.16.0.0/12',
	'192.168.0.0/16',
	'::1/128' // kept so loopback IPv6 users don't get surprised; matcher below handles IPv4 only
];

let cachedTrustedCidrs: Cidr[] | null = null;
let cachedTrustFlag: boolean | null = null;

function envFlag(name: string): boolean {
	const raw = process.env[name];
	if (!raw) return false;
	return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

function ipv4ToInt(ip: string): number | null {
	const parts = ip.split('.');
	if (parts.length !== 4) return null;
	let acc = 0;
	for (const part of parts) {
		const n = Number.parseInt(part, 10);
		if (!Number.isFinite(n) || n < 0 || n > 255) return null;
		acc = ((acc << 8) | n) >>> 0;
	}
	return acc >>> 0;
}

function parseCidr(spec: string): Cidr | null {
	const trimmed = spec.trim();
	if (!trimmed) return null;
	const [addr, bitsRaw] = trimmed.includes('/') ? trimmed.split('/') : [trimmed, '32'];
	const bits = Number.parseInt(bitsRaw, 10);
	if (!Number.isFinite(bits) || bits < 0 || bits > 32) return null;
	const ipInt = ipv4ToInt(addr);
	if (ipInt === null) return null;
	const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
	return { base: (ipInt & mask) >>> 0, mask, bits };
}

function loadTrustedCidrs(): Cidr[] {
	if (cachedTrustedCidrs) return cachedTrustedCidrs;
	const raw = process.env.NEXUS_TRUSTED_PROXIES;
	const specs = raw
		? raw.split(',').map((s) => s.trim()).filter(Boolean)
		: DEFAULT_TRUSTED_CIDRS;
	cachedTrustedCidrs = specs
		.map(parseCidr)
		.filter((c): c is Cidr => c !== null);
	return cachedTrustedCidrs;
}

function isTrustedPeer(ip: string): boolean {
	const ipInt = ipv4ToInt(ip);
	if (ipInt === null) return false; // non-IPv4 (incl. IPv6): never trusted by CIDR matcher
	for (const cidr of loadTrustedCidrs()) {
		if (((ipInt & cidr.mask) >>> 0) === cidr.base) return true;
	}
	return false;
}

function trustProxyEnabled(): boolean {
	if (cachedTrustFlag !== null) return cachedTrustFlag;
	cachedTrustFlag = envFlag('NEXUS_TRUST_PROXY');
	return cachedTrustFlag;
}

/** Test-only — resets the env-var caches so tests can flip the flag. */
export function __resetRateLimitConfig(): void {
	cachedTrustedCidrs = null;
	cachedTrustFlag = null;
}

/**
 * Resolve client IP for rate-limit bucketing. Prefers `getClientAddress()` —
 * SvelteKit's node adapter wires this to the actual socket peer address so
 * it's un-spoofable at the HTTP layer. We only honor `X-Forwarded-For` when
 * the deployment has opted in with `NEXUS_TRUST_PROXY` AND the peer is
 * actually inside the configured trusted-proxy ranges.
 *
 * Accepts either a full RequestEvent (preferred) or a bare Request for
 * legacy callers — the latter loses the peer-address check and only returns
 * `127.0.0.1` so buckets still group somehow.
 */
export function getClientIp(source: RequestEvent | Request): string {
	// Duck-type: RequestEvent has `getClientAddress`.
	const isEvent = typeof (source as RequestEvent).getClientAddress === 'function';
	let peer = '127.0.0.1';
	let xff: string | null = null;
	if (isEvent) {
		const event = source as RequestEvent;
		try {
			peer = event.getClientAddress();
		} catch {
			peer = '127.0.0.1';
		}
		xff = event.request.headers.get('x-forwarded-for');
	} else {
		xff = (source as Request).headers.get('x-forwarded-for');
	}

	if (!trustProxyEnabled()) return peer;
	if (!isEvent) return peer;
	if (!isTrustedPeer(peer)) return peer;
	if (!xff) return peer;

	// Walk XFF right-to-left; return the first entry that isn't itself a
	// trusted proxy. That's the real client.
	const chain = xff.split(',').map((s) => s.trim()).filter(Boolean);
	for (let i = chain.length - 1; i >= 0; i--) {
		const candidate = chain[i];
		if (!isTrustedPeer(candidate)) return candidate;
	}
	return peer;
}

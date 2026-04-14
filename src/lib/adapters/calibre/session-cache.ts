import type { ServiceConfig, UserCredential } from '../types';

interface CachedSession {
	cookie: string;
	csrfToken?: string;
	expiresAt: number;
}

const SESSION_TTL_MS = 55 * 60_000; // Flask default session is 60min; refresh early
const cache = new Map<string, CachedSession>();

function cacheKey(config: ServiceConfig, userCred?: UserCredential): string {
	const user = userCred?.externalUsername ?? config.username ?? '';
	return `${config.id}:${user}`;
}

export function getCachedSession(config: ServiceConfig, userCred?: UserCredential): CachedSession | undefined {
	const entry = cache.get(cacheKey(config, userCred));
	if (!entry) return undefined;
	if (entry.expiresAt <= Date.now()) {
		cache.delete(cacheKey(config, userCred));
		return undefined;
	}
	return entry;
}

export function setCachedSession(config: ServiceConfig, cookie: string, userCred?: UserCredential): CachedSession {
	const entry: CachedSession = { cookie, expiresAt: Date.now() + SESSION_TTL_MS };
	cache.set(cacheKey(config, userCred), entry);
	return entry;
}

export function setCachedCsrf(config: ServiceConfig, csrfToken: string, userCred?: UserCredential): void {
	const entry = cache.get(cacheKey(config, userCred));
	if (entry) entry.csrfToken = csrfToken;
}

export function invalidateSession(config: ServiceConfig, userCred?: UserCredential): void {
	cache.delete(cacheKey(config, userCred));
}

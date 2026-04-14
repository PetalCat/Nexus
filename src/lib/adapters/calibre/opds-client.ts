import type { ServiceConfig, UserCredential } from '../types';
import { parseOpdsFeed } from './opds-parse';
import type { OpdsEntry, OpdsFeed } from './types';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_PAGES = 100;

export function opdsAuthHeader(config: ServiceConfig, userCred?: UserCredential): string {
	const user = userCred?.externalUsername ?? config.username ?? '';
	const pass = userCred?.accessToken ?? config.password ?? '';
	if (!user || !pass) {
		throw new Error('Calibre-Web adapter: username and password are required for OPDS auth');
	}
	const token = Buffer.from(`${user}:${pass}`, 'utf-8').toString('base64');
	return `Basic ${token}`;
}

async function rawOpdsFetch(
	config: ServiceConfig,
	path: string,
	userCred: UserCredential | undefined,
	timeoutMs: number
): Promise<string> {
	const url = path.startsWith('http') ? path : `${config.url}${path}`;
	const res = await fetch(url, {
		headers: {
			Authorization: opdsAuthHeader(config, userCred),
			Accept: 'application/atom+xml,application/xml;q=0.9,*/*;q=0.8'
		},
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (res.status === 401) {
		throw new Error('Calibre-Web authentication failed — check username and password');
	}
	if (res.status === 403) {
		throw new Error('Calibre-Web permission denied — user lacks required role');
	}
	if (!res.ok) {
		throw new Error(`Calibre-Web OPDS ${path} → HTTP ${res.status}`);
	}
	return res.text();
}

export async function opdsFetch(
	config: ServiceConfig,
	path: string,
	userCred?: UserCredential,
	opts?: { timeoutMs?: number }
): Promise<OpdsFeed> {
	const xml = await rawOpdsFetch(config, path, userCred, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	return parseOpdsFeed(xml);
}

/**
 * Walk a paginated OPDS feed until no rel="next" link remains or MAX_PAGES is hit.
 * Used by library-wide aggregations (series, authors, categories, all-books).
 */
export async function opdsFetchAllPages(
	config: ServiceConfig,
	startPath: string,
	userCred?: UserCredential
): Promise<OpdsEntry[]> {
	const entries: OpdsEntry[] = [];
	let path: string | undefined = startPath;
	let pages = 0;
	const seen = new Set<string>();
	while (path && pages < MAX_PAGES) {
		if (seen.has(path)) break;
		seen.add(path);
		const feed = await opdsFetch(config, path, userCred);
		entries.push(...feed.entries);
		path = feed.nextHref;
		pages++;
	}
	return entries;
}

/** Ping: a single /opds GET that just verifies auth + server responds with a feed. */
export async function opdsPing(config: ServiceConfig, userCred?: UserCredential): Promise<void> {
	await opdsFetch(config, '/opds', userCred, { timeoutMs: 8000 });
}

/**
 * Centralized Invidious HTTP client. The one place that handles SID cookie
 * injection, error mapping, and AdapterAuthError throwing for the Invidious
 * adapter.
 *
 * All 7 route handlers that currently hand-roll `Cookie: SID=...` should
 * migrate to this helper. Until they do, the main invidious.ts file's
 * invFetch delegates to this module.
 *
 * NO retry logic here — when invidiousFetch throws AdapterAuthError('expired'),
 * the shared registry layer (src/lib/adapters/registry-auth.ts) catches it,
 * calls refreshCredential, updates the DB, and retries the original call.
 * This module stays dumb about refresh semantics.
 */

import type { ServiceConfig, UserCredential } from '../types';
import { AdapterAuthError } from '../errors';

/**
 * Build the `Cookie: SID=<token>` header dict for authenticated Invidious
 * requests. Returns an empty object when no credential is provided so
 * callers can spread it unconditionally.
 *
 * Used by route handlers that need to forward raw responses (stream proxy,
 * DASH manifest, captions, thumbnail-stripping search) where the full
 * invidiousFetch JSON-returning path doesn't fit.
 */
export function invidiousCookieHeaders(userCred?: UserCredential): Record<string, string> {
	if (!userCred?.accessToken) return {};
	return { Cookie: `SID=${userCred.accessToken}` };
}

export interface InvidiousFetchOptions {
	/** Timeout in ms. Defaults to 8000. */
	timeoutMs?: number;
	/** Extra fetch init (method, body, headers). */
	init?: RequestInit;
}

/**
 * Fetch JSON from an Invidious endpoint. Automatically applies the user's
 * SID cookie when present, and throws structured AdapterAuthError on
 * auth-related failures.
 *
 * Throws:
 *   - AdapterAuthError('expired') on 401 to auth-scoped endpoints
 *   - AdapterAuthError('rate-limited', retryAfterMs) on 429
 *   - AdapterAuthError('unreachable') on network errors / timeouts
 *   - plain Error on other non-2xx responses
 */
export async function invidiousFetch<T = unknown>(
	config: ServiceConfig,
	path: string,
	userCred?: UserCredential,
	opts?: InvidiousFetchOptions
): Promise<T> {
	const url = `${config.url}${path}`;
	const headers: Record<string, string> = {
		...((opts?.init?.headers as Record<string, string>) ?? {})
	};

	if (userCred?.accessToken) {
		headers['Cookie'] = `SID=${userCred.accessToken}`;
	}

	let res: Response;
	try {
		res = await fetch(url, {
			...opts?.init,
			headers,
			signal: opts?.init?.signal ?? AbortSignal.timeout(opts?.timeoutMs ?? 8000)
		});
	} catch (err) {
		if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
			throw new AdapterAuthError(
				`Invidious at ${config.url} is unreachable (timeout)`,
				'unreachable'
			);
		}
		// Network errors (DNS, connection refused, etc.) — TypeError in most runtimes
		throw new AdapterAuthError(
			`Invidious at ${config.url} is unreachable: ${err instanceof Error ? err.message : String(err)}`,
			'unreachable'
		);
	}

	// 401 on auth-scoped endpoints means the SID is dead.
	if (res.status === 401 && path.startsWith('/api/v1/auth/')) {
		throw new AdapterAuthError('Invidious session expired', 'expired');
	}

	// 403 on auth-scoped endpoints means the credential is invalid (signed in
	// but lacks permission — rare for Invidious but possible with instance
	// restrictions).
	if (res.status === 403 && path.startsWith('/api/v1/auth/')) {
		throw new AdapterAuthError('Invidious permission denied', 'permission-denied');
	}

	if (res.status === 429) {
		const retryAfter = parseInt(res.headers.get('retry-after') ?? '0', 10);
		throw new AdapterAuthError(
			'Invidious is rate-limiting requests',
			'rate-limited',
			retryAfter * 1000 || undefined
		);
	}

	if (!res.ok) {
		throw new Error(`Invidious ${path} -> ${res.status}`);
	}

	// 204 No Content — nothing to parse
	if (res.status === 204 || res.headers.get('content-length') === '0') {
		return undefined as T;
	}

	return res.json() as Promise<T>;
}

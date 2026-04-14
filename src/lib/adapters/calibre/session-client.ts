import type { ServiceConfig, UserCredential } from '../types';
import { getCachedSession, setCachedSession, setCachedCsrf, invalidateSession } from './session-cache';

const DEFAULT_TIMEOUT_MS = 10_000;

function extractSetCookies(headers: Headers): string[] {
	const maybeFn = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
	if (typeof maybeFn === 'function') return maybeFn.call(headers);
	const raw = headers.get('set-cookie');
	if (!raw) return [];
	return raw.split(/,(?=\s*\w+=)/).map((c) => c.trim());
}

/**
 * Merge Set-Cookie headers into a name→value jar. Prefix-agnostic — Calibre-Web
 * uses {COOKIE_PREFIX}session and {COOKIE_PREFIX}remember_token, which the old
 * prefix-based matcher missed on any install with a configured prefix.
 */
function mergeCookies(jar: Map<string, string>, setCookies: string[]): void {
	for (const sc of setCookies) {
		const pair = sc.split(';')[0]?.trim();
		if (!pair) continue;
		const eq = pair.indexOf('=');
		if (eq < 1) continue;
		jar.set(pair.substring(0, eq), pair.substring(eq + 1));
	}
}

function serializeJar(jar: Map<string, string>): string {
	return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function extractCsrfToken(html: string): string | undefined {
	const match = html.match(/name="csrf_token"\s+value="([^"]+)"/);
	return match?.[1];
}

function isHtmlLoginPage(contentType: string, body?: string): boolean {
	if (contentType.includes('json')) return false;
	if (!contentType.includes('html')) return false;
	if (body && (body.includes('name="csrf_token"') && body.includes('/login'))) return true;
	// If we only have content-type, err on the side of assuming it's a login page
	return !body;
}

async function performLogin(config: ServiceConfig, userCred?: UserCredential): Promise<string> {
	const user = userCred?.externalUsername ?? config.username ?? '';
	const pass = userCred?.accessToken ?? config.password ?? '';
	if (!user || !pass) {
		throw new Error('Calibre-Web adapter: username and password are required for session auth');
	}

	const jar = new Map<string, string>();

	// Step 1: GET /login → CSRF token + initial session cookie
	const loginPageRes = await fetch(`${config.url}/login`, {
		redirect: 'manual',
		signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
	});
	mergeCookies(jar, extractSetCookies(loginPageRes.headers));
	const html = await loginPageRes.text();
	const csrf = extractCsrfToken(html);
	if (!csrf) throw new Error('Calibre-Web: could not find csrf_token on /login page');

	// Step 2: POST /login with form body
	const body = new URLSearchParams({
		username: user,
		password: pass,
		csrf_token: csrf,
		next: '/',
		remember_me: 'on',
		submit: ''
	});
	const loginRes = await fetch(`${config.url}/login`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Cookie: serializeJar(jar)
		},
		body: body.toString(),
		redirect: 'manual',
		signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
	});
	if (loginRes.status !== 302) {
		throw new Error('Calibre-Web login failed: wrong username or password');
	}
	mergeCookies(jar, extractSetCookies(loginRes.headers));

	const cookieHeader = serializeJar(jar);
	if (!cookieHeader) throw new Error('Calibre-Web login: no cookies returned from server');
	return cookieHeader;
}

export async function getSessionCookie(
	config: ServiceConfig,
	userCred?: UserCredential
): Promise<string> {
	const cached = getCachedSession(config, userCred);
	if (cached) return cached.cookie;
	const cookie = await performLogin(config, userCred);
	setCachedSession(config, cookie, userCred);
	return cookie;
}

/**
 * Fetch a fresh CSRF token for write endpoints. Calibre-Web's csrf_token is NOT
 * rendered on the authed home page by default — it only appears on pages with
 * forms AND (for the nav upload form) when uploads are globally enabled. The
 * `/me` profile page is a reliable source: always logged-in-required, always
 * has a form with csrf_token.
 */
export async function getCsrfToken(
	config: ServiceConfig,
	cookie: string,
	userCred?: UserCredential
): Promise<string> {
	const cached = getCachedSession(config, userCred);
	if (cached?.csrfToken) return cached.csrfToken;

	const res = await fetch(`${config.url}/me`, {
		headers: { Cookie: cookie },
		signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`Calibre-Web /me → HTTP ${res.status} (could not fetch CSRF token)`);
	const html = await res.text();
	const token = extractCsrfToken(html);
	if (!token) throw new Error('Calibre-Web: could not find csrf_token on /me page');
	setCachedCsrf(config, token, userCred);
	return token;
}

/**
 * POST to a session-protected endpoint. Auto-refreshes the session on
 * detected expiry (HTML-login-page sniff), retrying once.
 */
export async function sessionPost(
	config: ServiceConfig,
	path: string,
	init: { body?: BodyInit; headers?: Record<string, string> } = {},
	userCred?: UserCredential
): Promise<Response> {
	const doRequest = async (): Promise<Response> => {
		const cookie = await getSessionCookie(config, userCred);
		const csrf = await getCsrfToken(config, cookie, userCred);
		return fetch(`${config.url}${path}`, {
			method: 'POST',
			headers: {
				Cookie: cookie,
				'X-CSRFToken': csrf,
				...init.headers
			},
			body: init.body,
			redirect: 'manual',
			signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
		});
	};

	let res = await doRequest();
	const contentType = res.headers.get('content-type') ?? '';
	if (isHtmlLoginPage(contentType) && res.status !== 302) {
		const body = await res.clone().text();
		if (isHtmlLoginPage(contentType, body)) {
			invalidateSession(config, userCred);
			res = await doRequest();
		}
	}
	return res;
}

/** GET a session-protected HTML page (for form scraping, e.g. /admin/user/new) */
export async function sessionGet(
	config: ServiceConfig,
	path: string,
	userCred?: UserCredential
): Promise<Response> {
	const cookie = await getSessionCookie(config, userCred);
	const res = await fetch(`${config.url}${path}`, {
		headers: { Cookie: cookie },
		signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
	});
	if (res.status === 401 || res.status === 403) {
		invalidateSession(config, userCred);
		const cookie2 = await getSessionCookie(config, userCred);
		return fetch(`${config.url}${path}`, {
			headers: { Cookie: cookie2 },
			signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
		});
	}
	return res;
}

export { invalidateSession };

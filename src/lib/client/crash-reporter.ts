/**
 * Client-side crash reporter. Hooks `window.onerror` and
 * `unhandledrejection`, dedupes duplicate reports, and POSTs a structured
 * payload to /api/telemetry/error. Server decides whether to persist based
 * on NEXUS_TELEMETRY_DISABLED.
 *
 * Why this exists: before this, any uncaught error in the Svelte player or
 * an adapter load threw silently from a user's perspective — we only ever
 * saw failures when the user screenshotted the console. For a public beta
 * we need a feedback loop that works even when the user isn't a developer.
 *
 * Design notes:
 *  - Dedupes by (message + first stack line) with a 1-minute window, so a
 *    crash inside a tight loop doesn't DDoS the server.
 *  - Fails silently on network errors; nothing here should ever surface a
 *    user-visible error.
 *  - Intentionally minimal — bundle size matters on the cold-load path.
 *    Sentry/Glitchtip integration lives in a separate module, opt-in via
 *    NEXUS_SENTRY_DSN.
 */

import { recordRecentCrash } from './bug-report-context';

const ENDPOINT = '/api/telemetry/error';
const DEDUPE_WINDOW_MS = 60_000;
const recentKeys = new Map<string, number>();

let installed = false;
let buildVersion = '';

function dedupeKey(message: string, stack?: string): string {
	const firstStackLine = stack?.split('\n').find((l) => /at\s/.test(l))?.trim() ?? '';
	return `${message}\u2063${firstStackLine}`;
}

function shouldSend(key: string): boolean {
	const now = Date.now();
	// Evict expired entries lazily — we touch at most one per send.
	for (const [k, t] of recentKeys) {
		if (now - t > DEDUPE_WINDOW_MS) recentKeys.delete(k);
	}
	if (recentKeys.has(key)) return false;
	recentKeys.set(key, now);
	return true;
}

interface ReportInput {
	message: string;
	stack?: string;
	surface?: string;
	extra?: Record<string, unknown>;
}

export function reportCrash(input: ReportInput): void {
	// Always record into the in-memory buffer — even deduped crashes — so
	// the bug-report modal can show the user "I saw this recent crash."
	recordRecentCrash({
		message: input.message,
		stack: input.stack,
		surface: input.surface,
		at: Date.now()
	});

	const key = dedupeKey(input.message, input.stack);
	if (!shouldSend(key)) return;

	const payload = {
		message: input.message,
		stack: input.stack,
		surface: input.surface,
		extra: input.extra,
		url: typeof location !== 'undefined' ? location.href : undefined,
		userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
		buildVersion
	};

	try {
		// keepalive: true lets the request survive a page unload triggered
		// by the same crash (e.g. auto-refresh on a boot-time error).
		fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
			keepalive: true
		}).catch(() => {
			/* swallow */
		});
	} catch {
		/* swallow */
	}
}

export function installCrashReporter(opts: { buildVersion?: string } = {}): void {
	if (installed) return;
	if (typeof window === 'undefined') return;
	installed = true;
	buildVersion = opts.buildVersion ?? '';

	window.addEventListener('error', (ev: ErrorEvent) => {
		reportCrash({
			message: ev.message || String(ev.error ?? 'unknown error'),
			stack: ev.error?.stack,
			surface: 'window.onerror'
		});
	});

	window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
		const reason = ev.reason;
		const message =
			reason instanceof Error
				? reason.message
				: typeof reason === 'string'
					? reason
					: (() => {
							try {
								return JSON.stringify(reason);
							} catch {
								return String(reason);
							}
						})();
		reportCrash({
			message,
			stack: reason instanceof Error ? reason.stack : undefined,
			surface: 'unhandledrejection'
		});
	});
}

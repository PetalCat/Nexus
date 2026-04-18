import { json } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

// POST /api/telemetry/error — client-side crash intake.
//
// Called from src/lib/client/crash-reporter.ts when window.onerror or
// unhandledrejection fires. Logs a structured error line via the shared
// logger so it shows up next to server-side errors in deployment logs
// (and, if configured later, flows into Sentry/Glitchtip).
//
// Self-hosters who don't want crash telemetry can set
// NEXUS_TELEMETRY_DISABLED=1 on the server. In that mode the endpoint
// returns 204 and logs nothing — the client still tries to POST, but
// nothing is persisted and the data never leaves the host.
const TELEMETRY_DISABLED = process.env.NEXUS_TELEMETRY_DISABLED === '1';

// Accept any shape so a malformed crash report doesn't itself 500.
// Keep server-side validation narrow to what we actually log.
interface ClientError {
	message?: string;
	stack?: string;
	url?: string;
	// Where the error fired — e.g. 'player', 'negotiate', 'calibre-read'.
	// Optional free-form label chosen by the client.
	surface?: string;
	// Version string from the client bundle; helps disambiguate when
	// users are on stale tabs after a deploy.
	buildVersion?: string;
	// Browser user agent — useful for "it crashes on Safari" triage.
	userAgent?: string;
	// Arbitrary small key/value map of context. Bounded below.
	extra?: Record<string, unknown>;
}

const MAX_STACK_LEN = 8_000;
const MAX_MSG_LEN = 1_000;
const MAX_EXTRA_BYTES = 2_000;

function clip(s: unknown, max: number): string | undefined {
	if (typeof s !== 'string') return undefined;
	return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (TELEMETRY_DISABLED) {
		return new Response(null, { status: 204 });
	}

	let body: ClientError = {};
	try {
		body = (await request.json()) as ClientError;
	} catch {
		// Malformed JSON — swallow and return OK; we don't want crash
		// reporting to amplify into a visible server error.
		return json({ ok: false, error: 'bad json' }, { status: 400 });
	}

	let extraStr: string | undefined;
	if (body.extra && typeof body.extra === 'object') {
		try {
			const s = JSON.stringify(body.extra);
			if (s.length <= MAX_EXTRA_BYTES) extraStr = s;
		} catch {
			/* unstringifiable — drop */
		}
	}

	logger.error('client crash', {
		message: clip(body.message, MAX_MSG_LEN) ?? '(no message)',
		stack: clip(body.stack, MAX_STACK_LEN),
		url: clip(body.url, 500),
		surface: clip(body.surface, 80),
		buildVersion: clip(body.buildVersion, 40),
		userAgent: clip(body.userAgent, 300),
		extra: extraStr,
		userId: locals.user?.id // may be undefined for unauth crashes
	});

	return json({ ok: true });
};

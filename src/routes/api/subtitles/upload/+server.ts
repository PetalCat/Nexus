import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { requireActiveUser } from '$lib/server/session-guard';

/**
 * POST /api/subtitles/upload
 *
 * Upload a custom subtitle file via Bazarr.
 * Expects multipart form data with: serviceId, itemId, language, mediaType, file
 *
 * Body is hard-capped at `NEXUS_SUBTITLE_MAX_BYTES` (default 5 MB) to prevent
 * heap-OOM via unbounded multipart parsing (issue #10). Real subtitle files are
 * tens of KB so 5 MB is generous.
 */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
	'application/x-subrip',
	'application/octet-stream',
	'text/vtt',
	'text/plain',
	'' // Safari sometimes sends empty
]);

function maxBytes(): number {
	const raw = process.env.NEXUS_SUBTITLE_MAX_BYTES;
	if (!raw) return DEFAULT_MAX_BYTES;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_BYTES;
	return n;
}

export const POST: RequestHandler = async (event) => {
	requireActiveUser(event);
	const { request } = event;

	// Fast-path reject: honor Content-Length before touching formData().
	const cap = maxBytes();
	const contentLength = request.headers.get('content-length');
	if (contentLength) {
		const declared = Number.parseInt(contentLength, 10);
		if (Number.isFinite(declared) && declared > cap) {
			throw error(413, 'Subtitle upload too large');
		}
	}

	const formData = await request.formData();
	const itemId = formData.get('itemId') as string;
	const language = formData.get('language') as string;
	const file = formData.get('file') as File | null;

	if (!itemId || !language || !file) {
		throw error(400, 'Missing required fields: itemId, language, file');
	}

	// Belt-and-suspenders: some clients omit or understate Content-Length.
	if (file.size > cap) {
		throw error(413, 'Subtitle upload too large');
	}

	if (!ALLOWED_MIME_TYPES.has(file.type)) {
		throw error(415, `Unsupported subtitle mime type: ${file.type}`);
	}

	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length === 0) {
		throw error(404, 'No Bazarr service configured');
	}

	const config = bazarrConfigs[0];
	const adapter = registry.get(config.type);

	if (!adapter?.uploadContent) {
		throw error(501, 'Subtitle upload not supported');
	}

	try {
		const blob = new Blob([await file.arrayBuffer()], { type: file.type });
		await adapter.uploadContent(config, itemId, 'subtitle', blob, file.name);
		return json({ success: true });
	} catch (e) {
		console.error('[subtitles/upload] error:', e);
		throw error(502, e instanceof Error ? e.message : 'Upload failed');
	}
};

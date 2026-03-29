import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';

const MIME_TYPES: Record<string, string> = {
	epub: 'application/epub+zip',
	pdf: 'application/pdf',
	mobi: 'application/x-mobipocket-ebook',
	azw3: 'application/x-mobi8-ebook',
	cbz: 'application/x-cbz',
	cbr: 'application/x-cbr',
	txt: 'text/plain',
	rtf: 'application/rtf'
};

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401);
	const config = getConfigsForMediaType('book')[0];
	if (!config) throw error(404, 'No Calibre service configured');

	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const response = await adapter?.downloadContent?.(config, params.id, params.format, userCred);
	if (!response) throw error(500, 'Download not supported');

	const contentType = MIME_TYPES[params.format.toLowerCase()] ?? 'application/octet-stream';
	const isView = url.searchParams.get('view') === 'true';
	const disposition = isView ? 'inline' : `attachment; filename="book-${params.id}.${params.format}"`;

	return new Response(response.body, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': disposition,
			'Cache-Control': 'private, max-age=3600',
			'Accept-Ranges': 'bytes',
			...(response.headers.get('content-length') ? { 'Content-Length': response.headers.get('content-length')! } : {})
		}
	});
};

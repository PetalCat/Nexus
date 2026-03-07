import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { downloadBook } from '$lib/adapters/calibre';

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

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const config = getEnabledConfigs().find(c => c.type === 'calibre');
	if (!config) throw error(404, 'No Calibre service configured');

	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const response = await downloadBook(config, params.id, params.format, userCred);

	const contentType = MIME_TYPES[params.format.toLowerCase()] ?? 'application/octet-stream';
	return new Response(response.body, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': `attachment; filename="book-${params.id}.${params.format}"`,
			'Cache-Control': 'private, max-age=3600'
		}
	});
};

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAnnotations, addAnnotation } from '$lib/server/annotations';

// GET /api/annotations?page=<pathname> → { annotations: [...] }
export const GET: RequestHandler = ({ url, locals }) => {
	if (!locals.user) return json({ annotations: [] });
	const page = url.searchParams.get('page') || '';
	if (!page) return json({ annotations: [] });
	return json({ annotations: listAnnotations(page) });
};

// POST /api/annotations { page_path, anchor_selector, anchor_snippet, anchor_offset_x, anchor_offset_y, body }
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	let p: Record<string, unknown>;
	try {
		p = await request.json();
	} catch {
		throw error(400, 'bad json');
	}
	const page_path = String(p.page_path || '').slice(0, 512);
	const anchor_selector = String(p.anchor_selector || '').slice(0, 1024);
	const body = String(p.body || '')
		.trim()
		.slice(0, 2000);
	if (!page_path || !anchor_selector || !body) {
		throw error(400, 'page_path, anchor_selector and body are required');
	}
	const clamp01 = (v: unknown) => {
		const n = Number(v);
		return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
	};
	const ann = addAnnotation({
		page_path,
		anchor_selector,
		anchor_snippet: String(p.anchor_snippet || '').slice(0, 200),
		anchor_offset_x: clamp01(p.anchor_offset_x),
		anchor_offset_y: clamp01(p.anchor_offset_y),
		body,
		author: locals.user.username || ''
	});
	return json({ annotation: ann }, { status: 201 });
};

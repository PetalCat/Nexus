import { json, error } from '@sveltejs/kit';
import { updateUser } from '$lib/server/auth';
import type { RequestHandler } from './$types';
import { writeFileSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';

// POST: Upload avatar (base64 or URL)
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);

	const contentType = request.headers.get('content-type') ?? '';

	if (contentType.includes('application/json')) {
		// URL-based avatar
		const { url } = await request.json();
		if (!url || typeof url !== 'string') throw error(400, 'url required');
		updateUser(locals.user.id, { avatar: url });
		return json({ avatar: url });
	}

	// File upload
	const formData = await request.formData();
	const file = formData.get('avatar') as File | null;
	if (!file) throw error(400, 'avatar file required');

	const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
	if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
		throw error(400, 'Invalid image format');
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	if (buffer.length > 2 * 1024 * 1024) throw error(400, 'Avatar must be under 2MB');

	const dir = 'static/avatars';
	mkdirSync(dir, { recursive: true });
	const filename = `${locals.user.id}-${randomBytes(4).toString('hex')}.${ext}`;
	writeFileSync(`${dir}/${filename}`, buffer);

	const avatarPath = `/avatars/${filename}`;
	updateUser(locals.user.id, { avatar: avatarPath });
	return json({ avatar: avatarPath });
};

// DELETE: Remove avatar
export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	updateUser(locals.user.id, { avatar: null });
	return json({ ok: true });
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRawDb } from '$lib/db';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let _version: string | null = null;

function getVersion(): string {
	if (!_version) {
		try {
			const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'));
			_version = pkg.version ?? 'unknown';
		} catch {
			_version = 'unknown';
		}
	}
	return _version;
}

export const GET: RequestHandler = async () => {
	try {
		const db = getRawDb();
		db.prepare('SELECT 1').get();
		return json({ status: 'ok', version: getVersion() });
	} catch (err) {
		return json(
			{ status: 'error', message: 'Database unreachable' },
			{ status: 503 }
		);
	}
};

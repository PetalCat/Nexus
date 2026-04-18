#!/usr/bin/env tsx
/**
 * Live integration smoke test. NOT part of the automated suite — this hits a
 * real Calibre-Web instance and asserts the full adapter surface works end to
 * end. Run manually:
 *
 *   pnpm tsx src/lib/adapters/calibre/__tests__/live-smoke.ts
 *
 * Requires a Calibre-Web instance at CALIBRE_URL (default http://localhost:8083)
 * with credentials CALIBRE_USER / CALIBRE_PASS (default admin/admin123) and a
 * seeded library.
 */
import { calibreAdapter, getCalibreAuthors, getCalibreCategories, getCalibreSeries, toggleReadStatus, downloadBook } from '../../calibre';
import type { ServiceConfig } from '../../types';

const URL = process.env.CALIBRE_URL ?? 'http://localhost:8083';
const USER = process.env.CALIBRE_USER ?? 'admin';
const PASS = process.env.CALIBRE_PASS ?? 'admin123';

const config: ServiceConfig = {
	id: 'smoke-calibre',
	name: 'Smoke Calibre',
	type: 'calibre',
	url: URL,
	username: USER,
	password: PASS,
	enabled: true
};

const pass: string[] = [];
const fail: string[] = [];
async function step(label: string, fn: () => Promise<unknown>): Promise<void> {
	try {
		const result = await fn();
		pass.push(label);
		console.log(`✓ ${label}`);
		if (process.env.VERBOSE) console.log('   →', JSON.stringify(result, null, 2).slice(0, 500));
	} catch (err) {
		fail.push(`${label}: ${(err as Error).message}`);
		console.error(`✗ ${label}: ${(err as Error).message}`);
	}
}

async function main(): Promise<void> {
	await step('ping', async () => {
		const health = await calibreAdapter.ping!(config);
		if (!health.online) throw new Error(health.error ?? 'ping returned offline');
		return health;
	});

	await step('getRecentlyAdded', async () => {
		const items = await calibreAdapter.getRecentlyAdded!(config);
		if (items.length === 0) throw new Error('no recent items');
		if (items[0].type !== 'book') throw new Error(`unexpected type: ${items[0].type}`);
		return { count: items.length, first: items[0].title };
	});

	await step('getContinueWatching', async () => {
		const items = await calibreAdapter.getContinueWatching!(config);
		// Calibre intentionally returns [] here — per-user reading progress
		// comes from `play_sessions`, not the adapter. See the 2026-04-17
		// player alignment plan (#12).
		if (items.length !== 0) throw new Error(`expected empty, got ${items.length}`);
		return { count: items.length };
	});

	await step('search() — exercise the search path with whatever is seeded', async () => {
		// Pick a partial that should match nearly any test fixture. If the
		// library is empty, getRecentlyAdded above will have already failed,
		// so this is only reached when there's something to search.
		const recent = await calibreAdapter.getRecentlyAdded!(config);
		const needle = recent[0]?.title?.split(/\s+/)[0] ?? 'the';
		const result = await calibreAdapter.search!(config, needle);
		if (result.items.length === 0) throw new Error(`no search results for "${needle}"`);
		return { needle, count: result.items.length };
	});

	await step('getLibrary (default)', async () => {
		const { items, total } = await calibreAdapter.getLibrary!(config, { limit: 50 });
		if (total !== items.length && total === 0) throw new Error('total=0');
		return { count: items.length, total };
	});

	await step('getLibrary (sortBy: added)', async () => {
		const { items } = await calibreAdapter.getLibrary!(config, { limit: 10, sortBy: 'added' });
		return { count: items.length };
	});

	await step('getLibrary (sortBy: rating)', async () => {
		const { items } = await calibreAdapter.getLibrary!(config, { limit: 10, sortBy: 'rating' });
		return { count: items.length };
	});

	await step('getItem(1)', async () => {
		const item = await calibreAdapter.getItem!(config, '1');
		if (!item) throw new Error('item not found');
		if (item.type !== 'book') throw new Error('wrong type');
		return { title: item.title, formatCount: item.metadata?.formatCount };
	});

	await step('enrichItem(formats)', async () => {
		const item = await calibreAdapter.getItem!(config, '1');
		if (!item) throw new Error('item not found');
		const enriched = await calibreAdapter.enrichItem!(config, item, 'formats');
		const formats = (enriched.metadata as { formats?: unknown[] } | undefined)?.formats;
		if (!Array.isArray(formats) || formats.length === 0) {
			throw new Error('no formats returned');
		}
		return formats;
	});

	await step('enrichItem(related)', async () => {
		const item = await calibreAdapter.getItem!(config, '1');
		if (!item) throw new Error('item not found');
		const enriched = await calibreAdapter.enrichItem!(config, item, 'related');
		const related = (enriched.metadata as { related?: unknown } | undefined)?.related;
		if (!related) throw new Error('no related returned');
		return related;
	});

	await step('getServiceData(series)', async () => {
		const series = await getCalibreSeries(config);
		return { count: series.length, names: series.map((s) => s.name) };
	});

	await step('getServiceData(authors)', async () => {
		const authors = await getCalibreAuthors(config);
		return { count: authors.length };
	});

	await step('getServiceData(categories)', async () => {
		const cats = await getCalibreCategories(config);
		return { count: cats.length };
	});

	await step('authenticateUser(valid)', async () => {
		const res = await calibreAdapter.authenticateUser!(config, USER, PASS);
		if (res.externalUsername !== USER) throw new Error('wrong username');
		return res;
	});

	await step('authenticateUser(invalid) — should throw', async () => {
		try {
			await calibreAdapter.authenticateUser!(config, USER, 'wrong-password');
			throw new Error('expected auth failure but got success');
		} catch (err) {
			const msg = (err as Error).message.toLowerCase();
			// Accept either the wrapped AdapterAuthError copy or the raw
			// OPDS layer's "authentication failed" — both are correct
			// signals from the adapter's POV.
			if (msg.includes('invalid') || msg.includes('authentication failed')) {
				return 'correctly rejected';
			}
			throw err;
		}
	});

	await step('getImageHeaders', async () => {
		const headers = await calibreAdapter.getImageHeaders!(config);
		if (!headers.Authorization?.startsWith('Basic ')) throw new Error('expected Basic auth header');
		return headers;
	});

	await step('toggleReadStatus(1) — session-cookie write path', async () => {
		const ok = await toggleReadStatus(config, '1');
		if (!ok) throw new Error('toggle returned false');
		// toggle back so the fixture state is restored
		await toggleReadStatus(config, '1');
		return 'toggled and restored';
	});

	await step('setItemStatus({read: true})', async () => {
		await calibreAdapter.setItemStatus!(config, '1', { read: true });
		await calibreAdapter.setItemStatus!(config, '1', { read: false }); // restore
		return 'ok';
	});

	await step('downloadContent(1, epub)', async () => {
		const res = await downloadBook(config, '1', 'epub');
		if (!res.ok) throw new Error(`download failed: ${res.status}`);
		const buf = await res.arrayBuffer();
		return { status: res.status, bytes: buf.byteLength };
	});

	console.log(`\n${pass.length} passed, ${fail.length} failed`);
	if (fail.length > 0) {
		console.error('\nFailures:');
		for (const f of fail) console.error('  ' + f);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});

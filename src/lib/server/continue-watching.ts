/**
 * Canonical Continue Watching helper.
 *
 * Reads from `play_sessions` (the unified data model) ordered by
 * `updated_at DESC` — that is, by recency, not by fake progress ratios.
 * This is the single source of truth for the Continue Watching row on
 * the homepage (and any future dedicated surface).
 *
 * Progress filters:
 *   - `completed = 0`                   — never resurface finished items
 *   - `progress > PROGRESS_MIN` (0.02)  — filter "barely started" noise
 *   - `progress < PROGRESS_MAX` (0.9)   — matches the session-poller
 *                                         completion threshold
 *
 * See docs/superpowers/specs/2026-04-17-player-alignment-plan.md §2.
 */

import { and, desc, eq, gt, isNotNull, lt } from 'drizzle-orm';
import { registry } from '../adapters/registry';
import type { ServiceConfig, UnifiedMedia } from '../adapters/types';
import { getDb, schema } from '../db';
import { getUserCredentialForService } from './auth';

export const CW_PROGRESS_MIN = 0.02;
export const CW_PROGRESS_MAX = 0.9;
export const CW_DEFAULT_LIMIT = 25;

function resolveUserCred(config: ServiceConfig, userId: string, configs: ServiceConfig[]) {
	const adapter = registry.get(config.type);
	if (adapter?.authVia) {
		const authConfig = configs.find((c) => c.type === adapter.authVia);
		if (!authConfig) return undefined;
		return getUserCredentialForService(userId, authConfig.id) ?? undefined;
	}
	if (!adapter?.userLinkable) return undefined;
	return getUserCredentialForService(userId, config.id) ?? undefined;
}

/**
 * Canonical Continue Watching source.
 *
 * Returns items in `updated_at DESC` order, filtered to in-progress rows,
 * with adapter-resolved metadata. Order from the DB is preserved —
 * callers MUST NOT re-sort by progress.
 */
export async function getContinueWatching(
	userId: string,
	opts: { limit?: number; configs?: ServiceConfig[] } = {}
): Promise<UnifiedMedia[]> {
	const limit = opts.limit ?? CW_DEFAULT_LIMIT;
	const db = getDb();

	const rows = db
		.select({
			mediaId: schema.playSessions.mediaId,
			serviceId: schema.playSessions.serviceId,
			serviceType: schema.playSessions.serviceType,
			progress: schema.playSessions.progress,
			updatedAt: schema.playSessions.updatedAt,
		})
		.from(schema.playSessions)
		.where(
			and(
				eq(schema.playSessions.userId, userId),
				eq(schema.playSessions.completed, 0),
				isNotNull(schema.playSessions.progress),
				gt(schema.playSessions.progress, CW_PROGRESS_MIN),
				lt(schema.playSessions.progress, CW_PROGRESS_MAX)
			)
		)
		.orderBy(desc(schema.playSessions.updatedAt))
		// Oversample so deduping by (serviceId, mediaId) below still yields
		// `limit` unique rows even when a user has several in-progress sessions
		// for the same title (e.g. binging a series). Codex-audit round 2 P2.
		.limit(limit * 4)
		.all();

	if (rows.length === 0) return [];

	// Resolve each row to UnifiedMedia. We need configs for cred resolution;
	// accept them via opts to avoid circular imports with services.ts.
	const configs = opts.configs ?? [];
	const seen = new Set<string>();

	// Dedupe by mediaId+serviceId BEFORE resolving (cheap), preserving order,
	// then cap to the requested limit. Oversample above guarantees we reach
	// `limit` unique items when available.
	const uniqueRows = rows.filter((row) => {
		const key = `${row.serviceId}:${row.mediaId}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	}).slice(0, limit);

	// Resolve items in parallel, but preserve DB order by index.
	const resolved = await Promise.allSettled(
		uniqueRows.map(async (row) => {
			const config = configs.find((c) => c.id === row.serviceId);
			if (!config) return null;
			const adapter = registry.get(config.type);
			if (!adapter?.getItem) return null;
			const cred = resolveUserCred(config, userId, configs);
			try {
				const item = await adapter.getItem(config, row.mediaId, cred);
				if (!item) return null;
				// Stamp progress from the play_sessions row — this is the
				// canonical number, not whatever the adapter's getItem call
				// returned (which might be stale or missing).
				item.progress = row.progress ?? item.progress;
				return item;
			} catch {
				return null;
			}
		})
	);

	// Preserve DB order (recency).
	return resolved
		.map((r) => (r.status === 'fulfilled' ? r.value : null))
		.filter((x): x is UnifiedMedia => x !== null);
}

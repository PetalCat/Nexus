/**
 * Tests for the native media-request service — including the adversarial-review
 * security fixes:
 *   - the per-service arr webhook token (HMAC, constant-time verify), and
 *   - markRequestsAvailable's CROSS-SERVICE scoping: a webhook authenticated as
 *     (or forged for) service B must NOT be able to flip a request that was bound
 *     to service A on a bare tmdb/tvdb match.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// DB + secret must be set before importing the module under test (getDb reads
// DATABASE_URL on first call; arrWebhookToken reads BETTER_AUTH_SECRET). vi.hoisted
// runs above the hoisted ESM imports so the env is in place at module-eval time.
vi.hoisted(() => {
	process.env.DATABASE_URL = `/tmp/nexus-test-media-requests-${Date.now()}.db`;
	process.env.BETTER_AUTH_SECRET = 'media-requests-test-secret-0123456789abcd'; // 40 chars
});

// Mock ONLY the request fns on the live arr adapters so approveNativeRequest
// doesn't hit a real Radarr/Sonarr — keep every other export (the adapter object
// the registry imports at module load) intact via importOriginal.
vi.mock('../../adapters/radarr', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../adapters/radarr')>()),
	radarrRequestMedia: vi.fn(async () => ({
		arrItemId: 555,
		qualityProfileId: 1,
		rootFolderPath: '/movies',
		alreadyPresent: false
	}))
}));
vi.mock('../../adapters/sonarr', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../adapters/sonarr')>()),
	sonarrRequestMedia: vi.fn(async () => ({
		tvdbId: 999,
		arrItemId: 777,
		qualityProfileId: 2,
		rootFolderPath: '/tv',
		alreadyPresent: false
	}))
}));

import { getDb, schema } from '../../db';
import { radarrRequestMedia } from '../../adapters/radarr';
import {
	arrWebhookToken,
	verifyArrWebhookToken,
	markRequestsAvailable,
	createNativeRequest,
	findExistingNativeRequest,
	reactivateNativeRequest,
	approveNativeRequest
} from '../media-requests';
import type { MediaRequest } from '../../db/schema';

const db = getDb();

function clearDb() {
	// notifications first — markRequestsAvailable / approveNativeRequest fire them
	// and they FK to users.id (delete-users would otherwise hit the constraint).
	db.delete(schema.notifications).run();
	db.delete(schema.mediaRequests).run();
	db.delete(schema.services).run();
	db.delete(schema.users).run();
}

function seedUser(id = 'user-1') {
	db.insert(schema.users)
		.values({ id, username: id, displayName: id })
		.onConflictDoNothing()
		.run();
	return id;
}

/** Insert a media_requests row directly (bypassing createNativeRequest so we can
 *  control arrServiceId / arrItemId / status precisely). */
function seedRequest(row: Partial<MediaRequest> & { id: string; userId: string }): void {
	const now = Date.now();
	db.insert(schema.mediaRequests)
		.values({
			id: row.id,
			userId: row.userId,
			mediaType: row.mediaType ?? 'movie',
			tmdbId: row.tmdbId ?? 100,
			tvdbId: row.tvdbId ?? null,
			title: row.title ?? 'Test Movie',
			poster: null,
			year: null,
			seasons: row.seasons ?? null,
			status: row.status ?? 'pending',
			backend: 'native',
			serviceId: row.serviceId ?? 'svc',
			sourceRequestId: null,
			arrServiceId: row.arrServiceId ?? null,
			arrItemId: row.arrItemId ?? null,
			qualityProfileId: null,
			rootFolderPath: null,
			approvedBy: null,
			declineReason: null,
			createdAt: now,
			updatedAt: now,
			availableAt: null
		})
		.run();
}

function statusOf(id: string): string | undefined {
	return db.select().from(schema.mediaRequests).where(eqId(id)).get()?.status;
}
import { eq } from 'drizzle-orm';
function eqId(id: string) {
	return eq(schema.mediaRequests.id, id);
}

beforeEach(() => {
	clearDb();
	vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// arr webhook token
// ───────────────────────────────────────────────────────────────────────────

describe('arrWebhookToken / verifyArrWebhookToken', () => {
	it('same serviceId → stable token', () => {
		expect(arrWebhookToken('radarr-A')).toBe(arrWebhookToken('radarr-A'));
	});

	it('different serviceId → different token', () => {
		expect(arrWebhookToken('radarr-A')).not.toBe(arrWebhookToken('radarr-B'));
	});

	it('token is 32 hex chars (truncated HMAC)', () => {
		expect(arrWebhookToken('radarr-A')).toMatch(/^[0-9a-f]{32}$/);
	});

	it('verify accepts the correct token', () => {
		expect(verifyArrWebhookToken('radarr-A', arrWebhookToken('radarr-A'))).toBe(true);
	});

	it('verify rejects null / undefined / empty', () => {
		expect(verifyArrWebhookToken('radarr-A', null)).toBe(false);
		expect(verifyArrWebhookToken('radarr-A', undefined)).toBe(false);
		expect(verifyArrWebhookToken('radarr-A', '')).toBe(false);
	});

	it("verify rejects another service's token (wrong token, same length)", () => {
		expect(verifyArrWebhookToken('radarr-A', arrWebhookToken('radarr-B'))).toBe(false);
	});

	it('verify rejects a truncated token without throwing (constant-time length guard)', () => {
		const tok = arrWebhookToken('radarr-A');
		const truncated = tok.slice(0, 16);
		expect(() => verifyArrWebhookToken('radarr-A', truncated)).not.toThrow();
		expect(verifyArrWebhookToken('radarr-A', truncated)).toBe(false);
	});

	it('verify rejects a longer-than-expected token without throwing', () => {
		const tok = arrWebhookToken('radarr-A');
		expect(() => verifyArrWebhookToken('radarr-A', tok + 'ff')).not.toThrow();
		expect(verifyArrWebhookToken('radarr-A', tok + 'ff')).toBe(false);
	});
});

// ───────────────────────────────────────────────────────────────────────────
// markRequestsAvailable cross-service scoping (the CRITICAL fix)
// ───────────────────────────────────────────────────────────────────────────

describe('markRequestsAvailable — cross-service scoping', () => {
	it('a webhook from a DIFFERENT arr service does NOT mark a bound request available (spoof blocked)', () => {
		seedUser();
		seedRequest({
			id: 'req-A',
			userId: 'user-1',
			mediaType: 'movie',
			tmdbId: 100,
			status: 'processing',
			arrServiceId: 'radarr-A',
			arrItemId: 42
		});

		// radarr-B fires a webhook with a matching tmdbId but the row is bound to radarr-A.
		const updated = markRequestsAvailable({
			mediaType: 'movie',
			tmdbId: 100,
			arrServiceId: 'radarr-B',
			arrItemId: 9999
		});

		expect(updated).toEqual([]);
		expect(statusOf('req-A')).toBe('processing'); // untouched
	});

	it('a webhook from the MATCHING arr service marks the bound request available', () => {
		seedUser();
		seedRequest({
			id: 'req-A',
			userId: 'user-1',
			mediaType: 'movie',
			tmdbId: 100,
			status: 'processing',
			arrServiceId: 'radarr-A',
			arrItemId: 42
		});

		const updated = markRequestsAvailable({
			mediaType: 'movie',
			tmdbId: 100,
			arrServiceId: 'radarr-A',
			arrItemId: 42
		});

		expect(updated.map((r) => r.id)).toEqual(['req-A']);
		expect(statusOf('req-A')).toBe('available');
	});

	it('a pending row with NO arrServiceId yet can be matched on tmdb by any service', () => {
		seedUser();
		seedRequest({
			id: 'req-pending',
			userId: 'user-1',
			mediaType: 'movie',
			tmdbId: 200,
			status: 'pending',
			arrServiceId: null,
			arrItemId: null
		});

		const updated = markRequestsAvailable({
			mediaType: 'movie',
			tmdbId: 200,
			arrServiceId: 'radarr-A',
			arrItemId: 1
		});

		expect(updated.map((r) => r.id)).toEqual(['req-pending']);
		expect(statusOf('req-pending')).toBe('available');
	});

	it('already-available and declined rows are never re-touched', () => {
		seedUser();
		seedUser('user-2');
		// Distinct (user,tmdb,type) tuples to satisfy the unique index, both matched
		// by the webhook's tmdbId in turn.
		seedRequest({
			id: 'req-avail',
			userId: 'user-1',
			mediaType: 'movie',
			tmdbId: 300,
			status: 'available',
			arrServiceId: 'radarr-A'
		});
		seedRequest({
			id: 'req-declined',
			userId: 'user-2',
			mediaType: 'movie',
			tmdbId: 300,
			status: 'declined',
			arrServiceId: 'radarr-A'
		});

		const updated = markRequestsAvailable({
			mediaType: 'movie',
			tmdbId: 300,
			arrServiceId: 'radarr-A'
		});

		expect(updated).toEqual([]);
		expect(statusOf('req-avail')).toBe('available');
		expect(statusOf('req-declined')).toBe('declined');
	});

	it('tvdb matching works for tv requests', () => {
		seedUser();
		seedRequest({
			id: 'req-tv',
			userId: 'user-1',
			mediaType: 'tv',
			tmdbId: 400,
			tvdbId: 12345,
			status: 'processing',
			arrServiceId: 'sonarr-A',
			arrItemId: 7
		});

		const updated = markRequestsAvailable({
			mediaType: 'tv',
			tvdbId: 12345,
			arrServiceId: 'sonarr-A'
		});

		expect(updated.map((r) => r.id)).toEqual(['req-tv']);
		expect(statusOf('req-tv')).toBe('available');
	});

	it('does not cross media-type boundaries (a movie webhook leaves tv rows alone)', () => {
		seedUser();
		seedRequest({
			id: 'req-tv',
			userId: 'user-1',
			mediaType: 'tv',
			tmdbId: 500,
			status: 'processing',
			arrServiceId: 'sonarr-A'
		});

		const updated = markRequestsAvailable({ mediaType: 'movie', tmdbId: 500, arrServiceId: 'radarr-A' });
		expect(updated).toEqual([]);
		expect(statusOf('req-tv')).toBe('processing');
	});
});

// ───────────────────────────────────────────────────────────────────────────
// createNativeRequest / findExistingNativeRequest / reactivateNativeRequest
// ───────────────────────────────────────────────────────────────────────────

describe('createNativeRequest + findExistingNativeRequest', () => {
	it('creates a pending row and finds it by (userId, tmdbId, mediaType)', () => {
		seedUser('user-1');
		const created = createNativeRequest({
			userId: 'user-1',
			mediaType: 'movie',
			tmdbId: 600,
			title: 'Dune',
			serviceId: 'svc'
		});
		expect(created.status).toBe('pending');

		const found = findExistingNativeRequest('user-1', 600, 'movie');
		expect(found?.id).toBe(created.id);
	});

	it('dedupe scope is (user, tmdb, type): a different user / tmdb / type is NOT found', () => {
		seedUser('user-1');
		seedUser('user-2');
		createNativeRequest({ userId: 'user-1', mediaType: 'movie', tmdbId: 700, title: 'A', serviceId: 'svc' });

		expect(findExistingNativeRequest('user-2', 700, 'movie')).toBeUndefined(); // other user
		expect(findExistingNativeRequest('user-1', 701, 'movie')).toBeUndefined(); // other tmdb
		expect(findExistingNativeRequest('user-1', 700, 'tv')).toBeUndefined(); // other type
		expect(findExistingNativeRequest('user-1', 700, 'movie')).toBeDefined();
	});
});

describe('reactivateNativeRequest', () => {
	it('flips a declined row back to pending and clears decline/approval fields', () => {
		seedUser('user-1');
		seedRequest({
			id: 'req-dec',
			userId: 'user-1',
			tmdbId: 800,
			status: 'declined'
		});
		const declined = db.select().from(schema.mediaRequests).where(eqId('req-dec')).get()!;

		reactivateNativeRequest(declined, { title: 'Re-requested', serviceId: 'svc' });

		const after = db.select().from(schema.mediaRequests).where(eqId('req-dec')).get()!;
		expect(after.status).toBe('pending');
		expect(after.title).toBe('Re-requested');
		expect(after.declineReason).toBeNull();
		expect(after.approvedBy).toBeNull();
	});
});

// ───────────────────────────────────────────────────────────────────────────
// approveNativeRequest — replay guard + arr push
// ───────────────────────────────────────────────────────────────────────────

describe('approveNativeRequest', () => {
	function seedEnabledRadarr() {
		db.insert(schema.services)
			.values({
				id: 'radarr-1',
				name: 'Radarr',
				type: 'radarr',
				url: 'http://radarr.local',
				apiKey: 'k',
				enabled: true
			})
			.run();
	}

	it('pushes a pending movie into Radarr and marks it processing', async () => {
		seedUser('user-1');
		seedUser('admin-1'); // approvedBy FKs to users.id
		seedEnabledRadarr();
		seedRequest({ id: 'req-app', userId: 'user-1', tmdbId: 900, status: 'pending', mediaType: 'movie' });
		const req = db.select().from(schema.mediaRequests).where(eqId('req-app')).get()!;

		const result = await approveNativeRequest(req, 'admin-1');

		expect(radarrRequestMedia).toHaveBeenCalledTimes(1);
		expect(result.status).toBe('processing');

		const after = db.select().from(schema.mediaRequests).where(eqId('req-app')).get()!;
		expect(after.status).toBe('processing');
		expect(after.arrServiceId).toBe('radarr-1');
		expect(after.arrItemId).toBe(555);
		expect(after.approvedBy).toBe('admin-1');
	});

	it('throws on a non-pending request (replay / double-approve guard) and does NOT call the arr', async () => {
		seedUser('user-1');
		seedUser('admin-1'); // approvedBy FKs to users.id
		seedEnabledRadarr();
		seedRequest({ id: 'req-proc', userId: 'user-1', tmdbId: 901, status: 'processing', mediaType: 'movie' });
		const req = db.select().from(schema.mediaRequests).where(eqId('req-proc')).get()!;

		await expect(approveNativeRequest(req, 'admin-1')).rejects.toThrow(/not pending/);
		expect(radarrRequestMedia).not.toHaveBeenCalled();
	});
});

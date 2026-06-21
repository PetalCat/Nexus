/**
 * Stub adapters that PROVE the conformance gate.
 *
 * - mediaSourceStub  — a fully-conformant media-source adapter.
 * - nexusNativeStub   — a fully-conformant nexus-native adapter.
 * - brokenStub        — deliberately broken: declares `playback` with no
 *                       negotiatePlayback() (Rule C) AND carries a banned
 *                       `authenticateUser` key (Rule E). Used raw (NOT through
 *                       declareAdapter, which would reject it at compile time).
 * - exemptStub        — a conformant adapter that would trip Rule D, downgraded
 *                       to a warning via conformanceExempt.
 */

import type { ServiceConfig, ServiceHealth } from '../../types';
import type { NexusAdapter } from '../contract';
import { declareAdapter } from '../contract';

const ok = (config: ServiceConfig): ServiceHealth => ({
	serviceId: config.id,
	name: config.name,
	type: config.type,
	online: true
});

// ─── Fully-conformant media-source ───────────────────────────────────────────
export const mediaSourceStub = declareAdapter({
	id: 'stub-media',
	displayName: 'Stub Media Source',
	defaultPort: 8096,
	abbreviation: 'SM',
	color: '#00a4dc',
	contractVersion: 2,
	tier: 'media-source',
	capabilities: {
		media: ['movie', 'show'],
		serviceAuth: { required: true, fields: ['url', 'apiKey'], kind: 'api-key' },
		library: true,
		search: { priority: 10 },
		playback: true,
		sessions: { pollIntervalMs: 10_000 },
		sync: true
	},
	async ping(config) {
		return ok(config);
	},
	async probeServiceCredential() {
		return 'ok';
	},
	async getImageHeaders() {
		return {};
	},
	async getLibrary() {
		return { items: [], total: 0 };
	},
	async getRecentlyAdded() {
		return [];
	},
	async getItem() {
		return null;
	},
	async search() {
		return { items: [], total: 0, source: 'stub-media' };
	},
	async negotiatePlayback() {
		return {
			engine: 'progressive',
			url: 'https://example/stream',
			mode: 'direct-play',
			audioTracks: [],
			subtitleTracks: [],
			burnableSubtitleTracks: []
		};
	},
	async pollSessions() {
		return [];
	},
	async syncLibraryItems() {
		return [];
	}
} satisfies NexusAdapter);

// ─── Fully-conformant nexus-native ───────────────────────────────────────────
export const nexusNativeStub = declareAdapter({
	id: 'stub-native',
	displayName: 'Stub Nexus Native',
	defaultPort: 0,
	abbreviation: 'SN',
	color: '#6366f1',
	contractVersion: 2,
	tier: 'nexus-native',
	capabilities: {
		media: ['movie'],
		// no serviceAuth.required, no library, no playback — all legal here.
		search: { priority: 50 },
		sync: true,
		derivesFrom: ['stub-media']
	},
	async ping(config) {
		return ok(config);
	},
	async search() {
		return { items: [], total: 0, source: 'stub-native' };
	},
	async syncLibraryItems() {
		return [];
	}
} satisfies NexusAdapter);

// ─── Fully-conformant request-fulfillment (extra coverage) ───────────────────
export const requestStub = declareAdapter({
	id: 'stub-requests',
	displayName: 'Stub Requests',
	defaultPort: 5055,
	abbreviation: 'SR',
	color: '#f59e0b',
	contractVersion: 2,
	tier: 'request-fulfillment',
	capabilities: {
		media: ['movie', 'show'],
		serviceAuth: { required: true, fields: ['url', 'apiKey'], kind: 'api-key' },
		requests: true,
		search: { priority: 90 }
	},
	async ping(config) {
		return ok(config);
	},
	async submitRequest() {
		return true;
	},
	async getRequests() {
		return [];
	},
	async search() {
		return { items: [], total: 0, source: 'stub-requests' };
	}
} satisfies NexusAdapter);

// ─── Deliberately BROKEN adapter ──────────────────────────────────────────────
// NOT run through declareAdapter — declareAdapter would reject the banned
// `authenticateUser` key at COMPILE time, which is the point. We hand-build the
// object as a plain NexusAdapter (with a cast for the banned key) so the gate
// can catch it at RUNTIME.
export const brokenStub = {
	id: 'stub-broken',
	displayName: 'Stub Broken',
	defaultPort: 9999,
	abbreviation: 'SB',
	color: '#ef4444',
	contractVersion: 2,
	tier: 'media-source',
	capabilities: {
		media: ['movie'],
		serviceAuth: { required: true, fields: ['url'], kind: 'api-key' },
		library: true,
		playback: true // declared but negotiatePlayback() is MISSING → Rule C
	},
	async ping(config: ServiceConfig) {
		return ok(config);
	},
	async getLibrary() {
		return { items: [], total: 0 };
	},
	async getRecentlyAdded() {
		return [];
	},
	// negotiatePlayback intentionally absent.
	// Banned v1 surface ported back in → Rule E.
	async authenticateUser() {
		return { accessToken: 'x', externalUserId: 'x', externalUsername: 'x' };
	}
} as unknown as NexusAdapter;

// ─── Conformant-via-exemption adapter ─────────────────────────────────────────
// Implements pollSessions() without declaring `sessions` (would be a Rule D hard
// FAIL) but carries a conformanceExempt entry downgrading D to a warning.
export const exemptStub = {
	id: 'stub-exempt',
	displayName: 'Stub Exempt',
	defaultPort: 8097,
	abbreviation: 'SE',
	color: '#10b981',
	contractVersion: 2,
	tier: 'media-source',
	conformanceExempt: [
		{ rule: 'D.dead-method', reason: 'sessions wired by a sibling module during migration' }
	],
	capabilities: {
		media: ['movie'],
		serviceAuth: { required: true, fields: ['url', 'apiKey'], kind: 'api-key' },
		library: true
	},
	async ping(config: ServiceConfig) {
		return ok(config);
	},
	async getLibrary() {
		return { items: [], total: 0 };
	},
	async getRecentlyAdded() {
		return [];
	},
	// pollSessions present WITHOUT a `sessions` capability → Rule D, but exempted.
	async pollSessions() {
		return [];
	}
} as unknown as NexusAdapter;

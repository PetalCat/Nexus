import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	assertConformant,
	hardFailures,
	warnings,
	rules
} from '../conformance';
import { deriveFlags, declareAdapter } from '../contract';
import type { NexusAdapter } from '../contract';
import { AdapterRegistryV2, AdapterConformanceError } from '../registry';
import {
	mediaSourceStub,
	nexusNativeStub,
	requestStub,
	brokenStub,
	exemptStub
} from './stubs';

describe('v2 conformance gate', () => {
	// ── conformant stubs pass ──────────────────────────────────────────────
	it('a fully-conformant media-source produces ZERO violations', () => {
		expect(assertConformant(mediaSourceStub)).toEqual([]);
	});

	it('a fully-conformant nexus-native produces ZERO violations', () => {
		expect(assertConformant(nexusNativeStub)).toEqual([]);
	});

	it('a fully-conformant request-fulfillment produces ZERO violations', () => {
		expect(assertConformant(requestStub)).toEqual([]);
	});

	// ── broken stub: ALL violations reported in one run (not die-on-first) ──
	it('the broken stub trips BOTH Rule C (missing method) and Rule E (banned key)', () => {
		const violations = assertConformant(brokenStub);
		const fails = hardFailures(violations);

		// Rule C: declared playback but missing negotiatePlayback.
		const c = fails.find((x) => x.rule === 'C.missing-method');
		expect(c).toBeDefined();
		expect(c!.message).toContain('negotiatePlayback');

		// Rule E: carries banned v1 `authenticateUser`.
		const e = fails.find((x) => x.rule === 'E.banned-v1-surface');
		expect(e).toBeDefined();
		expect(e!.message).toContain('authenticateUser');

		// Both surfaced in a single run.
		expect(fails.length).toBeGreaterThanOrEqual(2);
	});

	// ── MCP SKIP/FAIL asymmetry: undeclared surface warns, not fails ────────
	it('genuine hard failures are only C and D families', () => {
		// Construct an adapter with an unrecognized capability key (undeclared
		// surface) — must be a WARNING, never a hard FAIL.
		const odd = {
			...mediaSourceStub,
			capabilities: { ...mediaSourceStub.capabilities, somethingWeird: true }
		} as unknown as NexusAdapter;
		const violations = assertConformant(odd);
		expect(hardFailures(violations)).toEqual([]);
		expect(warnings(violations).some((w) => w.message.includes('somethingWeird'))).toBe(true);
	});

	// ── Rule A: v1 contractVersion is a hard reject ─────────────────────────
	it('Rule A hard-rejects a non-2 contractVersion (v1 split-shape)', () => {
		const v1ish = { ...mediaSourceStub, contractVersion: 1 } as unknown as NexusAdapter;
		const fails = hardFailures(assertConformant(v1ish));
		expect(fails.some((x) => x.rule === 'A.contract-version')).toBe(true);
	});

	// ── Rule B: tier ⇒ shape ────────────────────────────────────────────────
	it('Rule B forbids requests on a media-source', () => {
		const bad = {
			...mediaSourceStub,
			capabilities: { ...mediaSourceStub.capabilities, requests: true },
			submitRequest: async () => true,
			getRequests: async () => []
		} as unknown as NexusAdapter;
		const fails = hardFailures(assertConformant(bad));
		expect(fails.some((x) => x.family === 'B' && x.message.includes('requests'))).toBe(true);
	});

	it('Rule B forbids library/playback on nexus-native', () => {
		const bad = {
			...nexusNativeStub,
			capabilities: { ...nexusNativeStub.capabilities, library: true },
			getLibrary: async () => ({ items: [], total: 0 }),
			getRecentlyAdded: async () => []
		} as unknown as NexusAdapter;
		const fails = hardFailures(assertConformant(bad));
		expect(fails.some((x) => x.family === 'B' && x.message.includes('library'))).toBe(true);
	});

	// ── Rule F: signature purity (arity backstop) ───────────────────────────
	it('Rule F flags a method with a ported-in extra (UserCredential) param', () => {
		const bad = {
			...mediaSourceStub,
			// search(config, query, userCred) — one param too many.
			search: async (_c: unknown, _q: unknown, _userCred: unknown) => ({
				items: [],
				total: 0,
				source: 'x'
			})
		} as unknown as NexusAdapter;
		const fails = hardFailures(assertConformant(bad));
		expect(fails.some((x) => x.family === 'F')).toBe(true);
	});

	it('SECURITY: conformanceExempt CANNOT waive the Rule F UserCredential ban', () => {
		// An adapter trying to opt out of the security backstop must still hard-fail.
		const bad = {
			...mediaSourceStub,
			conformanceExempt: [{ rule: 'F', reason: 'sneaky' }],
			search: async (_c: unknown, _q: unknown, _userCred: unknown) => ({
				items: [],
				total: 0,
				source: 'x'
			})
		} as unknown as NexusAdapter;
		const fails = hardFailures(assertConformant(bad));
		expect(fails.some((x) => x.family === 'F')).toBe(true); // NOT downgraded
	});

	it('Rule F ALLOWS negotiatePlayback(config,item,plan,caps,ctx) — ctx is the Nexus request context, not a backend cred', () => {
		const ok = {
			...mediaSourceStub,
			capabilities: { ...mediaSourceStub.capabilities, playback: { progressive: true } },
			// 5 params: the 5th is the typed Nexus identity ctx (allowed).
			negotiatePlayback: async (_c: unknown, _i: unknown, _p: unknown, _caps: unknown, _ctx: unknown) =>
				({ engine: 'progressive', url: '', mime: '' }) as unknown
		} as unknown as NexusAdapter;
		const fails = hardFailures(assertConformant(ok));
		expect(fails.some((x) => x.family === 'F')).toBe(false);
	});

	it('Rule F still flags negotiatePlayback with a 6th param (ctx + a ported-in extra)', () => {
		const bad = {
			...mediaSourceStub,
			capabilities: { ...mediaSourceStub.capabilities, playback: { progressive: true } },
			negotiatePlayback: async (
				_c: unknown,
				_i: unknown,
				_p: unknown,
				_caps: unknown,
				_ctx: unknown,
				_userCred: unknown
			) => ({ engine: 'progressive', url: '', mime: '' }) as unknown
		} as unknown as NexusAdapter;
		const fails = hardFailures(assertConformant(bad));
		expect(fails.some((x) => x.family === 'F')).toBe(true);
	});

	// ── the rule set really is modular ──────────────────────────────────────
	it('exposes per-rule modules covering families A–G', () => {
		const families = new Set(rules.map((r) => r.family));
		for (const f of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
			expect(families.has(f)).toBe(true);
		}
	});
});

describe('declareAdapter derived flags', () => {
	it('derives loose flags from capabilities and freezes them on', () => {
		expect(mediaSourceStub.isLibrary).toBe(true);
		expect(mediaSourceStub.isSearchable).toBe(true);
		expect(mediaSourceStub.searchPriority).toBe(10);
		expect(mediaSourceStub.pollIntervalMs).toBe(10_000);
		expect(mediaSourceStub.mediaTypes).toEqual(['movie', 'show']);
		expect(Object.isFrozen(mediaSourceStub)).toBe(true);
	});

	it('derives correctly for a non-searchable / no-sessions adapter', () => {
		const a = declareAdapter({
			id: 'd1',
			displayName: 'D1',
			defaultPort: 1,
			abbreviation: 'D1',
			color: '#000',
			contractVersion: 2,
			tier: 'media-source',
			capabilities: {
				media: ['video'],
				serviceAuth: { required: false, fields: ['url'], kind: 'none' }
			},
			async ping(config) {
				return { serviceId: config.id, name: config.name, type: config.type, online: true };
			}
		} satisfies NexusAdapter);
		expect(a.isLibrary).toBe(false);
		expect(a.isSearchable).toBe(false);
		expect(a.searchPriority).toBe(Infinity);
		expect(a.pollIntervalMs).toBeUndefined();
		expect(a.mediaTypes).toEqual(['video']);
	});

	it('deriveFlags is pure and matches declareAdapter output', () => {
		expect(deriveFlags(nexusNativeStub)).toMatchObject({
			isLibrary: false,
			isSearchable: true,
			searchPriority: 50,
			mediaTypes: ['movie']
		});
	});
});

describe('AdapterRegistryV2 gate', () => {
	let registry: AdapterRegistryV2;
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		registry = new AdapterRegistryV2();
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => {
		warnSpy.mockRestore();
	});

	it('register() succeeds for conformant adapters and derives accessors', () => {
		registry.register(mediaSourceStub).register(nexusNativeStub).register(requestStub);
		expect(registry.types().sort()).toEqual(['stub-media', 'stub-native', 'stub-requests']);

		// libraries() reads the DERIVED flag.
		expect(registry.libraries().map((a) => a.id)).toEqual(['stub-media']);

		// searchable() sorted by derived priority (10, 50, 90).
		expect(registry.searchable().map((a) => a.id)).toEqual([
			'stub-media',
			'stub-native',
			'stub-requests'
		]);

		expect(registry.byMediaType('show').map((a) => a.id).sort()).toEqual([
			'stub-media',
			'stub-requests'
		]);
	});

	it('register() THROWS AdapterConformanceError on the broken stub, with ALL violations', () => {
		expect(() => registry.register(brokenStub)).toThrow(AdapterConformanceError);

		let caught: AdapterConformanceError | undefined;
		try {
			registry.register(brokenStub);
		} catch (err) {
			caught = err as AdapterConformanceError;
		}
		expect(caught).toBeInstanceOf(AdapterConformanceError);
		expect(caught!.adapterId).toBe('stub-broken');
		// Reports ALL violations across the adapter, not just the first.
		const rulesHit = new Set(caught!.violations.filter((x) => x.severity === 'error').map((x) => x.rule));
		expect(rulesHit.has('C.missing-method')).toBe(true);
		expect(rulesHit.has('E.banned-v1-surface')).toBe(true);
		// The broken adapter was NOT stored.
		expect(registry.get('stub-broken')).toBeUndefined();
	});
});

describe('conformanceExempt escape hatch', () => {
	it('downgrades a named rule from error to a logged warning', () => {
		const violations = assertConformant(exemptStub);

		// No hard failures remain — the Rule D failure was downgraded.
		expect(hardFailures(violations)).toEqual([]);

		// The downgraded violation shows as an exempted warning with its reason.
		const downgraded = warnings(violations).find((w) => w.rule === 'D.dead-method');
		expect(downgraded).toBeDefined();
		expect(downgraded!.exempted).toBe(true);
		expect(downgraded!.exemptionReason).toContain('sibling module');
	});

	it('an exempt adapter REGISTERS successfully (warning, not throw)', () => {
		const registry = new AdapterRegistryV2();
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(() => registry.register(exemptStub)).not.toThrow();
		expect(registry.get('stub-exempt')).toBeDefined();
		// The exemption was logged loudly.
		expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('EXEMPT'))).toBe(true);
		warnSpy.mockRestore();
	});
});

/**
 * Nexus Adapter Conformance Gate — v2.
 *
 * `assertConformant(adapter): Violation[]` — PURE, no I/O. Runs at register()
 * (throwing on hard failures, crashing boot on a genuinely-unsafe adapter) and
 * as a CI-blocking gate.
 *
 * Structured HA-hassfest-style as per-rule MODULES (`rules: ConformanceRule[]`),
 * each `(adapter) => Violation[]`, never a monolith. Rule families:
 *   A  Identity        — contractVersion === 2, has id, hard-reject v1 split-shape
 *   B  Tier ⇒ shape    — each tier's legal/illegal capability set
 *   C  Capability ⇒ method — declared capability MUST have its method (HARD FAIL)
 *   D  Method ⇒ capability — method present without its capability (HARD FAIL)
 *   E  Banned v1 surface  — userAuth/authenticateUser/... present ⇒ violation
 *   F  Signature purity   — no UserCredential param (method-arity backstop)
 *   G  Coherence          — cross-field sanity (media kinds, derivesFrom, etc.)
 *
 * MCP SKIP/FAIL asymmetry: of all the checks, only the TWO genuine hard failures
 * FAIL — C (declared-capability-missing-method) and D (method-without-capability).
 * Undeclared / unexpected surface is a WARNING (SKIP), never a hard FAIL.
 * `conformanceExempt` downgrades any named rule's errors to logged warnings.
 */

import type { NexusAdapter, AdapterTier } from './contract';
import { ADAPTER_CONTRACT_VERSION, BANNED_V1_KEYS } from './contract';

// ─────────────────────────────────────────────────────────────────────────────
// Violation model + error/warning split.
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = 'error' | 'warning';

export interface Violation {
	/** Rule family letter (A–G). */
	readonly family: string;
	/** Specific rule id, e.g. 'C.missing-method' — also the exemption key. */
	readonly rule: string;
	readonly severity: Severity;
	readonly message: string;
	/** True when this violation was downgraded error→warning by an exemption. */
	readonly exempted?: boolean;
	/** The exemption reason, if exempted. */
	readonly exemptionReason?: string;
}

/** A single conformance rule module. Pure: adapter in, violations out. */
export interface ConformanceRule {
	/** Family letter — used for exemption matching by family. */
	readonly family: string;
	/** Stable rule id. */
	readonly id: string;
	readonly run: (adapter: NexusAdapter) => Violation[];
}

const v = (
	family: string,
	rule: string,
	severity: Severity,
	message: string
): Violation => ({ family, rule, severity, message });

/** View the adapter as a loose key bag (for runtime introspection). */
function bag(adapter: NexusAdapter): Record<string, unknown> {
	return adapter as unknown as Record<string, unknown>;
}

/** Does the adapter object carry a non-null own property by this name? */
function has(adapter: NexusAdapter, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(adapter, key) && bag(adapter)[key] != null;
}
function hasMethod(adapter: NexusAdapter, key: string): boolean {
	return typeof bag(adapter)[key] === 'function';
}

// ─────────────────────────────────────────────────────────────────────────────
// Capability ⇄ method map (single source for rules C and D).
// ─────────────────────────────────────────────────────────────────────────────

interface CapMethodLink {
	/** Predicate: is the capability declared? */
	declared: (a: NexusAdapter) => boolean;
	/** Human label for the capability. */
	capLabel: string;
	/** Methods required when the capability is declared. */
	methods: string[];
}

const CAP_METHOD_LINKS: CapMethodLink[] = [
	{
		declared: (a) => a.capabilities.library === true,
		capLabel: 'library',
		methods: ['getLibrary', 'getRecentlyAdded']
	},
	{
		declared: (a) => a.capabilities.search != null,
		capLabel: 'search',
		methods: ['search']
	},
	{
		declared: (a) => a.capabilities.playback === true,
		capLabel: 'playback',
		methods: ['negotiatePlayback']
	},
	{
		declared: (a) => a.capabilities.sessions != null,
		capLabel: 'sessions',
		methods: ['pollSessions']
	},
	{
		declared: (a) => a.capabilities.requests === true,
		capLabel: 'requests',
		methods: ['submitRequest', 'getRequests']
	},
	{
		declared: (a) => a.capabilities.sync === true,
		capLabel: 'sync',
		methods: ['syncLibraryItems']
	}
];

/** Every capability-gated method known to the contract (for Rule D). */
const ALL_GATED_METHODS = new Map<string, CapMethodLink>();
for (const link of CAP_METHOD_LINKS) {
	for (const m of link.methods) ALL_GATED_METHODS.set(m, link);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier ⇒ legal-shape table (Rule B).
// ─────────────────────────────────────────────────────────────────────────────

interface TierShape {
	serviceAuthRequired?: boolean; // true: must be required; false: must not be required
	forbid: string[]; // capability keys illegal for this tier
}

const TIER_SHAPES: Record<AdapterTier, TierShape> = {
	'media-source': {
		serviceAuthRequired: undefined, // serviceAuth must EXIST (checked below) but required may vary (anon Invidious)
		forbid: ['requests']
	},
	'request-fulfillment': {
		serviceAuthRequired: true,
		forbid: ['library', 'playback', 'sessions']
	},
	'nexus-native': {
		forbid: ['library', 'playback'] // and serviceAuth.required must be false/absent
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Rule families.
// ─────────────────────────────────────────────────────────────────────────────

const RULE_A: ConformanceRule = {
	family: 'A',
	id: 'A.identity',
	run(a) {
		const out: Violation[] = [];
		if (!a.id || typeof a.id !== 'string') {
			out.push(v('A', 'A.identity', 'error', 'adapter is missing a string `id`'));
		}
		if (!a.displayName) {
			out.push(v('A', 'A.identity', 'error', `adapter "${a.id}" missing displayName`));
		}
		if (a.contractVersion !== ADAPTER_CONTRACT_VERSION) {
			out.push(
				v(
					'A',
					'A.contract-version',
					'error',
					`adapter "${a.id}" declares contractVersion ${String(
						a.contractVersion
					)} — v2 requires ${ADAPTER_CONTRACT_VERSION} (a v1 split-shape adapter cannot load)`
				)
			);
		}
		if (!a.capabilities || typeof a.capabilities !== 'object') {
			out.push(v('A', 'A.identity', 'error', `adapter "${a.id}" has no capabilities object`));
		}
		return out;
	}
};

const RULE_B: ConformanceRule = {
	family: 'B',
	id: 'B.tier-shape',
	run(a) {
		const out: Violation[] = [];
		const tier = a.tier;
		const shape = TIER_SHAPES[tier];
		if (!shape) {
			out.push(v('B', 'B.tier-shape', 'error', `adapter "${a.id}" has unknown tier "${tier}"`));
			return out;
		}
		const caps = a.capabilities ?? {};

		for (const forbidden of shape.forbid) {
			if ((caps as Record<string, unknown>)[forbidden] != null &&
				(caps as Record<string, unknown>)[forbidden] !== false) {
				out.push(
					v(
						'B',
						'B.tier-shape',
						'error',
						`tier "${tier}" forbids capability "${forbidden}" (adapter "${a.id}")`
					)
				);
			}
		}

		if (tier === 'media-source') {
			if (caps.serviceAuth == null) {
				out.push(
					v('B', 'B.tier-shape', 'error', `media-source "${a.id}" must declare serviceAuth`)
				);
			}
		}
		if (tier === 'request-fulfillment') {
			if (caps.serviceAuth == null || caps.serviceAuth.required !== true) {
				out.push(
					v(
						'B',
						'B.tier-shape',
						'error',
						`request-fulfillment "${a.id}" must declare serviceAuth.required=true`
					)
				);
			}
			if (caps.requests !== true) {
				out.push(
					v('B', 'B.tier-shape', 'error', `request-fulfillment "${a.id}" must declare requests`)
				);
			}
		}
		if (tier === 'nexus-native') {
			if (caps.serviceAuth?.required === true) {
				out.push(
					v(
						'B',
						'B.tier-shape',
						'error',
						`nexus-native "${a.id}" must not require serviceAuth (it acts over Nexus-owned data)`
					)
				);
			}
		}
		return out;
	}
};

// Rule C — declared capability MUST have its method. HARD FAIL #1.
const RULE_C: ConformanceRule = {
	family: 'C',
	id: 'C.missing-method',
	run(a) {
		const out: Violation[] = [];
		for (const link of CAP_METHOD_LINKS) {
			if (!link.declared(a)) continue;
			for (const m of link.methods) {
				if (!hasMethod(a, m)) {
					out.push(
						v(
							'C',
							'C.missing-method',
							'error',
							`adapter "${a.id}" declares capability "${link.capLabel}" but is missing method "${m}()"`
						)
					);
				}
			}
		}
		return out;
	}
};

// Rule D — method present without its capability. HARD FAIL #2 (kills dead code).
const RULE_D: ConformanceRule = {
	family: 'D',
	id: 'D.dead-method',
	run(a) {
		const out: Violation[] = [];
		for (const [method, link] of ALL_GATED_METHODS) {
			if (hasMethod(a, method) && !link.declared(a)) {
				out.push(
					v(
						'D',
						'D.dead-method',
						'error',
						`adapter "${a.id}" implements "${method}()" but never declares capability "${link.capLabel}" (dead code)`
					)
				);
			}
		}
		return out;
	}
};

// Rule E — NO BANNED v1 SURFACE. Presence mechanically proves rot ported back.
const RULE_E: ConformanceRule = {
	family: 'E',
	id: 'E.banned-v1-surface',
	run(a) {
		const out: Violation[] = [];
		for (const key of BANNED_V1_KEYS) {
			if (has(a, key) || Object.prototype.hasOwnProperty.call(a, key)) {
				out.push(
					v(
						'E',
						'E.banned-v1-surface',
						'error',
						`adapter "${a.id}" carries banned v1 surface "${key}" — the Nexus-owns-identity rebuild deleted this; remove it (don't port it back)`
					)
				);
			}
		}
		// Banned v1 keys may also hide inside capabilities.
		const caps = (a.capabilities ?? {}) as Record<string, unknown>;
		for (const key of BANNED_V1_KEYS) {
			if (Object.prototype.hasOwnProperty.call(caps, key)) {
				out.push(
					v(
						'E',
						'E.banned-v1-surface',
						'error',
						`adapter "${a.id}".capabilities carries banned v1 key "${key}"`
					)
				);
			}
		}
		return out;
	}
};

// Rule F — signature purity: no UserCredential param. We can't read TS types at
// runtime, so the backstop is method ARITY: a v1 method took an extra userCred
// argument, so any core method declaring MORE params than its v2 signature
// allows is flagged. This catches a ported-in `(config, userCred, …)` method.
const MAX_ARITY: Record<string, number> = {
	ping: 1,
	probeServiceCredential: 1,
	getImageHeaders: 1,
	getLibrary: 2,
	getRecentlyAdded: 1,
	getItem: 2,
	search: 2,
	negotiatePlayback: 4,
	pollSessions: 1,
	submitRequest: 3,
	getRequests: 2,
	approveRequest: 2,
	denyRequest: 2,
	syncLibraryItems: 1
};

const RULE_F: ConformanceRule = {
	family: 'F',
	id: 'F.signature-purity',
	run(a) {
		const out: Violation[] = [];
		for (const [method, maxArity] of Object.entries(MAX_ARITY)) {
			if (!hasMethod(a, method)) continue;
			const fn = bag(a)[method] as (...args: unknown[]) => unknown;
			if (fn.length > maxArity) {
				out.push(
					v(
						'F',
						'F.signature-purity',
						'error',
						`method "${method}()" on "${a.id}" declares ${fn.length} params (max ${maxArity}) — likely a ported-in UserCredential argument; core methods take (config, …) only`
					)
				);
			}
		}
		return out;
	}
};

// Rule G — coherence (cross-field sanity). These are WARNINGS (SKIP), not hard
// FAILs, per the MCP asymmetry: unexpected-but-not-unsafe surface warns.
const KNOWN_CAP_KEYS = new Set([
	'media',
	'serviceAuth',
	'library',
	'search',
	'playback',
	'sessions',
	'requests',
	'sync',
	'derivesFrom'
]);

const RULE_G: ConformanceRule = {
	family: 'G',
	id: 'G.coherence',
	run(a) {
		const out: Violation[] = [];
		const caps = (a.capabilities ?? {}) as Record<string, unknown>;

		// derivesFrom only legal on nexus-native.
		if (caps.derivesFrom != null && a.tier !== 'nexus-native') {
			out.push(
				v(
					'G',
					'G.coherence',
					'warning',
					`adapter "${a.id}" declares derivesFrom but is tier "${a.tier}" (only nexus-native derives)`
				)
			);
		}

		// A media-source / nexus-native that surfaces content should name media kinds.
		if (
			(a.tier === 'media-source') &&
			(!Array.isArray(caps.media) || (caps.media as unknown[]).length === 0)
		) {
			out.push(
				v('G', 'G.coherence', 'warning', `media-source "${a.id}" declares no media kinds`)
			);
		}

		// Undeclared capability keys = SKIP/warn, never a hard FAIL.
		for (const key of Object.keys(caps)) {
			if (!KNOWN_CAP_KEYS.has(key)) {
				out.push(
					v(
						'G',
						'G.coherence',
						'warning',
						`adapter "${a.id}".capabilities has unrecognized key "${key}" (ignored)`
					)
				);
			}
		}

		// NOTE: derived flags (isLibrary/searchPriority/…) appearing at top level
		// are EXPECTED — declareAdapter and the registry add them. Hand-writing one
		// in the literal is blocked at COMPILE time by declareAdapter's
		// NoForbiddenKeys guard, so there is nothing to check at runtime here.
		return out;
	}
};

/** The ordered rule set. Add rules here; assertConformant runs them all. */
export const rules: ConformanceRule[] = [
	RULE_A,
	RULE_B,
	RULE_C,
	RULE_D,
	RULE_E,
	RULE_F,
	RULE_G
];

// ─────────────────────────────────────────────────────────────────────────────
// assertConformant — run every rule, collect ALL violations, apply exemptions.
// PURE. Does not throw (the registry decides what to do with the result).
// ─────────────────────────────────────────────────────────────────────────────

export function assertConformant(adapter: NexusAdapter): Violation[] {
	const exemptions = adapter.conformanceExempt ?? [];
	const out: Violation[] = [];

	for (const rule of rules) {
		let produced: Violation[];
		try {
			produced = rule.run(adapter);
		} catch (err) {
			// A rule throwing is itself a conformance error (defensive, all-in-one-run).
			produced = [
				v('?', `${rule.id}.threw`, 'error', `rule ${rule.id} threw: ${String(err)}`)
			];
		}

		for (const violation of produced) {
			const exemption = exemptions.find(
				(e) => e.rule === violation.rule || e.rule === violation.family
			);
			if (exemption && violation.severity === 'error') {
				out.push({
					...violation,
					severity: 'warning',
					exempted: true,
					exemptionReason: exemption.reason
				});
			} else {
				out.push(violation);
			}
		}
	}
	return out;
}

/** Convenience: only the hard failures (post-exemption errors). */
export function hardFailures(violations: Violation[]): Violation[] {
	return violations.filter((x) => x.severity === 'error');
}

/** Convenience: warnings (including downgraded/exempted errors). */
export function warnings(violations: Violation[]): Violation[] {
	return violations.filter((x) => x.severity === 'warning');
}

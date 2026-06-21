/**
 * Nexus Adapter Registry — v2.
 *
 * register(adapter) runs the conformance gate AT REGISTRATION and THROWS
 * `AdapterConformanceError` on hard failures — reporting ALL violations across
 * the adapter (not die-on-first). Warnings (including exempted/downgraded ones)
 * are logged loudly but do not block. Derived flags are computed once and stored.
 *
 * This is the third enforcement layer (TS compile + boot throw + CI gate) the
 * blueprint calls for: a non-conformant adapter crashes its own registration
 * rather than silently degrading at runtime the way v1 did.
 */

import type { NexusAdapter, RegisteredAdapter } from './contract';
import { deriveFlags } from './contract';
import {
	assertConformant,
	hardFailures,
	warnings,
	type Violation
} from './conformance';

/** Thrown by register() when an adapter fails the conformance gate. */
export class AdapterConformanceError extends Error {
	readonly adapterId: string;
	readonly violations: Violation[];

	constructor(adapterId: string, violations: Violation[]) {
		const fails = violations.filter((x) => x.severity === 'error');
		const lines = fails.map((x) => `  [${x.rule}] ${x.message}`).join('\n');
		super(
			`Adapter "${adapterId}" failed conformance with ${fails.length} hard failure(s):\n${lines}`
		);
		this.name = 'AdapterConformanceError';
		this.adapterId = adapterId;
		this.violations = violations;
	}
}

export class AdapterRegistryV2 {
	private adapters = new Map<string, RegisteredAdapter>();

	/**
	 * Register an adapter. Runs conformance; THROWS on hard failures (all
	 * reported at once); logs warnings; stores the adapter with derived flags.
	 */
	register(adapter: NexusAdapter): this {
		const violations = assertConformant(adapter);

		for (const w of warnings(violations)) {
			const tag = w.exempted ? ` (EXEMPT: ${w.exemptionReason})` : '';
			console.warn(`[Nexus v2][conformance][${w.rule}] ${w.message}${tag}`);
		}

		const fails = hardFailures(violations);
		if (fails.length > 0) {
			throw new AdapterConformanceError(adapter.id, violations);
		}

		if (this.adapters.has(adapter.id)) {
			console.warn(`[Nexus v2] Overwriting adapter "${adapter.id}"`);
		}

		// Derive loose flags here — the registry is the single producer.
		const derived = deriveFlags(adapter);
		const registered = { ...adapter, ...derived } as RegisteredAdapter;
		this.adapters.set(adapter.id, registered);
		return this;
	}

	get(type: string): RegisteredAdapter | undefined {
		return this.adapters.get(type);
	}

	all(): RegisteredAdapter[] {
		return [...this.adapters.values()];
	}

	types(): string[] {
		return [...this.adapters.keys()];
	}

	/** Adapters providing a browsable library (derived from capabilities.library). */
	libraries(): RegisteredAdapter[] {
		return this.all().filter((a) => a.isLibrary);
	}

	/** Searchable adapters, sorted by derived searchPriority (lower first). */
	searchable(): RegisteredAdapter[] {
		return this.all()
			.filter((a) => a.isSearchable)
			.sort((a, b) => a.searchPriority - b.searchPriority);
	}

	/** Adapters surfacing a given media kind (derived from capabilities.media). */
	byMediaType(mediaType: string): RegisteredAdapter[] {
		return this.all().filter((a) => a.mediaTypes.includes(mediaType as never));
	}
}

/** The singleton v2 registry. Concrete adapters get registered onto this. */
export const registryV2 = new AdapterRegistryV2();

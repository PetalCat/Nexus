import { describe, it, expect } from 'vitest';
import { invidiousV2 } from '../invidious';
import { assertConformant } from '../conformance';

describe('invidiousV2 adapter', () => {
	it('passes the conformance gate (no hard failures)', () => {
		const violations = assertConformant(invidiousV2);
		const hard = violations.filter((v) => v.severity === 'error' && !v.exempted);
		expect(hard).toEqual([]);
	});

	it('is an anonymous media-source with playback, no per-user auth surface', () => {
		expect(invidiousV2.tier).toBe('media-source');
		expect(invidiousV2.capabilities.serviceAuth?.required).toBe(false);
		expect(invidiousV2.capabilities.serviceAuth?.kind).toBe('none');
		expect(invidiousV2.capabilities.playback).toBe(true);
		expect(invidiousV2.capabilities.media).toEqual(['video']);
		// Derived flags computed by declareAdapter.
		expect(invidiousV2.mediaTypes).toEqual(['video']);
	});

	it('declares negotiatePlayback with the ctx (Nexus identity) param, no UserCredential', () => {
		expect(typeof invidiousV2.negotiatePlayback).toBe('function');
		// (config, item, plan, caps, ctx) — 5 params, the 5th is Nexus ctx.
		expect(invidiousV2.negotiatePlayback?.length).toBeLessThanOrEqual(5);
		// no banned v1 per-user auth surface
		expect((invidiousV2 as unknown as Record<string, unknown>).authenticateUser).toBeUndefined();
		expect((invidiousV2 as unknown as Record<string, unknown>).getUserCredential).toBeUndefined();
	});
});

import { describe, it, expect } from 'vitest';
import { resolvePlaybackRate, type SpeedRule } from '../speed-resolver';

describe('resolvePlaybackRate', () => {
	it('returns 1 when no rules exist', () => {
		expect(resolvePlaybackRate([], 'movie')).toBe(1);
	});

	it('returns the default-rule speed when only default exists', () => {
		const rules: SpeedRule[] = [{ scope: 'default', scopeValue: null, speed: 1.25 }];
		expect(resolvePlaybackRate(rules, 'movie')).toBe(1.25);
	});

	it('type rule beats default rule', () => {
		const rules: SpeedRule[] = [
			{ scope: 'default', scopeValue: null, speed: 1.25 },
			{ scope: 'type', scopeValue: 'movie', speed: 1.0 }
		];
		expect(resolvePlaybackRate(rules, 'movie')).toBe(1.0);
		// non-matching type falls back to default
		expect(resolvePlaybackRate(rules, 'video')).toBe(1.25);
	});

	it('channel rule beats type rule', () => {
		const rules: SpeedRule[] = [
			{ scope: 'default', scopeValue: null, speed: 1.25 },
			{ scope: 'type', scopeValue: 'video', speed: 1.5 },
			{ scope: 'channel', scopeValue: 'ch-1', speed: 2.0 }
		];
		expect(resolvePlaybackRate(rules, 'video', 'some-video', 'ch-1')).toBe(2.0);
	});

	it('video rule beats channel rule', () => {
		const rules: SpeedRule[] = [
			{ scope: 'default', scopeValue: null, speed: 1.25 },
			{ scope: 'channel', scopeValue: 'ch-1', speed: 2.0 },
			{ scope: 'video', scopeValue: 'vid-1', speed: 1.75 }
		];
		expect(resolvePlaybackRate(rules, 'video', 'vid-1', 'ch-1')).toBe(1.75);
	});

	it('skips invalid speeds and falls through to the next rule', () => {
		const rules: SpeedRule[] = [
			{ scope: 'default', scopeValue: null, speed: 1.5 },
			{ scope: 'type', scopeValue: 'movie', speed: 0 } // invalid
		];
		expect(resolvePlaybackRate(rules, 'movie')).toBe(1.5);
	});

	it('returns 1 when mediaType is undefined and only a type rule exists', () => {
		const rules: SpeedRule[] = [{ scope: 'type', scopeValue: 'movie', speed: 2.0 }];
		expect(resolvePlaybackRate(rules, undefined)).toBe(1);
	});

	it('respects upper and lower speed bounds', () => {
		const rules: SpeedRule[] = [{ scope: 'default', scopeValue: null, speed: 32 }];
		// 32 > 16 → invalid, falls back to 1
		expect(resolvePlaybackRate(rules, 'movie')).toBe(1);
	});
});

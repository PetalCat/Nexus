import { describe, it, expect, beforeEach } from 'vitest';
import { withCache, invalidate, invalidatePrefix } from '../cache';

describe('withCache', () => {
	beforeEach(() => {
		// Clear all cache entries used in tests
		invalidatePrefix('test:');
	});

	it('caches the result of fn for the TTL duration', async () => {
		let callCount = 0;
		const fn = async () => {
			callCount++;
			return 'value';
		};

		const first = await withCache('test:a', 5000, fn);
		const second = await withCache('test:a', 5000, fn);

		expect(first).toBe('value');
		expect(second).toBe('value');
		expect(callCount).toBe(1);
	});

	it('re-fetches after invalidation', async () => {
		let callCount = 0;
		const fn = async () => {
			callCount++;
			return `call-${callCount}`;
		};

		await withCache('test:b', 5000, fn);
		invalidate('test:b');
		const result = await withCache('test:b', 5000, fn);

		expect(result).toBe('call-2');
		expect(callCount).toBe(2);
	});

	it('invalidatePrefix clears all matching keys', async () => {
		let countA = 0, countB = 0;
		await withCache('test:x:1', 5000, async () => ++countA);
		await withCache('test:x:2', 5000, async () => ++countB);

		invalidatePrefix('test:x:');

		await withCache('test:x:1', 5000, async () => ++countA);
		await withCache('test:x:2', 5000, async () => ++countB);

		expect(countA).toBe(2);
		expect(countB).toBe(2);
	});
});

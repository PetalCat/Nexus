import { describe, it, expect, beforeEach } from 'vitest';
import {
	withCache,
	withStaleCache,
	invalidate,
	invalidatePrefix,
	invalidateAll,
	__debugCacheStats,
	__debugCacheKeys
} from '../cache';

describe('withCache', () => {
	beforeEach(() => {
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
		let countA = 0,
			countB = 0;
		await withCache('test:x:1', 5000, async () => ++countA);
		await withCache('test:x:2', 5000, async () => ++countB);

		invalidatePrefix('test:x:');

		await withCache('test:x:1', 5000, async () => ++countA);
		await withCache('test:x:2', 5000, async () => ++countB);

		expect(countA).toBe(2);
		expect(countB).toBe(2);
	});

	it('respects TTL expiry', async () => {
		let n = 0;
		await withCache('test:ttl', 10, async () => ++n);
		await new Promise((r) => setTimeout(r, 30));
		await withCache('test:ttl', 10, async () => ++n);
		expect(n).toBe(2);
	});
});

describe('withStaleCache', () => {
	beforeEach(() => {
		invalidatePrefix('test:');
	});

	it('returns stale data immediately and refreshes in background', async () => {
		let n = 0;
		const fn = async () => ++n;
		await withStaleCache('test:s', 10, 5_000, fn);
		await new Promise((r) => setTimeout(r, 30)); // now stale, still within grace
		const result = await withStaleCache('test:s', 10, 5_000, fn);
		expect(result).toBe(1); // served stale
		// Let the background refresh settle.
		await new Promise((r) => setTimeout(r, 20));
		const fresh = await withStaleCache('test:s', 10_000, 5_000, fn);
		expect(fresh).toBe(2);
	});
});

describe('cache debug hooks', () => {
	beforeEach(() => {
		invalidateAll();
	});

	it('records hits and misses', async () => {
		await withCache('test:stats', 5000, async () => 'x');
		await withCache('test:stats', 5000, async () => 'x');
		const stats = __debugCacheStats();
		expect(stats.hits).toBeGreaterThanOrEqual(1);
		expect(stats.misses).toBeGreaterThanOrEqual(1);
		expect(stats.size).toBeGreaterThanOrEqual(1);
	});

	it('exposes keys under NODE_ENV=test', async () => {
		const prev = process.env.NODE_ENV;
		process.env.NODE_ENV = 'test';
		await withCache('test:keyA', 5000, async () => 1);
		await withCache('test:keyB', 5000, async () => 1);
		const keys = __debugCacheKeys();
		expect(keys).toContain('test:keyA');
		expect(keys).toContain('test:keyB');
		process.env.NODE_ENV = prev;
	});
});

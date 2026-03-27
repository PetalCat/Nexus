import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, resetRateLimiter } from '../rate-limit';

describe('checkRateLimit', () => {
	beforeEach(() => {
		resetRateLimiter();
	});

	it('allows requests under the limit', () => {
		for (let i = 0; i < 10; i++) {
			expect(checkRateLimit('1.2.3.4', 10, 60000)).toBe(true);
		}
	});

	it('blocks requests over the limit', () => {
		for (let i = 0; i < 10; i++) {
			checkRateLimit('1.2.3.5', 10, 60000);
		}
		expect(checkRateLimit('1.2.3.5', 10, 60000)).toBe(false);
	});

	it('tracks IPs independently', () => {
		for (let i = 0; i < 10; i++) {
			checkRateLimit('1.1.1.1', 10, 60000);
		}
		expect(checkRateLimit('1.1.1.1', 10, 60000)).toBe(false);
		expect(checkRateLimit('2.2.2.2', 10, 60000)).toBe(true);
	});

	it('resets after window expires', () => {
		const shortWindow = 50; // 50ms
		for (let i = 0; i < 5; i++) {
			checkRateLimit('3.3.3.3', 5, shortWindow);
		}
		expect(checkRateLimit('3.3.3.3', 5, shortWindow)).toBe(false);

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(checkRateLimit('3.3.3.3', 5, shortWindow)).toBe(true);
				resolve();
			}, 60);
		});
	});
});

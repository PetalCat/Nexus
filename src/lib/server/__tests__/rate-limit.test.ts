import { describe, it, expect, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
	checkRateLimit,
	resetRateLimiter,
	getClientIp,
	__resetRateLimitConfig
} from '../rate-limit';

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

function fakeEvent(peer: string, xff?: string): RequestEvent {
	return {
		getClientAddress: () => peer,
		request: new Request('http://localhost/', {
			headers: xff ? { 'x-forwarded-for': xff } : {}
		})
	} as unknown as RequestEvent;
}

describe('getClientIp (trusted-proxy handling)', () => {
	beforeEach(() => {
		delete process.env.NEXUS_TRUST_PROXY;
		delete process.env.NEXUS_TRUSTED_PROXIES;
		__resetRateLimitConfig();
	});

	it('returns the peer address when NEXUS_TRUST_PROXY is off, ignoring XFF', () => {
		const ip = getClientIp(fakeEvent('1.2.3.4', '9.9.9.9, 5.5.5.5'));
		expect(ip).toBe('1.2.3.4');
	});

	it('honors XFF when trust is on AND peer is in default RFC1918 range', () => {
		process.env.NEXUS_TRUST_PROXY = '1';
		__resetRateLimitConfig();
		// Peer is 10.x (a default trusted proxy); XFF leftmost is the real client.
		const ip = getClientIp(fakeEvent('10.0.0.5', '9.9.9.9'));
		expect(ip).toBe('9.9.9.9');
	});

	it('walks XFF right-to-left past trusted hops', () => {
		process.env.NEXUS_TRUST_PROXY = '1';
		__resetRateLimitConfig();
		// Real client is 8.8.8.8, then two trusted hops.
		const ip = getClientIp(fakeEvent('10.0.0.5', '8.8.8.8, 10.0.0.6, 10.0.0.5'));
		expect(ip).toBe('8.8.8.8');
	});

	it('falls back to peer when trust is on but peer is NOT a trusted proxy', () => {
		process.env.NEXUS_TRUST_PROXY = '1';
		__resetRateLimitConfig();
		const ip = getClientIp(fakeEvent('4.4.4.4', '99.99.99.99'));
		expect(ip).toBe('4.4.4.4');
	});

	it('rate-limit bucket stays bound to peer when XFF is spoofed (trust off)', () => {
		resetRateLimiter();
		// 10 attempts, all from same peer but different XFF values — they
		// should all land in the same bucket and trip the limit.
		for (let i = 0; i < 10; i++) {
			const ip = getClientIp(fakeEvent('7.7.7.7', String(i)));
			checkRateLimit(ip, 10, 60_000);
		}
		const ip = getClientIp(fakeEvent('7.7.7.7', '123'));
		expect(checkRateLimit(ip, 10, 60_000)).toBe(false);
	});
});

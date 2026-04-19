import { describe, it, expect } from 'vitest';
import { hitZone, isHorizontalSwipe, mapKeyToAction, flipForRtl } from '../useReaderInputs.svelte';

describe('useReaderInputs helpers', () => {
	describe('hitZone', () => {
		it('maps left third to prev', () => {
			expect(hitZone(50, 1000)).toBe('prev');
		});
		it('maps middle third to toggleUI', () => {
			expect(hitZone(500, 1000)).toBe('toggleUI');
		});
		it('maps right third to next', () => {
			expect(hitZone(900, 1000)).toBe('next');
		});
		it('handles small viewports', () => {
			expect(hitZone(100, 360)).toBe('prev');
			expect(hitZone(180, 360)).toBe('toggleUI');
			expect(hitZone(300, 360)).toBe('next');
		});
	});

	describe('isHorizontalSwipe', () => {
		it('returns prev for rightward swipe past threshold', () => {
			expect(isHorizontalSwipe({ dx: 80, dy: 10 })).toBe('prev');
		});
		it('returns next for leftward swipe past threshold', () => {
			expect(isHorizontalSwipe({ dx: -80, dy: 10 })).toBe('next');
		});
		it('returns null when below threshold', () => {
			expect(isHorizontalSwipe({ dx: 30, dy: 5 })).toBeNull();
		});
		it('returns null when vertical travel dominates', () => {
			expect(isHorizontalSwipe({ dx: 60, dy: 200 })).toBeNull();
		});
	});

	describe('mapKeyToAction', () => {
		it('maps ArrowLeft to prev', () => {
			expect(mapKeyToAction('ArrowLeft')).toBe('prev');
		});
		it('maps ArrowRight to next', () => {
			expect(mapKeyToAction('ArrowRight')).toBe('next');
		});
		it('maps PageUp to prev, PageDown and Space to next', () => {
			expect(mapKeyToAction('PageUp')).toBe('prev');
			expect(mapKeyToAction('PageDown')).toBe('next');
			expect(mapKeyToAction(' ')).toBe('next');
		});
		it('returns null for irrelevant keys', () => {
			expect(mapKeyToAction('a')).toBeNull();
			expect(mapKeyToAction('Enter')).toBeNull();
		});
	});

	describe('flipForRtl', () => {
		it('swaps prev and next when direction is rtl', () => {
			expect(flipForRtl('prev', 'rtl')).toBe('next');
			expect(flipForRtl('next', 'rtl')).toBe('prev');
			expect(flipForRtl('toggleUI', 'rtl')).toBe('toggleUI');
		});
		it('passes through when direction is ltr', () => {
			expect(flipForRtl('prev', 'ltr')).toBe('prev');
			expect(flipForRtl('next', 'ltr')).toBe('next');
		});
	});
});

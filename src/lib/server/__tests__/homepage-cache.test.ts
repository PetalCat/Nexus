import { describe, it, expect } from 'vitest';
import { applyRowOrder, DEFAULT_ROW_ORDER } from '../homepage-cache';
import type { HomepageRow } from '$lib/types/homepage';

function row(id: string, type: HomepageRow['type'] = 'system'): HomepageRow {
	return { id, title: id, type, items: [] };
}

describe('applyRowOrder — drift pin', () => {
	it('orders rows per DEFAULT_ROW_ORDER when no user order is given', () => {
		const rows = [row('new'), row('trending-movie', 'reason'), row('calendar', 'calendar')];
		const result = applyRowOrder(rows);
		expect(result.map((r) => r.id)).toEqual(['calendar', 'trending-movie', 'new']);
	});

	it('honors user rowOrder verbatim', () => {
		const rows = [row('trending-movie', 'reason'), row('new'), row('calendar', 'calendar')];
		const result = applyRowOrder(rows, ['new', 'calendar', 'trending-movie']);
		expect(result.map((r) => r.id)).toEqual(['new', 'calendar', 'trending-movie']);
	});

	it('appends rows not listed in the order at the end', () => {
		const rows = [row('mystery-new-row'), row('trending-movie', 'reason')];
		const result = applyRowOrder(rows);
		// trending-movie matches DEFAULT, mystery-new-row falls through to the tail.
		expect(result.map((r) => r.id)).toEqual(['trending-movie', 'mystery-new-row']);
	});

	it('expands genre:* to every genre row in the order the rows arrive', () => {
		const rows = [
			row('genre:sci-fi', 'genre'),
			row('genre:drama', 'genre'),
			row('trending-movie', 'reason')
		];
		const result = applyRowOrder(rows);
		// DEFAULT_ROW_ORDER places trending-movie before genre:*
		const ids = result.map((r) => r.id);
		expect(ids.indexOf('trending-movie')).toBeLessThan(ids.indexOf('genre:sci-fi'));
		expect(ids).toContain('genre:drama');
	});

	it('does not duplicate a row when it appears in the order and a genre expansion', () => {
		const rows = [row('genre:drama', 'genre')];
		const result = applyRowOrder(rows, ['genre:drama', 'genre:*']);
		expect(result.filter((r) => r.id === 'genre:drama')).toHaveLength(1);
	});

	it('treats calendar + upcoming-* + suggestions as first-class orderable rows', () => {
		// If any of these fall out of DEFAULT_ROW_ORDER we lose the ordering
		// contract; this test is the canary for future drift.
		for (const id of ['calendar', 'upcoming-movies', 'upcoming-tv', 'suggestions']) {
			expect(DEFAULT_ROW_ORDER).toContain(id);
		}
	});
});

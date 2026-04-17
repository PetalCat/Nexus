import { describe, it, expect } from 'vitest';
import { buildCompositeId, parseCompositeId } from '../ids';

describe('ids', () => {
	describe('buildCompositeId', () => {
		it('produces `${serviceId}:${sourceId}`', () => {
			expect(buildCompositeId('jelly-a', 'ch-123')).toBe('jelly-a:ch-123');
		});

		it('coerces numeric sourceId to string', () => {
			expect(buildCompositeId('svc', 42)).toBe('svc:42');
		});
	});

	describe('parseCompositeId', () => {
		it('round-trips with buildCompositeId', () => {
			const id = buildCompositeId('svc-1', 'item-9');
			const parsed = parseCompositeId(id);
			expect(parsed).toEqual({ serviceId: 'svc-1', sourceId: 'item-9' });
		});

		it('splits on the FIRST colon so sourceId may contain colons', () => {
			const parsed = parseCompositeId('svc:urn:item:abc');
			expect(parsed).toEqual({ serviceId: 'svc', sourceId: 'urn:item:abc' });
		});

		it('returns null for bare sourceId (no colon)', () => {
			expect(parseCompositeId('bare-source')).toBeNull();
		});

		it('returns null for empty serviceId or trailing colon', () => {
			expect(parseCompositeId(':sourceOnly')).toBeNull();
			expect(parseCompositeId('svcOnly:')).toBeNull();
		});
	});
});

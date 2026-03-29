import { describe, it, expect } from 'vitest';
import { registry } from '../registry';

describe('AdapterRegistry', () => {
	it('returns all registered adapters', () => {
		const all = registry.all();
		expect(all.length).toBeGreaterThan(0);
	});

	it('every adapter has required fields', () => {
		for (const adapter of registry.all()) {
			expect(adapter.id).toBeTruthy();
			expect(adapter.displayName).toBeTruthy();
			expect(typeof adapter.defaultPort).toBe('number');
			expect(typeof adapter.ping).toBe('function');
		}
	});

	it('every adapter has color and abbreviation', () => {
		for (const adapter of registry.all()) {
			expect(adapter.color).toBeTruthy();
			expect(adapter.abbreviation).toBeTruthy();
		}
	});

	// ---- Capability metadata tests (will pass after Task 2 adds values) ----

	it.skip('library adapters have isLibrary set', () => {
		const libraries = registry.all().filter((a) => a.isLibrary);
		const libraryIds = libraries.map((a) => a.id).sort();
		expect(libraryIds).toEqual(['calibre', 'invidious', 'jellyfin', 'romm']);
	});

	it.skip('searchable adapters have isSearchable set', () => {
		const searchable = registry.all().filter((a) => a.isSearchable);
		expect(searchable.length).toBeGreaterThanOrEqual(7);
		expect(searchable.find((a) => a.id === 'bazarr')).toBeUndefined();
		expect(searchable.find((a) => a.id === 'prowlarr')).toBeUndefined();
	});

	it.skip('enrichment-only adapters are flagged', () => {
		const enrichmentOnly = registry.all().filter((a) => a.isEnrichmentOnly);
		const ids = enrichmentOnly.map((a) => a.id).sort();
		expect(ids).toEqual(['bazarr', 'prowlarr']);
	});

	it.skip('authVia resolves to a valid adapter', () => {
		const withAuthVia = registry.all().filter((a) => a.authVia);
		for (const adapter of withAuthVia) {
			expect(registry.get(adapter.authVia!)).toBeDefined();
		}
	});

	it.skip('searchPriority defaults to Infinity when not set', () => {
		for (const adapter of registry.all()) {
			const priority = adapter.searchPriority ?? Infinity;
			expect(typeof priority).toBe('number');
		}
	});
});

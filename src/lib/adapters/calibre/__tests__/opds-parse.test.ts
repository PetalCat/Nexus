import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseOpdsFeed } from '../opds-parse';

const FIX = join(__dirname, 'fixtures');
const read = (name: string) => readFileSync(join(FIX, name), 'utf-8');

describe('parseOpdsFeed', () => {
	it('parses /opds root as a navigation feed with zero book entries', () => {
		const feed = parseOpdsFeed(read('opds-root.xml'));
		// Root is a navigation feed — its entries are subsection links, not books.
		// The parser only returns entries with acquisition links or valid book ids.
		expect(feed.entries).toEqual([]);
	});

	it('parses /opds/new into book entries with full metadata', () => {
		const feed = parseOpdsFeed(read('opds-new.xml'));
		expect(feed.entries.length).toBeGreaterThan(0);
		const byTitle = new Map(feed.entries.map((e) => [e.title, e]));
		const hobbit = byTitle.get('The Hobbit');
		expect(hobbit).toBeDefined();
		if (!hobbit) throw new Error();
		expect(hobbit.authors).toContain('J.R.R. Tolkien');
		expect(hobbit.publishers).toContain('Allen & Unwin');
		expect(hobbit.id).toBe('1');
		expect(hobbit.uuid).toMatch(/^[a-f0-9-]{36}$/);
		expect(hobbit.categories).toEqual(expect.arrayContaining(['Fantasy', 'Classic']));
		expect(hobbit.published?.getFullYear()).toBe(1937);
		expect(hobbit.acquisitions.length).toBeGreaterThan(0);
		const epub = hobbit.acquisitions.find((a) => a.format === 'EPUB');
		expect(epub).toBeDefined();
		expect(epub?.href).toMatch(/\/opds\/download\/1\/epub\//);
		expect(epub?.mimeType).toBe('application/epub+zip');
		expect(epub?.length).toBe(30);
	});

	it('parses ratings from content HTML', () => {
		const feed = parseOpdsFeed(read('opds-new.xml'));
		const withRating = feed.entries.filter((e) => e.ratingStars !== undefined);
		expect(withRating.length).toBeGreaterThan(0);
		for (const e of withRating) {
			expect(e.ratingStars).toBeGreaterThanOrEqual(1);
			expect(e.ratingStars).toBeLessThanOrEqual(5);
		}
	});

	it('strips HTML from description', () => {
		const feed = parseOpdsFeed(read('opds-new.xml'));
		const hobbit = feed.entries.find((e) => e.title === 'The Hobbit');
		expect(hobbit?.description).toBeDefined();
		expect(hobbit?.description).not.toContain('<');
		expect(hobbit?.description).not.toContain('RATING');
		expect(hobbit?.description).not.toContain('TAGS');
	});

	it('parses series name and index from SERIES: Name [Index] content', () => {
		const feed = parseOpdsFeed(read('opds-new.xml'));
		const fellowship = feed.entries.find((e) => e.title === 'The Fellowship of the Ring');
		expect(fellowship?.series).toBe('Middle-earth');
		expect(fellowship?.seriesIndex).toBe(2);
		const hobbit = feed.entries.find((e) => e.title === 'The Hobbit');
		expect(hobbit?.series).toBe('Middle-earth');
		expect(hobbit?.seriesIndex).toBe(1);
		const dune = feed.entries.find((e) => e.title === 'Dune');
		expect(dune?.series).toBe('Dune');
	});

	it('parses /opds/books/letter/00 as the full library', () => {
		const feed = parseOpdsFeed(read('opds-books-all.xml'));
		expect(feed.entries.length).toBe(5);
		const titles = feed.entries.map((e) => e.title).sort();
		expect(titles).toEqual([
			'Dune',
			'Neuromancer',
			'Project Hail Mary',
			'The Fellowship of the Ring',
			'The Hobbit'
		]);
	});

	it('parses /opds/search results', () => {
		const feed = parseOpdsFeed(read('opds-search-hobbit.xml'));
		expect(feed.entries.length).toBe(1);
		expect(feed.entries[0].title).toBe('The Hobbit');
	});

	it('returns empty for /opds/search/id:1 — OPDS search does not support Calibre field syntax', () => {
		// Documenting the Calibre-Web quirk: /opds/search/{query} is plain text only.
		// `id:N`, `title:X`, etc. all return empty feeds. This fixture exists to pin
		// that behavior so we don't accidentally reintroduce a broken fast-path.
		const feed = parseOpdsFeed(read('opds-search-id-1.xml'));
		expect(feed.entries).toEqual([]);
	});

	it('parses /opds/unreadbooks (for getContinueWatching)', () => {
		const feed = parseOpdsFeed(read('opds-unreadbooks.xml'));
		// All 5 seeded books are unread at capture time (toggled back before fixture grab
		// or captured before toggle). We assert structural correctness, not exact count.
		expect(feed.entries.length).toBeGreaterThanOrEqual(1);
		for (const e of feed.entries) {
			expect(e.id).toMatch(/^\d+$/);
			expect(e.title).toBeTruthy();
		}
	});

	it('parses /opds/readbooks', () => {
		const feed = parseOpdsFeed(read('opds-readbooks.xml'));
		// readbooks may be empty if no books are marked read at capture time — structural check only
		for (const e of feed.entries) {
			expect(e.id).toMatch(/^\d+$/);
			expect(e.title).toBeTruthy();
		}
	});

	it('does not throw on empty or malformed input for the error path we care about', () => {
		expect(() => parseOpdsFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).not.toThrow();
		const feed = parseOpdsFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
		expect(feed.entries).toEqual([]);
	});

	it('throws a structured error on invalid XML', () => {
		expect(() => parseOpdsFeed('<not xml <<<')).toThrow(/OPDS XML parse failed/);
	});
});

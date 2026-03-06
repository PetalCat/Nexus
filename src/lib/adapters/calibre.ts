import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, UserCredential } from './types';
import { withCache } from '../server/cache';

// ---------------------------------------------------------------------------
// Calibre-Web OPDS adapter
// Uses Basic auth against the Calibre-Web OPDS feed (Atom XML).
// ---------------------------------------------------------------------------

function authHeader(config: ServiceConfig, userCred?: UserCredential): string {
	const user = userCred?.externalUsername ?? config.username ?? '';
	const pass = userCred?.accessToken ?? config.password ?? '';
	return 'Basic ' + btoa(`${user}:${pass}`);
}

async function calibreFetch(config: ServiceConfig, path: string, userCred?: UserCredential): Promise<string> {
	const url = `${config.url}${path}`;
	const res = await fetch(url, {
		headers: { Authorization: authHeader(config, userCred) },
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`Calibre ${path} -> ${res.status}`);
	return res.text();
}

// ---------------------------------------------------------------------------
// Simple XML helpers (no dependency — OPDS is predictable)
// ---------------------------------------------------------------------------

function extractEntries(xml: string): string[] {
	const entries: string[] = [];
	let idx = 0;
	while (true) {
		const start = xml.indexOf('<entry>', idx);
		if (start === -1) break;
		const end = xml.indexOf('</entry>', start);
		if (end === -1) break;
		entries.push(xml.slice(start, end + 8));
		idx = end + 8;
	}
	return entries;
}

function xmlTag(xml: string, name: string): string {
	const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`);
	const m = xml.match(re);
	return m ? m[1].trim() : '';
}

function xmlAttr(xml: string, tagName: string, attrName: string): string {
	const re = new RegExp(`<${tagName}[^>]*?${attrName}="([^"]*)"`, 's');
	const m = xml.match(re);
	return m ? m[1] : '';
}

function allAttr(xml: string, tagName: string, attrName: string): string[] {
	const re = new RegExp(`<${tagName}[^>]*?${attrName}="([^"]*)"`, 'gs');
	const results: string[] = [];
	let m;
	while ((m = re.exec(xml)) !== null) results.push(m[1]);
	return results;
}

// ---------------------------------------------------------------------------
// Normalize an OPDS <entry> to UnifiedMedia
// ---------------------------------------------------------------------------

function normalize(config: ServiceConfig, entry: string): UnifiedMedia {
	const title = xmlTag(entry, 'title');
	const id = xmlTag(entry, 'id');

	// Extract numeric book ID from cover href or id path
	const coverHref = allAttr(entry, 'link', 'href').find(h => h.includes('/cover/'));
	const bookId = coverHref?.match(/\/cover\/(\d+)/)?.[1]
		?? id.match(/\/(\d+)/)?.[1]
		?? id;

	// Author
	const authorBlock = entry.match(/<author>\s*<name>([\s\S]*?)<\/name>/);
	const author = authorBlock ? authorBlock[1].trim() : undefined;

	// Publisher
	const pubBlock = entry.match(/<publisher>\s*<name>([\s\S]*?)<\/name>/);
	const publisher = pubBlock ? pubBlock[1].trim() : undefined;

	// Published date -> year
	const published = xmlTag(entry, 'published');
	const year = published ? new Date(published).getFullYear() : undefined;

	// Description from <content>
	const contentBlock = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/);
	let description: string | undefined;
	if (contentBlock) {
		// Strip HTML tags, decode entities
		description = contentBlock[1]
			.replace(/<[^>]+>/g, ' ')
			.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
			.replace(/&#34;/g, '"').replace(/&#39;/g, "'")
			.replace(/\s+/g, ' ')
			.trim();
		// Remove the RATING/TAGS/SERIES metadata lines, keep just the prose
		const parts = description.split(/(?:RATING:|TAGS:|SERIES:)/);
		if (parts.length > 1) {
			description = parts[parts.length - 1].trim() || description;
		}
	}

	// Rating from content text (e.g., "RATING: ★★★★")
	const ratingMatch = contentBlock?.[1].match(/RATING:\s*(★+)/);
	const rating = ratingMatch ? ratingMatch[1].length * 2 : undefined; // 5 stars = 10

	// Series from content text
	const seriesMatch = contentBlock?.[1].match(/SERIES:\s*(.+?)(?:\[(\d+)\])?<br/);
	const seriesName = seriesMatch?.[1].trim();
	const seriesIndex = seriesMatch?.[2] ? parseInt(seriesMatch[2]) : undefined;

	// Categories/tags
	const genres = allAttr(entry, 'category', 'label');

	// Cover image
	const poster = coverHref ? `${config.url}${coverHref}` : undefined;

	// Download links — find available formats
	const downloadLinks = entry.match(/<link[^>]*rel="http:\/\/opds-spec\.org\/acquisition"[^>]*>/g) ?? [];
	const formats: string[] = [];
	const fileLinks: Array<{ format: string; url: string; size?: number }> = [];
	for (const link of downloadLinks) {
		const href = link.match(/href="([^"]*)"/)?.[1] ?? '';
		const titleMatch = link.match(/title="([^"]*)"/)?.[1] ?? '';
		const length = link.match(/length="(\d+)"/)?.[1];
		formats.push(titleMatch);
		fileLinks.push({
			format: titleMatch,
			url: `${config.url}${href}`,
			size: length ? parseInt(length) : undefined
		});
	}

	// Language
	const language = xmlTag(entry, 'dcterms:language') || undefined;

	return {
		id: `${bookId}:${config.id}`,
		sourceId: bookId,
		serviceId: config.id,
		serviceType: 'calibre',
		type: 'book',
		title,
		description,
		poster,
		year: year && !isNaN(year) ? year : undefined,
		rating,
		genres,
		status: 'available',
		metadata: {
			calibreId: bookId,
			author,
			publisher,
			language,
			seriesName,
			seriesIndex,
			formats,
			fileLinks
		},
		actionLabel: 'Read',
		actionUrl: `${config.url}/book/${bookId}`
	};
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const calibreAdapter: ServiceAdapter = {
	id: 'calibre',
	displayName: 'Calibre-Web',
	defaultPort: 8083,
	icon: 'calibre',
	mediaTypes: ['book'],
	userLinkable: true,

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			const xml = await calibreFetch(config, '/opds');
			if (!xml.includes('<feed')) throw new Error('Not an OPDS feed');
			return {
				serviceId: config.id,
				name: config.name,
				type: 'calibre',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'calibre',
				online: false,
				error: String(e)
			};
		}
	},

	async getRecentlyAdded(config, userCred): Promise<UnifiedMedia[]> {
		try {
			const xml = await calibreFetch(config, '/opds/new', userCred);
			return extractEntries(xml).map(e => normalize(config, e));
		} catch {
			return [];
		}
	},

	async search(config, query, userCred): Promise<UnifiedSearchResult> {
		try {
			const xml = await calibreFetch(config, `/opds/search/${encodeURIComponent(query)}`, userCred);
			const items = extractEntries(xml).map(e => normalize(config, e));
			return { items, total: items.length, source: 'calibre' };
		} catch {
			return { items: [], total: 0, source: 'calibre' };
		}
	},

	async getItem(config, sourceId, userCred): Promise<UnifiedMedia | null> {
		// OPDS doesn't have a single-book endpoint — search all books and find by ID
		try {
			const xml = await calibreFetch(config, '/opds/books/letter/00', userCred);
			const entries = extractEntries(xml);
			for (const entry of entries) {
				const item = normalize(config, entry);
				if (item.sourceId === sourceId) return item;
			}
			return null;
		} catch {
			return null;
		}
	},

	async getLibrary(config, opts, userCred): Promise<{ items: UnifiedMedia[]; total: number }> {
		try {
			const sortBy = opts?.sortBy ?? 'title';
			let path: string;
			switch (sortBy) {
				case 'rating': path = '/opds/rated'; break;
				case 'added': path = '/opds/new'; break;
				default: path = '/opds/books/letter/00'; break;
			}
			const xml = await calibreFetch(config, path, userCred);
			const items = extractEntries(xml).map(e => normalize(config, e));
			const offset = opts?.offset ?? 0;
			const limit = opts?.limit ?? 50;
			return {
				items: items.slice(offset, offset + limit),
				total: items.length
			};
		} catch {
			return { items: [], total: 0 };
		}
	},

	async authenticateUser(config, username, password) {
		// Calibre-Web uses Basic auth — verify by hitting /opds
		const creds = btoa(`${username}:${password}`);
		const res = await fetch(`${config.url}/opds`, {
			headers: { Authorization: `Basic ${creds}` },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) throw new Error(`Calibre auth failed: ${res.status}`);
		return {
			accessToken: password,
			externalUserId: username,
			externalUsername: username
		};
	}
};

// ---------------------------------------------------------------------------
// Exported helpers for book detail enrichment
// ---------------------------------------------------------------------------

export interface CalibreSeries {
	name: string;
	books: UnifiedMedia[];
}

export async function getCalibreSeries(config: ServiceConfig, userCred?: UserCredential): Promise<CalibreSeries[]> {
	return withCache(`calibre-series:${config.id}`, 300_000, async () => {
		try {
			const xml = await calibreFetch(config, '/opds/series/letter/00', userCred);
			const entries = extractEntries(xml);
			const series: CalibreSeries[] = [];
			for (const entry of entries) {
				const name = xmlTag(entry, 'title');
				const href = xmlAttr(entry, 'link', 'href');
				if (!href) continue;
				try {
					const seriesXml = await calibreFetch(config, href, userCred);
					const books = extractEntries(seriesXml).map(e => normalize(config, e));
					series.push({ name, books });
				} catch { /* skip */ }
			}
			return series;
		} catch {
			return [];
		}
	});
}

export async function getCalibreCategories(config: ServiceConfig, userCred?: UserCredential): Promise<string[]> {
	return withCache(`calibre-categories:${config.id}`, 300_000, async () => {
		try {
			const xml = await calibreFetch(config, '/opds/category/letter/00', userCred);
			return extractEntries(xml).map(e => xmlTag(e, 'title')).filter(Boolean);
		} catch {
			return [];
		}
	});
}

import { XMLParser } from 'fast-xml-parser';
import type { OpdsAcquisition, OpdsEntry, OpdsFeed } from './types';

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	allowBooleanAttributes: true,
	parseAttributeValue: false,
	trimValues: true,
	removeNSPrefix: true,
	isArray: (name) => name === 'entry' || name === 'link' || name === 'category' || name === 'author' || name === 'publisher' || name === 'language'
});

const ACQUISITION_REL = 'http://opds-spec.org/acquisition';
const COVER_REL = 'http://opds-spec.org/image';
const THUMB_REL = 'http://opds-spec.org/image/thumbnail';

function toStr(v: unknown): string | undefined {
	if (v === null || v === undefined) return undefined;
	if (typeof v === 'string') return v.trim() || undefined;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) {
		return toStr((v as Record<string, unknown>)['#text']);
	}
	return undefined;
}

function toDate(v: unknown): Date | undefined {
	const s = toStr(v);
	if (!s) return undefined;
	const d = new Date(s);
	return isNaN(d.getTime()) ? undefined : d;
}

function extractLinks(entry: Record<string, unknown>): Array<Record<string, string>> {
	const raw = entry.link;
	if (!raw) return [];
	const arr = Array.isArray(raw) ? raw : [raw];
	return arr.map((l) => {
		const attrs: Record<string, string> = {};
		if (typeof l === 'object' && l !== null) {
			for (const [k, v] of Object.entries(l as Record<string, unknown>)) {
				if (k.startsWith('@_') && typeof v === 'string') attrs[k.slice(2)] = v;
			}
		}
		return attrs;
	});
}

function extractCategories(entry: Record<string, unknown>): string[] {
	const raw = entry.category;
	if (!raw) return [];
	const arr = Array.isArray(raw) ? raw : [raw];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const c of arr) {
		const term = typeof c === 'object' && c !== null
			? (c as Record<string, unknown>)['@_term'] ?? (c as Record<string, unknown>)['@_label']
			: undefined;
		const s = toStr(term);
		if (s && !seen.has(s)) {
			seen.add(s);
			out.push(s);
		}
	}
	return out;
}

function extractNames(raw: unknown): string[] {
	if (!raw) return [];
	const arr = Array.isArray(raw) ? raw : [raw];
	const out: string[] = [];
	for (const item of arr) {
		if (typeof item === 'string') {
			const s = item.trim();
			if (s) out.push(s);
		} else if (typeof item === 'object' && item !== null) {
			const name = (item as Record<string, unknown>).name;
			const s = toStr(name);
			if (s) out.push(s);
		}
	}
	return out;
}

function extractContent(entry: Record<string, unknown>): string | undefined {
	const raw = entry.content ?? entry.summary;
	if (!raw) return undefined;
	if (typeof raw === 'string') return raw;
	if (typeof raw === 'object' && raw !== null) {
		return toStr((raw as Record<string, unknown>)['#text']) ?? toStrDeep(raw);
	}
	return undefined;
}

function toStrDeep(v: unknown): string | undefined {
	if (v === null || v === undefined) return undefined;
	if (typeof v === 'string') return v;
	if (typeof v === 'number') return String(v);
	if (Array.isArray(v)) return v.map(toStrDeep).filter(Boolean).join(' ');
	if (typeof v === 'object') {
		const parts: string[] = [];
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
			if (k.startsWith('@_')) continue;
			const s = toStrDeep(val);
			if (s) parts.push(s);
		}
		return parts.join(' ').trim() || undefined;
	}
	return undefined;
}

function parseRating(contentText: string | undefined): number | undefined {
	if (!contentText) return undefined;
	const match = contentText.match(/RATING:\s*([★☆]+)/);
	if (!match) return undefined;
	const stars = (match[1].match(/★/g) ?? []).length;
	return stars > 0 ? stars : undefined;
}

function parseDescription(contentText: string | undefined): string | undefined {
	if (!contentText) return undefined;
	// Strip the RATING / TAGS preamble and anything before the first <p>, then strip tags
	const pMatch = contentText.match(/<p>([\s\S]*?)<\/p>/);
	let body = pMatch ? pMatch[1] : contentText;
	body = body
		.replace(/<[^>]+>/g, ' ')
		.replace(/RATING:\s*[★☆]+/g, '')
		.replace(/TAGS:[^<\n]*/g, '')
		.replace(/SERIES:[^<\n]*/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#34;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, ' ')
		.trim();
	return body || undefined;
}

function parseSeries(contentText: string | undefined): { name: string; index?: number } | undefined {
	if (!contentText) return undefined;
	// Calibre-Web's feed.xml content HTML renders series as "SERIES: Name [Index]<br/>".
	// Verified against linuxserver/calibre-web 0.6.x — the index uses SQUARE brackets,
	// not parentheses.
	const match = contentText.match(/SERIES:\s*([^<[\n]+?)\s*(?:\[([0-9.]+)\])?\s*(?:<|$)/);
	if (!match) return undefined;
	const name = match[1].trim();
	if (!name) return undefined;
	const index = match[2] ? parseFloat(match[2]) : undefined;
	return { name, index };
}

function extractIdFromHref(href: string | undefined): string | undefined {
	if (!href) return undefined;
	// Matches /opds/download/{id}/{fmt}/ or /opds/cover/{id} or /opds/cover_N_N/{id}
	const m = href.match(/\/(?:opds\/)?(?:download|cover|cover_\d+_\d+|thumb_\d+_\d+)\/(\d+)/);
	return m?.[1];
}

function extractUuidFromId(idField: string | undefined): string | undefined {
	if (!idField) return undefined;
	const m = idField.match(/urn:uuid:([a-f0-9-]+)/i);
	return m?.[1];
}

function parseAcquisitionLink(attrs: Record<string, string>): OpdsAcquisition | undefined {
	const rel = attrs.rel ?? '';
	if (!rel.startsWith(ACQUISITION_REL)) return undefined;
	const href = attrs.href;
	if (!href) return undefined;
	let format = attrs.title ?? '';
	if (!format) {
		// Fall back to extracting from href: /opds/download/1/epub/
		const m = href.match(/\/download\/\d+\/([^/]+)/);
		format = m ? m[1].toUpperCase() : '';
	}
	if (!format) return undefined;
	return {
		format: format.toUpperCase(),
		href,
		length: attrs.length ? parseInt(attrs.length, 10) : undefined,
		mtime: attrs.mtime ? new Date(attrs.mtime) : undefined,
		mimeType: attrs.type ?? 'application/octet-stream'
	};
}

function parseEntry(raw: Record<string, unknown>): OpdsEntry | undefined {
	const title = toStr(raw.title);
	if (!title) return undefined;

	const idField = toStr(raw.id);
	const uuid = extractUuidFromId(idField);

	const links = extractLinks(raw);
	const acquisitions: OpdsAcquisition[] = [];
	let coverHref: string | undefined;
	let thumbHref: string | undefined;
	let numericId: string | undefined;

	for (const attrs of links) {
		const rel = attrs.rel ?? '';
		if (rel.startsWith(ACQUISITION_REL)) {
			const acq = parseAcquisitionLink(attrs);
			if (acq) {
				acquisitions.push(acq);
				numericId ??= extractIdFromHref(acq.href);
			}
		} else if (rel === COVER_REL) {
			coverHref = attrs.href;
			numericId ??= extractIdFromHref(coverHref);
		} else if (rel === THUMB_REL) {
			thumbHref = attrs.href;
			numericId ??= extractIdFromHref(thumbHref);
		}
	}

	if (!numericId || !uuid) return undefined;

	const authors = extractNames(raw.author);
	const publishers = extractNames(raw.publisher);
	const categories = extractCategories(raw);
	const language = toStr(raw.language);
	const published = toDate(raw.published);
	const updated = toDate(raw.updated);

	const contentText = extractContent(raw);
	const ratingStars = parseRating(contentText);
	const description = parseDescription(contentText);
	const seriesInfo = parseSeries(contentText);

	return {
		id: numericId,
		uuid,
		title,
		authors,
		publishers,
		language,
		published,
		updated,
		categories,
		series: seriesInfo?.name,
		seriesIndex: seriesInfo?.index,
		ratingStars,
		description,
		coverHref,
		thumbHref,
		acquisitions
	};
}

export function parseOpdsFeed(xml: string): OpdsFeed {
	let doc: Record<string, unknown>;
	try {
		doc = parser.parse(xml) as Record<string, unknown>;
	} catch (err) {
		throw new Error(`OPDS XML parse failed: ${(err as Error).message}`);
	}

	const feed = (doc.feed ?? {}) as Record<string, unknown>;
	const rawEntries = feed.entry;
	const entryArr = Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : [];
	const entries: OpdsEntry[] = [];
	for (const raw of entryArr) {
		if (typeof raw !== 'object' || raw === null) continue;
		const parsed = parseEntry(raw as Record<string, unknown>);
		if (parsed) entries.push(parsed);
	}

	// Find rel="next" link on the feed itself
	const feedLinks = extractLinks(feed);
	let nextHref: string | undefined;
	for (const attrs of feedLinks) {
		if (attrs.rel === 'next' && attrs.href) {
			nextHref = attrs.href;
			break;
		}
	}

	const totalResults = typeof feed.totalResults === 'number'
		? feed.totalResults
		: typeof feed.totalResults === 'string'
			? parseInt(feed.totalResults as string, 10) || undefined
			: undefined;

	return { totalResults, nextHref, entries };
}

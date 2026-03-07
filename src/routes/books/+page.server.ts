import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getCalibreSeries, getCalibreCategories, getCalibreAuthors } from '$lib/adapters/calibre';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user?.id;
	const sortBy = url.searchParams.get('sort') ?? 'title';
	const category = url.searchParams.get('category') ?? '';
	const author = url.searchParams.get('author') ?? '';
	const status = url.searchParams.get('status') ?? '';
	const tab = url.searchParams.get('tab') ?? 'all';

	const configs = getEnabledConfigs();
	const calibreConfig = configs.find(c => c.type === 'calibre');
	if (!calibreConfig) {
		return { items: [], total: 0, sortBy, tab, categories: [], series: [], authors: [], category, author, status, featuredBook: null, recentlyAdded: [], continueReading: [] };
	}

	const adapter = registry.get('calibre');
	if (!adapter?.getLibrary) {
		return { items: [], total: 0, sortBy, tab, categories: [], series: [], authors: [], category, author, status, featuredBook: null, recentlyAdded: [], continueReading: [] };
	}
	const userCred = userId ? getUserCredentialForService(userId, calibreConfig.id) ?? undefined : undefined;

	const { items, total } = await adapter.getLibrary(calibreConfig, { sortBy, limit: 200 }, userCred);

	const [categories, series, authors] = await Promise.all([
		getCalibreCategories(calibreConfig, userCred),
		getCalibreSeries(calibreConfig, userCred),
		getCalibreAuthors(calibreConfig, userCred)
	]);

	let filtered = items;
	if (category) filtered = filtered.filter(i => i.genres?.includes(category));
	if (author) filtered = filtered.filter(i => (i.metadata?.author as string) === author);
	if (status === 'read') filtered = filtered.filter(i => i.metadata?.readStatus === true);
	if (status === 'unread') filtered = filtered.filter(i => i.metadata?.readStatus !== true);

	const heroCandidate = filtered.filter(i => i.poster && i.description);
	const featuredBook = heroCandidate.length > 0 ? heroCandidate[Math.floor(Math.random() * heroCandidate.length)] : null;

	const recentlyAdded = [...items].sort((a, b) => {
		const aId = parseInt(a.sourceId) || 0;
		const bId = parseInt(b.sourceId) || 0;
		return bId - aId;
	}).slice(0, 20);

	const continueReading = items.filter(i => i.progress && i.progress > 0 && i.progress < 1);

	return {
		items: filtered,
		total,
		sortBy,
		tab,
		categories,
		series,
		authors,
		category,
		author,
		status,
		featuredBook,
		recentlyAdded,
		continueReading
	};
};

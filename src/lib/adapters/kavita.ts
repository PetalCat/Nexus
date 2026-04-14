import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, UserCredential } from './types';

async function kvFetch(config: ServiceConfig, path: string, body?: unknown, userCred?: UserCredential) {
	const url = `${config.url}/api${path}`;
	const token = userCred?.accessToken || config.apiKey || '';
	const res = await fetch(url, {
		method: body ? 'POST' : 'GET',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json'
		},
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`Kavita ${path} -> ${res.status}`);
	return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(config: ServiceConfig, item: any): UnifiedMedia {
	return {
		id: `${item.id}:${config.id}`,
		sourceId: String(item.id),
		serviceId: config.id,
		serviceType: 'kavita',
		type: 'book',
		title: item.name || item.localizedName || 'Unknown',
		sortTitle: item.sortName,
		description: item.summary,
		poster: `${config.url}/api/image/series-cover?seriesId=${item.id}&apiKey=${config.apiKey}`,
		year: item.originalReleaseYear,
		genres: item.genres?.map((g: { title: string }) => g.title) ?? [],
		status: 'available',
		progress: item.pagesRead && item.pages ? item.pagesRead / item.pages : undefined,
		metadata: { kavitaId: item.id, format: item.format, libraryId: item.libraryId },
		actionLabel: 'Read',
		actionUrl: `${config.url}/library/${item.libraryId}/series/${item.id}`
	};
}

export const kavitaAdapter: ServiceAdapter = {
	id: 'kavita',
	displayName: 'Kavita',
	defaultPort: 5000,
	icon: 'kavita',
	mediaTypes: ['book'],
	userLinkable: true,

	contractVersion: 1,
	tier: 'user-standalone',
	capabilities: {
		media: ['book'],
		adminAuth: {
			required: false,
			fields: ['url', 'adminApiKey'],
			supportsHealthProbe: true
		},
		userAuth: {
			userLinkable: true,
			usernameLabel: 'Username',
			supportsRegistration: false,
			supportsAccountCreation: false,
			supportsPasswordStorage: true,
			supportsHealthProbe: true
		},
		library: true,
		search: { priority: 1 }
	},

	async probeAdminCredential(config) {
		try {
			const res = await fetch(`${config.url}/api/health`, {
				signal: AbortSignal.timeout(5000)
			});
			if (!res.ok) return 'expired';
			return 'ok';
		} catch {
			return 'expired';
		}
	},

	async probeCredential(config, userCred) {
		try {
			const token = userCred.accessToken;
			if (!token) return 'invalid';
			const res = await fetch(`${config.url}/api/account`, {
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(5000)
			});
			if (res.status === 401) return 'expired';
			if (res.status === 403) return 'invalid';
			if (!res.ok) return 'expired';
			return 'ok';
		} catch {
			return 'expired';
		}
	},

	async refreshCredential(config, userCred, storedPassword) {
		const username = userCred.externalUsername;
		if (!username) throw new Error('Kavita refresh: missing username');
		const res = await fetch(`${config.url}/api/account/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password: storedPassword }),
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) throw new Error(`Kavita refresh failed: ${res.status}`);
		const data = await res.json();
		return {
			accessToken: data.token,
			externalUserId: String(data.userId ?? data.id ?? ''),
			externalUsername: data.username ?? username
		};
	},

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await kvFetch(config, '/health');
			return {
				serviceId: config.id,
				name: config.name,
				type: 'kavita',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'kavita',
				online: false,
				error: String(e)
			};
		}
	},

	async getRecentlyAdded(config, userCred): Promise<UnifiedMedia[]> {
		try {
			const data = await kvFetch(config, '/series/recently-added', { pageNumber: 0, pageSize: 20 }, userCred);
			return (data ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	async getContinueWatching(config, userCred): Promise<UnifiedMedia[]> {
		try {
			const data = await kvFetch(config, '/want-to-read', { pageNumber: 0, pageSize: 20 }, userCred);
			return (data?.result ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	async search(config, query, userCred): Promise<UnifiedSearchResult> {
		try {
			const data = await kvFetch(config, '/search', { queryString: query }, userCred);
			const series = (data?.series ?? []).map((i: unknown) => normalize(config, i));
			return { items: series, total: series.length, source: 'kavita' };
		} catch {
			return { items: [], total: 0, source: 'kavita' };
		}
	},

	async getItem(config, sourceId, userCred): Promise<UnifiedMedia | null> {
		try {
			const item = await kvFetch(config, `/series/${sourceId}`, undefined, userCred);
			return normalize(config, item);
		} catch {
			return null;
		}
	},

	async authenticateUser(config, username, password) {
		const res = await fetch(`${config.url}/api/account/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password }),
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) throw new Error(`Kavita auth failed: ${res.status}`);
		const data = await res.json();
		return {
			accessToken: data.token,
			externalUserId: String(data.userId ?? data.id ?? ''),
			externalUsername: data.username ?? username
		};
	}
};

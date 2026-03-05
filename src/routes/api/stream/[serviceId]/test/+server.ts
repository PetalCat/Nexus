import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { RequestHandler } from './$types';

/**
 * Diagnostic endpoint to test stream proxy connectivity.
 * Hit /api/stream/{serviceId}/test in the browser to see what's happening.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

	const { serviceId } = params;
	const config = getServiceConfig(serviceId);

	if (!config) return Response.json({ error: 'Service not found', serviceId }, { status: 404 });

	const adapter = registry.get(config.type);
	const userCred =
		locals.user?.id && adapter?.userLinkable
			? getUserCredentialForService(locals.user.id, serviceId) ?? undefined
			: undefined;

	const token = userCred?.accessToken ?? config.apiKey ?? '';
	const diag: Record<string, any> = {
		serviceId,
		serviceType: config.type,
		serviceUrl: config.url,
		hasApiKey: !!config.apiKey,
		hasUserCred: !!userCred,
		tokenLength: token.length,
		externalUserId: userCred?.externalUserId ?? null
	};

	// Test basic connectivity
	try {
		const infoRes = await fetch(`${config.url}/System/Info/Public`, {
			signal: AbortSignal.timeout(5000)
		});
		const info = infoRes.ok ? await infoRes.json() : null;
		diag.connectivity = {
			status: infoRes.status,
			serverName: info?.ServerName ?? null,
			version: info?.Version ?? null
		};
	} catch (e: any) {
		diag.connectivity = { error: e.message };
	}

	// Test auth
	try {
		const meRes = await fetch(`${config.url}/Users/Me`, {
			headers: { 'X-Emby-Token': token },
			signal: AbortSignal.timeout(5000)
		});
		if (meRes.ok) {
			const me = await meRes.json();
			diag.auth = { status: 'ok', userId: me.Id, userName: me.Name };
		} else {
			diag.auth = { status: meRes.status, error: await meRes.text().catch(() => '') };
		}
	} catch (e: any) {
		diag.auth = { error: e.message };
	}

	// Test user list (API key only)
	if (config.apiKey) {
		try {
			const usersRes = await fetch(`${config.url}/Users`, {
				headers: { 'X-Emby-Token': config.apiKey },
				signal: AbortSignal.timeout(5000)
			});
			if (usersRes.ok) {
				const users = await usersRes.json();
				const list = Array.isArray(users) ? users : (users.Items ?? []);
				diag.users = list.map((u: any) => ({
					id: u.Id,
					name: u.Name,
					isAdmin: u.Policy?.IsAdministrator ?? false
				}));
			} else {
				diag.users = { status: usersRes.status };
			}
		} catch (e: any) {
			diag.users = { error: e.message };
		}
	}

	return Response.json(diag, {
		headers: { 'Content-Type': 'application/json' }
	});
};

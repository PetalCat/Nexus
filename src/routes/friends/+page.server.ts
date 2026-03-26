import { getFriends, getPendingRequests, getBlockedUserIds } from '$lib/server/social';
import { getOnlineUserIds } from '$lib/server/ws';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { friends: [], requests: [], blocked: [], onlineIds: new Set<string>() };
	const userId = locals.user.id;
	const friends = getFriends(userId);
	const requests = getPendingRequests(userId);
	const blocked = getBlockedUserIds(userId);
	const onlineIds = getOnlineUserIds();
	return { friends, requests, blocked, onlineIds };
};

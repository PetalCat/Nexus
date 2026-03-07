import type { AuthUser } from '$lib/types/media-ui';

let _user = $state<AuthUser | null>(null);
let _ghostMode = $state(false);

export const auth = {
	get user() { return _user; },
	get isLoggedIn() { return _user !== null; },
	get isAdmin() { return false; },
	get ghostMode() { return _ghostMode; },
};

export function setUser(user: AuthUser | null) { _user = user; }
export function toggleGhostMode() { _ghostMode = !_ghostMode; }

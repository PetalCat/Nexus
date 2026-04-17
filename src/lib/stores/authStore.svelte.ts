import type { AuthUser } from '$lib/types/media-ui';

let _user = $state<AuthUser | null>(null);

// Ghost mode is NOT held here — the canonical single source is the server-
// side `user_presence.ghost_mode` column, surfaced via /api/auth/me and
// mutated via PUT /api/auth/me/ghost. See src/lib/server/social.ts (the
// CANONICAL comment at updatePresence) and codex-review/27 bug B.

export const auth = {
	get user() { return _user; },
	get isLoggedIn() { return _user !== null; },
	get isAdmin() { return false; },
};

export function setUser(user: AuthUser | null) { _user = user; }

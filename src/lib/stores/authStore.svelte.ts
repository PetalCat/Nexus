import type { AuthUser } from '$lib/types/media-ui';

let _user = $state<AuthUser | null>(null);

// Ghost mode is NOT held here — the canonical single source is the server-
// side `user_presence.ghost_mode` column, surfaced via GET /api/auth/me and
// mutated by server-side `updatePresence()` (see src/lib/server/social.ts
// CANONICAL comment). Any future client ghost UI goes through a new endpoint
// that calls updatePresence; do NOT add a client-side mirror. See #33 + codex-
// review/27 bug B.

export const auth = {
	get user() { return _user; },
	get isLoggedIn() { return _user !== null; },
	get isAdmin() { return false; },
};

export function setUser(user: AuthUser | null) { _user = user; }

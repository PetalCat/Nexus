/**
 * Maps AdapterAuthError.kind values to user-facing messages. Shared by the
 * AccountLinkModal, SignInCard, and StaleCredentialBanner components so copy
 * stays consistent across every account-linking flow.
 */

import type { AdapterAuthErrorKind } from '$lib/adapters/errors';

/**
 * Return a human-readable message for a given AdapterAuthError kind. Takes
 * the service name so copy can reference the specific service (e.g.
 * "Can't reach Jellyfin").
 */
export function errorCopyForKind(
	kind: AdapterAuthErrorKind | string,
	serviceName: string,
	retryAfterMs?: number
): string {
	switch (kind) {
		case 'invalid':
			return `Username or password doesn't match.`;
		case 'expired':
			return `Your ${serviceName} session expired.`;
		case 'rate-limited': {
			const minutes = retryAfterMs ? Math.ceil(retryAfterMs / 60_000) : 0;
			return minutes > 0
				? `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
				: `Too many attempts. Wait a bit and try again.`;
		}
		case 'registration-disabled':
			return `${serviceName} doesn't allow new accounts. Ask your admin, or choose another instance.`;
		case 'unreachable':
			return `Can't reach ${serviceName}. Check that it's running and the URL is correct.`;
		case 'permission-denied':
			return `You signed in to ${serviceName}, but your account doesn't have permission for this action.`;
		case 'parent-stale':
			return `Can't connect ${serviceName} because its parent service needs to reconnect first.`;
		case 'no-stored-password':
			return `No saved password for ${serviceName}. Sign in manually to reconnect.`;
		case 'not-linked':
			return `You're not connected to ${serviceName}.`;
		case 'unsupported':
			return `${serviceName} doesn't support automatic reconnect. Sign in manually.`;
		default:
			return `Something went wrong with ${serviceName}.`;
	}
}

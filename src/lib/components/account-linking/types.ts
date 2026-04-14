/**
 * Shared types for the account-linking UI components.
 *
 * AccountServiceSummary is the normalized shape that every component consumes.
 * It's computed server-side from services + user_service_credentials + adapter
 * capabilities. Never contains raw access tokens or stored passwords — only
 * metadata and state. See docs/superpowers/specs/2026-04-14-settings-ux-
 * rework-design.md §"Shared components".
 */

import type { AdapterCapabilities } from '$lib/adapters/contract';

export interface AccountServiceSummary {
	/** Service ID (services.id — unique per registered instance). */
	id: string;
	/** Display name, e.g. "Jellyfin (home server)". */
	name: string;
	/** Adapter type key, e.g. 'jellyfin'. */
	type: string;
	/** Instance URL the user is connecting to. */
	url: string;
	/** Brand color for badges. */
	color: string;
	/** 2-char abbreviation. */
	abbreviation: string;
	/** Icon name resolved by ServiceIcon. */
	icon?: string;
	/** Full adapter capabilities object — drives modal/card behavior. */
	capabilities: AdapterCapabilities;
	/** True if the current user has a credential for this service. */
	isLinked: boolean;
	/** ISO timestamp when the credential went stale, null if healthy. */
	staleSince: string | null;
	/** External username on the remote service (if linked). */
	externalUsername: string | null;
	/** True if the credential was created by Nexus via createUser. */
	nexusManaged: boolean;
	/** True if the credential was auto-linked from a parent service. */
	autoLinked: boolean;
	/** True if the credential has a stored password for auto-reconnect. */
	hasStoredPassword: boolean;
	/** Parent service summary if this is a derived credential. */
	parentServiceName: string | null;
}

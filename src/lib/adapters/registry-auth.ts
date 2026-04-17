/**
 * Shared auth-resilience layer for the adapter registry.
 *
 * This module centralizes the stored-password auto-refresh machinery,
 * health-probe orchestration, and reconnect flow. Adapters throw
 * AdapterAuthError with a specific kind; this layer catches, retries,
 * and updates DB state (stale_since, access_token) uniformly.
 *
 * See docs/superpowers/specs/2026-04-14-adapter-contract-design.md for the
 * contract rules, and 2026-04-14-service-account-umbrella-design.md for the
 * credential lifecycle state machine.
 */

import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { ServiceConfig, UserCredential } from './types';
import type { CredentialProbeResult, UserCredentialResult } from './contract';
import { registry } from './registry';
import { AdapterAuthError } from './errors';
import { decryptStoredPassword } from '../server/crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Stale-state helpers
// ─────────────────────────────────────────────────────────────────────────────

export function markUserCredentialStale(userId: string, serviceId: string): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.update(schema.userServiceCredentials)
		.set({ staleSince: now, lastProbedAt: now })
		.where(
			and(
				eq(schema.userServiceCredentials.userId, userId),
				eq(schema.userServiceCredentials.serviceId, serviceId)
			)
		)
		.run();
}

export function clearUserCredentialStale(userId: string, serviceId: string): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.update(schema.userServiceCredentials)
		.set({ staleSince: null, lastProbedAt: now })
		.where(
			and(
				eq(schema.userServiceCredentials.userId, userId),
				eq(schema.userServiceCredentials.serviceId, serviceId)
			)
		)
		.run();
}

function updateCredentialAfterRefresh(
	userId: string,
	serviceId: string,
	result: UserCredentialResult
): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.update(schema.userServiceCredentials)
		.set({
			accessToken: result.accessToken,
			externalUserId: result.externalUserId,
			externalUsername: result.externalUsername,
			extraAuth: result.extraAuth ? JSON.stringify(result.extraAuth) : null,
			staleSince: null,
			lastProbedAt: now
		})
		.where(
			and(
				eq(schema.userServiceCredentials.userId, userId),
				eq(schema.userServiceCredentials.serviceId, serviceId)
			)
		)
		.run();
}

function getStoredPassword(userId: string, serviceId: string): string | null {
	const db = getDb();
	const row = db
		.select({ storedPassword: schema.userServiceCredentials.storedPassword })
		.from(schema.userServiceCredentials)
		.where(
			and(
				eq(schema.userServiceCredentials.userId, userId),
				eq(schema.userServiceCredentials.serviceId, serviceId)
			)
		)
		.get();
	// Decrypt at the boundary — adapters that consume this string downstream
	// (Jellyfin / Invidious / Calibre / RomM refreshCredential) never see the
	// envelope.
	return decryptStoredPassword(row?.storedPassword ?? null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-refresh orchestration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run an adapter call with auto-refresh semantics:
 *
 * 1. Call the provided function.
 * 2. If it throws AdapterAuthError('expired'), look up the user's stored
 *    password, call adapter.refreshCredential, update the credential row, and
 *    retry the original call exactly once.
 * 3. If the retry also fails (or there's no stored password), mark the
 *    credential stale and rethrow.
 *
 * Callers pass a thunk that closes over userCred so the retry uses the
 * refreshed access token automatically.
 */
export async function runWithAutoRefresh<T>(
	config: ServiceConfig,
	userId: string,
	initialUserCred: UserCredential | undefined,
	call: (userCred: UserCredential | undefined) => Promise<T>
): Promise<T> {
	try {
		return await call(initialUserCred);
	} catch (err) {
		if (!AdapterAuthError.is(err) || err.kind !== 'expired') throw err;

		const adapter = registry.get(config.type);
		if (!adapter?.refreshCredential) {
			markUserCredentialStale(userId, config.id);
			throw err;
		}

		const storedPassword = getStoredPassword(userId, config.id);
		if (!storedPassword || !initialUserCred) {
			markUserCredentialStale(userId, config.id);
			throw err;
		}

		let refreshed: UserCredentialResult;
		try {
			refreshed = await adapter.refreshCredential(config, initialUserCred, storedPassword);
		} catch (refreshErr) {
			// Refresh failed — stored password no longer works. Mark stale and
			// rethrow a stable error kind so the UI can render 'invalid'.
			markUserCredentialStale(userId, config.id);
			if (AdapterAuthError.is(refreshErr)) throw refreshErr;
			throw new AdapterAuthError(
				refreshErr instanceof Error ? refreshErr.message : String(refreshErr),
				'invalid'
			);
		}

		updateCredentialAfterRefresh(userId, config.id, refreshed);

		// Retry the original call with the refreshed credential.
		return call({
			accessToken: refreshed.accessToken,
			externalUserId: refreshed.externalUserId,
			externalUsername: refreshed.externalUsername
		});
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Health probes
// ─────────────────────────────────────────────────────────────────────────────

export interface HealthProbeResult {
	serviceId: string;
	result: CredentialProbeResult | 'unsupported' | 'error';
	error?: string;
}

/**
 * Probe a single user credential. Updates stale_since in the DB based on
 * the result. Returns the outcome.
 */
export async function probeUserCredential(
	config: ServiceConfig,
	userId: string,
	userCred: UserCredential
): Promise<HealthProbeResult> {
	const adapter = registry.get(config.type);
	if (!adapter?.probeCredential) {
		return { serviceId: config.id, result: 'unsupported' };
	}

	try {
		const outcome = await adapter.probeCredential(config, userCred);
		if (outcome === 'ok') {
			clearUserCredentialStale(userId, config.id);
		} else {
			markUserCredentialStale(userId, config.id);
		}
		return { serviceId: config.id, result: outcome };
	} catch (err) {
		markUserCredentialStale(userId, config.id);
		return {
			serviceId: config.id,
			result: 'error',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

/**
 * Probe every linked credential for a user in parallel. Used by the accounts
 * page server load so the UI can show health state.
 */
export async function probeAllUserCredentials(
	userId: string,
	serviceConfigs: ServiceConfig[]
): Promise<HealthProbeResult[]> {
	const db = getDb();
	const creds = db
		.select()
		.from(schema.userServiceCredentials)
		.where(eq(schema.userServiceCredentials.userId, userId))
		.all();

	const configsById = new Map(serviceConfigs.map((c) => [c.id, c]));
	const tasks: Array<Promise<HealthProbeResult>> = [];

	for (const cred of creds) {
		const config = configsById.get(cred.serviceId);
		if (!config) continue;
		const userCred: UserCredential = {
			accessToken: cred.accessToken ?? undefined,
			externalUserId: cred.externalUserId ?? undefined,
			externalUsername: cred.externalUsername ?? undefined
		};
		tasks.push(probeUserCredential(config, userId, userCred));
	}

	return Promise.all(tasks);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconnect (manual retry via /api/user/credentials/reconnect)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconnectResult {
	success: boolean;
	kind?: string;
	message?: string;
}

/**
 * Manual reconnect: user clicked "Reconnect" on a stale credential in the UI.
 * Reads the stored password, calls refreshCredential, updates the row,
 * clears stale_since. Returns a structured result the route can serialize.
 */
export async function reconnectCredential(
	config: ServiceConfig,
	userId: string
): Promise<ReconnectResult> {
	const adapter = registry.get(config.type);
	if (!adapter?.refreshCredential) {
		return {
			success: false,
			kind: 'unsupported',
			message: `${config.name} does not support automatic reconnect — sign in manually.`
		};
	}

	const db = getDb();
	const row = db
		.select()
		.from(schema.userServiceCredentials)
		.where(
			and(
				eq(schema.userServiceCredentials.userId, userId),
				eq(schema.userServiceCredentials.serviceId, config.id)
			)
		)
		.get();

	if (!row) {
		return { success: false, kind: 'not-linked', message: 'No credential to reconnect.' };
	}

	if (!row.storedPassword) {
		return {
			success: false,
			kind: 'no-stored-password',
			message: 'No saved password — sign in manually.'
		};
	}

	const plaintext = decryptStoredPassword(row.storedPassword);
	if (!plaintext) {
		return {
			success: false,
			kind: 'no-stored-password',
			message: 'No saved password — sign in manually.'
		};
	}

	const userCred: UserCredential = {
		accessToken: row.accessToken ?? undefined,
		externalUserId: row.externalUserId ?? undefined,
		externalUsername: row.externalUsername ?? undefined
	};

	try {
		const refreshed = await adapter.refreshCredential(config, userCred, plaintext);
		updateCredentialAfterRefresh(userId, config.id, refreshed);
		return { success: true };
	} catch (err) {
		markUserCredentialStale(userId, config.id);
		if (AdapterAuthError.is(err)) {
			return { success: false, kind: err.kind, message: err.message };
		}
		return {
			success: false,
			kind: 'error',
			message: err instanceof Error ? err.message : String(err)
		};
	}
}

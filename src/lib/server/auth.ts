import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { UserCredential } from '../adapters/types';
import { encryptAtRest } from './crypto';

const SESSION_TTL_DAYS = 30;
const COOKIE_NAME = 'nexus_session';

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(password, salt, 64).toString('hex');
	return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const attempt = scryptSync(password, salt, 64);
	const expected = Buffer.from(hash, 'hex');
	if (attempt.length !== expected.length) return false;
	return timingSafeEqual(attempt, expected);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function getUserCount(): number {
	const db = getDb();
	const result = db.get<{ n: number }>(`SELECT COUNT(*) as n FROM users`);
	return result?.n ?? 0;
}

export function getUserByUsername(username: string) {
	const db = getDb();
	return db.select().from(schema.users).where(eq(schema.users.username, username)).get();
}

export function getUserById(id: string) {
	const db = getDb();
	return db.select().from(schema.users).where(eq(schema.users.id, id)).get();
}

export function getAllUsers() {
	const db = getDb();
	return db.select({
		id: schema.users.id,
		username: schema.users.username,
		displayName: schema.users.displayName,
		avatar: schema.users.avatar,
		isAdmin: schema.users.isAdmin,
		authProvider: schema.users.authProvider,
		externalId: schema.users.externalId,
		forcePasswordReset: schema.users.forcePasswordReset,
		status: schema.users.status,
		createdAt: schema.users.createdAt
	}).from(schema.users).all();
}

export function createUser(
	username: string,
	displayName: string,
	password: string,
	isAdmin = false,
	opts?: { authProvider?: string; externalId?: string; status?: string; forcePasswordReset?: boolean }
) {
	const db = getDb();
	const id = randomBytes(16).toString('hex');
	const passwordHash = hashPassword(password);
	db.insert(schema.users).values({
		id,
		username,
		displayName,
		passwordHash,
		isAdmin,
		authProvider: opts?.authProvider ?? 'local',
		externalId: opts?.externalId,
		status: opts?.status ?? 'active',
		forcePasswordReset: opts?.forcePasswordReset ?? false
	}).run();
	return id;
}

export function deleteUser(id: string) {
	const db = getDb();
	// Delete user's sessions, credentials, then the user
	db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run();
	db.delete(schema.userServiceCredentials).where(eq(schema.userServiceCredentials.userId, id)).run();
	db.delete(schema.users).where(eq(schema.users.id, id)).run();
}

export function updateUser(id: string, updates: { displayName?: string; isAdmin?: boolean; avatar?: string | null }) {
	const db = getDb();
	if (updates.displayName !== undefined) {
		db.update(schema.users).set({ displayName: updates.displayName }).where(eq(schema.users.id, id)).run();
	}
	if (updates.isAdmin !== undefined) {
		db.update(schema.users).set({ isAdmin: updates.isAdmin }).where(eq(schema.users.id, id)).run();
	}
	if (updates.avatar !== undefined) {
		db.update(schema.users).set({ avatar: updates.avatar }).where(eq(schema.users.id, id)).run();
	}
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function createSession(userId: string): string {
	const db = getDb();
	const token = randomBytes(32).toString('hex');
	const expiresAt = Date.now() + SESSION_TTL_DAYS * 86_400_000;
	db.insert(schema.sessions).values({ token, userId, expiresAt }).run();
	return token;
}

export function validateSession(token: string | undefined) {
	if (!token) return null;
	const db = getDb();
	const session = db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.token, token))
		.get();
	if (!session) return null;
	if (session.expiresAt < Date.now()) {
		db.delete(schema.sessions).where(eq(schema.sessions.token, token)).run();
		return null;
	}
	return getUserById(session.userId) ?? null;
}

export function deleteSession(token: string) {
	const db = getDb();
	db.delete(schema.sessions).where(eq(schema.sessions.token, token)).run();
}

export function purgeExpiredSessions() {
	const db = getDb();
	db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, Date.now())).run();
}

// ---------------------------------------------------------------------------
// Invite Links
// ---------------------------------------------------------------------------

export function createInviteLink(
	createdBy: string,
	opts?: { maxUses?: number; expiresInHours?: number }
) {
	const db = getDb();
	const code = randomBytes(12).toString('base64url'); // ~16 char URL-safe code
	const maxUses = opts?.maxUses ?? 1;
	const expiresAt = opts?.expiresInHours
		? Date.now() + opts.expiresInHours * 3_600_000
		: null;
	db.insert(schema.inviteLinks).values({ code, createdBy, maxUses, expiresAt }).run();
	return code;
}

export function getInviteLinks() {
	const db = getDb();
	return db.select().from(schema.inviteLinks).all();
}

export function validateInviteCode(code: string) {
	const db = getDb();
	const invite = db.select().from(schema.inviteLinks).where(eq(schema.inviteLinks.code, code)).get();
	if (!invite) return null;
	if (invite.expiresAt && invite.expiresAt < Date.now()) return null;
	if (invite.uses >= invite.maxUses) return null;
	return invite;
}

export function consumeInviteCode(code: string) {
	const db = getDb();
	db.update(schema.inviteLinks).set({ uses: sql`uses + 1` }).where(eq(schema.inviteLinks.code, code)).run();
}

export function deleteInviteLink(code: string) {
	const db = getDb();
	db.delete(schema.inviteLinks).where(eq(schema.inviteLinks.code, code)).run();
}

// ---------------------------------------------------------------------------
// User Service Credentials (per-user linked accounts)
// ---------------------------------------------------------------------------

export function getUserCredentials(userId: string) {
	const db = getDb();
	return db.select().from(schema.userServiceCredentials)
		.where(eq(schema.userServiceCredentials.userId, userId))
		.all();
}

export function getUserCredentialForService(userId: string, serviceId: string): UserCredential | null {
	const db = getDb();
	const row = db.select().from(schema.userServiceCredentials)
		.where(and(
			eq(schema.userServiceCredentials.userId, userId),
			eq(schema.userServiceCredentials.serviceId, serviceId)
		))
		.get();
	if (!row) return null;
	return {
		accessToken: row.accessToken ?? undefined,
		externalUserId: row.externalUserId ?? undefined,
		externalUsername: row.externalUsername ?? undefined
	};
}

export function upsertUserCredential(
	userId: string,
	serviceId: string,
	cred: { accessToken?: string; externalUserId?: string; externalUsername?: string; storedPassword?: string | null; extraAuth?: Record<string, unknown> | null },
	opts?: { managed?: boolean; linkedVia?: string; skipDerivedLink?: boolean; autoLinked?: boolean; parentServiceId?: string | null }
) {
	const db = getDb();
	const managed = opts?.managed ?? false;
	const linkedVia = opts?.linkedVia ?? null;
	const autoLinked = opts?.autoLinked ?? false;
	const parentServiceId = opts?.parentServiceId ?? null;

	// Only write storedPassword/extraAuth if explicitly provided — null means
	// "clear it", undefined means "leave existing value alone".
	//
	// Encrypt at the boundary so raw plaintext never leaves this function.
	// See src/lib/server/crypto.ts — AES-256-GCM envelope, NEXUS_ENCRYPTION_KEY.
	const storedPasswordProvided = cred.storedPassword !== undefined;
	const storedPassword =
		cred.storedPassword === undefined || cred.storedPassword === null
			? null
			: encryptAtRest(cred.storedPassword);
	const extraAuthProvided = cred.extraAuth !== undefined;
	const extraAuth = cred.extraAuth ? JSON.stringify(cred.extraAuth) : null;

	// Try insert, on conflict update
	db.insert(schema.userServiceCredentials)
		.values({
			userId,
			serviceId,
			accessToken: cred.accessToken ?? null,
			externalUserId: cred.externalUserId ?? null,
			externalUsername: cred.externalUsername ?? null,
			managed,
			linkedVia,
			autoLinked,
			parentServiceId,
			...(storedPasswordProvided ? { storedPassword } : {}),
			...(extraAuthProvided ? { extraAuth } : {}),
			staleSince: null
		})
		.onConflictDoUpdate({
			target: [schema.userServiceCredentials.userId, schema.userServiceCredentials.serviceId],
			set: {
				accessToken: cred.accessToken ?? null,
				externalUserId: cred.externalUserId ?? null,
				externalUsername: cred.externalUsername ?? null,
				managed,
				linkedVia,
				autoLinked,
				parentServiceId,
				...(storedPasswordProvided ? { storedPassword } : {}),
				...(extraAuthProvided ? { extraAuth } : {}),
				staleSince: null,
				linkedAt: new Date().toISOString()
			}
		})
		.run();

	// Fire-and-forget: auto-link derived services (e.g. Overseerr, StreamyStats)
	// Uses dynamic import to avoid circular dependency with services.ts
	if (!opts?.skipDerivedLink) {
		import('./services.js')
			.then(({ getServiceConfig }) => {
				const config = getServiceConfig(serviceId);
				if (!config) return;
				return import('./derived-linker.js').then(({ linkDerivedServices }) =>
					linkDerivedServices(userId, serviceId, config.type)
				);
			})
			.catch((e) => {
				console.warn('[auth] Derived linker failed:', e instanceof Error ? e.message : e);
			});
	}
}

export function deleteUserCredential(userId: string, serviceId: string) {
	const db = getDb();
	db.delete(schema.userServiceCredentials)
		.where(and(
			eq(schema.userServiceCredentials.userId, userId),
			eq(schema.userServiceCredentials.serviceId, serviceId)
		))
		.run();
}

// ---------------------------------------------------------------------------
// App Settings
// ---------------------------------------------------------------------------

export function getSetting(key: string): string | null {
	const db = getDb();
	const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
	return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
	const db = getDb();
	db.insert(schema.appSettings)
		.values({ key, value })
		.onConflictDoUpdate({ target: schema.appSettings.key, set: { value } })
		.run();
}

export function getAllSettings(): Record<string, string> {
	const db = getDb();
	const rows = db.select().from(schema.appSettings).all();
	return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---------------------------------------------------------------------------
// Password Reset + Force Reset
// ---------------------------------------------------------------------------

export function resetUserPassword(userId: string, newPassword: string): void {
	const db = getDb();
	const passwordHash = hashPassword(newPassword);
	db.update(schema.users)
		.set({ passwordHash, forcePasswordReset: true })
		.where(eq(schema.users.id, userId))
		.run();
}

export function setForcePasswordReset(userId: string, force: boolean): void {
	const db = getDb();
	db.update(schema.users)
		.set({ forcePasswordReset: force })
		.where(eq(schema.users.id, userId))
		.run();
}

export function changePassword(userId: string, newPassword: string): void {
	const db = getDb();
	const passwordHash = hashPassword(newPassword);
	db.update(schema.users)
		.set({ passwordHash, forcePasswordReset: false })
		.where(eq(schema.users.id, userId))
		.run();
}

// ---------------------------------------------------------------------------
// User Status (pending/active)
// ---------------------------------------------------------------------------

export function approveUser(userId: string): void {
	const db = getDb();
	db.update(schema.users)
		.set({ status: 'active' })
		.where(eq(schema.users.id, userId))
		.run();
}

export function getPendingUsers() {
	const db = getDb();
	return db.select({
		id: schema.users.id,
		username: schema.users.username,
		displayName: schema.users.displayName,
		createdAt: schema.users.createdAt
	}).from(schema.users).where(eq(schema.users.status, 'pending')).all();
}

export { COOKIE_NAME };

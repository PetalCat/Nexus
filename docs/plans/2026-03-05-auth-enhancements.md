# Auth Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add admin password reset (with force-reset flag), open registration with optional approval queue, and all supporting UI.

**Architecture:** New `app_settings` table for global config. Two new columns on `users` (`force_password_reset`, `status`). New pages for `/register`, `/reset-password`, `/pending-approval`. Admin APIs for user management + settings. Login flow checks force-reset flag and pending status.

**Tech Stack:** SvelteKit (form actions), Drizzle/SQLite, existing Nexus design system (card, btn, input classes).

---

### Task 1: DB schema — add app_settings table + users columns

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/index.ts`

**Step 1: Add `app_settings` table to schema.ts**

After the social features section, add:

```ts
export const appSettings = sqliteTable('app_settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export type AppSetting = typeof appSettings.$inferSelect;
```

**Step 2: Add columns to `users` in schema.ts**

Add to the `users` table definition:
```ts
forcePasswordReset: integer('force_password_reset', { mode: 'boolean' }).notNull().default(false),
status: text('status').notNull().default('active'), // 'active' | 'pending'
```

**Step 3: Add CREATE TABLE + migrations to index.ts**

Add `app_settings` table:
```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
```

Add safe migrations for existing `users` table:
```ts
safeAddColumn('users', 'force_password_reset', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
```

**Step 4: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/index.ts
git commit -m "feat(auth): add app_settings table + force_password_reset, status columns on users"
```

---

### Task 2: Auth helpers — settings CRUD + password reset + user status

**Files:**
- Modify: `src/lib/server/auth.ts`

**Step 1: Add app settings helpers**

```ts
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
```

**Step 2: Add password reset + force-reset helpers**

```ts
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
```

**Step 3: Add user status helpers**

```ts
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
```

**Step 4: Update `getAllUsers` to include new fields**

Add `forcePasswordReset` and `status` to the select in `getAllUsers()`.

**Step 5: Commit**

```bash
git add src/lib/server/auth.ts
git commit -m "feat(auth): add settings CRUD, password reset, force-reset, user status helpers"
```

---

### Task 3: Admin API endpoints

**Files:**
- Create: `src/routes/api/admin/users/[id]/reset-password/+server.ts`
- Create: `src/routes/api/admin/users/[id]/force-reset/+server.ts`
- Create: `src/routes/api/admin/users/[id]/approve/+server.ts`
- Create: `src/routes/api/admin/users/[id]/deny/+server.ts`
- Create: `src/routes/api/admin/settings/+server.ts`

**Step 1: Create reset-password endpoint**

`PUT /api/admin/users/:id/reset-password`
Body: `{ password: string }`
- Validates admin, validates password length >= 6
- Calls `resetUserPassword(params.id, password)` (auto-sets forcePasswordReset)
- Returns `{ ok: true }`

**Step 2: Create force-reset endpoint**

`PUT /api/admin/users/:id/force-reset`
Body: `{ force: boolean }`
- Validates admin
- Calls `setForcePasswordReset(params.id, force)`
- Returns `{ ok: true }`

**Step 3: Create approve endpoint**

`PUT /api/admin/users/:id/approve`
- Validates admin
- Calls `approveUser(params.id)`
- Returns `{ ok: true }`

**Step 4: Create deny endpoint**

`DELETE /api/admin/users/:id/deny`
- Validates admin
- Calls `deleteUser(params.id)`
- Returns `{ ok: true }`

**Step 5: Create settings endpoint**

`GET /api/admin/settings` — returns `getAllSettings()`
`PUT /api/admin/settings` — body: `{ key, value }`, calls `setSetting(key, value)`
- Both validate admin

**Step 6: Commit**

```bash
git add src/routes/api/admin/
git commit -m "feat(auth): add admin APIs for password reset, force-reset, approve, deny, settings"
```

---

### Task 4: Login flow — force-reset + pending redirects

**Files:**
- Modify: `src/routes/login/+page.server.ts`
- Modify: `src/hooks.server.ts`

**Step 1: Update login action to check force-reset and status**

In `src/routes/login/+page.server.ts`, after verifying password and before the redirect:

```ts
// Check if user is pending approval
if (user.status === 'pending') {
	// Create session so they can see the pending page
	const token = createSession(user.id);
	cookies.set(COOKIE_NAME, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
	throw redirect(303, '/pending-approval');
}

// After creating session, check force reset
const token = createSession(user.id);
cookies.set(COOKIE_NAME, token, { ... });

if (user.forcePasswordReset) {
	throw redirect(303, '/reset-password');
}
```

**Step 2: Update login load function to pass registration setting**

```ts
export const load: PageServerLoad = async ({ locals, url }) => {
	if (getUserCount() === 0) throw redirect(303, '/setup');
	if (locals.user) throw redirect(303, url.searchParams.get('next') || '/');
	const registrationEnabled = getSetting('registration_enabled') === 'true';
	return { registrationEnabled };
};
```

**Step 3: Update hooks.server.ts to check pending + force-reset on every request**

In the `handle` function, after attaching `user` to locals:
- If `user.forcePasswordReset` and path is not `/reset-password` or `/api`, redirect to `/reset-password`
- If `user.status === 'pending'` and path is not `/pending-approval` or `/api/auth/logout`, redirect to `/pending-approval`

Add `/register`, `/pending-approval`, `/reset-password` to `NO_AUTH_PATHS`.

**Step 4: Commit**

```bash
git add src/routes/login/+page.server.ts src/hooks.server.ts
git commit -m "feat(auth): login redirects for force-reset and pending-approval"
```

---

### Task 5: Pages — /reset-password, /register, /pending-approval

**Files:**
- Create: `src/routes/reset-password/+page.server.ts`
- Create: `src/routes/reset-password/+page.svelte`
- Create: `src/routes/register/+page.server.ts`
- Create: `src/routes/register/+page.svelte`
- Create: `src/routes/pending-approval/+page.server.ts`
- Create: `src/routes/pending-approval/+page.svelte`

**Step 1: /reset-password server**

Load: verify user is logged in + `forcePasswordReset === true`, else redirect to `/`.
Action: validate new password + confirm match, >= 6 chars, call `changePassword(user.id, password)`, redirect to `/`.

**Step 2: /reset-password page**

Same visual style as login/setup pages (centered card, Nexus logo, dark gradient bg).
Form: new password, confirm password, submit button.
Message at top: "Your password needs to be changed before continuing."

**Step 3: /register server**

Load: check `getSetting('registration_enabled') === 'true'`, else redirect to `/login`. If logged in, redirect to `/`.
Action: validate fields (username, displayName, password >= 6, confirm match). Check `getSetting('registration_requires_approval')` — if `'true'`, create user with `status: 'pending'` and redirect to `/pending-approval`; otherwise create with `status: 'active'`, create session, redirect to `/`.

Use `createUser` but pass the status. Update `createUser` in auth.ts to accept `status` in opts.

**Step 4: /register page**

Same visual style. Title: "Create Account". Same form as invite page (username, display name, password, confirm). Link at bottom: "Already have an account? Sign in".

**Step 5: /pending-approval server**

Load: verify user is logged in and `status === 'pending'`. If not pending, redirect to `/`. If not logged in, redirect to `/login`.

**Step 6: /pending-approval page**

Same centered card style. Icon + message: "Your account is pending approval. An admin will review your request. Check back later." Link: "Sign out" → `/api/auth/logout`.

**Step 7: Commit**

```bash
git add src/routes/reset-password/ src/routes/register/ src/routes/pending-approval/
git commit -m "feat(auth): add /reset-password, /register, /pending-approval pages"
```

---

### Task 6: Login page — "Create Account" link

**Files:**
- Modify: `src/routes/login/+page.svelte`

**Step 1: Add conditional registration link**

After the `</form>` closing tag, add:
```svelte
{#if data.registrationEnabled}
	<p class="mt-4 text-center text-xs text-[var(--color-muted)]">
		Don't have an account? <a href="/register" class="text-[var(--color-nebula)] hover:underline">Create one</a>
	</p>
{/if}
```

Update the script to accept `data`:
```ts
let { data, form }: { data: PageData; form: ActionData } = $props();
```

**Step 2: Commit**

```bash
git add src/routes/login/+page.svelte
git commit -m "feat(auth): show 'Create Account' link on login when registration enabled"
```

---

### Task 7: Admin panel — registration toggles + pending users + reset password UI

**Files:**
- Modify: `src/routes/settings/+page.server.ts`
- Modify: `src/routes/settings/+page.svelte`

**Step 1: Load settings + pending users in page server**

In `settings/+page.server.ts` load function, add:
```ts
import { getAllSettings, getPendingUsers } from '$lib/server/auth';

// Inside load:
const settings = isAdmin ? getAllSettings() : {};
const pendingUsers = isAdmin ? getPendingUsers() : [];

// Add to return:
return { ..., settings, pendingUsers };
```

**Step 2: Add registration toggles to Users tab**

In the Users tab section of `+page.svelte`, add a "Registration" card at the top with:
- Toggle switch: "Open Registration" (calls `PUT /api/admin/settings` with `registration_enabled`)
- Toggle switch (only visible when registration is on): "Require Approval" (calls `PUT /api/admin/settings` with `registration_requires_approval`)

**Step 3: Add pending users section**

Below the registration toggles, if there are pending users, show a "Pending Approval" section with a list of cards, each showing username + display name + "Approve" (green) + "Deny" (red) buttons.

**Step 4: Add password reset to user cards**

In the existing user list, add a "Reset Password" button next to each user (not self). Clicking opens a small inline form asking for a new password. On submit, calls `PUT /api/admin/users/:id/reset-password`. Also add a "Force Reset" toggle that calls `PUT /api/admin/users/:id/force-reset`.

**Step 5: Commit**

```bash
git add src/routes/settings/
git commit -m "feat(auth): admin panel — registration toggles, pending users, password reset UI"
```

---

### Task 8: Update createUser to accept status option

**Files:**
- Modify: `src/lib/server/auth.ts`

**Step 1: Add status to createUser opts**

Update `createUser` signature:
```ts
export function createUser(
	username: string,
	displayName: string,
	password: string,
	isAdmin = false,
	opts?: { authProvider?: string; externalId?: string; status?: string }
)
```

In the insert, add: `status: opts?.status ?? 'active'`

**Step 2: Commit**

```bash
git add src/lib/server/auth.ts
git commit -m "feat(auth): createUser accepts status option for pending registration"
```

---

### Task 9: Verify + smoke test

**Step 1: Run svelte-check**

```bash
npx svelte-check --threshold error
```

Expected: no new errors beyond pre-existing stats-engine/analytics ones.

**Step 2: Manual smoke test checklist**

- [ ] Login as admin, go to Settings > Users
- [ ] See registration toggles (both off by default)
- [ ] Enable registration, check login page shows "Create Account" link
- [ ] Enable "Require Approval", register a new user, see pending-approval page
- [ ] Approve user from admin panel, user can now log in normally
- [ ] Reset a user's password from admin panel
- [ ] User is forced to change password on next login
- [ ] After changing, user proceeds normally

**Step 3: Final commit if any fixes needed**

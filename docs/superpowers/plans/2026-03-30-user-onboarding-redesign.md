# User Onboarding & Credential Linking Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace auto-provisioning with explicit user-driven service linking, add Jellyfin/Plex native authentication, and add derived service auto-linking.

**Architecture:** Three registration paths (Jellyfin/Plex auth, local, invite) all funnel into the same `createUser` + `createSession` flow. Service linking moves entirely to user-driven settings page. Derived services auto-link when parent credentials are upserted. Adapter metadata (`derivedFrom`, `parentRequired`) drives all linking logic — no hardcoded service names.

**Tech Stack:** SvelteKit, Drizzle ORM, SQLite, existing adapter registry

**Spec:** `docs/superpowers/specs/2026-03-30-user-onboarding-redesign-design.md`

---

## File Map

### New Files
- `src/lib/server/derived-linker.ts` — auto-link derived services when parent credential is upserted
- `src/routes/api/user/credentials/[serviceId]/managed/+server.ts` — create managed account on a service
- `src/routes/api/admin/users/+server.ts` — admin create local user (if not existing)

### Modified Files
- `src/lib/db/schema.ts` — add `managed` and `linkedVia` columns to `userServiceCredentials`
- `src/lib/adapters/types.ts` — add `derivedFrom` and `parentRequired` to ServiceAdapter
- `src/lib/adapters/overseerr.ts` — add `derivedFrom: ['jellyfin', 'plex'], parentRequired: false`
- `src/lib/adapters/streamystats.ts` — add `derivedFrom: ['jellyfin'], parentRequired: true`
- `src/lib/server/auth.ts` — add `authenticateViaService()` helper, modify `upsertUserCredential` to trigger derived linking
- `src/lib/server/services.ts` — remove `provisionUserOnServices`, remove `autoLinkOverseerr` from login caller
- `src/routes/login/+page.server.ts` — add Jellyfin/Plex auth path, remove autoLinkOverseerr call
- `src/routes/login/+page.svelte` — add "Sign in with Jellyfin/Plex" buttons
- `src/routes/register/+page.server.ts` — add Jellyfin/Plex auth path, remove provisionUserOnServices call
- `src/routes/register/+page.svelte` — add "Sign in with Jellyfin/Plex" buttons
- `src/routes/invite/+page.server.ts` — add Jellyfin/Plex auth path, remove provisionUserOnServices call
- `src/routes/invite/+page.svelte` — add "Sign in with Jellyfin/Plex" buttons
- `src/routes/settings/accounts/+page.svelte` — redesign with three states, managed accounts, derived services
- `src/routes/settings/accounts/+page.server.ts` — return richer service linking data
- `src/routes/api/user/credentials/+server.ts` — add `managed` flag to upsert, return `managed`/`linkedVia` in GET
- `src/hooks.server.ts` — no changes needed (session handling unchanged)

---

## Task 1: Schema Migration — Add Columns to userServiceCredentials

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Add `managed` and `linkedVia` columns**

In `src/lib/db/schema.ts`, find the `userServiceCredentials` table definition and add two columns:

```typescript
// In the userServiceCredentials table definition, add after linkedAt:
managed: integer('managed', { mode: 'boolean' }).notNull().default(false),
linkedVia: text('linked_via'),  // e.g. 'jellyfin' — null for directly linked
```

- [ ] **Step 2: Generate and run migration**

```bash
pnpm db:generate
pnpm db:migrate
```

If the DB already has data and migration fails due to NOT NULL constraint, the `default(false)` should handle it. Verify the migration SQL adds the columns with defaults.

- [ ] **Step 3: Verify schema**

```bash
sqlite3 nexus.db ".schema user_service_credentials"
```

Expected: table includes `managed INTEGER NOT NULL DEFAULT 0` and `linked_via TEXT` columns.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(auth): add managed and linkedVia columns to userServiceCredentials"
```

---

## Task 2: Adapter Interface — Add derivedFrom and parentRequired

**Files:**
- Modify: `src/lib/adapters/types.ts`
- Modify: `src/lib/adapters/overseerr.ts`
- Modify: `src/lib/adapters/streamystats.ts`

- [ ] **Step 1: Add fields to ServiceAdapter interface**

In `src/lib/adapters/types.ts`, find the `ServiceAdapter` interface (in `base.ts` if separate, or `types.ts`) and add:

```typescript
/** Parent adapter types this service can auto-link through. Order = preference. */
derivedFrom?: string[];
/** If true, this service ONLY works through a parent — no manual link fallback. */
parentRequired?: boolean;
```

- [ ] **Step 2: Add derivedFrom to Overseerr adapter**

In `src/lib/adapters/overseerr.ts`, find the adapter object export and add:

```typescript
derivedFrom: ['jellyfin', 'plex'],
parentRequired: false,
```

Since `seerr` is registered as a copy of overseerr in the registry, verify it inherits these fields. If seerr is a separate object, add the same fields there.

- [ ] **Step 3: Add derivedFrom to StreamyStats adapter**

In `src/lib/adapters/streamystats.ts`, find the adapter object export and add:

```typescript
derivedFrom: ['jellyfin'],
parentRequired: true,
```

- [ ] **Step 4: Verify no other adapters need derivedFrom**

Check all adapters in the registry. Currently only Overseerr/Seerr and StreamyStats derive from other services. Confirm by checking which adapters have `authVia` set — those are the candidates for `derivedFrom`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapters/types.ts src/lib/adapters/overseerr.ts src/lib/adapters/streamystats.ts
git commit -m "feat(adapters): add derivedFrom and parentRequired metadata to adapter interface"
```

---

## Task 3: Derived Service Auto-Linker

**Files:**
- Create: `src/lib/server/derived-linker.ts`
- Modify: `src/lib/server/auth.ts` — trigger linker from `upsertUserCredential`

- [ ] **Step 1: Write the derived linker module**

Create `src/lib/server/derived-linker.ts`:

```typescript
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService, upsertUserCredential } from '$lib/server/auth';

/**
 * When a parent credential (e.g. Jellyfin) is upserted, scan all enabled
 * services for adapters that derive from that parent type and attempt
 * auto-linking. Called automatically from upsertUserCredential.
 */
export async function linkDerivedServices(
	userId: string,
	parentServiceId: string,
	parentServiceType: string
): Promise<void> {
	const configs = getEnabledConfigs();

	for (const config of configs) {
		const adapter = registry.get(config.type);
		if (!adapter?.derivedFrom?.includes(parentServiceType)) continue;

		// Skip if already linked
		const existing = getUserCredentialForService(userId, config.id);
		if (existing?.accessToken || existing?.externalUserId) continue;

		try {
			await attemptDerivedLink(userId, config, adapter, parentServiceId, parentServiceType);
		} catch {
			// Silent — derived linking is best-effort
		}
	}
}

async function attemptDerivedLink(
	userId: string,
	config: { id: string; type: string; url: string; apiKey?: string; username?: string; password?: string },
	adapter: any,
	parentServiceId: string,
	parentServiceType: string
): Promise<void> {
	const parentCred = getUserCredentialForService(userId, parentServiceId);
	if (!parentCred?.accessToken && !parentCred?.externalUserId) return;

	// StreamyStats-style: validate parent token directly against derived service
	if (adapter.authVia === parentServiceType && parentCred.accessToken) {
		// The adapter's authenticateUser or a specific method handles this.
		// For StreamyStats, the existing auto-link logic validates the Jellyfin
		// token against StreamyStats' API.
		if (adapter.validateParentToken) {
			const result = await adapter.validateParentToken(config, parentCred);
			if (result) {
				upsertUserCredential(userId, config.id, {
					accessToken: result.accessToken ?? parentCred.accessToken,
					externalUserId: result.externalUserId ?? parentCred.externalUserId,
					externalUsername: result.externalUsername ?? parentCred.externalUsername
				}, { linkedVia: parentServiceType });
				return;
			}
		}
	}

	// Overseerr-style: find user by parent's externalUserId in the derived service
	if (adapter.getUsers && parentCred.externalUserId) {
		const users = await adapter.getUsers(config);
		const match = users.find((u: any) =>
			u.jellyfinUserId === parentCred.externalUserId ||
			u.plexUserId === parentCred.externalUserId
		);
		if (match) {
			upsertUserCredential(userId, config.id, {
				accessToken: match.accessToken,
				externalUserId: match.id?.toString(),
				externalUsername: match.username ?? match.displayName
			}, { linkedVia: parentServiceType });
		}
	}
}
```

- [ ] **Step 2: Add linkedVia support to upsertUserCredential**

In `src/lib/server/auth.ts`, modify `upsertUserCredential` to accept an optional options parameter and trigger derived linking:

Find the current `upsertUserCredential` function and update its signature:

```typescript
export function upsertUserCredential(
	userId: string,
	serviceId: string,
	cred: { accessToken?: string; externalUserId?: string; externalUsername?: string },
	opts?: { managed?: boolean; linkedVia?: string; skipDerivedLink?: boolean }
): void {
```

In the INSERT/UPDATE statement, include `managed` and `linkedVia` from `opts`:

```typescript
const managed = opts?.managed ? 1 : 0;
const linkedVia = opts?.linkedVia ?? null;
```

Add these to the insert values and the ON CONFLICT SET clause.

After the upsert completes, trigger derived linking unless `skipDerivedLink` is set:

```typescript
if (!opts?.skipDerivedLink) {
	const config = getServiceConfig(serviceId);
	if (config) {
		// Import dynamically to avoid circular dependency
		import('./derived-linker.js').then(({ linkDerivedServices }) => {
			linkDerivedServices(userId, serviceId, config.type).catch(() => {});
		});
	}
}
```

- [ ] **Step 3: Verify build passes**

```bash
pnpm build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/derived-linker.ts src/lib/server/auth.ts
git commit -m "feat(auth): add derived service auto-linker triggered on credential upsert"
```

---

## Task 4: Remove Old Provisioning Code

**Files:**
- Modify: `src/lib/server/services.ts` — remove `provisionUserOnServices`
- Modify: `src/routes/register/+page.server.ts` — remove provisionUserOnServices call
- Modify: `src/routes/invite/+page.server.ts` — remove provisionUserOnServices call
- Modify: `src/routes/login/+page.server.ts` — remove autoLinkOverseerr function and call

- [ ] **Step 1: Remove provisionUserOnServices from services.ts**

In `src/lib/server/services.ts`, delete the `provisionUserOnServices` function (lines ~86-163) and its `ProvisionResult` type. Also remove the `autoLinkOverseerr` function if it exists as a standalone (the login file has its own inline version).

Keep any other exports (`getServiceConfigs`, `getEnabledConfigs`, etc.) intact.

- [ ] **Step 2: Remove provisioning call from register**

In `src/routes/register/+page.server.ts`:
- Remove the import of `provisionUserOnServices`
- Remove the fire-and-forget call (line ~60): `provisionUserOnServices(userId, username, password).catch(...)`

- [ ] **Step 3: Remove provisioning call from invite**

In `src/routes/invite/+page.server.ts`:
- Remove the import of `provisionUserOnServices`
- Remove the fire-and-forget call (line ~67): `provisionUserOnServices(userId, username, password).catch(...)`

- [ ] **Step 4: Remove autoLinkOverseerr from login**

In `src/routes/login/+page.server.ts`:
- Remove the `autoLinkOverseerr` function (lines ~19-55)
- Remove its call in the login action (line ~53): `autoLinkOverseerr(userId).catch(...)`

The derived linker from Task 3 replaces this functionality — it triggers automatically when any credential is upserted.

- [ ] **Step 5: Remove autoLinkJellyfinServices if only used for provisioning**

In `src/lib/server/services.ts`, check if `autoLinkJellyfinServices` is still called anywhere other than provisioning. If it's only used in the layout's `needsAutoLink` check, leave it for now. If it's only called from removed code, remove it too.

- [ ] **Step 6: Verify build and tests pass**

```bash
pnpm build 2>&1 | tail -5
pnpm test 2>&1 | tail -10
```

Expected: both pass. If tests reference `provisionUserOnServices`, update them.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/services.ts src/routes/register/+page.server.ts src/routes/invite/+page.server.ts src/routes/login/+page.server.ts
git commit -m "feat(auth): remove auto-provisioning and hardcoded autoLinkOverseerr"
```

---

## Task 5: Jellyfin/Plex Authentication on Login

**Files:**
- Modify: `src/routes/login/+page.server.ts`
- Modify: `src/routes/login/+page.svelte`

- [ ] **Step 1: Add service auth to login server**

In `src/routes/login/+page.server.ts`, update the load function to return available auth services:

```typescript
import { getEnabledConfigs } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';

// In load function, add:
const authServices = getEnabledConfigs()
	.filter(c => {
		const a = registry.get(c.type);
		return (c.type === 'jellyfin' || c.type === 'plex') && a?.authenticateUser;
	})
	.map(c => ({ id: c.id, name: c.name, type: c.type }));

return { registrationEnabled, authServices };
```

In the actions, add a new action or branch in the default action. When `formData.get('authType')` is `'service'`:

```typescript
const serviceId = formData.get('serviceId') as string;
const username = formData.get('username') as string;
const password = formData.get('password') as string;

if (!serviceId || !username || !password) return fail(400, { error: 'All fields required' });

const config = getServiceConfig(serviceId);
if (!config) return fail(400, { error: 'Service not found' });

const adapter = registry.get(config.type);
if (!adapter?.authenticateUser) return fail(400, { error: 'Service does not support authentication' });

// Authenticate against the external service
let extCred;
try {
	extCred = await adapter.authenticateUser(config, username, password);
} catch (e) {
	return fail(401, { error: 'Invalid credentials for ' + config.name });
}

// Find existing Nexus user by linked credential OR by username
let user = null;

// Check if any Nexus user already has this external credential linked
const allUsers = getAllUsers();
for (const u of allUsers) {
	const cred = getUserCredentialForService(u.id, serviceId);
	if (cred?.externalUserId === extCred.externalUserId) {
		user = getUserById(u.id);
		break;
	}
}

// If no linked user found, check by username match
if (!user) {
	const byName = getUserByUsername(username);
	if (byName) {
		// Username match exists — user must prove they own the Nexus account
		const nexusPassword = formData.get('nexusPassword') as string;
		if (!nexusPassword) {
			return fail(409, {
				error: 'account_exists',
				message: `A Nexus account "${username}" already exists. Enter your Nexus password to link it.`,
				serviceId, username, needsNexusPassword: true
			});
		}
		if (!verifyPassword(nexusPassword, byName.passwordHash)) {
			return fail(401, { error: 'Wrong Nexus password', serviceId, username, needsNexusPassword: true });
		}
		user = byName;
	}
}

// If still no user, create a new Nexus account
if (!user) {
	const requiresApproval = getSetting('registration_requires_approval') === 'true';
	const status = requiresApproval ? 'pending' : 'active';
	const userId = createUser(username, extCred.externalUsername ?? username, password, false, {
		authProvider: config.type,
		externalId: extCred.externalUserId,
		status
	});
	user = getUserById(userId);
}

// Link the service credential (triggers derived auto-linking)
upsertUserCredential(user!.id, serviceId, {
	accessToken: extCred.accessToken,
	externalUserId: extCred.externalUserId,
	externalUsername: extCred.externalUsername
});

// Create session
const token = createSession(user!.id);
cookies.set('nexus_session', token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 2_592_000 });

if (user!.status === 'pending') throw redirect(302, '/pending-approval');
if (user!.forcePasswordReset) throw redirect(302, '/reset-password');
throw redirect(302, next || '/');
```

- [ ] **Step 2: Update login page UI**

In `src/routes/login/+page.svelte`, add service auth buttons above or below the local login form:

```svelte
<script lang="ts">
	let { data, form } = $props();
	let authMode = $state<'local' | 'service'>('local');
	let selectedService = $state<string | null>(null);
	let needsNexusPassword = $state(false);

	// If form came back with account_exists error, show Nexus password field
	$effect(() => {
		if (form?.needsNexusPassword) {
			needsNexusPassword = true;
			selectedService = form.serviceId;
			authMode = 'service';
		}
	});
</script>

{#if data.authServices.length > 0}
	<div class="auth-services">
		{#each data.authServices as svc}
			<button
				type="button"
				class="service-auth-btn"
				onclick={() => { authMode = 'service'; selectedService = svc.id; }}
			>
				Sign in with {svc.name}
			</button>
		{/each}
	</div>
	<div class="divider"><span>or</span></div>
{/if}

{#if authMode === 'service' && selectedService}
	<form method="POST">
		<input type="hidden" name="authType" value="service" />
		<input type="hidden" name="serviceId" value={selectedService} />
		<label>
			Username
			<input name="username" required value={form?.username ?? ''} />
		</label>
		<label>
			Password
			<input name="password" type="password" required />
		</label>
		{#if needsNexusPassword}
			<p class="link-notice">A Nexus account with this username already exists. Enter your Nexus password to link it.</p>
			<label>
				Nexus Password
				<input name="nexusPassword" type="password" required />
			</label>
		{/if}
		<button type="submit">Sign In</button>
	</form>
{:else}
	<!-- Existing local login form -->
{/if}
```

Style the service auth buttons to match the existing design system (dark surface, accent border, etc.).

- [ ] **Step 3: Verify login works locally**

Start dev server, navigate to `/login`. Verify:
- Service auth buttons appear for each connected Jellyfin/Plex service
- Clicking one shows the service credential form
- Submitting authenticates against the service
- New Nexus account created if needed
- Existing account linked if username matches and Nexus password provided

- [ ] **Step 4: Commit**

```bash
git add src/routes/login/+page.server.ts src/routes/login/+page.svelte
git commit -m "feat(auth): add Jellyfin/Plex authentication to login flow"
```

---

## Task 6: Jellyfin/Plex Authentication on Register and Invite

**Files:**
- Modify: `src/routes/register/+page.server.ts`
- Modify: `src/routes/register/+page.svelte`
- Modify: `src/routes/invite/+page.server.ts`
- Modify: `src/routes/invite/+page.svelte`

- [ ] **Step 1: Add service auth to register server**

Apply the same pattern as the login server action from Task 5 to `src/routes/register/+page.server.ts`. The key difference: registration always creates a new account (no existing-user lookup needed, since this is explicitly the register page). The Jellyfin/Plex credentials are linked on creation.

When `formData.get('authType') === 'service'`:
- Authenticate against the external service
- Check if a Nexus account already exists with this external credential → if so, redirect to `/login` with a message
- Create the Nexus user with `authProvider: config.type`
- Link the credential via `upsertUserCredential` (triggers derived linking)
- Create session, redirect

Also add `authServices` to the load function return (same pattern as login).

- [ ] **Step 2: Update register page UI**

Same pattern as login: add service auth buttons, service credential form, divider. Reuse the same visual style.

- [ ] **Step 3: Add service auth to invite server**

Same pattern applied to `src/routes/invite/+page.server.ts`. The invite code is still validated and consumed. The only addition is the Jellyfin/Plex auth path alongside local registration.

Also add `authServices` to the load function return.

- [ ] **Step 4: Update invite page UI**

Same button + form pattern as login/register.

- [ ] **Step 5: Verify all three paths work**

Test each path:
- `/register` with Jellyfin/Plex auth → creates account + links credential
- `/invite?code=xxx` with Jellyfin/Plex auth → creates account + links credential + consumes invite
- `/login` with Jellyfin/Plex auth for existing user → logs in
- `/login` with Jellyfin/Plex auth for new user → creates account + links credential

- [ ] **Step 6: Commit**

```bash
git add src/routes/register/ src/routes/invite/
git commit -m "feat(auth): add Jellyfin/Plex authentication to register and invite flows"
```

---

## Task 7: Redesign Settings Accounts Page

**Files:**
- Modify: `src/routes/settings/accounts/+page.server.ts`
- Modify: `src/routes/settings/accounts/+page.svelte`

- [ ] **Step 1: Update server to return richer linking data**

In `src/routes/settings/accounts/+page.server.ts`, return for each service:
- Service config (id, name, type)
- Current credential status (linked/not linked, managed, linkedVia)
- Adapter capabilities (userLinkable, derivedFrom, parentRequired, has createUser)
- Whether parent is linked (for derived services)

```typescript
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentials, getUserCredentialForService } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { services: [] };

	const configs = getEnabledConfigs();
	const creds = getUserCredentials(locals.user.id);
	const credMap = new Map(creds.map(c => [c.serviceId, c]));

	const services = configs
		.map(config => {
			const adapter = registry.get(config.type);
			if (!adapter) return null;

			const cred = credMap.get(config.id);
			const isLinked = !!(cred?.accessToken || cred?.externalUserId);

			// Check if parent is linked (for derived services)
			let parentLinked = false;
			let parentServiceName: string | null = null;
			if (adapter.derivedFrom) {
				for (const parentType of adapter.derivedFrom) {
					const parentConfig = configs.find(c => c.type === parentType);
					if (parentConfig) {
						const parentCred = credMap.get(parentConfig.id);
						if (parentCred?.accessToken || parentCred?.externalUserId) {
							parentLinked = true;
							parentServiceName = parentConfig.name;
							break;
						}
					}
				}
			}

			return {
				id: config.id,
				name: config.name,
				type: config.type,
				userLinkable: adapter.userLinkable ?? false,
				derivedFrom: adapter.derivedFrom ?? null,
				parentRequired: adapter.parentRequired ?? false,
				canCreateUser: typeof adapter.createUser === 'function',
				canAuthenticate: typeof adapter.authenticateUser === 'function',
				isLinked,
				managed: cred?.managed ?? false,
				linkedVia: cred?.linkedVia ?? null,
				externalUsername: cred?.externalUsername ?? null,
				parentLinked,
				parentServiceName
			};
		})
		.filter(Boolean)
		.filter(s => s!.userLinkable || s!.derivedFrom);

	return { services };
};
```

- [ ] **Step 2: Redesign the accounts page UI**

Rewrite `src/routes/settings/accounts/+page.svelte` with three states per service:

```svelte
{#each data.services as svc}
	<div class="service-card" class:linked={svc.isLinked}>
		<div class="service-header">
			<span class="service-name">{svc.name}</span>
			{#if svc.isLinked}
				{#if svc.managed}
					<span class="badge managed">Managed by Nexus</span>
				{:else if svc.linkedVia}
					<span class="badge derived">Linked via {svc.linkedVia}</span>
				{:else}
					<span class="badge linked">{svc.externalUsername}</span>
				{/if}
			{/if}
		</div>

		<div class="service-actions">
			{#if svc.isLinked}
				<button onclick={() => unlinkService(svc.id, svc.managed, svc.linkedVia)}>
					Unlink
				</button>
			{:else if svc.derivedFrom && svc.parentRequired}
				{#if svc.parentLinked}
					<p class="status-msg">Auto-linking failed. Your {svc.parentServiceName} account wasn't found in {svc.name}. Ask your admin to add you.</p>
					<button onclick={() => retryDerivedLink(svc.id)}>Retry</button>
				{:else}
					<p class="status-msg">Requires {svc.derivedFrom.join(' or ')}. <a href="#" onclick|preventDefault={() => scrollToParent(svc.derivedFrom)}>Set it up first.</a></p>
				{/if}
			{:else if svc.derivedFrom && !svc.parentRequired}
				{#if svc.parentLinked}
					<p class="status-msg">Auto-link didn't find your account.</p>
				{/if}
				<!-- Fall through to manual options -->
				{#if svc.canAuthenticate}
					<button onclick={() => openLinkModal(svc.id, svc.name)}>Link existing account</button>
				{/if}
				{#if svc.canCreateUser}
					<button onclick={() => createManagedAccount(svc.id)}>
						Create managed account
					</button>
					<p class="help-text">Nexus will create and manage an account on {svc.name} for you. You won't need to log into {svc.name} directly.</p>
				{/if}
			{:else}
				<!-- Standard linkable service (not derived) -->
				{#if svc.canAuthenticate}
					<button onclick={() => openLinkModal(svc.id, svc.name)}>Link existing account</button>
				{/if}
				{#if svc.canCreateUser}
					<button onclick={() => createManagedAccount(svc.id)}>
						Create managed account
					</button>
					<p class="help-text">Nexus will create and manage an account on {svc.name} for you. You won't need to log into {svc.name} directly.</p>
				{/if}
			{/if}
		</div>
	</div>
{/each}
```

Add a modal for "Link existing account" that collects username/password and POSTs to `/api/user/credentials`.

Add an unlink confirmation dialog that warns about derived service cascade when unlinking a parent.

- [ ] **Step 3: Implement client-side actions**

```typescript
async function unlinkService(serviceId: string, managed: boolean, linkedVia: string | null) {
	const msg = managed
		? 'This will delete your managed account on the service. Continue?'
		: linkedVia
			? 'This was linked automatically and will need to be re-linked. Continue?'
			: 'Unlink this service?';

	// Check if any derived services are linked through this one
	const derivedLinked = data.services.filter(s => s.linkedVia === data.services.find(x => x.id === serviceId)?.type && s.isLinked);
	if (derivedLinked.length > 0) {
		const names = derivedLinked.map(s => s.name).join(', ');
		if (!confirm(`This will also unlink: ${names}. Continue?`)) return;
	} else if (!confirm(msg)) return;

	await fetch(`/api/user/credentials?serviceId=${serviceId}`, { method: 'DELETE' });
	location.reload();
}

async function createManagedAccount(serviceId: string) {
	const res = await fetch(`/api/user/credentials/${serviceId}/managed`, { method: 'POST' });
	if (!res.ok) {
		const err = await res.json();
		alert(err.error ?? 'Failed to create managed account');
		return;
	}
	location.reload();
}
```

- [ ] **Step 4: Style to match existing design system**

Use the existing Nexus dark theme variables (`--color-surface`, `--color-cream`, `--color-accent`, `--color-muted`, etc.). Service cards should look consistent with the rest of settings.

- [ ] **Step 5: Verify in browser**

Navigate to `/settings/accounts`. Verify:
- Linked services show correct badge (username, "Managed by Nexus", or "Linked via X")
- Unlinked services show appropriate options based on adapter capabilities
- Derived services with no parent show "Requires X" message
- Link modal works, managed account creation works, unlink works

- [ ] **Step 6: Commit**

```bash
git add src/routes/settings/accounts/
git commit -m "feat(settings): redesign accounts page with managed accounts and derived service states"
```

---

## Task 8: Managed Account Creation API

**Files:**
- Create: `src/routes/api/user/credentials/[serviceId]/managed/+server.ts`

- [ ] **Step 1: Create the managed account endpoint**

```typescript
import { json, error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService, upsertUserCredential } from '$lib/server/auth';
import { getUserById } from '$lib/server/auth';
import { randomBytes } from 'crypto';
import type { RequestHandler } from './$types';

/** POST: Create a Nexus-managed account on an external service */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);

	const { serviceId } = params;
	const config = getServiceConfig(serviceId);
	if (!config) throw error(404, 'Service not found');

	const adapter = registry.get(config.type);
	if (!adapter?.createUser) throw error(400, 'Service does not support account creation');

	// Check if already linked
	const existing = getUserCredentialForService(locals.user.id, serviceId);
	if (existing?.accessToken || existing?.externalUserId) {
		throw error(409, 'Already linked to this service');
	}

	const user = getUserById(locals.user.id);
	if (!user) throw error(401);

	// Generate a managed password the user never sees
	const managedPassword = randomBytes(24).toString('base64url');

	try {
		const result = await adapter.createUser(config, user.username, managedPassword);
		upsertUserCredential(locals.user.id, serviceId, {
			accessToken: result.accessToken,
			externalUserId: result.externalUserId,
			externalUsername: result.externalUsername
		}, { managed: true });

		return json({ success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to create account';
		throw error(500, msg);
	}
};
```

- [ ] **Step 2: Verify the endpoint**

```bash
pnpm build 2>&1 | tail -5
```

Expected: builds without errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/user/credentials/[serviceId]/managed/
git commit -m "feat(api): add managed account creation endpoint"
```

---

## Task 9: Update Credential API for managed/linkedVia

**Files:**
- Modify: `src/routes/api/user/credentials/+server.ts`

- [ ] **Step 1: Return managed and linkedVia in GET response**

In the GET handler, update the select/map to include `managed` and `linkedVia` fields from the database row:

```typescript
// In the GET response mapping, add:
managed: row.managed ?? false,
linkedVia: row.linkedVia ?? null,
```

- [ ] **Step 2: Handle unlink cascade for derived services**

In the DELETE handler, after removing the credential, check if any derived services were linked through this service type and unlink them:

```typescript
// After deleteUserCredential(userId, serviceId):
const config = getServiceConfig(serviceId);
if (config) {
	// Find credentials linked via this service type and remove them
	const allCreds = getUserCredentials(userId);
	for (const cred of allCreds) {
		if (cred.linkedVia === config.type) {
			deleteUserCredential(userId, cred.serviceId);
		}
	}
}
```

Also, for managed accounts, call `adapter.deleteUser` if available before removing the credential:

```typescript
const existing = getUserCredentialForService(userId, serviceId);
if (existing?.managed) {
	const adapter = registry.get(config.type);
	if (adapter?.deleteUser && existing.externalUserId) {
		try {
			await adapter.deleteUser(config, existing.externalUserId);
		} catch { /* best effort */ }
	}
}
```

- [ ] **Step 3: Update getUserCredentials in auth.ts to return managed/linkedVia**

Make sure `getUserCredentials` returns the new columns. Update the select query to include `managed` and `linkedVia`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/user/credentials/+server.ts src/lib/server/auth.ts
git commit -m "feat(api): return managed/linkedVia in credentials, add unlink cascade"
```

---

## Task 10: Admin User Management

**Files:**
- Create or modify: `src/routes/api/admin/users/+server.ts`
- Modify: `src/routes/admin/users/+page.svelte` (or its component)

- [ ] **Step 1: Add admin create-user endpoint**

Create/update `src/routes/api/admin/users/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit';
import { createUser } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/** POST: Admin creates a local user with temp password + force reset */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) throw error(403);

	const { username, displayName, password } = await request.json();
	if (!username || !displayName || !password) throw error(400, 'username, displayName, and password required');

	try {
		const userId = createUser(username, displayName, password, false, {
			status: 'active',
			forcePasswordReset: true
		});
		return json({ userId, username });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to create user';
		throw error(400, msg);
	}
};
```

- [ ] **Step 2: Check if createUser supports forcePasswordReset option**

In `src/lib/server/auth.ts`, verify that `createUser` accepts `forcePasswordReset` in its options parameter. If not, add it:

```typescript
export function createUser(
	username: string,
	displayName: string,
	password: string,
	isAdmin: boolean,
	opts?: { authProvider?: string; externalId?: string; status?: string; forcePasswordReset?: boolean }
): string {
	// ... existing code ...
	// Add forcePasswordReset to the insert:
	const forcePasswordReset = opts?.forcePasswordReset ? 1 : 0;
	// Include in INSERT statement
}
```

- [ ] **Step 3: Add "Create User" button to admin users page**

In the admin users page component, add a simple form/modal:

```svelte
<button onclick={() => showCreateModal = true}>Create User</button>

{#if showCreateModal}
	<div class="modal">
		<h3>Create Local User</h3>
		<p class="help-text">User will be required to set a new password on first login.</p>
		<input bind:value={newUsername} placeholder="Username" />
		<input bind:value={newDisplayName} placeholder="Display Name" />
		<input bind:value={newTempPassword} type="password" placeholder="Temporary Password" />
		<button onclick={createLocalUser}>Create</button>
		<button onclick={() => showCreateModal = false}>Cancel</button>
	</div>
{/if}
```

- [ ] **Step 4: Verify admin page**

Navigate to `/admin/users`. Verify:
- User list shows all users with status and linked services
- "Create User" opens form
- Created user appears in list with `forcePasswordReset` flag
- Created user can log in and is forced to `/reset-password`

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/admin/users/ src/routes/admin/users/ src/lib/server/auth.ts
git commit -m "feat(admin): add create local user with forced password reset"
```

---

## Task 11: Homepage Nudge for Unlinked Services

**Files:**
- Modify: `src/routes/+layout.server.ts` or `src/routes/+page.server.ts`
- Modify: `src/routes/+page.svelte` (or homepage layout)

- [ ] **Step 1: Compute unlinked service count in layout/page server**

In the homepage server load, add a count of services that could be linked but aren't:

```typescript
const unlinkableCount = getEnabledConfigs()
	.filter(config => {
		const adapter = registry.get(config.type);
		if (!adapter?.userLinkable && !adapter?.derivedFrom) return false;
		const cred = getUserCredentialForService(userId, config.id);
		return !(cred?.accessToken || cred?.externalUserId);
	}).length;

// Return in data:
return { ..., unlinkedServiceCount: unlinkableCount };
```

- [ ] **Step 2: Add dismissable banner to homepage**

In the homepage svelte file, above the main content:

```svelte
{#if data.unlinkedServiceCount > 0 && !dismissed}
	<div class="nudge-banner">
		<p>
			{data.unlinkedServiceCount} service{data.unlinkedServiceCount > 1 ? 's' : ''} not linked yet.
			<a href="/settings/accounts">Set up your accounts</a> to unlock more features.
		</p>
		<button onclick={() => dismissed = true} aria-label="Dismiss">x</button>
	</div>
{/if}
```

Style it subtle — not a blocking modal, just a small banner at the top.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.server.ts src/routes/+page.svelte
git commit -m "feat(ui): add homepage nudge for unlinked services"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm check 2>&1 | tail -5
pnpm build 2>&1 | tail -5
pnpm test 2>&1 | tail -10
```

All three must pass.

- [ ] **Step 2: Manual smoke test**

Wipe DB and test these flows:
1. Fresh setup → create admin → add Jellyfin/Plex service
2. Log out → log back in with Jellyfin credentials → account linked
3. New user registers with Jellyfin credentials → new account + linked
4. New user registers locally → links Jellyfin in settings → Overseerr auto-links
5. Settings page → create managed account on Calibre/RomM
6. Settings page → unlink Jellyfin → derived services also unlinked
7. Admin creates local user → user forced to reset password on first login
8. Homepage nudge appears for unlinked services, dismisses correctly

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final adjustments from onboarding redesign smoke test"
```

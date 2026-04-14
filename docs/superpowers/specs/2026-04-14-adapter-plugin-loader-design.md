# Nexus Adapter Plugin Loader — Design

**Date:** 2026-04-14
**Scope:** How adapter plugins are discovered, loaded, versioned, and registered at Nexus boot. Enables third-party adapters as external npm packages without forking Nexus core. Defines the SDK surface and contract-versioning semantics that keep plugins compatible across Nexus upgrades.
**Status:** Proposed, pending Parker approval.
**Depends on:** [`2026-04-14-adapter-contract-design.md`](./2026-04-14-adapter-contract-design.md) (approved)
**Tracking:** ProjectOS Nexus #2 — *Pluggable adapter architecture*.

## Problem

The existing registry (`src/lib/adapters/registry.ts`) is a hand-maintained map of hardcoded adapter imports. Every new adapter ships as a core PR, making the in-tree adapter count the de facto limit on Nexus's service coverage. The Nexus backlog has 13 unimplemented adapter requests (issues #27–#53) and awesome-arr lists dozens more relevant tools.

Parker's goal (2026-04-14): **make adapters pluggable so third parties can ship them as external npm packages.** This spec defines the loader that makes that possible.

The loader has to:

1. Discover and load adapter plugins at Nexus boot without hardcoded imports
2. Enforce the adapter contract version — old plugins stay compatible when the contract evolves
3. Handle broken plugins gracefully (log and skip, never crash boot)
4. Expose a stable SDK package that plugin authors consume
5. Not require Parker to restart Nexus every time a plugin is enabled/disabled (stretch goal)
6. Not require sandboxing in v1 — plugins are trusted code like VS Code extensions
7. Support both in-tree core adapters AND external plugin adapters uniformly

## Architecture

### Plugin shape

A Nexus adapter plugin is an npm package that exports a default `NexusAdapter` object implementing the contract. Example minimal package:

```
@nexus-adapter/radarr/
  package.json           # name, version, "nexus" field with metadata
  dist/
    index.js             # CommonJS or ESM entry
    index.d.ts           # types
  src/
    index.ts             # exports default adapter
  README.md
```

**`package.json` metadata block:**

```json
{
  "name": "@nexus-adapter/radarr",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "nexus": {
    "adapter": true,
    "contractVersion": 1,
    "displayName": "Radarr",
    "id": "radarr",
    "minNexusVersion": "0.1.0",
    "maxNexusVersion": null
  },
  "peerDependencies": {
    "@nexus/adapter-sdk": "^1.0.0"
  }
}
```

**`src/index.ts`** exports a default-exported adapter:

```ts
import type { NexusAdapter } from '@nexus/adapter-sdk';

const radarrAdapter: NexusAdapter = {
  id: 'radarr',
  displayName: 'Radarr',
  // ... full contract implementation
};

export default radarrAdapter;
```

### The `@nexus/adapter-sdk` package

New package published alongside Nexus core. Ships:

- All types from `src/lib/adapters/contract.ts` — `NexusAdapter`, `AdapterCapabilities`, `AdapterAuthCapabilities`, `AdapterAuthError`, `LinkedParentContext`, etc.
- The `ADAPTER_CONTRACT_VERSION` constant
- Helper functions for common patterns: fetch wrappers, error mapping, URL building
- `declareAdapter<T extends NexusAdapter>(adapter: T): T` — identity function that gives better IDE autocomplete
- **No runtime dependency on Nexus core** — plugins can be written and tested in isolation

The SDK lives in `packages/nexus-adapter-sdk/` in the Nexus monorepo (or as a separate repo if Nexus isn't a monorepo yet — if not, this spec triggers the monorepo conversion). Published to npm as `@nexus/adapter-sdk`. Versioned independently from Nexus core but following the contract version.

**Versioning rule:** `@nexus/adapter-sdk` major version === `ADAPTER_CONTRACT_VERSION`. When the contract breaks, the SDK bumps major. Plugins declare a peer-dep range that matches the contract versions they support (`^1.0.0` for contract v1, `>=1.0.0 <3.0.0` for plugins that support both v1 and v2).

### Discovery

Nexus boots and discovers plugins via three mechanisms, checked in order:

1. **In-tree adapters** (`src/lib/adapters/*.ts`) — loaded first. These are the existing adapters post-migration and serve as the reference implementation. Loaded via static imports the registry already knows about. Treated identically to external plugins from the loader's point of view.

2. **Installed npm packages matching `@nexus-adapter/*`** — the loader reads `package.json` dependencies + devDependencies, filters for scoped packages matching the pattern, and loads each one. This is the primary mechanism for external plugins.

3. **User-dropped packages in `nexus-plugins/`** — a directory (configurable via env var `NEXUS_PLUGIN_DIR`) where users can drop unpacked plugin packages for testing. Each subdirectory is treated as a local npm package. Useful for plugin development without npm publish.

The loader reads each discovered plugin's `package.json`, validates the `nexus` metadata block, then dynamically imports the entry point.

### Loading

```ts
// src/lib/adapters/registry/loader.ts

export interface LoadedPlugin {
  source: 'in-tree' | 'npm' | 'local';
  packageName: string;
  version: string;
  adapter: NexusAdapter;
  loadedAt: Date;
}

export interface PluginLoadError {
  packageName: string;
  source: 'in-tree' | 'npm' | 'local';
  error: Error;
  reason: 'missing-metadata' | 'contract-mismatch' | 'version-mismatch' | 'import-failed' | 'invalid-shape';
}

export async function loadAllPlugins(): Promise<{
  loaded: LoadedPlugin[];
  errors: PluginLoadError[];
}>;
```

**Loading sequence:**

1. Enumerate candidates from all three discovery mechanisms.
2. For each candidate:
   a. Read and validate its `nexus` metadata block. Skip with `missing-metadata` error if absent.
   b. Check `contractVersion` matches `ADAPTER_CONTRACT_VERSION`. Skip with `contract-mismatch` error if not. (Compat shims for older versions come later; see below.)
   c. Check `minNexusVersion` / `maxNexusVersion` against running Nexus version. Skip with `version-mismatch` error if out of range.
   d. Dynamically import the entry point. Catch any throw as `import-failed`.
   e. Validate the imported default export is a well-formed `NexusAdapter` object (required fields present, `capabilities` well-typed). Skip with `invalid-shape` error if not.
   f. If the adapter's `id` collides with one already loaded, log and skip — first-loaded wins. (In-tree adapters are loaded first, so core adapters always beat duplicate plugins.)
3. Register each successfully-loaded adapter in the registry.
4. Return the full result set so boot logging can show both successes and failures.

**Graceful failure:** a broken plugin never crashes Nexus boot. The loader logs the error, skips the plugin, and continues. The admin UI surfaces the failure in `/admin/services` as *"Plugin X failed to load: [reason]"* with a retry button.

### Contract versioning and compat shims

`ADAPTER_CONTRACT_VERSION = 1` for the v1 release. When the contract evolves (say, v2 adds new required methods), we have two options:

1. **Hard break** — plugins declaring `contractVersion: 1` are refused to load on a Nexus running contract v2. Users must upgrade the plugin before upgrading Nexus.
2. **Compat shim** — Nexus ships a translation layer for v1 → v2 that fills in default implementations for new methods. Plugins keep working without updates.

**v1 strategy:** always hard-break with clear error messages. The compat-shim layer is stubbed but not implemented — it's a pattern the loader supports, not a contract Nexus commits to maintaining. When v2 ships, Parker decides per-change whether to shim or break.

**Loader provides the extension point:**

```ts
// src/lib/adapters/registry/compat.ts

export type CompatShim = (rawPluginExport: unknown) => NexusAdapter;

export const compatShims: Record<number, CompatShim> = {
  // 0: (old) => shim0to1(old),   // someday
};
```

A shim takes the raw default export of an older plugin and returns a current-contract-compliant `NexusAdapter`. Not wired in v1 but stubbed for future use.

### In-tree adapter loading (existing adapters)

In-tree adapters (`src/lib/adapters/jellyfin.ts` etc.) need to work with the same loader. Rather than hand-enumerate them in a static map, the loader scans `src/lib/adapters/*.ts` at build time (via Vite's `import.meta.glob`) and registers each default export.

```ts
// src/lib/adapters/registry/in-tree.ts

const modules = import.meta.glob('../*.ts', { eager: true }) as Record<string, { default: NexusAdapter }>;

export function loadInTreeAdapters(): LoadedPlugin[] {
  return Object.entries(modules)
    .filter(([path]) => !path.includes('registry') && !path.includes('types') && !path.includes('contract'))
    .map(([path, mod]) => ({
      source: 'in-tree' as const,
      packageName: path.split('/').pop()!.replace('.ts', ''),
      version: process.env.NEXUS_VERSION ?? 'dev',
      adapter: mod.default,
      loadedAt: new Date()
    }));
}
```

The import-glob pattern runs at build time, so adding a new in-tree adapter means dropping a file in `src/lib/adapters/` and restarting dev — no registry edits. Same ergonomic improvement that npm packages get, just for core adapters.

### Runtime state

```ts
// src/lib/adapters/registry/index.ts

const registry = new Map<string, NexusAdapter>();
const loadedPlugins: LoadedPlugin[] = [];
const loadErrors: PluginLoadError[] = [];

export async function initialize(): Promise<void> {
  const inTree = loadInTreeAdapters();
  for (const plugin of inTree) {
    registry.set(plugin.adapter.id, plugin.adapter);
    loadedPlugins.push(plugin);
  }

  const external = await loadExternalPlugins();
  for (const plugin of external.loaded) {
    if (registry.has(plugin.adapter.id)) {
      logger.warn(`Plugin ${plugin.packageName} tried to register duplicate adapter id '${plugin.adapter.id}', skipped.`);
      continue;
    }
    registry.set(plugin.adapter.id, plugin.adapter);
    loadedPlugins.push(plugin);
  }
  loadErrors.push(...external.errors);
}

export function get(type: string): NexusAdapter | undefined {
  return registry.get(type);
}

export function list(): NexusAdapter[] {
  return Array.from(registry.values());
}

export function listLoaded(): LoadedPlugin[] {
  return [...loadedPlugins];
}

export function listErrors(): PluginLoadError[] {
  return [...loadErrors];
}
```

`initialize()` is called once at Nexus boot from the main server entry point. Idempotent — calling it again is a no-op (useful for hot-reload scenarios).

### Hot-reload (stretch goal)

v1 loads plugins at boot and requires a restart to pick up changes. v2 could support hot-reload:

```ts
export async function reloadPlugin(packageName: string): Promise<LoadedPlugin | PluginLoadError>;
export async function unloadPlugin(packageName: string): Promise<void>;
```

Requires clearing the module from Node's require cache, unregistering from the registry, and restarting any adapter-scoped background jobs (polling loops, cache invalidations). Not in v1 scope — mentioned for forward-compatibility.

### Admin UI for plugin management

`/admin/services` gets a new section: **Installed plugins**. Shows each loaded plugin with:

- Package name, version, source (in-tree / npm / local)
- Adapter ID, display name
- Load status (OK / Error)
- Action: Disable (sets a flag in the DB so the plugin is skipped on next boot), Reload (v2), View errors

A separate **Failed plugins** section lists `PluginLoadError` entries with the specific failure reason and a retry button.

**Plugin disable:**

```sql
CREATE TABLE disabled_plugins (
  package_name  TEXT PRIMARY KEY,
  disabled_at   TEXT NOT NULL,
  reason        TEXT
);
```

On boot, the loader reads `disabled_plugins` and skips any matching package. Admins can re-enable from the UI.

## Security

Plugins are **trusted code**, same as VS Code extensions. Users who install a plugin are implicitly trusting its author. No sandboxing in v1.

**Specific risks admins should know about:**

- A plugin can read/write the Nexus DB (via Drizzle imports)
- A plugin can make arbitrary outbound HTTP requests from the server
- A plugin sees admin credentials from `ServiceConfig` when called
- A plugin can log whatever it wants

**Mitigations in v1:**

- Plugin source must be visible at a public URL (npm package or GitHub repo)
- Admin UI shows the package name + version prominently when a plugin is loaded
- Nexus documentation includes a "security note for plugin authors and users" page
- Compromise of a plugin compromises the whole Nexus install — users should audit plugins they install

**Out of scope for v1** (future concerns):

- Process isolation / worker threads
- Capability-based permission model (plugin declares what it needs, Nexus gates)
- Signature verification (npm registry doesn't do this well)
- Review queue for community-published plugins

## SDK package layout

```
packages/nexus-adapter-sdk/
  package.json
  src/
    index.ts              # re-exports everything below
    contract.ts           # NexusAdapter, AdapterCapabilities, etc. (copied from Nexus core)
    errors.ts             # AdapterAuthError
    helpers/
      fetch.ts            # Basic auth, token auth, session cookie helpers
      errors.ts           # Error-mapping helpers (HTTP status → AdapterAuthError.kind)
      normalize.ts        # UnifiedMedia construction helpers
  tests/
    contract.test.ts      # Sanity checks on the contract types
  README.md               # Plugin authoring guide
```

**`packages/nexus-adapter-sdk/src/contract.ts`** is kept in sync with `src/lib/adapters/contract.ts` via a build step — there's only one source of truth; the SDK copy is generated. Divergence would be a bug.

### Plugin authoring guide (ships with the SDK README)

The SDK README walks through writing a new plugin end-to-end. Template structure:

1. Install `@nexus/adapter-sdk` as a peer dependency
2. Create a `NexusAdapter` object implementing the contract
3. Add the `nexus` metadata block to your `package.json`
4. Publish to npm with the `@nexus-adapter/*` scope (or keep it private/local)
5. Users install it via `npm install @nexus-adapter/your-service` in their Nexus install
6. Restart Nexus; your adapter appears in the registry

A scaffolding CLI (`npx create-nexus-adapter my-service`) is mentioned as a stretch goal, not a v1 deliverable.

## Testing

1. **Loader unit tests** (vitest):
   - Valid plugin loads successfully
   - Missing `nexus` metadata → `missing-metadata` error
   - Mismatched contract version → `contract-mismatch` error
   - Import throws → `import-failed` error
   - Exported object missing required fields → `invalid-shape` error
   - Duplicate adapter ID → second one skipped
2. **Discovery tests**:
   - In-tree adapters all discovered via `import.meta.glob`
   - `@nexus-adapter/*` packages in `node_modules` discovered
   - `NEXUS_PLUGIN_DIR` directory scanning
   - Disabled plugins (via DB) skipped
3. **End-to-end**:
   - Install a real plugin in the test fixture, verify it ends up in the registry
   - Disable it, restart, verify it's skipped
   - Re-enable, restart, verify it's loaded again
4. **Admin UI tests** (playwright):
   - "Installed plugins" section renders the loaded list
   - "Failed plugins" section renders errors
   - Disable/re-enable action works

## Migration path — what changes in the existing registry

Today's `src/lib/adapters/registry.ts` is 80 lines of static map construction. The rework:

1. Move the type definitions (`NexusAdapter`, `AdapterCapabilities`, etc.) from wherever they live into `src/lib/adapters/contract.ts` (established by the contract spec).
2. Rename `src/lib/adapters/registry.ts` → `src/lib/adapters/registry/index.ts` and add the sibling files (`loader.ts`, `in-tree.ts`, `compat.ts`).
3. Replace the hand-maintained adapter import map with `import.meta.glob`-driven auto-discovery.
4. Add the boot-time `initialize()` call in the server entry point.
5. Add the `nexus` metadata block to each in-tree adapter's exported object (or derive from a lookup, if adding per-adapter metadata is too invasive).
6. Ship the `@nexus/adapter-sdk` package from `packages/nexus-adapter-sdk/` — new monorepo directory if Nexus isn't a monorepo yet.

**In-tree adapters don't need to be rewritten**, just touched to match the new registration mechanism. Zero runtime behavior changes for any existing adapter.

## Out of scope

- **Hot-reload** of plugins without Nexus restart (v2)
- **Process isolation** / sandboxing (v2 — if/when plugin ecosystem matures enough to need it)
- **Plugin marketplace** / in-app browse/install UI (v2 — admin UI just shows what's already installed in v1)
- **Community plugin review / signing** (v2)
- **Scaffolding CLI** (`create-nexus-adapter`) (stretch)
- **Plugin capability gating** (plugin declares what it needs, Nexus enforces) (v2)
- **Per-user plugin enable/disable** — plugins are install-wide only

## Parker decisions baked in

- **Pluggable = external npm packages** (Parker, 2026-04-14)
- **v1 in-tree adapters + v2 external plugins** — this spec does both simultaneously by treating them uniformly through the loader
- **Contract version matches SDK major version** — clean versioning story
- **No sandboxing in v1** — plugins are trusted code, VS-Code-extension model

## Open questions

*None that need pre-implementation resolution. Some implementation-time items:*
- Whether the SDK ships as a separate git repo or lives in a monorepo directory — probably monorepo for ease of keeping contract types in sync, but defer until the refactor lands.
- Whether `nexus-plugins/` local directory gets a convention (`nexus-plugins/my-plugin/package.json`) or something more opinionated. Defer to implementation taste.

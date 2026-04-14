# Calibre-Web Adapter Rewrite — Design

**Date:** 2026-04-13
**Scope:** `src/lib/adapters/calibre.ts` — full rewrite.
**Status:** Proposed, pending Parker approval.

## Problem

The current Calibre adapter is brittle. It uses Calibre-Web's Flask session-cookie login flow (`/login` → CSRF → POST → 302 → session cookie) for *everything* — reads, writes, metadata, downloads, cover proxying. A half-finished hardening pass sits in `git stash` (cookie jar, follow-redirect, session validation via `/ajax/listbooks`, auto-retry on expired session).

The root problem isn't that the session-cookie flow is bad. It's that **it's the wrong tool for the read path**. Every read re-authenticates against an endpoint that:

- Requires a CSRF token that rotates
- Returns HTML-login-page-with-200 instead of 401 when session expires (silent failure)
- Strips critical metadata (empirically confirmed: `ratings`, `pubdate`, `timestamp`, `last_modified` all come back as empty strings from `/ajax/listbooks`)
- Has a very limited `sort` parameter (only `sort`, `title`, `authors_sort`, `series_index`, `tags`, `series`, `publishers`, `authors`, `languages` are honored — anything else falls through to `timestamp desc`; the current adapter uses `sort='id'` and `sort='last_modified'`, **both silently ignored**)
- Doesn't expose per-book format information (the current adapter *scrapes `/book/{id}` HTML* for download links — another failure surface)

Meanwhile, Calibre-Web exposes a rich **OPDS Atom catalog** that uses HTTP Basic auth, returns full metadata including formats with download URLs, and needs no CSRF dance.

## Empirical findings

All findings verified against `lscr.io/linuxserver/calibre-web:latest` running locally with a seeded 5-book library. Source line references are to Calibre-Web `0.6.x`-era code in the container (`/app/calibre-web/cps/*`).

### Auth surfaces

| Endpoint | Auth accepted | Notes |
|---|---|---|
| `/opds` and all subpaths | HTTP Basic *or* session cookie | `401` without auth. Clean, stable. |
| `/ajax/listbooks` | Session cookie only | Returns HTML login page (with 200) if cookie is stale — no 401. |
| `/ajax/toggleread/{id}` (POST) | Session cookie + `X-CSRFToken` header | 400 Bad Request without CSRF. |
| `/admin/user/new` (POST) | Session cookie + `csrf_token` form field + admin role | Standard Flask-WTF form. |
| `/download/{id}/{format}/{filename}` | Session cookie only | **Does not accept HTTP Basic** — redirects to `/login`. |
| `/opds/download/{id}/{format}/` | HTTP Basic | Works, returns the file with correct Content-Disposition. |
| `/cover/{id}` | Session cookie only | Redirects to `/login` with Basic. |
| `/opds/cover/{id}` | HTTP Basic | Returns image. |

**Implication:** OPDS routes are the only ones that accept Basic auth cleanly. Non-OPDS routes require a logged-in session.

### CSRF token sourcing (the hidden gotcha)

Calibre-Web's CSRF token is **not on the authed home page** by default. `layout.html:80` only renders `<input name="csrf_token">` inside `{% if current_user.role_upload() and g.allow_upload %}`. If uploads are disabled (default on fresh installs), the navbar has no token, and common pages don't render one either.

**Reliable source:** `GET /me` (user profile page) — always renders the csrf token in its form. Other candidates: `/admin/user/new`, `/book/edit/{id}`. The token is a Flask-WTF session-bound HMAC, stable across requests for the same session.

### OPDS Atom response shape

`GET /opds/new` (example, authed Basic):

```xml
<entry>
  <title>Project Hail Mary</title>
  <id>urn:uuid:597dde46-29d6-4be1-bda7-b88211b8aefb</id>
  <updated>2026-04-14T03:38:04+00:00</updated>
  <author><name>Andy Weir</name></author>
  <publisher><name>Ballantine</name></publisher>
  <published>2021-05-04T00:00:00+00:00</published>
  <dcterms:language>eng</dcterms:language>
  <category scheme="…" term="Recent" label="Recent"/>
  <category scheme="…" term="SciFi" label="SciFi"/>
  <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">
    RATING: ★★★★<br/>
    TAGS: Recent, SciFi<br/>
    <p>A lone astronaut must save humanity.</p>
  </div></content>
  <link rel="http://opds-spec.org/acquisition"
        href="/opds/download/5/epub/"
        length="30"
        title="EPUB"
        mtime="2026-04-14T03:38:04+00:00"
        type="application/epub+zip"/>
</entry>
```

**Every field the current adapter wants is here, and ratings/pubdate/formats are here but NOT in `/ajax/listbooks`.** Format discovery from OPDS acquisition links replaces HTML scraping of `/book/{id}` entirely. Multiple acquisition links appear when a book has multiple formats.

Cover links are also in the entry: `<link rel="http://opds-spec.org/image" href="/opds/cover/{id}"/>` and `<link rel="http://opds-spec.org/image/thumbnail" href="/opds/cover/{id}"/>`.

### OPDS pagination and enumeration

All book-listing OPDS routes use `?offset=N` query param with page size = `config_books_per_page` (default 60). Pagination metadata is rendered in the feed header as `rel="next"`/`rel="last"` links when applicable.

Notable routes:

- `/opds/books/letter/00?offset=N` — **all books**, sorted by `Books.sort`. "00" is the "all" alias; other letters filter by starting letter.
- `/opds/new?offset=N` — recently added, sorted by `Books.timestamp desc` (**true `recentlyAdded` semantics** — not available via listbooks).
- `/opds/rated?offset=N` — rating desc.
- `/opds/hot?offset=N` — popularity by download count.
- `/opds/discover` — random selection.
- `/opds/search/{query}?offset=N` — calibre search syntax (`title:foo`, `author:bar`, etc.).
- `/opds/author`, `/opds/series`, `/opds/category`, `/opds/publisher` — letter-drilled navigation (not ideal for programmatic enumeration; see below).

### Navigation feeds are letter-drilled

`/opds/author`, `/opds/series`, `/opds/category`, `/opds/publisher` all return **letter navigation entries** (`"A"`, `"B"`, …, `"All"→/opds/{kind}/letter/00`), not flat lists. To enumerate all series/authors/categories programmatically, we hit the `letter/00` subpath, which returns the flat list.

For building cross-book aggregations (series memberships, author→book mappings, tag→book mappings), it is **cheaper to walk `/opds/books/letter/00` once** and bucket client-side than to make N letter-drilled calls. The current adapter's `getCalibreSeries` / `getCalibreAuthors` / `getCalibreCategories` already do this (`fetchBooks(limit: 5000)`) — we'll keep that pattern but point it at OPDS.

### `/ajax/listbooks` — what it's still good for

Despite its gaps, `/ajax/listbooks` has value for **one thing**: the Calibre search-query syntax with richer field filters than `/opds/search`. But `/opds/search/<query>` also accepts Calibre search syntax (same backend: `calibre_db.get_search_results`). So we can drop `/ajax/listbooks` entirely from the read path.

### `/ajax/toggleread` behavior

The endpoint takes book_id in the URL, toggles the current user's `book_read_link` row, returns empty 200 on success. Verified: the write **does** persist (`app.db → book_read_link`), even when a subsequent `/ajax/listbooks` response seems stale (listbooks read_status comes from a join that's subject to the Calibre DB snapshot cache, not a real bug).

For setting explicit state (not just toggle), there's no dedicated endpoint — the helper function `edit_book_read_status(book_id, read_status)` supports it internally, but the route only calls it with `read_status=None` (toggle). We accept toggle semantics.

### `createUser` — required form fields for `/admin/user/new` (POST)

Full field list from the form (Calibre-Web `0.6.x`):

- `csrf_token`
- `name` (username)
- `email`
- `password`
- `kindle_mail` (optional, can be empty)
- `default_language` (default from form: `all`)
- `locale` (default from form: `en`)
- Role flags (optional, submit as checkbox present/absent): `admin_role`, `download_role`, `viewer_role`, `edit_role`, `delete_role`, `passwd_role`, `edit_shelf_role`
- Sidebar view bitfield: `show_2` through `show_131072` (checkboxes — we omit them for the default view)
- `Show_detail_random` (optional, capital S — Calibre-Web quirk)
- `submit_allow` / `submit_deny` — present on the form but only for rule-based registration flows, not new-user creation

Success detection: response is `200` for both success and failure; differentiate by flash message text — `"alert-success"` + `"created"` on success; `"existing account"` or `"already exists"` on duplicate; `"Please complete all fields"` on validation error. The current adapter gets this right.

## Architecture

### File layout

```
src/lib/adapters/calibre.ts          # Public ServiceAdapter object — thin shim
src/lib/adapters/calibre/
  opds-client.ts                     # OPDS Atom fetch + parse, Basic-auth headers
  opds-parse.ts                      # XML → typed entries (no network)
  session-client.ts                  # Session-cookie flow for write endpoints
  session-cache.ts                   # In-memory session cookie cache (keyed by service+user)
  normalize.ts                       # OPDS entry → UnifiedMedia
  types.ts                           # Internal types (OpdsEntry, OpdsFeed, OpdsAcquisition)
  __tests__/
    opds-parse.test.ts               # Snapshot-style tests against captured XML fixtures
    normalize.test.ts
    session-client.test.ts           # Mock-fetch-driven
```

**Why split the file:** the current 646-line monolith makes the adapter hard to reason about. Splitting along the auth-surface boundary (read/OPDS vs. write/session) keeps each module focused. `opds-parse.ts` in particular is pure-function and trivially testable.

### Module contracts

**`opds-client.ts`**
```ts
type OpdsRequestOptions = { offset?: number; timeoutMs?: number };
function opdsAuthHeader(config: ServiceConfig, userCred?: UserCredential): string;
async function opdsFetch(config: ServiceConfig, path: string, userCred?: UserCredential, opts?: OpdsRequestOptions): Promise<OpdsFeed>;
async function opdsFetchAllPages(config: ServiceConfig, path: string, userCred?: UserCredential): Promise<OpdsEntry[]>;  // walks rel=next
```

- Single entry point for every OPDS read. Handles Basic auth, timeouts, and `401 → throw` (unlike `/ajax/listbooks` silent HTML-login fallback, OPDS behaves correctly).
- `opdsFetchAllPages` is used by the library-wide walks (`getAllBooks`, `getCalibreSeries`, `getCalibreAuthors`, `getCalibreCategories`). It walks until no `rel="next"` link is found, with a hard cap (e.g., 100 pages / ~6000 books) to avoid runaway loops on a misbehaving server.

**`opds-parse.ts`**
```ts
interface OpdsFeed {
  totalResults?: number;   // from opensearch:totalResults if present
  nextHref?: string;       // from rel="next"
  entries: OpdsEntry[];
}
interface OpdsEntry {
  id: string;              // calibre book id extracted from urn:uuid + acquisition href
  uuid: string;
  title: string;
  authors: string[];
  publishers: string[];
  language?: string;
  published?: Date;
  updated?: Date;
  categories: string[];    // tags
  series?: string;
  seriesIndex?: number;
  ratingStars?: number;    // 0..5 parsed from content RATING: ★★★★
  description?: string;    // from content <p> or <summary>
  coverHref?: string;      // /opds/cover/{id}
  thumbHref?: string;
  acquisitions: OpdsAcquisition[];
}
interface OpdsAcquisition {
  format: string;          // "EPUB", "PDF", etc.
  href: string;            // /opds/download/{id}/{ext}/
  length?: number;         // bytes
  mtime?: Date;
  mimeType: string;
}
```

- Parser uses the existing SvelteKit server environment — there's no XML parser in the current deps. Add `fast-xml-parser` (lightweight, already present in many SvelteKit projects) or do a regex-driven pass. **Preference: `fast-xml-parser`.** It's ~50KB, zero deps, handles namespaces, and the adapter needs to be robust across Calibre-Web versions where output spacing/ordering may shift.
- Series name and index come from the `<content>` HTML blob (Calibre-Web doesn't put them in first-class Atom fields in 0.6.x). Parser extracts via regex from the content text: `SERIES: X (Y)` pattern, plus fallback from the content-only representation. Empirical note from our test library: series data isn't shown in `<content>` for single-book series — need to confirm in a seeded multi-book series case.
- `id` extraction: the Calibre numeric id isn't exposed in OPDS as a first-class field, but it's in the `acquisition` href (`/opds/download/{id}/{fmt}/`) and in `/opds/cover/{id}`. Parser extracts from the acquisition href; fall back to cover href.

**`session-client.ts`**
```ts
async function getSessionCookie(config, userCred?): Promise<string>;        // login flow, cached
async function getCsrfToken(config, cookie): Promise<string>;               // GET /me, extract
async function sessionFetch(config, path, init, userCred?): Promise<Response>;  // retries once on HTML-login-page
async function sessionWrite(config, path, csrfBody, userCred?): Promise<Response>;  // POST + X-CSRFToken header
function invalidateSession(config, userCred?): void;
```

- Session cookie cache is keyed by `{serviceId, username}`, TTL 55 minutes.
- CSRF token is **cached alongside the session cookie** (same TTL). Extracted lazily on first write.
- `sessionFetch` detects the "Calibre-Web returned HTML login instead of JSON/200" case via content-type sniff + `<title>Calibre-Web | Login</title>` regex, invalidates the cache, retries once. No second retry.
- Write endpoints (`sessionWrite`) always include `X-CSRFToken` header. Form body is `application/x-www-form-urlencoded`.

**`normalize.ts`**
```ts
function opdsEntryToUnifiedMedia(config: ServiceConfig, entry: OpdsEntry): UnifiedMedia;
```

- Maps OPDS entry → the same `UnifiedMedia` shape the current adapter produces, so callers don't change.
- Cover proxy URL: `/api/media/image?service=<id>&path=<encoded /opds/cover/{id}>` — same pattern as today, but points at OPDS cover (Basic auth).
- `streamUrl` — kept as `/api/books/{id}/read` (Nexus's in-app reader route, unchanged).
- `actionUrl` — unchanged.

### Adapter method → endpoint map

| `ServiceAdapter` method | Uses | OPDS path / action |
|---|---|---|
| `ping` | OPDS | `GET /opds` (just needs a 200 + well-formed Atom root) |
| `getRecentlyAdded` | OPDS | `GET /opds/new?offset=0` (limit 20) |
| `getContinueWatching` | Session + Calibre DB | Walk `/opds/books/letter/00` once (cached 5 min); filter books that have a `book_read_link` row with status != finished. **Note:** read-status isn't in OPDS — so for this method we additionally call `/ajax/listbooks?sort=authors&limit=N` to get `read_status` per book, or we accept the limitation and mark the most-recently-updated books as "in progress". **Decision: accept the limitation.** Calibre-Web genuinely doesn't have per-page progress — the current adapter's `getContinueWatching` is already a best-effort approximation. Serve the first 10 entries from `/opds/new` that aren't yet marked `read_status=finished` (requires one extra `/ajax/listbooks` call to pull read_status, which is the only field listbooks gives us that OPDS doesn't). **Alternative: return [] and stop pretending.** Parker: which? |
| `search` | OPDS | `GET /opds/search/<encoded query>?offset=0` |
| `getItem` | OPDS | Walk `/opds/books/letter/00` with cache; find matching id. **Alternative:** `GET /opds/search/uuid:<uuid>` doesn't work (search fields don't include uuid); **but** `/opds/search/id:{numeric_id}` does. Use the id-filtered search for a single-request lookup. |
| `getLibrary` | OPDS | `GET /opds/books/letter/00?offset=N` with mapped sort. **Sort limitation:** OPDS `/opds/books` always sorts by `Books.sort`. Other OPDS routes have fixed sorts (`/opds/new` = timestamp desc, `/opds/rated` = rating desc). To honor the adapter's `sortBy` parameter: route `added` → `/opds/new`, `rating` → `/opds/rated`, `title` (and default) → `/opds/books/letter/00`. `year` is not directly supported by any OPDS route — fall back to fetching all-books and sorting in memory (acceptable given typical library sizes and 5-min cache). |
| `authenticateUser` | OPDS | `GET /opds` with Basic auth — 200 = valid, 401 = invalid. No more session-cookie login dance just to test credentials. |
| `createUser` | Session | `GET /admin/user/new` (extract csrf + defaults) → `POST /admin/user/new` (same pattern as today). |
| `getImageHeaders` | OPDS | Return `{ Authorization: 'Basic …' }` instead of `{ Cookie: … }`. |
| `getServiceData('series' / 'all' / 'categories' / 'authors')` | OPDS | Walk `/opds/books/letter/00` once, bucket client-side, cache 5 min. |
| `enrichItem('formats')` | OPDS | Already in the entry's `acquisitions` array — just re-serialize. **No more `/book/{id}` HTML scraping.** For a single-book re-fetch (when called without the full entry in hand), use `GET /opds/search/id:{id}` to get the one entry. |
| `enrichItem('related')` | OPDS | Walk all-books (cached), compute same-author / same-series / prev-in-series / next-in-series. Same as today but off OPDS. |
| `setItemStatus({read})` | Session | `POST /ajax/toggleread/{id}` with `X-CSRFToken` — matches current behavior. |
| `downloadContent` | OPDS | `GET /opds/download/{id}/{format}/` with Basic auth. **Current behavior uses session cookie + `/download/{id}/{format}/{filename}` — switch to OPDS to drop the session dependency.** |

### Caching

Current adapter has `withCache(key, 300_000, …)` for series / authors / categories / allbooks. Keep it. Add one more: cache `GET /opds/books/letter/00` (full walk) for 300s; every read-path method that needs enumeration reuses that walk rather than re-hitting the feed.

### Error model

- Auth errors (401, bad credentials) → throw `new Error('Calibre authentication failed: <reason>')`. Callers already wrap in try/catch and degrade to `[]`/`null`.
- OPDS parse failures → throw with the raw first 200 bytes of the response for debuggability (current adapter's errors are opaque).
- Session cookie expiry → `sessionFetch` catches the HTML-login-page case, invalidates cache, retries once. Second failure throws.
- XML parse of OPDS feed: if the feed has an entry we can't parse (missing acquisition, malformed date), skip that entry and log; don't fail the whole fetch.

### Onboarding / config — unchanged

The `onboarding` block, `defaultPort: 8083`, color, abbreviation, required fields (`url`, `username`, `password`) all stay the same. Users see no change in the onboarding flow.

## Testing

1. **Unit tests** (vitest) for `opds-parse.ts` against **captured real XML fixtures** from our local Docker instance. Fixtures live in `src/lib/adapters/calibre/__tests__/fixtures/opds-*.xml` and are the actual responses we captured during research.
2. **Unit tests** for `normalize.ts` using parsed entry fixtures.
3. **Unit tests** for `session-client.ts` using a fetch mock — exercise login happy path, expired-session retry, CSRF-token extraction from `/me`, and the "HTML login page returned with 200" detection.
4. **Integration smoke test** (manual, during implementation): every adapter method exercised against the live local Docker instance with output inspected. This is not a CI test — it's a one-shot pass during dev.
5. **Existing call sites** remain unchanged — `ServiceAdapter` contract is preserved, so consumer-side tests (if any) stay green.

## Migration notes

- **No schema migration.** The adapter surface is preserved.
- **No config migration.** Existing user credentials still work (username + password).
- **Delete** the `getCalibreBookFormats` scraping path (now obsolete — formats come from OPDS acquisitions). Keep the exported function signature as a thin wrapper returning the already-parsed formats, to avoid breaking any callers.
- **Drop** the stash once the rewrite lands: `git stash drop` on `stash@{0}` (which is currently the half-rewrite reference).

## Out of scope

- **Writing new books / metadata edits.** The adapter is read-mostly; the only writes are `toggleread` and `createUser`. Calibre-Web has `/admin/book/edit`, `/upload`, etc. — not adding them now.
- **Kobo sync endpoints.** Calibre-Web has a whole Kobo-device-compatible API under `/kobo/*` with its own auth model. Not touching it.
- **The setup wizard / E2E test failure.** Separate open thread.
- **The stale `feature/library-watchlists-collections` worktree.** Separate open thread.

## Addendum: Codex cross-validation (2026-04-13, added after empirical design)

Codex research against upstream `janeczku/calibre-web` (0.6.26 stable, 0.6.27b in master) confirms every empirical finding and adds four material updates that improve the design:

### 1. `/opds/readbooks` and `/opds/unreadbooks` exist

This kills the last ugly dependency in the design. `getContinueWatching` no longer needs `/ajax/listbooks` — it uses **`GET /opds/unreadbooks?offset=0`** via Basic auth, exactly like `/opds/new`. The feed respects the Basic-authenticated user's identity, so per-user filtering is free. Verified empirically: after toggling `The Hobbit` read, `/opds/unreadbooks` returns 4 entries and `/opds/readbooks` returns 1.

**Revised `getContinueWatching` logic:** take the first 10 entries from `/opds/unreadbooks`, assign `progress=0.05` as a "started" nominal value (same as current adapter's approximation). **Read path is now 100% OPDS.** Session cookie flow is used for `setItemStatus(read)` and `createUser` only.

### 2. Session-cookie name has a configurable prefix

`SESSION_COOKIE_NAME = {COOKIE_PREFIX}session` per `cps/__init__.py`. Current adapter does `setCookies.find(c => c.startsWith('session='))` — **breaks on any install with `COOKIE_PREFIX` set.** Fix: match any cookie whose name ends with `session` (case-insensitive). The cookie jar approach from the stash already handles this correctly since it merges all cookies regardless of name; we adopt that pattern.

### 3. Since 0.6.23, Basic auth to OPDS does not create a session cookie

Simpler model to reason about. Means we never accidentally accumulate stale session state from OPDS reads. Since 0.6.24, forbidden-download returns `401` not `403`. The `opdsFetch` error mapping treats `401` as auth failure and `403` as permission failure (the user exists but lacks `role_download()`) — important distinction for error messages.

### 4. `/ajax/book/{uuid}` is an alternative JSON single-book endpoint

Defined in `cps/opds.py` (Calibre Companion compat), so it accepts Basic auth like the rest of OPDS. Returns JSON with `formats`, `format_metadata`, `main_format`, `other_formats`, `cover`, `thumbnail`, `authors`, `tags`, `comments`, `uuid`, `application_id` (the numeric id). **Not used by the initial rewrite** — OPDS XML is sufficient and keeping one parser is simpler — but flagged as a future optimization for `enrichItem` if XML parsing ever becomes a bottleneck.

### Other confirmations worth noting

- `/ajax/listbooks` sort whitelist confirmed: `state`, `tags`, `series`, `publishers`, `authors`, `languages`, `sort`, `title`, `authors_sort`, `series_index`. Nothing else is honored.
- `POST /ajax/bookmark/{book_id}/{format}` exists (form field: `bookmark`, 201/204 responses). Not used now, flagged for a possible future "real progress tracking" enhancement.
- Reverse-proxy handling uses custom middleware (`cps/reverseproxy.py`), honors `X-Script-Name` / `X-Scheme` / `X-Forwarded-Host` (not `X-Forwarded-Proto`). Adapter doesn't care — we talk directly to the internal URL in `config.url`.
- **Fork warning:** `crocodilestick/Calibre-Web-Automated` adds extra surfaces (KOReader sync, OAuth/OIDC, analytics). Not targeting it. If users report issues on that fork, add a capability probe.
- `createUser` form: `default_language` is **required at server validation time** (current adapter already handles this). Flash-text variants for failure detection: `"Please complete all fields"`, `"username is already taken"`, `"existing account for this Email"`, `"Database Error"`. Current adapter's success/failure detection is close but incomplete — update to check for these additional markers.

### Summary of design changes driven by addendum

1. `getContinueWatching` → `/opds/unreadbooks` (was: `/ajax/listbooks` fallback)
2. Session cookie matching → suffix-based, not prefix-based
3. Error mapping → distinguish 401 (auth failed) from 403 (permission denied)
4. `createUser` flash-text detection → broaden to the full list above
5. Read path has **zero** session-cookie dependency

## Open question for Parker

- **`getContinueWatching`:** keep the best-effort "most-recently-updated unread" approximation (requires one extra `/ajax/listbooks` call to get `read_status`, forcing the session-cookie dependency onto a read path), or drop it and return `[]` (purely OPDS, cleaner, but the Continue Watching row loses the Calibre section)?

  **My recommendation:** keep the approximation. It's already what the adapter pretends to do; losing the section from Continue Watching would be a user-visible regression. The `/ajax/listbooks` dependency is contained to this one method, and if it fails the method already degrades to `[]`.

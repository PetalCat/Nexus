---
Status: in-flight
Closes: #61
---

# Reader Paginated Mode — Design

## Goal

Bring the PDF reader to feature parity with the EPUB reader's paginated/scrolled flow modes, and unify the reader settings surface across both. The result: one familiar control panel that works on phone, tablet, and desktop, with the page-turn experience that physical-book readers expect.

Also: a small bug fix so the EPUB reader doesn't load for books that have no EPUB format.

## Background

`BookReader.svelte` (foliate-js, EPUB) already supports `flow: paginated | scrolled` via a settings drawer toggle. `PdfReader.svelte` (PDF.js, our wrapper) is scroll-only with a `single | dual` spread mode. There is no shared settings model — each reader carries its own state and persistence.

Today, opening a book with no EPUB format still routes to the EPUB reader because `+page.server.ts` defaults `format = 'epub'` regardless of what's actually available. This produces a broken reader for PDF-only books.

## Requirements

1. PDF reader gains `paginated` flow mode.
2. EPUB reader gains the missing controls (spread, animation, per-input toggles, direction).
3. Both readers share one settings model and one settings UI pattern.
4. Settings persist per-user (extending the existing `userReaderPrefs` storage).
5. Touch-friendly on phones, comfortable on tablets, fast on desktop.
6. Bug fix: pick a sensible default format when EPUB is unavailable.

## Settings Model

A shared `ReaderSettings` shape, persisted per user:

```ts
interface ReaderSettings {
  flow: 'paginated' | 'scrolled';        // default: 'paginated'
  spread: 'auto' | 'single' | 'dual';    // default: 'auto'
  pageAnimation: 'slide' | 'fade' | 'none'; // default: 'slide'
  inputs: {
    tapZones: boolean;  // default: true
    swipe: boolean;     // default: true
    keyboard: boolean;  // default: true
  };
  direction: 'ltr' | 'rtl';              // default: 'ltr'
}
```

`spread: 'auto'` resolves at runtime: phones and portrait tablets → single, landscape tablets and desktop → dual. Resolution uses a CSS media query observed via a `$state` rune so it stays reactive when the device rotates.

## Components

### `PaginatedViewport.svelte` (new)

A generic wrapper that owns flow, spread, animation, and input handling. PDF and EPUB readers each render their format-specific content as the viewport's slot child. The viewport's job is to translate user inputs (tap, swipe, key) and the active settings into "advance N pages" / "go back N pages" calls that the child handles.

Why a wrapper rather than duplicating logic in each reader: input handling, gesture thresholds, animation state, and accessibility wiring are not format-specific. Splitting them out keeps each reader focused on rendering its own content.

### `useReaderInputs.svelte.ts` (new)

A small rune that wires touch (swipe), pointer (tap zones), and keyboard handlers. Caller passes `{ onPrev, onNext, onToggleUI, settings }` and gets back the appropriate event listeners as derived attachments. Centralizing this avoids three near-identical implementations.

Tap zones: invisible overlays at left-third / middle / right-third. Tap-zone hit detection uses pointer events; debounced 200ms to prevent double-fire on touch-then-click.

Swipe threshold: 50px minimum horizontal travel, must exceed vertical travel by 2x (avoids fighting vertical scroll in scrolled mode).

Keyboard: ←/→ and PageUp/PageDown for prev/next, Space for next, Esc to close drawers. Already wired for EPUB; this consolidates.

`direction: 'rtl'` flips the prev/next mapping for tap zones, swipe, and keyboard.

### `KeyboardShortcuts.svelte`

Extend the existing component to be format-agnostic; PDF reader picks it up.

### `PdfReader.svelte` (modify)

- Wrap rendered pages in `PaginatedViewport`.
- In paginated mode: render only the current page (or current pair if `spread = dual`) at fit-to-viewport sizing, no scroll. Advance/back updates the current page index.
- Existing `spreadMode` state becomes the `spread` setting; `auto` resolves at render time.
- Page index continues to flow through `play_sessions.position` (already does for scrolled mode).

### `BookReader.svelte` (modify)

- Pull existing `flow` state out into the shared settings model.
- Add the spread/animation/input/direction controls to its settings drawer.
- Pass everything to `PaginatedViewport`.
- foliate-js's `renderer.setAttribute('flow', ...)` continues to drive the underlying paginated layout; the wrapper just owns the chrome and inputs.

### Settings UI

Both readers' right-side drawers render the same `<ReaderSettingsPanel>` component. Single source of truth for layout and copy.

## Animation

Implemented via CSS on the viewport's page container:

- `slide` (default): `transform: translateX(±100%)` with `transition: transform 220ms ease-out`. Two-buffer approach (current + incoming) so slide direction matches navigation direction.
- `fade`: `opacity 0 → 1` over 150ms.
- `none`: no transition.

All three driven by the single `pageAnimation` setting; no per-format implementations.

## Persistence

Extend `userReaderPrefs` (already used by EPUB reader for theme/font/etc.) to include the new fields. Migrate existing rows: any row with the old `flow` field carries through; missing fields fall back to defaults at read time.

No schema migration needed for SQLite — the existing column is JSON; we extend the shape and tolerate missing keys.

## Format-Default Bug Fix

In `src/routes/books/read/[id]/+page.server.ts`, change the format-resolution logic:

```ts
const requestedFormat = (url.searchParams.get('format') ?? 'epub').toLowerCase();
const fallback = availableFormats[0] ?? 'epub';
const format = availableFormats.includes(requestedFormat) ? requestedFormat : fallback;
```

If the requested format isn't available, fall back to the first available format rather than always to `'epub'`. For a PDF-only book, this routes to the PDF reader cleanly. If `availableFormats` is empty (no formats reported), the existing 404 from `getItem` returning null still fires upstream of this code.

## Out of Scope

- Page curl animation (skeuomorphic page-turn): expensive to make non-cringe, easy to skip.
- Per-zone tap action remapping (custom action mapping per zone): YAGNI.
- Two-up cover handling (first page solo, then pairs in dual mode): can add later if it bugs anyone.
- Per-book settings overrides (settings are global per user, not per book).

## Testing

- Vitest: `useReaderInputs` rune — tap zone hit detection, swipe threshold, RTL direction flip, keyboard mapping.
- Vitest: `PaginatedViewport` — flow switching, spread auto-resolution at different viewport widths, animation class application.
- Manual: `pnpm dev`, exercise both readers across desktop, an iPad-sized viewport, and a phone-sized viewport. Verify tap zones, swipe, keyboard. Verify `:dev` build behavior on jellyfin host with TKAMB.

## Migration / Rollout

Single PR. No DB migration. No feature flag — the new settings panel replaces the existing one in both readers atomically. Old `userReaderPrefs` rows continue to work; missing fields hit defaults.

## Open Questions

None at design time. Implementation plan will surface anything that needs a follow-up.

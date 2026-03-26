# Books UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire books experience — library page, book detail page, PDF reader (PDF.js), and EPUB reader (foliate-js migration) — with premium features and Nexus theming.

**Architecture:** Four phases: (1) Foundation — DB schema, dependencies, shared components, API fixes; (2) PDF Reader — full pdfjs-dist viewer with 8 premium features; (3) EPUB Reader — foliate-js migration with feature parity; (4) Library & Detail Pages — enhanced grid, virtual scrolling, book detail redesign.

**Tech Stack:** SvelteKit 5 (runes), pdfjs-dist 5.5.207, foliate-js, Drizzle ORM/SQLite, Tailwind CSS 4, Nexus design tokens.

**Spec:** `docs/superpowers/specs/2026-03-26-books-ui-redesign-design.md`

**Mockup:** `.superpowers/brainstorm/64274-1774551841/pdf-reader-nexus.html`

---

## File Structure

### New Files
```
src/lib/components/books/AnnotationPopup.svelte     — shared annotation popup (color picker + actions)
src/lib/components/books/KeyboardShortcuts.svelte    — shared keyboard shortcuts overlay
src/lib/components/books/ReaderProgressBar.svelte    — shared progress bar with chapters
src/lib/components/books/TimeEstimate.svelte         — shared time remaining display
src/lib/components/books/ReadingRuler.svelte         — shared reading ruler guide
src/lib/components/books/PdfSidebar.svelte           — PDF thumbnail/outline/notes sidebar
src/lib/components/books/PdfToolbar.svelte           — PDF top toolbar
src/lib/components/books/PdfMinimap.svelte           — PDF minimap right-edge strip
src/lib/components/books/MarginNotes.svelte          — Tufte-style margin sidenotes
src/lib/components/books/BookCardSkeleton.svelte     — skeleton placeholder for lazy loading
src/lib/components/books/SeriesCollapsedCard.svelte  — collapsed series card for grid
src/lib/components/books/ReadingStatsCard.svelte     — replaces existing ReadingStatsWidget.svelte
static/pdf.worker.min.mjs                           — PDF.js worker (copied via postinstall)
```

### Modified Files
```
package.json                                         — add pdfjs-dist, foliate-js; remove epubjs; add postinstall
vite.config.ts                                       — add optimizeDeps exclude for pdfjs-dist
src/lib/db/schema.ts                                 — add position column to activity, cfi+chapter to bookNotes
src/lib/db/index.ts                                  — add migration for new columns
src/routes/api/books/[id]/progress/+server.ts        — store position in activity.position
src/routes/api/books/[id]/download/[format]/+server.ts — add inline Content-Disposition + range headers
src/routes/books/read/[id]/+page.server.ts           — load saved position, pass annotations to both readers
src/routes/books/read/[id]/+page.svelte              — update reader component imports + props
src/lib/components/books/PdfReader.svelte             — complete rewrite with pdfjs-dist
src/lib/components/books/BookReader.svelte            — complete rewrite with foliate-js
src/routes/books/+page.svelte                         — add virtual scrolling, series collapse, format badges, stats widget
src/routes/books/+page.server.ts                      — add reading stats data
src/routes/media/[type]/[id]/+page.svelte             — enhance book detail sections
```

---

## Phase 1: Foundation

### Task 1: Install Dependencies and Configure Build

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Install pdfjs-dist**

Run: `pnpm add pdfjs-dist@5.5.207`

- [ ] **Step 2: Add postinstall script for PDF.js worker**

In `package.json`, add to `"scripts"`:
```json
"postinstall": "cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs static/pdf.worker.min.mjs"
```

Run: `pnpm run postinstall`
Expected: `static/pdf.worker.min.mjs` exists.

- [ ] **Step 3: Configure Vite for pdfjs-dist**

In `vite.config.ts`, add `optimizeDeps` to the config:
```typescript
export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  optimizeDeps: {
    exclude: ['pdfjs-dist']
  }
});
```

- [ ] **Step 4: Vendor foliate-js**

foliate-js is not on npm. Vendor it:
```bash
mkdir -p src/lib/vendor
cd src/lib/vendor
git clone --depth 1 https://github.com/johnfactotum/foliate-js.git
rm -rf foliate-js/.git
```

Verify key modules exist:
```bash
ls src/lib/vendor/foliate-js/view.js src/lib/vendor/foliate-js/epub.js
```

- [ ] **Step 5: Verify Vite resolves foliate-js imports**

Create a temporary test: in any `.ts` file, try `import { makeBook } from '$lib/vendor/foliate-js/book.js'`. Run `pnpm dev`. If Vite fails to resolve, add path aliases to `vite.config.ts`. Delete the test import after confirming.

- [ ] **Step 6: Verify dev server starts**

Run: `pnpm dev`
Expected: No build errors. Do NOT remove epub.js yet — the existing BookReader still needs it until Phase 3 rewrites it.

- [ ] **Step 7: Add pdf.worker.min.mjs to .gitignore**

Add `static/pdf.worker.min.mjs` to `.gitignore` since it is generated by the postinstall script.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml vite.config.ts src/lib/vendor/foliate-js/ .gitignore
git commit -m "feat(books): add pdfjs-dist, vendor foliate-js, configure build"
```

---

### Task 2: Database Schema Migrations

**Files:**
- Modify: `src/lib/db/schema.ts:71-83` (activity table)
- Modify: `src/lib/db/schema.ts:505-513` (bookNotes table)
- Modify: `src/lib/db/index.ts` (migration section)

- [ ] **Step 1: Add `position` column to activity table in schema**

In `src/lib/db/schema.ts`, add after `positionTicks` (line 78):
```typescript
position: text('position'), // CFI (EPUB) or page number (PDF)
```

- [ ] **Step 2: Add `cfi` and `chapter` columns to bookNotes in schema**

In `src/lib/db/schema.ts`, add after `content` (line 510):
```typescript
cfi: text('cfi'),
chapter: text('chapter'),
```

- [ ] **Step 3: Add safe migrations in initDb**

In `src/lib/db/index.ts`, in the migration section (after existing ALTER TABLE blocks), add:
```typescript
// Books UI redesign — position sync + positioned notes
try { db.exec(`ALTER TABLE activity ADD COLUMN position TEXT`); } catch {}
try { db.exec(`ALTER TABLE book_notes ADD COLUMN cfi TEXT`); } catch {}
try { db.exec(`ALTER TABLE book_notes ADD COLUMN chapter TEXT`); } catch {}
```

- [ ] **Step 4: Verify migration runs**

Restart dev server. Check the DB:
```bash
sqlite3 nexus.db ".schema activity" | grep position
sqlite3 nexus.db ".schema book_notes" | grep cfi
```
Expected: Both columns exist.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/index.ts
git commit -m "feat(books): add position column to activity, cfi+chapter to book_notes"
```

---

### Task 3: Fix Progress API — Store and Restore Position

**Files:**
- Modify: `src/routes/api/books/[id]/progress/+server.ts:24-56`
- Modify: `src/routes/books/read/[id]/+page.server.ts:55-57`

- [ ] **Step 1: Update progress PUT to store position**

In `src/routes/api/books/[id]/progress/+server.ts`:

First, update the destructuring (around line 24) to include `page`:
```typescript
const { progress, cfi, page, serviceId } = await request.json();
```

Then add `position` to both the `db.update().set({...})` call (around line 41) and the `db.insert().values({...})` call (around line 46):
```typescript
position: cfi ?? page?.toString() ?? null,
```

The code uses a manual if/else pattern (not an upsert), so both branches need the field.

- [ ] **Step 2: Fix page.server.ts to load saved position**

In `src/routes/books/read/[id]/+page.server.ts`, replace line 57:
```typescript
const savedPosition: string | undefined = undefined;
```
with:
```typescript
const savedPosition: string | undefined = activityRow?.position ?? undefined;
```

- [ ] **Step 3: Pass bookmarks and highlights to PdfReader too**

In `src/routes/books/read/[id]/+page.svelte`, update the PdfReader in the `{:else}` branch to receive all data:
```svelte
<PdfReader
  fileUrl={data.bookUrl}
  book={data.book}
  serviceId={data.serviceId}
  format={data.format}
  initialProgress={data.progress}
  savedPosition={data.savedPosition}
  availableFormats={data.availableFormats}
  bookmarks={data.bookmarks}
  highlights={data.highlights}
/>
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/books/[id]/progress/+server.ts src/routes/books/read/[id]/+page.server.ts src/routes/books/read/[id]/+page.svelte
git commit -m "fix(books): store and restore reading position (CFI/page)"
```

---

### Task 4: Fix Download Endpoint for PDF Viewing

**Files:**
- Modify: `src/routes/api/books/[id]/download/[format]/+server.ts`

- [ ] **Step 1: Add inline Content-Disposition when ?view=true**

Add `url` to the destructured handler params: `{ params, locals, url }`.

Update the Response construction:
```typescript
const isView = url.searchParams.get('view') === 'true';
const disposition = isView ? 'inline' : `attachment; filename="book-${params.id}.${params.format}"`;

return new Response(response.body, {
  headers: {
    'Content-Type': contentType,
    'Content-Disposition': disposition,
    'Cache-Control': 'private, max-age=3600',
    'Accept-Ranges': 'bytes',
    ...(response.headers.get('content-length') ? { 'Content-Length': response.headers.get('content-length')! } : {})
  }
});
```

- [ ] **Step 2: Verify PDF loads inline in browser**

Navigate to `/api/books/{some-id}/download/pdf?view=true` — should render in-browser instead of downloading.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/books/[id]/download/[format]/+server.ts
git commit -m "fix(books): support inline PDF viewing with ?view=true param"
```

---

### Task 5: Build Shared Reader Components

**Files:**
- Create: `src/lib/components/books/AnnotationPopup.svelte`
- Create: `src/lib/components/books/KeyboardShortcuts.svelte`
- Create: `src/lib/components/books/ReaderProgressBar.svelte`
- Create: `src/lib/components/books/TimeEstimate.svelte`
- Create: `src/lib/components/books/ReadingRuler.svelte`

- [ ] **Step 1: Create AnnotationPopup.svelte**

Shared popup that appears on text selection. Props:
- `x: number`, `y: number` — position relative to viewport
- `onHighlight: (color: string) => void`
- `onNote: () => void`
- `onCopy: () => void`
- `onSearch: () => void`
- `onDismiss: () => void`

Features: 4 color dots (yellow, green, blue, pink), Highlight/Note/Copy/Search buttons. Nexus-themed: `--color-raised` background, `--shadow-float`, `--font-body`. Click outside dismisses.

Use the `svelte-file-editor` agent. Reference the annotation popup in the mockup HTML.

- [ ] **Step 2: Create KeyboardShortcuts.svelte**

Overlay panel. Props: `shortcuts: Array<{ label: string; key: string }>`, `visible: boolean`, `onClose: () => void`.

Fixed position, bottom-right corner. Slide-up animation. Title in `--color-accent`, uppercase. Rows: label (muted) + key badge (mono font, surface bg). Close on Escape.

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Create ReaderProgressBar.svelte**

Bottom bar progress component. Props: `progress: number` (0-1), `chapters: Array<{ position: number; title: string }>`, `currentPage: number`, `totalPages: number`, `onSeek: (position: number) => void`.

Gold gradient fill + glow. Chapter tick marks. Draggable scrubber. Editable page input (mono font). Percentage display.

Use the `svelte-file-editor` agent.

- [ ] **Step 4: Create TimeEstimate.svelte**

Props: `remainingPages: number`, `averageSecondsPerPage: number` (default 120).

Clock icon + "~Xh Ym left". Steel/teal accent. Mono font for numbers.

Use the `svelte-file-editor` agent.

- [ ] **Step 5: Create ReadingRuler.svelte**

Props: `y: number`, `visible: boolean`.

Absolute positioned, full width. Subtle gold-tinted gradient band. `pointer-events: none`. Smooth transition.

Use the `svelte-file-editor` agent.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/books/AnnotationPopup.svelte src/lib/components/books/KeyboardShortcuts.svelte src/lib/components/books/ReaderProgressBar.svelte src/lib/components/books/TimeEstimate.svelte src/lib/components/books/ReadingRuler.svelte
git commit -m "feat(books): shared reader components (annotations, shortcuts, progress, time, ruler)"
```

---

## Phase 2: PDF Reader

### Task 6: PDF Reader — Core Rendering Engine

**Files:**
- Rewrite: `src/lib/components/books/PdfReader.svelte`

- [ ] **Step 1: Rewrite PdfReader with pdfjs-dist canvas rendering**

Complete rewrite. Key architecture:

**Props (full interface):**
```typescript
interface Props {
  fileUrl: string;
  book: UnifiedMedia;
  serviceId: string;
  format: string;
  initialProgress?: number;
  savedPosition?: string;        // page number as string
  availableFormats?: string[];
  bookmarks?: BookBookmark[];    // from Task 3
  highlights?: BookHighlight[];  // from Task 3
}
```

**State:** `pdfDoc`, `numPages`, `currentPage`, `scale`, `fitMode`, `showToolbar`, `showSidebar`, `spreadMode`, `darkMode`, `showRuler`, `showShortcuts`, `renderedPages: Set<number>`.

**Mount sequence:**
1. Set `pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'`
2. Load PDF: `pdfjsLib.getDocument({ url: fileUrl + '?view=true' })`
3. Set `numPages`, calculate initial scale (fit-width)
4. Create placeholder divs for all pages
5. Set up IntersectionObserver with `rootMargin: '400px'` on placeholders
6. If `savedPosition`, scroll to that page

**Page rendering function:** Render canvas at `viewport.width * dpr` x `viewport.height * dpr`. Add TextLayer for text selection/copy. Add AnnotationLayer for PDF-embedded links and form fields (using `page.getAnnotations()` + `AnnotationLayer.render()`). Apply dark mode filter if active.

**Memory management:**
- Store each `renderTask` promise. On fast scrolling, call `renderTask.cancel()` for pages leaving the viewport before they finish rendering.
- Limit concurrent renders to 3 max — use a render queue.
- For pages outside the +/- 3 buffer, clear the canvas context (`ctx.clearRect()`) and remove from `renderedPages` set so they re-render when scrolled back.
- On unmount: `pdfDoc.destroy()`, disconnect observer.

Use the `svelte-file-editor` agent. Reference the mockup at `.superpowers/brainstorm/64274-1774551841/pdf-reader-nexus.html` for exact Nexus-themed UI.

- [ ] **Step 2: Verify PDF renders in the reader route**

Open a book with PDF format. Pages should render with canvas.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/books/PdfReader.svelte
git commit -m "feat(books): PDF.js core rendering engine with lazy page loading"
```

---

### Task 7: PDF Reader — Toolbar, Sidebar, and Bottom Bar

**Files:**
- Create: `src/lib/components/books/PdfToolbar.svelte`
- Create: `src/lib/components/books/PdfSidebar.svelte`
- Modify: `src/lib/components/books/PdfReader.svelte`

- [ ] **Step 1: Create PdfToolbar.svelte**

Top toolbar matching the mockup. Props for all state + event callbacks. Back button, title (Playfair Display), sidebar toggle, zoom controls with mono % display, fit W/P, spread single/dual, dark mode toggle, search bar, bookmark, shortcuts, fullscreen. Auto-hiding via `visible` prop.

Use the `svelte-file-editor` agent.

- [ ] **Step 2: Create PdfSidebar.svelte**

Left sidebar (190px). Three tabs: Pages (thumbnails at 0.2 scale), Outline (from `pdfDoc.getOutline()`), Notes (highlights/bookmarks list). Active page thumbnail has gold border + glow.

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Wire toolbar, sidebar, and progress bar into PdfReader**

Import and compose: PdfToolbar at top, PdfSidebar on left, viewport in center, ReaderProgressBar + TimeEstimate at bottom. Wire all event handlers.

- [ ] **Step 4: Test full toolbar/sidebar experience**

Verify: sidebar toggles, zoom changes rendering, thumbnails show, progress bar updates on scroll, toolbar auto-hides.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/books/PdfToolbar.svelte src/lib/components/books/PdfSidebar.svelte src/lib/components/books/PdfReader.svelte
git commit -m "feat(books): PDF reader toolbar, sidebar, and progress bar"
```

---

### Task 8: PDF Reader — Zoom, Spread Modes, and Search

**Files:**
- Modify: `src/lib/components/books/PdfReader.svelte`

- [ ] **Step 1: Implement zoom controls**

Functions: `zoomIn()` (scale x 1.25), `zoomOut()` (scale x 0.8), `fitWidth()`, `fitPage()`. On scale change, clear all canvases and re-trigger IntersectionObserver rendering for visible pages.

- [ ] **Step 2: Implement dual-page spread mode**

When `spreadMode === 'dual'`: render page pairs in a 2-column grid. Cover page solo. Scale to fit both pages.

- [ ] **Step 3: Implement text search**

Iterate all pages' text content, find matches, store results with page number + excerpt. Navigate between results, scroll to matching page.

- [ ] **Step 4: Test zoom, spread, search**

Verify each feature works correctly.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/books/PdfReader.svelte
git commit -m "feat(books): PDF reader zoom, dual-page spread, and search"
```

---

### Task 9: PDF Reader — Annotations

**Files:**
- Modify: `src/lib/components/books/PdfReader.svelte`

- [ ] **Step 1: Implement text selection and annotation popup**

On `mouseup` in viewport, check `window.getSelection()`. If text selected, show AnnotationPopup near selection. Get page number and character offset for position storage (format: `pdf:{pageNum}:{offset}`).

- [ ] **Step 2: Wire annotation CRUD**

Highlight: POST to `/api/books/{id}/highlights`. Bookmark: POST to `/api/books/{id}/bookmarks`. Note: POST to `/api/books/{id}/notes`. Render existing annotations from props on page load.

- [ ] **Step 3: Test annotation persistence**

Highlight text, reload page, verify highlight persists. Add bookmark, verify ribbon shows.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/books/PdfReader.svelte
git commit -m "feat(books): PDF reader annotations (highlights, notes, bookmarks)"
```

---

### Task 10: PDF Reader — Premium Features

**Files:**
- Create: `src/lib/components/books/PdfMinimap.svelte`
- Create: `src/lib/components/books/MarginNotes.svelte`
- Modify: `src/lib/components/books/PdfReader.svelte`

- [ ] **Step 1: Create PdfMinimap.svelte**

Right-edge vertical strip (32px). Tiny rectangles per page. Current page glows gold. Highlight/bookmark indicators. Click navigates. Appears on hover.

Use the `svelte-file-editor` agent.

- [ ] **Step 2: Create MarginNotes.svelte**

Tufte-style sidenotes (desktop only, hidden < 1200px). Shows highlights/notes for current page with color-coded labels and timestamps.

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Implement auto-dark page mode**

CSS filters on canvas containers:
- Light: none
- Dark: `filter: invert(0.88) hue-rotate(180deg)`
- Sepia: `filter: sepia(0.3) brightness(0.95)`

- [ ] **Step 4: Wire reading ruler, minimap, margin notes, and progress saving**

Import ReadingRuler, PdfMinimap, MarginNotes into PdfReader. Wire ruler to mouse Y. Wire minimap to right edge. Wire margin notes beside page. Add debounced (3s) progress save on page change.

- [ ] **Step 5: Test all premium features**

Verify: minimap navigates, ruler follows, dark mode inverts, margin notes show, progress persists.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/books/PdfMinimap.svelte src/lib/components/books/MarginNotes.svelte src/lib/components/books/PdfReader.svelte
git commit -m "feat(books): PDF reader premium features (minimap, ruler, dark mode, sidenotes)"
```

---

## Phase 3: EPUB Reader

### Task 11: EPUB Reader — Core foliate-js Integration

**Files:**
- Rewrite: `src/lib/components/books/BookReader.svelte`

- [ ] **Step 0: Remove epub.js dependency**

Run: `pnpm remove epubjs`

This is safe now because this task immediately rewrites BookReader to use foliate-js.

- [ ] **Step 1: Rewrite BookReader with foliate-js**

Key imports:
```typescript
import { makeBook } from '$lib/vendor/foliate-js/book.js';
import { createView } from '$lib/vendor/foliate-js/view.js';
```

Mount: fetch EPUB as ArrayBuffer, `makeBook(data)`, `createView({ book, container })`. Apply saved settings from localStorage. Navigate to `savedPosition`. Listen for `'relocate'` (progress), `'select'` (annotations).

Touch/click zones: left 20% prev, right 60% next, center 20% toolbar.

- [ ] **Step 2: Verify EPUB opens and paginates**

Open an EPUB book. Pages render, page turns work.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/books/BookReader.svelte
git commit -m "feat(books): EPUB reader rewrite with foliate-js core"
```

---

### Task 12: EPUB Reader — Settings Panel

**Files:**
- Modify: `src/lib/components/books/BookReader.svelte`

- [ ] **Step 1: Build settings panel UI**

Slide-out panel: Theme (Light/Sepia/Dark/OLED), Font family (4 options), Font size slider (12-36px), Line height slider (1.0-2.0), Margins (Narrow/Medium/Wide), Text alignment (Left/Justified), Reading mode (Paginated/Scrolled). Persisted to `localStorage('nexus-reader-settings')`.

- [ ] **Step 2: Apply settings to foliate-js view**

On change, call view renderer's style API to update font, size, line height, margins, alignment. Apply theme colors to container.

- [ ] **Step 3: Test settings persist and apply**

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/books/BookReader.svelte
git commit -m "feat(books): EPUB reader settings panel"
```

---

### Task 13: EPUB Reader — Annotations, Progress, and Features

**Files:**
- Modify: `src/lib/components/books/BookReader.svelte`

- [ ] **Step 1: Wire annotation popup and highlight rendering**

On `'select'` event, show AnnotationPopup. POST highlights/notes/bookmarks to API. Render existing highlights from props via `view.addAnnotation()`.

- [ ] **Step 2: Wire progress sync**

On `'relocate'`: save CFI + fraction to progress API (debounced 3s). On mount: navigate to `savedPosition`.

- [ ] **Step 3: Add toolbar, progress bar, time estimate, search, shortcuts, ruler, TOC**

Import shared components. Wire TOC from book metadata. Search via foliate-js search API.

- [ ] **Step 4: Test full EPUB reader experience**

Pages turn, settings work, highlights persist, progress saves/restores, search works, TOC navigates.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/books/BookReader.svelte
git commit -m "feat(books): EPUB reader annotations, progress sync, and premium features"
```

---

## Phase 4: Library and Detail Pages

### Task 14: Library Page — Virtual Scrolling and Skeleton Loading

**Files:**
- Create: `src/lib/components/books/BookCardSkeleton.svelte`
- Modify: `src/routes/books/+page.svelte`

- [ ] **Step 1: Create BookCardSkeleton.svelte**

Animated shimmer placeholder matching MediaCard dimensions. Book cover aspect ratio. `--color-surface` background with lighter sweep animation.

Use the `svelte-file-editor` agent.

- [ ] **Step 2: Add `loading="lazy"` to cover images**

- [ ] **Step 3: Add IntersectionObserver virtual scrolling to grid**

Only render cards in/near viewport. Spacer divs above/below for scroll height. Buffer of ~20 extra cards.

- [ ] **Step 4: Test smooth scrolling with large library**

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/books/BookCardSkeleton.svelte src/routes/books/+page.svelte
git commit -m "feat(books): virtual scrolling grid with skeleton loading"
```

---

### Task 15: Library Page — Series Collapsing and Format Badges

**Files:**
- Create: `src/lib/components/books/SeriesCollapsedCard.svelte`
- Modify: `src/routes/books/+page.svelte`

- [ ] **Step 1: Create SeriesCollapsedCard.svelte**

Card representing a collapsed series. Cover of first/next-unread book. Series name, book count badge, stacked card shadow effect. Click expands.

Use the `svelte-file-editor` agent.

- [ ] **Step 2: Add series collapse logic**

`$derived` that groups books by `metadata.series`. Series with 2+ books collapse. Add toggle button in controls.

- [ ] **Step 3: Add format badges**

Small format pills overlaid on covers showing available formats (EPUB/PDF/MOBI).

- [ ] **Step 4: Test collapsing and badges**

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/books/SeriesCollapsedCard.svelte src/routes/books/+page.svelte
git commit -m "feat(books): series collapsing grid and format badges"
```

---

### Task 16: Library Page — Reading Stats Widget

**Files:**
- Create: `src/lib/components/books/ReadingStatsCard.svelte` (replaces existing `ReadingStatsWidget.svelte`)
- Delete: `src/lib/components/books/ReadingStatsWidget.svelte`
- Modify: `src/routes/books/+page.server.ts`
- Modify: `src/routes/books/+page.svelte`

- [ ] **Step 0: Delete existing ReadingStatsWidget.svelte**

Remove `src/lib/components/books/ReadingStatsWidget.svelte` and update any imports in `+page.svelte` that reference it.

- [ ] **Step 1: Add stats query to page server load**

Query `activity` (completed books this year) and `book_reading_sessions` (pages this month). Return `readingStats` object.

- [ ] **Step 2: Create ReadingStatsCard.svelte**

Compact horizontal card: "X books this year", "X pages this month", "X-day streak". Gold accent numbers, DM Sans font.

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Add widget to library page between shelves and tabs**

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/books/ReadingStatsCard.svelte src/routes/books/+page.server.ts src/routes/books/+page.svelte
git commit -m "feat(books): reading stats widget on library page"
```

---

### Task 17: Book Detail Page — Enhanced Book Sections

**Files:**
- Modify: `src/routes/media/[type]/[id]/+page.svelte`

- [ ] **Step 1: Add book-specific enhancements to media detail page**

The page already receives `bookRelated`, `bookFormats`, `bookNotes`, `bookHighlights`, `bookBookmarks`. Enhance:

- **Format pills**: Styled badges for each available format (clickable download)
- **Progress section**: Progress bar + "Continue Reading (X%)" CTA if in progress
- **Annotations section**: Collapsible section listing highlights/notes/bookmarks by chapter
- **Series navigation**: Ordered list from `bookRelated.sameSeries` with prev/next and current highlighted
- **More by author**: Horizontal scroll row from `bookRelated.sameAuthor`

- [ ] **Step 2: Test book detail page**

Format pills show, progress appears for in-progress books, annotations list, series nav, author row.

- [ ] **Step 3: Commit**

```bash
git add src/routes/media/[type]/[id]/+page.svelte
git commit -m "feat(books): enhanced book detail page"
```

---

### Task 18: Final Polish and Integration Testing

- [ ] **Step 1: End-to-end test**

1. `/books` — hero, continue reading, recently added, stats, grid with series collapse
2. Book detail — format pills, progress, annotations, series nav
3. EPUB reader — foliate-js, settings, annotations, position save/restore
4. PDF reader — PDF.js, zoom, search, annotations, minimap, dark mode, position save/restore
5. Mobile viewport — responsive, touch zones, sidebar collapse

- [ ] **Step 2: Fix TypeScript errors**

Run: `pnpm check`
Fix any type mismatches from the migration.

- [ ] **Step 3: Smoke test non-book pages**

Movies, shows, games, settings all still work.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(books): final polish and integration fixes"
```

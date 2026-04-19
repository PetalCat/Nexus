# Books UI Redesign — Design Spec

*Superseded by `docs/superpowers/specs/2026-04-18-books-redesign-design.md`.*

**Date:** 2026-03-26
**Scope:** Library page, book detail page, PDF reader (new), EPUB reader (rewrite)
**Direction:** Hybrid — streaming-service library + premium reader experience

---

## 1. Library Page (`/books`)

### Layout (top to bottom)

1. **BookHero** — existing cinematic hero carousel. Randomly featured book with blurred backdrop, description, "Read" CTA. Shown when library has 5+ books.

2. **Continue Reading Shelf** — horizontal scroll row of in-progress books (0 < progress < 1). Each card shows cover with progress bar overlay at bottom edge and "X%" label. Sorted by most recently read.

3. **Recently Added Shelf** — horizontal scroll row, newest 20 books. Shown when library has 10+ books.

4. **Reading Stats Widget** — compact card: books read this year, current reading streak, pages this month. Links to full stats page with activity heatmap.

5. **Tabs: All Books | Series | Authors** — existing tab structure, kept as-is.

6. **All Books Grid** with enhancements:
   - **Virtual scrolling**: IntersectionObserver-based rendering of only visible cards + buffer. No library dependency.
   - **Lazy cover images**: `loading="lazy"` + skeleton placeholders while loading.
   - **Series collapsing**: Books in the same series collapse into a single card showing series name + book count badge. Click expands to ordered series view. (Audiobookshelf pattern)
   - **Format badges**: Small pills on covers showing available formats (EPUB, PDF, MOBI). Helps users know what's readable in-browser.
   - Existing sort/filter/view-mode controls (grid/list/shelf) preserved.

7. **Smart Filters** (lower priority, future enhancement): User-created saved filter presets pinnable as custom homepage sections.

### Technical Changes
- Add IntersectionObserver-based virtual scrolling to grid view
- Add skeleton placeholder component for lazy cover loading
- Series collapse logic: group by `metadata.series`, show first/next-unread cover
- Format badge data: extend Calibre adapter `normalize()` to populate `metadata.formats` from the initial library fetch. If format list is unavailable without per-book scrape, fall back to showing format count badge ("3 formats") instead of specific names. Full format list already fetched on detail page via `getCalibreBookFormats()`.
- Reading stats widget queries `book_reading_sessions` and `activity` tables directly (simpler than rollup tables for book-specific counts)

---

## 2. Book Detail Page (`/media/book/[id]`)

### Layout

**Route:** `/media/book/[id]` (existing generic media detail route, enhanced with book-specific sections below)

**Hero Area:**
- Blurred cover backdrop (consistent with movie/show detail pages)
- Large cover on the left, sticky while scrolling on desktop
- Right side: title (Playfair Display), author (linked), series position with prev/next navigation, star rating, page count, publication year

**Action Bar:**
- Primary "Read" button (opens best available in-browser format)
- Format pills: EPUB / PDF / MOBI etc. as clickable download badges showing file size
- "Want to Read" / shelving button

**Progress Section** (if book has been started):
- Progress bar with percentage
- Estimated time remaining
- "Continue Reading" button that resumes from saved CFI/page position

**Description:**
- Expandable synopsis/description from Calibre metadata

**Annotations Tab:**
- All highlights, notes, and bookmarks for this book
- Grouped by chapter/position
- Clickable to jump into reader at that location

**More by Author:**
- Horizontal scroll row of other books by the same author

**Series Section** (if book is in a series):
- Ordered list of all books in the series
- Read/unread indicators
- Current book highlighted

---

## 3. PDF Reader (new `PdfReader.svelte`)

### Architecture
- Replace iframe with `pdfjs-dist@5.5.207` canvas rendering
- Worker file: `pdf.worker.min.mjs` copied to `static/` via postinstall script
- Vite config: `optimizeDeps: { exclude: ['pdfjs-dist'] }`
- Each page rendered as: canvas + TextLayer (selection/copy) + AnnotationLayer, stacked

### Layout

**Top Toolbar** (auto-hiding, 4s timeout):
- Back button, book title (Playfair Display), author
- Sidebar toggle (Pages/Outline/Notes)
- Zoom controls: zoom out, percentage display (JetBrains Mono), zoom in
- Fit modes: Fit Width (W), Fit Page (P)
- Spread modes: Single page, Dual-page spread
- Auto-Dark toggle: Light / Dark / Sepia page rendering (CSS filter inversion)
- Search bar with result count, prev/next navigation
- Bookmark page button, keyboard shortcuts button (?), fullscreen (F)

**Left Sidebar** (collapsible, 190px):
- Three tabs: Pages (thumbnails), Outline (TOC tree), Notes (annotations list)
- Page thumbnails with active page highlighted in gold border + glow
- Collapses to icon on mobile

**Main Viewport:**
- Canvas-rendered pages, vertical continuous scroll
- Lazy rendering via IntersectionObserver: current page +/- 3 buffer
- HiDPI: canvas dimensions × devicePixelRatio, CSS-scaled back down
- Gray background with subtle radial gold gradient at top
- Page shadow: `0 4px 32px rgba(0,0,0,0.5)`

**Bottom Bar:**
- Page input (editable) / total pages
- Progress track with chapter marks, gold gradient fill, glowing scrubber
- Percentage display
- Time remaining estimate (teal accent): "~2h 38m left"

### Eight Premium Features

1. **Reading Ruler** — subtle gold-tinted horizontal guide that follows reading position. Reduces eye strain during long reads. Togglable via keyboard shortcut (R).

2. **Minimap** — right-edge vertical strip showing all pages as tiny rectangles. Current page glows gold. Highlights and bookmarks shown as colored indicators on their respective pages. Appears on hover over right edge. Clicking a minimap page navigates to that page.

3. **Multi-Color Annotations** — highlight text in 4 colors (yellow, green, blue, pink). Note indicators in the page margin. All persisted to `book_highlights` table.

4. **Smart Annotation Popup** — on text selection: color picker, Highlight, Note, Copy, Search. Positioned near selection. Nexus-themed with raised surface background and gold accent on primary action.

5. **Keyboard Shortcuts Overlay** — press `?` to show all shortcuts panel. Styled with Nexus surface/mono font. Shortcuts: arrows (page nav), S (sidebar), B (bookmark), ⌘F (search), ⌘+/- (zoom), F (fullscreen), D (dark mode), R (ruler).

6. **Time Remaining Estimate** — bottom bar displays estimated reading time based on pages remaining and average reading speed. Uses steel/teal accent. Speed calculated from reading session data.

7. **Auto-Dark Page Mode** — toggle between Light (normal), Dark (CSS filter inversion for dark-on-light), and Sepia (warm tone filter). Applies to the PDF canvas rendering so the page content matches the Nexus dark theme.

8. **Margin Sidenotes** — Tufte-style notes alongside the page (desktop only, hidden on narrow screens). Shows highlights and notes in context with timestamps and color-coded labels. Connected to their position on the page with horizontal connector lines. Note: connector line positioning is approximate and may not perfectly track during zoom/resize — acceptable degradation is to hide connectors and just show notes aligned vertically with their page region.

### Progress Tracking
- `currentPage / numPages` saved to `/api/books/[id]/progress` on page change (debounced 3s)
- Page number stored as position metadata
- Position restored on reopen: scroll to saved page

### Memory Management
- Cancel in-flight renders when scrolling fast: `renderTask.cancel()`
- Destroy document on component unmount: `pdfDocument.destroy()`
- Page cleanup for pages outside +/- 3 buffer
- Limit concurrent renders to 2-3

---

## 4. EPUB Reader (new `BookReader.svelte` with foliate-js)

### Migration
- Replace `epub.js` with `foliate-js`
- Supports: EPUB, MOBI, AZW3, CBZ (multi-format from single reader)
- CSS multi-column pagination (lighter than epub.js iframe approach)
- Remove `epub.js` dependency after migration

### Layout (consistent with PDF reader)

**Top Toolbar** (auto-hiding, 4s timeout):
- Back button, book title, author
- Settings button (opens settings panel)
- TOC button (opens chapter navigation)
- Bookmarks button
- Search button
- Format switcher (if book available in multiple formats)
- Fullscreen

**Main Reading Area:**
- Paginated by default (CSS multi-column)
- Touch/click zones: left 20% = prev page, right 60% = next page, center 20% = show toolbar
- Swipe left/right for page turns on touch devices
- Keyboard: arrow keys for page turns

**Bottom Bar:**
- Progress bar with chapter tick marks
- Current chapter name
- Page/percentage display
- Time remaining estimate

### Settings Panel (slide-out)

| Setting | Options | Default |
|---------|---------|---------|
| Theme | Light (#faf8f5), Sepia (#f4ecd8), Dark (#181514), OLED Black (#000000) | Dark |
| Font family | Serif (Georgia), Sans (system-ui), Mono (JetBrains Mono), Display (Playfair Display) | Serif |
| Font size | Slider 12-36px | 18px |
| Line height | Slider 1.0-2.0 | 1.5 |
| Margins | Narrow / Medium / Wide | Medium |
| Text alignment | Left / Justified | Left |
| Reading mode | Paginated / Scrolled | Paginated |

All settings persisted to `localStorage` key `nexus-reader-settings`.

### Annotations (consistent with PDF reader)
- Select text → popup: Highlight (4 colors), Note, Copy, Search
- Margin sidenotes on desktop widths
- Persisted to existing `book_highlights`, `book_bookmarks`, `book_notes` tables

### Position Sync (fixing broken savedPosition)
- Save CFI to `/api/books/[id]/progress` on every page turn (debounced 3s)
- **Fix**: Load saved CFI from `activity.position` column on page load — currently hardcoded to `undefined` in `+page.server.ts:57` because the column doesn't exist yet (see Schema Changes in Section 5)
- Cross-device resume works via server-side position storage

### Features (matching PDF reader)
- Reading ruler (togglable via R key)
- Keyboard shortcuts overlay (? key)
- Time remaining estimate (based on reading speed from session data)
- Full-text search with result list and match highlighting

---

## 5. Shared Infrastructure

### New Dependencies
- `pdfjs-dist@5.5.207` — PDF rendering engine (npm package, standard install)
- `foliate-js` — EPUB/MOBI/CBZ reader engine. **Note:** Not published on npm as a standard package. Install via Git dependency (`github:johnfactotum/foliate-js`) or vendor a copy into `src/lib/vendor/foliate-js/`. ESM-only modules — verify Vite/SvelteKit compatibility during implementation spike. Key imports: `foliate-js/view.js` (main reader), `foliate-js/epub.js` (EPUB parser).
- Remove: `epub.js`

### package.json Changes
```json
{
  "dependencies": {
    "pdfjs-dist": "^5.5.207"
  },
  "scripts": {
    "postinstall": "cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs static/pdf.worker.min.mjs"
  }
}
```

### Vite Config Addition
```typescript
optimizeDeps: {
  exclude: ['pdfjs-dist']
}
```

### Database

**Schema changes required:**

1. **Add `position` column to `activity` table** — stores CFI (EPUB) or page number (PDF) as text. Currently `positionTicks` exists for Jellyfin video but there is no column for book position. The progress PUT endpoint already accepts `cfi` in the request body but silently discards it.
   ```sql
   ALTER TABLE activity ADD COLUMN position TEXT;
   ```

2. **Add `cfi` and `chapter` columns to `book_notes` table** — needed for positioned notes that can be clicked to jump to a location. Currently `book_notes` only has `content` with no position data. Without this, notes cannot be grouped by chapter or clicked to navigate.
   ```sql
   ALTER TABLE book_notes ADD COLUMN cfi TEXT;
   ALTER TABLE book_notes ADD COLUMN chapter TEXT;
   ```

**Existing tables (no changes needed):**
- `book_highlights` — has `cfi`, `text`, `color`, `chapter`, `note` (for inline notes on highlights)
- `book_bookmarks` — has `cfi`, `label`
- `book_reading_sessions` — has `startCfi`, `endCfi`, `pagesRead`, `durationSeconds`
- `activity` — has `progress` (0-1), `positionTicks` (Jellyfin), new `position` (books)

### API Changes
- **Fix** `/api/books/[id]/download/[format]`: Add `Content-Disposition: inline` option when `?view=true` query param is present (for PDF viewer to load without forcing download). Also ensure response includes `Content-Length` and `Accept-Ranges: bytes` headers for PDF.js streaming support with large files.
- **Fix** `read/[id]/+page.server.ts`: Load saved position from `activity.position` column instead of hardcoding `undefined`. Pass existing bookmarks and highlights to PdfReader (currently only passed to BookReader).
- **Fix** `/api/books/[id]/progress` PUT: Actually store the `cfi`/page position in the new `activity.position` column instead of silently discarding it.

### Shared Components
Both readers share these components (in `src/lib/components/books/`):
- `AnnotationPopup.svelte` — color picker + Highlight/Note/Copy/Search actions. Props: `position`, `onHighlight`, `onNote`, `onCopy`, `onSearch`
- `KeyboardShortcuts.svelte` — overlay panel triggered by `?` key. Props: `shortcuts` (array of `{label, key}`)
- `ReaderProgressBar.svelte` — chapter marks, draggable scrubber, percentage. Props: `progress`, `chapters`, `onSeek`
- `TimeEstimate.svelte` — reading time remaining display. Props: `remainingPages`, `readingSpeed`
- `ReadingRuler.svelte` — horizontal guide line. Props: `position`, `visible`

---

## 6. Design Tokens (Nexus Theme Application)

All reader UI elements use existing Nexus CSS variables:
- Backgrounds: `--color-void`, `--color-deep`, `--color-base`, `--color-raised`, `--color-surface`
- Text: `--color-cream` (primary), `--color-muted` (secondary), `--color-faint` (tertiary)
- Accent: `--color-accent` (gold, progress bars, active states), `--color-steel` (time estimates, reading ruler)
- Danger: `--color-warm` (bookmarks, delete actions)
- Typography: `--font-display` (titles), `--font-body` (UI), `--font-mono` (page numbers, zoom %)
- Borders: `rgba(240,235,227, 0.04-0.08)` (subtle cream-tinted borders)
- Shadows: `--shadow-float`, `--shadow-card`, `--shadow-glow-accent`

Highlight colors (shared across both readers):
- Yellow: `rgba(250,204,21, 0.25)` / hover `0.4`
- Green: `rgba(74,222,128, 0.2)` / hover `0.35`
- Blue: `rgba(96,165,250, 0.2)` / hover `0.35`
- Pink: `rgba(251,113,133, 0.2)` / hover `0.35`

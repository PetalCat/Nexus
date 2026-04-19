# Books Redesign — Remaining Surfaces Plan

> **For agentic workers:** Use superpowers:subagent-driven-development per task. Steps use `- [ ]` checkboxes.

**Goal:** Ship the remaining five book surfaces on branch `feature/books-redesign` using the design-system primitives already landed: `/books/[id]` · `/books/notes` · `/books/read/[id]` chrome · `/books/series/[name]` · `/books/authors/[name]`.

**Source spec:** `docs/superpowers/specs/2026-04-18-books-redesign-design.md` sections §4–§8 are authoritative for layout/copy/states.

**Tech stack:** SvelteKit 5 runes · Drizzle + better-sqlite3 · primitives under `src/lib/components/books/system/` · all pages inherit `.books-surface` via `src/routes/books/+layout.svelte`.

**Branch:** `feature/books-redesign` at worktree `.worktrees/books-redesign/`.

---

## Task B: /books/[id] book detail (NEW route)

**Files:**
- Create `src/routes/books/[id]/+page.server.ts`
- Create `src/routes/books/[id]/+page.svelte`

Currently books route through the generic `/media/[type]/[id]`. This task adds a dedicated book-shaped detail page at `/books/[id]`. Existing `/media/[type]/[id]` stays for other media types.

Spec: §4.1 layout, §4.2 states, §4.3 data.

- [ ] **B.1 Loader.** Query the book via existing `registry.get('calibre').getBookById(configId, bookId, userCred)` (verify the adapter method name by reading `src/lib/adapters/calibre/index.ts`). Return: `book`, `sessionsCount`, `totalReadingMs`, `lastSessionAt`, `thisWeekDays: boolean[7]`, `authorOtherBooks: UnifiedMedia[]` (max 6), `seriesSiblings: UnifiedMedia[]` (empty if standalone), `highlights` (first 3 from `/api/books/[id]/highlights`). All derived fields from `play_sessions` + existing book queries. No new endpoints.

- [ ] **B.2 Page.** Compose from primitives:
  - Hero header (grid: 260px cover left, copy right): `<BookCover {book} size="hero" />` + tag `◇ IN YOUR LIBRARY · {pct}% READ` (or `◇ UNREAD` / `◇ FINISHED`) + `<h1>` with accent on last word + Playfair italic meta (author · year · pages) + genre chips + CTA row (Continue at p{page} / Details / Download) + `<ProgressThread variant="thick" />` + mono meta.
  - `<SectionHeader ordinal="◇ I" title="About this book" meta="From the publisher">` + drop-cap paragraph of `book.description`. Hide block if no description; show mono line "No synopsis from Calibre metadata." instead.
  - `<SectionHeader ordinal="◇ II" title="Your marginalia" meta="{n} highlights · latest {date}">` + 2-col grid of up to 3 quote cards + one "All your highlights → /books/notes" tile. Hide section entirely if zero highlights.
  - `<SectionHeader ordinal="◇ III" title="More from {author}" meta="{n} in your library">` + 4-6 cover grid. Hide section if author has only this book in library.
  - `<SectionHeader ordinal="◇ IV" title="In the same series">` + vertical list of siblings (cover + ordinal + title + per-volume progress bar + action). Show a "Standalone novel" card if not in a series.
  - Right rail via `<RightRailBlock>`: Shelf (Currently reading/Finished/Unread + Change link) · Editions (format chips EPUB/PDF/MOBI from `book.metadata.formats`) · Sessions (`{sessionsCount} sessions · {hh}h {mm}m` + "Last: {date}") · This week (7-cell strip from `thisWeekDays`) · From Calibre (added date + serial + "Open source →" to Calibre-Web).

- [ ] **B.3 Verify & commit.** `pnpm check` clean, `pnpm build` succeeds. Commit `feat(books): book detail page (/books/[id])`.

---

## Task N: /books/notes hub (REWRITE)

**Files:**
- Modify `src/routes/books/notes/+page.server.ts` — aggregate highlights per book in the loader
- Rewrite `src/routes/books/notes/+page.svelte`

Spec: §5.1–§5.3.

- [ ] **N.1 Loader.** Aggregate across all books in the Calibre library. For each book that has highlights or notes, return `{ book: BookRef, highlights: Highlight[], notes: Note[] }`. Also return totals (`totalHighlights`, `totalNotes`, `totalBooks`, `tagCloud` as `Array<{ tag: string; count: number }>`). Server-side aggregation via existing per-book endpoints — no new public API. Cap per-book items at 8 (lead with favorites, then most-recent).

- [ ] **N.2 Page.**
  - Page header: mono tag `◇ FROM THE PAGES YOU'VE FOLDED` + `<h1>The <em>marginalia</em>.</h1>` + Playfair italic subtitle with totals.
  - Toolbar: segment `All / Highlights / Notes`, segment `By book / Chronological / Random`, search input, right-side entry count.
  - Body: book groups with small cover (`<BookCover size="sm">`) + title + author + per-book counts + "Open book → /books/{id}" link, then 2-col quote-card grid. Two card variants: `.quote.highlight` (italic Playfair, `"` glyph, gold-tinted) and `.quote.note` (upright Playfair, `§` glyph, steel left-border). Favorite tag as warm chip.
  - Right rail: This-year totals · Tag cloud · Books list (clickable filter) · Export formats (MD/JSON/CSV — placeholder links for v1).
  - Footer: `<Ornament />` + one C.S. Lewis-style Playfair italic line (pulled from highlights if possible, else static).

- [ ] **N.3 Verify & commit.** `pnpm check` clean. Commit `feat(books): rewrite /books/notes as marginalia hub`.

---

## Task R: /books/read/[id] reader shell (REWRITE CHROME ONLY)

**Files:**
- Modify `src/routes/books/read/[id]/+page.svelte` (shell only; keep server loader as-is)
- The wrapped engines (`BookReader.svelte` for EPUB via foliate-js, `PdfReader.svelte` for PDF) are **not** modified.

Spec: §6.1–§6.4. Six principles: chrome auto-hides 2s, TOC drawer, annotation popover+drawer, `Aa` sheet, hairline progress, edge-tap pages.

- [ ] **R.1 Chrome shell.** Rewrite `+page.svelte` as a grid (`auto 1fr auto` rows) with:
  - Top bar (fixed): close link + centered Playfair title + tool buttons (TOC · bookmark · highlights · `Aa` · search · fullscreen). Auto-hide: after 2s of idle (no pointermove, no keydown), fade both bars. Reveal on: pointermove toward top 60px, Esc, arrow key, center-tap on page area. Hairline 2px gold progress strip at very bottom always visible.
  - Middle: host the existing `<BookReader>` or `<PdfReader>` based on the detected format.
  - Bottom bar: chapter label · prev/next arrows · thread · page/percent meter.
  - TOC drawer: left-slide sheet with scrim. Content differs by mode: EPUB = chapter tree with per-chapter % (from foliate CFI positions); PDF = embedded outline (if any) + page-range bookmarks + page grid thumbnails.
  - `Aa` sheet: floating top-right panel. EPUB shows face/size/line-height/theme. PDF shows zoom/fit/single-spread-scroll/rotate.
  - Selection popover: identical in both modes (highlight/favorite/note/copy/look-up).

- [ ] **R.2 Mode detection.** Based on `book.metadata.formats` or the file extension of the stream URL. If both EPUB and PDF available, default to EPUB and offer a "switch format" chip in the topbar.

- [ ] **R.3 Verify.** `pnpm check` clean. Manually test auto-hide trap mitigation: edge vignettes, Esc reveals, first-visit toast "tap center to toggle chrome".

- [ ] **R.4 Commit** `feat(books): auto-hide chrome reader shell (EPUB + PDF modes)`.

---

## Task S: /books/series/[name] series pages (NEW)

**Files:**
- Create `src/routes/books/series/[name]/+page.server.ts`
- Create `src/routes/books/series/[name]/+page.svelte`
- Add redirect: when old URL `/books?tab=series&series=X` is hit, redirect to `/books/series/{encodeURIComponent(X)}`. Do this in the existing `/books/+page.server.ts`.

Spec: §7.

- [ ] **S.1 Loader.** Use existing `/api/books/series` to fetch the series and its volumes. Return: `seriesName`, `author`, `yearSpan` (`{first, last}`), `totalPages`, `volumes` (ordered by `volumeIndex` or publication year), `overallProgress` (`{read: n, total: n, pagesRead, pagesTotal}`). Mark each volume's state: `finished | current | branch | unread | missing`. "Branch" = gap > 3 years since previous volume (naive heuristic per spec).

- [ ] **S.2 Page.**
  - Hero (grid: text + 320px stack): tag `◇ A SERIES IN {n} VOLUMES · {year range}` + `<h1>The cycle of <em>{name}</em></h1>` + meta line + prose blurb + big stat `<em>{read}</em> of {total} read` · `{pct}%`.
  - Fanned-stack cover composition on the right (3–4 BookCovers tilted, current highlighted). Use CSS transforms.
  - Vertical timeline via a styled `<ul>` with a `::before` line. Each row: cover (60px) + ordinal + title + per-volume progress + primary action (Continue/Open/Request). States: gold solid, gold-light pulsing, steel for branch (with "BRANCH · {gap}-YEAR GAP" note), faint unread, dashed missing.
  - Footer `<Ornament>`.

- [ ] **S.3 Redirect from old query-param.** In `src/routes/books/+page.server.ts`, top of the `load`, if `url.searchParams.get('tab') === 'series'` AND `url.searchParams.get('series')` exists, `throw redirect(302, /books/series/${encodeURIComponent(seriesName)})`.

- [ ] **S.4 Verify & commit** `feat(books): series pages (/books/series/[name])`.

---

## Task A: /books/authors/[name] author pages (NEW)

**Files:**
- Create `src/routes/books/authors/[name]/+page.server.ts`
- Create `src/routes/books/authors/[name]/+page.svelte`
- Add redirect from old `/books?tab=authors&author=X` in `/books/+page.server.ts` similarly.

Spec: §8.

- [ ] **A.1 Loader.** Use existing `/api/books/authors` + per-book queries. Return: `authorName`, `bio` (from Calibre if available, else null), `dates` (birth/death from Calibre metadata if present), `genres: string[]`, `booksInLibrary`, `totalReadingMs` across all books, `totalHighlights`, `seriesGroupings` (grouped by series + standalone group), `pullQuote` (single most-liked highlight across all their books), `influences` (up to 5 authors in user's library with overlapping genres — naive genre-match for v1).

- [ ] **A.2 Page.**
  - Hero (3-col grid 260 / 1fr / 220): procedural SVG silhouette portrait (use initials + palette shift) · bio column (mono tag · big italic name · dates · drop-cap bio · genre chips) · right stats block via `<RightRailBlock>` list (In library / Time spent / Highlights / Series).
  - Pull quote section (2-col grid with oversize `"` glyph + Playfair italic 24px quote + cite line). Hide if no highlights.
  - Bibliography — `<SectionHeader>` per series grouping + 6-col `<BookCover>` grid with state chips (READ / IN FLIGHT / UNREAD).
  - "If you like" row — horizontal pill chips with initials-dot + name + "{n} IN LIBRARY · {m} READING" sub.
  - Footer: `<Ornament>` + Playfair italic quote footer.

- [ ] **A.3 Redirect** from old `?tab=authors&author=X` to `/books/authors/{encodeURIComponent(name)}`.

- [ ] **A.4 Verify & commit** `feat(books): author pages (/books/authors/[name])`.

---

## Task V: final verification

- [ ] **V.1** `pnpm check` — 0 errors.
- [ ] **V.2** `pnpm vitest run` — 142+ tests (any new vitest tests introduced in this pass also pass).
- [ ] **V.3** `pnpm build` — succeeds.
- [ ] **V.4** Archive the predecessor spec in the same PR:
  ```bash
  mkdir -p docs/superpowers/specs/archive
  git mv docs/superpowers/specs/2026-03-26-books-ui-redesign-design.md \
         docs/superpowers/specs/archive/2026-03-26-books-ui-redesign-design.md
  ```
  Add a single line at the top of the archived file: `*Superseded by 2026-04-18-books-redesign-design.md.*`. Commit as `docs(books): archive 2026-03-26 spec (superseded)`.
- [ ] **V.5** Push branch. PR stays in draft until Parker reviews visually.

## Acceptance

- Every surface renders without type errors.
- All existing routes continue to work (old query-param redirects preserved).
- `play_sessions` remains the single source of truth for progress.
- Design-system primitives are the only visual vocabulary (no ad-hoc styles that duplicate them).

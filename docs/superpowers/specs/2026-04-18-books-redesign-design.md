# Books Redesign — Design Spec

**Date:** 2026-04-18
**Status:** drafted
**Closes:** (umbrella — no single issue yet; supersedes #19 "Books Experience: Complete Overhaul" which was closed against the 2026-03-26 spec)
**Supersedes:** `docs/superpowers/specs/2026-03-26-books-ui-redesign-design.md` (shipped — move to `archive/` in the same PR)
**Scope:** Full redesign of the books surface — `/books`, `/books/[id]`, `/books/notes`, `/books/read/[id]`, `/books/series/[name]`, `/books/authors/[name]`
**Explicitly deferred:** `/books/stats` (Parker: "another project"), e2e fixture repair, mobile polish beyond locked breakpoints, AI curator features (#44), Kapowarr / comics

---

## 1. Direction

One design language across every books surface: editorial warmth as the base (Playfair Display italic, cream-on-void, gold accents) with subtle retrofuture touches (JetBrains Mono timecodes, hairline progress threads, constellation/starfield backdrops). Three hero variants coexist and are chosen by context, not by user toggle:

- **Cinematic** — current book with drop-cap excerpt and big cover. Default for `/books/[id]`.
- **Literary** — centered ornament + prose + compact resume card. Default for `/books` landing when nothing in flight.
- **Constellation** — starfield + connecting threads. Default for `/books` landing when actively reading; also used on series pages.

The starting material was a React mockup (`Reading Room.html`) and four inspiration screenshots (Nexus Home + three Loki/TVA timeline frames). Parker's direction: keep the mockup's aesthetic; rework the information hierarchy so the library is the page, not a footer; push secondary content to a right rail, inline prose, or dedicated pages.

## 2. Shared design system

Extracted into `src/lib/components/books/system/`. These are the only visual primitives for any books surface. Other media surfaces keep their own.

### 2.1 Tokens (`src/lib/styles/books-tokens.css`)

```
--void:#0d0b0a   --base:#181514   --raised:#1f1c1a   --surface:#272321
--cream:#f0ebe3  --muted:#a09890  --faint:#605850
--accent:#d4a253 --accent-lt:#e8bc6a --accent-dim:#b8862e
--steel:#3d8f84  --steel-lt:#56a99d
--warm:#c45c5c

--font-display:'Playfair Display', Georgia, serif
--font-body:   'DM Sans', system-ui, sans-serif
--font-mono:   'JetBrains Mono', ui-monospace, monospace
--font-read:   'Lora', Georgia, serif              (reader body font)
```

Existing app-wide tokens stay; this stylesheet scopes to `/books/**` via a root class.

### 2.2 Six primitives

| Component | Purpose | Props |
|---|---|---|
| `SectionHeader` | Mono-ordinal + Playfair title + right meta. Every section uses it. | `variant: 'hero' \| 'subsection' \| 'aside'`, `ordinal`, `title`, `meta?` |
| `BookCover` | Real cover if available, abstract SVG fallback. | `book`, `size: 'xs' \| 'sm' \| 'md' \| 'lg' \| 'hero'`, `showProgress?`, `badge?` |
| `RightRailBlock` | Sticky sidebar unit. | `label`, `children`, `linkText?`, `linkHref?` |
| `ProgressThread` | Animated hairline — replaces standard progress bars. | `value: 0..1`, `waypoints?: number[]`, `variant: 'thick' \| 'thin'` |
| `ProseStat` | Playfair italic prose replacing widget-y stats in ambient positions. | `children`, `center?: boolean` |
| `Ornament` | `⁜ ⁂ ⁜` dividers + glow-line separators. | `variant: 'cluster' \| 'line'` |

### 2.3 Three hero variants

Live in `src/lib/components/books/system/heroes/`. Each accepts `{ book }` + surface-specific props.

- `HeroCinematic` — big cover (right), drop-cap excerpt, chips, Continue/Details/Download actions, ProgressThread.
- `HeroLiterary` — centered ornament, prose subtitle, compact resume pill.
- `HeroConstellation` — starfield SVG with animated connecting threads between books, big book copy on top. **Copy must be book-themed** (driven by current book), not generic library-wide ("eighteen stars" copy was rejected).

### 2.4 Stories

One `+stories.svelte` per primitive and per hero so the system is reviewable without touching any page. `pnpm dev` serves stories at `/stories/books`.

## 3. `/books` landing

### 3.1 Layout

| Slot | Component | Notes |
|---|---|---|
| 1. Hero (full width) | One of three hero variants | Constellation when reading, Literary otherwise. Book-themed copy. Big cover. |
| 2. Library (main col) | Tabs + filter bar + grid/list/shelf | Tabs move *inside* this section (were page-level in old design). Default sort option includes "Recently added" so it needs no separate rail. |
| 3. Right rail (sticky 280px) | `RightRailBlock` list | Quick Resume · Year Progress · 14-day Streak · One recent Highlight · "All highlights →" |
| 4. ProseStat divider | Inline italic prose | "Forty-two nights in flight this season… more in stats →" |
| 5. Deep-page links (2-col) | Two equal cards | "Stats & habits → /books/stats" and "Marginalia → /books/notes" |
| 6. Literary footer | `Ornament` + one line of Playfair italic | |

### 3.2 Breakpoints

- **≥ 1024px** — two-column: library main + 280px sticky right rail.
- **640–1023px** — right rail becomes a 4-across horizontal strip under the hero (resume · year · streak · highlight).
- **< 640px** — hero stacks (copy over compact cover). Rail collapses to a single one-line ambient bar `◆ Resume Gatsby p122 · 6-day streak` that expands to a sheet on tap.

### 3.3 States

| State | Behavior |
|---|---|
| No service | Hero → onboarding card "Connect a book service". Library empty prompt. Rail hidden. Deep-page links hidden. |
| Service offline | Hero → thin warning strip. Library "Couldn't load library" with retry. Rail hidden. ProseStat + footer hidden. |
| Empty library | Service online, zero books. Hero = Literary. Library empty prompt. Rail: only year-progress if goal set. |
| Not reading anything | Library has books, no active `play_sessions`. Hero = Literary. Rail Quick-Resume replaced with "Pick something →" CTA scrolling to library. |
| Actively reading | Default. Hero = Cinematic with current book's cover + excerpt. Rail shows last session. |
| No highlights | Rail highlight block hidden. "All highlights →" link also hidden until first highlight exists. |

### 3.4 Data wiring

`+page.server.ts` loads from existing endpoints (`/api/books`, `/api/books/stats`, `/api/books/[id]/highlights`). Source of truth is `play_sessions` (canonical since `be9bb09`). Additional derived fields: `currentBook` (most recent active session within 30 days), `recentHighlight` (single most-recent across all books), `streak14` (14-day strip). No new APIs required.

### 3.5 What's removed

- Standalone "Recently Added" `MediaRow` — folded into Library sort.
- Standalone `ReadingStatsCard` widget — replaced by rail + ProseStat + `/books/stats` link.
- `TonightCard` as a standalone block — absorbed into rail Quick-Resume.
- Goal + Genre + Heatmap 3-column widget row — goal to rail, genre bars to `/books/stats`, heatmap to rail as 14-day strip + `/books/stats` for full year.
- Marginalia grid on landing — replaced by one rail highlight + link to `/books/notes`.
- Up Next block — folded into Library (series tab already covers it).

## 4. `/books/[id]` book detail

### 4.1 Layout

1. **Hero header** — cover (left, 260px) + Playfair italic title with accent on a key word + author/year/pages meta + genre chips + Continue/Details/Download actions + ProgressThread.
2. **About this book** — drop-cap first paragraph of the book's description.
3. **Your marginalia** — up to 3 most recent highlights inline as quote cards + a "See all →" tile. Hidden if zero highlights.
4. **More from `<author>`** — 4–6 covers, ProgressThread overlay on in-flight ones. Hidden if only book by that author.
5. **In the same series** — vertical list of siblings with per-volume progress. Shows "Standalone novel" card if not in a series.
6. **Right rail** — Shelf · Editions · Sessions (total + last session) · This-week strip · From Calibre (metadata + source link).

### 4.2 States

| State | Behavior |
|---|---|
| Unread | Hero tag → "◇ UNREAD". Primary action → "Start reading". ProgressThread hidden. Sessions rail → "Not started". |
| In flight | Default. "Continue at p X". |
| Finished | Hero tag → "◇ FINISHED · N DAYS". Thread at 100%, accent-light. Primary action → "Re-read". Sessions rail summarizes total reading span. |
| No highlights | Marginalia section hidden entirely. No placeholder. |
| No description | Drop-cap section hidden. Replaced with mono line "No synopsis from Calibre metadata." |

### 4.3 Data

New derived fields in `+page.server.ts`: `sessionsCount`, `totalReadingMs`, `lastSessionAt`, `thisWeekDays` (length-7 array), `authorOtherBooks`, `seriesSiblings`. All from `play_sessions` + existing book queries. No new endpoints.

## 5. `/books/notes` marginalia hub

### 5.1 Layout

1. **Page header** — "The *marginalia*." big italic title + prose subtitle with totals.
2. **Toolbar** — All/Highlights/Notes segment · By book/Chronological/Random sort · search box · right-side entry count.
3. **Body** — book groups. Each group: small cover + book title + author + per-book counts + "Open book →" link, followed by a 2-col grid of quote cards.
4. **Right rail** — This-year totals · Tag cloud · Books list (clickable filter) · Export formats (MD/JSON/CSV).

### 5.2 Quote card variants

- **Highlight** — italic Playfair text with `"` glyph in top-left. Gold-tinted background.
- **Note** — upright Playfair text with `§` glyph in top-left. Steel left-border.
- **Favorite tag** — warm chip in meta row.

### 5.3 Data

Server-side aggregation in the page loader. No new public endpoint — only one page consumes this shape, so keeping it in-loader avoids exposing a wide API surface. Shape:

```
byBook: Array<{ book: BookRef, highlights: Highlight[], notes: Note[] }>
```

Rationale: existing `/api/books/[id]/highlights` is per-book; fetching 12+ books client-side is not tolerable. Loader-side aggregation is already the established pattern for per-page composite data in Nexus.

## 6. `/books/read/[id]` reader shell

Internal reading engines (foliate-js for EPUB, PDF.js for PDF) stay unchanged. Only the chrome is rewritten.

### 6.1 Principles

1. **Chrome auto-hides** after 2s of no interaction. Reveal on: tap-center, Esc, mouse toward top 60px, or arrow key.
2. **TOC is a drawer**, not a persistent sidebar. Opens on ≡ icon or left-swipe. Scrim over page.
3. **Annotations** = selection popover (create) + right drawer (list all).
4. **Typography / layout controls** behind an `Aa` button. Settings sheet, remembered per-book.
5. **Persistent 2px hairline progress** at very bottom edge, even when chrome hidden.
6. **Edge-tap page turn** — left 25% / right 25% of viewport. Arrow keys and space also work.

### 6.2 EPUB vs PDF — what differs

| Control | EPUB (reflowable) | PDF (fixed layout) |
|---|---|---|
| `Aa` / Layout sheet | Face · size · line-height · theme | Zoom · fit (width/page/actual) · single/spread/scroll · rotate |
| Page turn | Edge-tap, space, arrows, swipe. Reflows on size change. | Edge-tap, space, arrows. Ctrl+scroll zoom. No reflow. |
| Primary TOC | Chapter tree with per-chapter % | Embedded outline (if any) + page grid + user bookmarks |
| Thumbnails | Not shown (reflow makes them meaningless) | Left rail, toggleable, current page highlighted |
| Progress meter | Chapter + overall % + "38 min left" estimate | Page X / Y (no time estimate — pages are fixed) |
| Search | Full-text via EPUB spine | Full-text via PDF.js text layer, page-jump results |
| Annotations model | CFI ranges into EPUB spine | Page + quad-point coordinates |
| Theme | Changes page background + text color (reflow respects) | Page color unchanged (it's rendered PDF). Chrome theme still applies. |

### 6.3 Selection popover

Identical in both modes: Highlight (gold) · Favorite (warm star) · Note (steel) · Copy · Look-up.

### 6.4 Risks

- **Auto-hide trap** — mitigate with edge vignettes, Esc always reveals, 3s hover near top reveals, first-visit one-time toast.
- **foliate-js lifecycle** — keep the iframe + postMessage contract unchanged; only the shell swaps.

## 7. `/books/series/[name]` series pages

### 7.1 Layout

1. **Hero** — fanned-stack cover composition (3–4 volumes tilted, current highlighted) + series name in big Playfair + author + volume count + year range + prose blurb + big overall stat ("3 of 7 read").
2. **Reading order timeline** — vertical timeline with:
   - Gold solid dot — finished volume.
   - Pulsing gold-light dot — current volume.
   - Steel dot — "branch" entry (publication gap, spin-off, out-of-order side book).
   - Faint empty dot — unread but in library.
   - Dashed card — volume exists but not in library, with "Request" CTA.
   - Each row has cover + ordinal + title + per-volume progress bar + primary action (Continue/Open/Request).
3. **Divider** + related sections (if applicable).

### 7.2 Data

Pulls from existing `/api/books/series` endpoint. Needs series-metadata enrichment (publication gaps, branch annotations) — v1 can use naive "gap > 3 years" heuristic; richer later.

## 8. `/books/authors/[name]` author pages

### 8.1 Layout

1. **Hero** (3-column) — stylized portrait (260px, procedural SVG silhouette if no image), bio column (`Aa` tag, big italic name, dates, drop-cap bio, genre chips), stats column (RightRailBlock: in-library count, time spent, highlights count, series list).
2. **Pull quote** — one highlighted quote from the user's own marginalia of this author, oversized Playfair italic. Hidden if zero highlights.
3. **Bibliography** — grouped by series (or standalone group), 6-col cover grids per group.
4. **"If you like" row** — horizontal chips of related authors in user's library. Naive genre-match for v1.
5. **Footer ornament** + one line of italic prose.

### 8.2 Data

Pulls from existing `/api/books/authors`. Needs `authorHighlights` aggregate (highlights across all of this author's books) in the page loader. Portrait SVG fallback: procedural silhouette keyed by author initials + genre-palette shift.

## 9. Implementation strategy

### 9.1 Branch and PR

- One feature branch: `feature/books-redesign`. Worktree at `.worktrees/books-redesign/`.
- Single PR to `main` when complete. No flag, destructive swap (aligns with Parker's dev-migrations pref).
- Must pass: `pnpm check`, `pnpm test`, `pnpm build`, Docker smoke test.
- E2E auth/setup failures stay failing — out of scope, tracked separately.

### 9.2 Step order

| Step | Surface | Blocker | Notes |
|---|---|---|---|
| 0 | Design system | **Blocker for all** | 6 primitives + 3 heroes + tokens + stories in `src/lib/components/books/system/`. |
| 1 | `/books` landing | After Step 0 | Rewrite layout; delete old widgets; Library tabs move inside. |
| 2 | `/books/[id]` | After Step 0 | New page shape; add derived fields. |
| 3 | `/books/notes` | After Step 0 | Add aggregate query/endpoint. |
| 4 | Reader shell | After Step 0 | Wrap existing engines; don't touch foliate/PDF.js internals. |
| 5 | `/books/series/[name]` | After Step 1 | Shares cover + thread patterns. |
| 6 | `/books/authors/[name]` | After Step 2 | Shares bio + bibliography patterns. |

### 9.3 Risk ledger

| Area | Risk | Mitigation |
|---|---|---|
| Reader auto-hide | Medium — users can feel trapped | Edge vignettes, Esc always reveals, 3s top-edge hover reveals, first-visit toast |
| foliate-js + Svelte | Medium — chrome rebuild may conflict with iframe listeners | Keep iframe + postMessage contract unchanged |
| Destructive component swap | Low — other routes import book components being rewritten | Grep all imports of `src/lib/components/books/**` before swap; update call-sites in same PR |
| Route collisions | Low — new routes may collide with old `?tab=series` / `?tab=authors` | Add server-side redirect from old query-param to new dedicated route |
| Responsive fidelity | Medium — right rail is desktop-shaped | Explicit breakpoint behavior; Playwright smoke at 375/768/1440 |
| Author portrait fallback | Low — Calibre rarely has portraits | Procedural SVG silhouette keyed by initials + genre palette |
| PDF thumbnail perf | Medium — 300+ thumbs slow | Viewport-aware lazy render; first 20 eager, rest on scroll |

### 9.4 Testing

- **Unit** — vitest for new loader-side functions (derived fields, aggregate highlights).
- **Component** — stories / render-tests for each primitive.
- **Smoke** — `pnpm check` + `pnpm test` + Docker smoke + manual walkthrough of all six surfaces (18 screenshots: six surfaces × three breakpoints).
- **E2E** — no new e2e tests until setup-wizard fixture issue is resolved separately.

### 9.5 Canonical sources declared in this pass

Document in `src/routes/books/CLAUDE.md`:

- `play_sessions` is canonical for all book progress/session data (already established).
- The six primitives in `src/lib/components/books/system/` are the canonical vocabulary for books surfaces. Any new book component must compose from them; ad-hoc styles get flagged in review.
- Three hero variants coexist. Default per surface: Cinematic = `/books/[id]`, Literary = `/books` landing when idle, Constellation = `/books` landing when reading + series pages.
- Reader chrome behavior (auto-hide, drawer TOC, popover annotations, `Aa` sheet) is the same for EPUB and PDF — only the sheet contents differ.

## 10. Out of scope

- **`/books/stats` redesign** — Parker declared this a separate project. Landing links `→ /books/stats` point at the current page. PR description must flag the visual mismatch until that project lands.
- **E2E test fixture repair** — `e2e/auth.spec.ts` / `e2e/setup.spec.ts` broken since setup-wizard feature landed. Separate ticket; tracked in project memory.
- **Mobile polish beyond locked breakpoints** — desktop-first; mobile bug fixes as follow-up.
- **AI curator features (#44)** — "If you like" row starts naive (genre match); smarter later.
- **Kapowarr comic integration (#28)** — this redesign doesn't anticipate graphic novels yet.

## 11. Archive task

In the same PR, move `docs/superpowers/specs/2026-03-26-books-ui-redesign-design.md` to `docs/superpowers/specs/archive/2026-03-26-books-ui-redesign-design.md` with a one-line status note inserted below the title: "*Superseded by 2026-04-18-books-redesign-design.md.*" The older spec shipped (its features are in `main`); archiving aligns with the drift-discipline rule.

# Books Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the redesigned `/books` landing page: new Hero + dominant Library + sticky right rail + ProseStat + deep-page links + literary footer, composed from a new `books/system/` primitive set.

**Architecture:** Extract six primitives + three hero variants into `src/lib/components/books/system/`, a token stylesheet into `src/lib/styles/books-tokens.css`, and rewrite `src/routes/books/+page.{svelte,server.ts}`. `play_sessions` stays canonical for all reading state. No API changes.

**Tech Stack:** SvelteKit 5 runes · Drizzle ORM · better-sqlite3 · Tailwind + CSS custom properties · Vitest for loader-side tests.

**Source spec:** `docs/superpowers/specs/2026-04-18-books-redesign-design.md` §2 and §3.

**Branch:** `feature/books-redesign` at worktree `.worktrees/books-redesign/`. All work, tests, and commits happen there.

---

## Task 0: Worktree and preflight

**Files:** git state only.

- [ ] **Step 1:** Create worktree.
```bash
git worktree add .worktrees/books-redesign -b feature/books-redesign
cd .worktrees/books-redesign
```
- [ ] **Step 2:** Sanity check — confirm on branch and tree clean.
```bash
git status && git branch --show-current
```
Expected: `On branch feature/books-redesign` · `nothing to commit, working tree clean`.
- [ ] **Step 3:** `pnpm install` (shared node_modules via pnpm-workspace).

---

## Task 1: Token stylesheet

**Files:** Create `src/lib/styles/books-tokens.css`.

- [ ] **Step 1:** Write the file with the token block from spec §2.1. Scope every rule under `.books-surface`. Tokens (verbatim from spec):
```css
.books-surface {
  --void:#0d0b0a; --base:#181514; --raised:#1f1c1a; --surface:#272321;
  --cream:#f0ebe3; --muted:#a09890; --faint:#605850;
  --accent:#d4a253; --accent-lt:#e8bc6a; --accent-dim:#b8862e;
  --steel:#3d8f84; --steel-lt:#56a99d; --warm:#c45c5c;
  --font-display:'Playfair Display',Georgia,serif;
  --font-body:'DM Sans',system-ui,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,monospace;
}
```
- [ ] **Step 2:** Import once in `src/routes/books/+layout.svelte` (create if missing). In the layout, add `<div class="books-surface">{@render children()}</div>`. All children inherit the tokens; non-books routes unaffected.
- [ ] **Step 3:** Add Playfair Display, DM Sans, JetBrains Mono to `src/app.html` `<link>` block if not present. Check first: `grep "Playfair Display" src/app.html`.
- [ ] **Step 4:** `pnpm check`. Expected: passes.
- [ ] **Step 5:** Commit.
```bash
git add src/lib/styles/books-tokens.css src/routes/books/+layout.svelte src/app.html
git commit -m "feat(books): token stylesheet and .books-surface scope"
```

---

## Task 2: Ornament primitive

**Files:** Create `src/lib/components/books/system/Ornament.svelte`.

- [ ] **Step 1:** Implement:
```svelte
<script lang="ts">
  let { variant = 'cluster' }: { variant?: 'cluster' | 'line' } = $props();
</script>
{#if variant === 'cluster'}
  <div class="orn-cluster" aria-hidden="true">⁜ ⁂ ⁜</div>
{:else}
  <div class="orn-line" aria-hidden="true"></div>
{/if}
<style>
  .orn-cluster { text-align:center; color:var(--faint); letter-spacing:.5em; font-size:16px; }
  .orn-line { height:1px; background:linear-gradient(90deg,transparent,rgba(212,162,83,.35),transparent); }
</style>
```
- [ ] **Step 2:** Commit `feat(books/system): Ornament primitive`.

---

## Task 3: ProseStat primitive

**Files:** Create `src/lib/components/books/system/ProseStat.svelte`.

- [ ] **Step 1:** Implement:
```svelte
<script lang="ts">
  let { center = true, children }: { center?: boolean; children: import('svelte').Snippet } = $props();
</script>
<p class="prose-stat" class:center>{@render children()}</p>
<style>
  .prose-stat { font-family:var(--font-display); font-style:italic; font-size:13px; color:rgba(240,235,227,.72); line-height:1.55; margin:14px 0; }
  .prose-stat.center { text-align:center; }
  :global(.prose-stat strong) { color:var(--accent); font-style:normal; font-weight:700; }
</style>
```
- [ ] **Step 2:** Commit `feat(books/system): ProseStat primitive`.

---

## Task 4: ProgressThread primitive

**Files:** Create `src/lib/components/books/system/ProgressThread.svelte`.

- [ ] **Step 1:** Implement:
```svelte
<script lang="ts">
  let { value = 0, waypoints = [], variant = 'thin' }: { value?: number; waypoints?: number[]; variant?: 'thick' | 'thin' } = $props();
  const clamped = $derived(Math.max(0, Math.min(1, value)));
</script>
<div class="thread" class:thick={variant === 'thick'} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(clamped * 100)}>
  <div class="track"></div>
  <div class="fill" style="width:{clamped * 100}%"></div>
  {#each waypoints as wp}
    <span class="wp" class:done={wp <= clamped} style="left:{wp * 100}%"></span>
  {/each}
</div>
<style>
  .thread { position:relative; height:2px; width:100%; }
  .thread.thick { height:3px; }
  .track { position:absolute; inset:0; background:var(--raised); border-radius:2px; }
  .fill { position:absolute; left:0; top:0; height:100%; background:linear-gradient(90deg,var(--accent-dim),var(--accent)); border-radius:2px; box-shadow:0 0 10px rgba(212,162,83,.4); }
  .fill::after { content:''; position:absolute; right:-3px; top:-3px; width:8px; height:8px; border-radius:50%; background:var(--accent-lt); box-shadow:0 0 8px var(--accent-lt); }
  .wp { position:absolute; top:-3px; width:1px; height:8px; background:rgba(240,235,227,.15); }
  .wp.done { background:var(--accent-dim); }
</style>
```
- [ ] **Step 2:** Commit `feat(books/system): ProgressThread primitive`.

---

## Task 5: SectionHeader primitive

**Files:** Create `src/lib/components/books/system/SectionHeader.svelte`.

- [ ] **Step 1:** Implement:
```svelte
<script lang="ts">
  let {
    ordinal = '', title, meta = '', variant = 'subsection'
  }: { ordinal?: string; title: string; meta?: string; variant?: 'hero' | 'subsection' | 'aside' } = $props();
</script>
<div class="sh sh-{variant}">
  {#if ordinal}<span class="ord">{ordinal}</span>{/if}
  <h2 class="title">{@html title}</h2>
  {#if meta}<span class="meta">{meta}</span>{/if}
</div>
<style>
  .sh { display:flex; align-items:baseline; gap:14px; margin-bottom:16px; }
  .ord { font:10px/1 var(--font-mono); letter-spacing:.26em; color:var(--accent); text-transform:uppercase; }
  .title { font-family:var(--font-display); font-weight:700; letter-spacing:-.01em; margin:0; font-size:22px; }
  .sh-hero .title { font-size:48px; line-height:.98; }
  .sh-aside .title { font-size:15px; }
  .meta { font:10px/1 var(--font-mono); letter-spacing:.2em; color:var(--faint); margin-left:auto; text-transform:uppercase; }
  :global(.sh .title em) { color:var(--accent); font-style:italic; }
</style>
```
- [ ] **Step 2:** Commit `feat(books/system): SectionHeader primitive`.

---

## Task 6: BookCover primitive

**Files:** Create `src/lib/components/books/system/BookCover.svelte`.

- [ ] **Step 1:** Implement, wrapping real cover with abstract SVG fallback:
```svelte
<script lang="ts">
  import type { UnifiedMedia } from '$lib/adapters/types';
  let {
    book, size = 'md', showProgress = false, badge = ''
  }: { book: UnifiedMedia; size?: 'xs' | 'sm' | 'md' | 'lg' | 'hero'; showProgress?: boolean; badge?: string } = $props();
  const progress = $derived(book.progress ?? 0);
</script>
<div class="cov cov-{size}">
  {#if book.poster}
    <img src={book.poster} alt={book.title} loading="lazy" />
  {:else}
    <svg viewBox="0 0 120 180" aria-label={book.title}>
      <rect width="120" height="180" fill="#2a2320" />
      <text x="60" y="90" text-anchor="middle" fill="#d4a253" font-family="Playfair Display" font-style="italic" font-size="14">{book.title.slice(0, 18)}</text>
    </svg>
  {/if}
  {#if badge}<span class="badge">{badge}</span>{/if}
  {#if showProgress && progress > 0 && progress < 1}
    <div class="prog-wrap"><div class="prog" style="width:{progress * 100}%"></div></div>
  {/if}
</div>
<style>
  .cov { position:relative; aspect-ratio:2/3; border-radius:4px; overflow:hidden; box-shadow:0 8px 18px rgba(0,0,0,.4); border:1px solid rgba(240,235,227,.06); }
  .cov-xs { width:40px; } .cov-sm { width:60px; } .cov-md { width:100%; max-width:140px; }
  .cov-lg { width:100%; max-width:200px; } .cov-hero { width:100%; max-width:260px; box-shadow:0 26px 70px rgba(0,0,0,.55); }
  img, svg { width:100%; height:100%; display:block; object-fit:cover; }
  .badge { position:absolute; bottom:5px; left:5px; font:8px/1 var(--font-mono); letter-spacing:.15em; padding:3px 6px; background:rgba(13,11,10,.85); border-radius:3px; color:var(--accent-lt); text-transform:uppercase; }
  .prog-wrap { position:absolute; left:0; right:0; bottom:0; height:2px; background:rgba(13,11,10,.6); }
  .prog { height:100%; background:var(--accent); }
</style>
```
- [ ] **Step 2:** `pnpm check`. Expected: passes (type imports resolve).
- [ ] **Step 3:** Commit `feat(books/system): BookCover primitive`.

---

## Task 7: RightRailBlock primitive

**Files:** Create `src/lib/components/books/system/RightRailBlock.svelte`.

- [ ] **Step 1:** Implement:
```svelte
<script lang="ts">
  let {
    label, linkText = '', linkHref = '', children
  }: { label: string; linkText?: string; linkHref?: string; children: import('svelte').Snippet } = $props();
</script>
<div class="rr-item">
  <div class="rr-label">{label}</div>
  {@render children()}
  {#if linkText && linkHref}<a class="rr-link" href={linkHref}>{linkText} →</a>{/if}
</div>
<style>
  .rr-item { padding:14px 0; border-bottom:1px solid rgba(240,235,227,.05); }
  .rr-item:last-child { border:none; }
  .rr-label { font:9px/1 var(--font-mono); letter-spacing:.22em; color:var(--faint); text-transform:uppercase; margin-bottom:8px; }
  .rr-link { display:inline-block; margin-top:8px; font:10px/1 var(--font-mono); letter-spacing:.22em; color:var(--accent); text-transform:uppercase; }
</style>
```
- [ ] **Step 2:** Commit `feat(books/system): RightRailBlock primitive`.

---

## Task 8: Hero variants

**Files:** Create `src/lib/components/books/system/heroes/{HeroCinematic,HeroLiterary,HeroConstellation}.svelte`.

- [ ] **Step 1: HeroLiterary.** Centered Playfair prose hero. Props: `{ totalBooks, nightsCount, currentBook? }`. Body: ornament-cluster, mono tagline `THE READING ROOM · NOW OPEN`, h1 `A library at the <em>nexus</em> of the universe`, Playfair italic prose subtitle referencing totals, optional compact resume pill if `currentBook`. Ornament at top and bottom.
- [ ] **Step 2: HeroCinematic.** Two-column: copy (left) + big cover (right). Props: `{ book }` (UnifiedMedia with progress). Body: `◇ CURRENTLY READING · CH X · Y% COMPLETE` tag, h1 `{book.title}` with accent on last word, Playfair italic meta line `{author} · {year} · {pages} pages`, drop-cap excerpt (first paragraph of `book.description` or fallback), CTAs `Continue at p{page}` + `Details`, `ProgressThread variant="thick"` with waypoints every 10%. Right column: `<BookCover size="hero">`.
- [ ] **Step 3: HeroConstellation.** Props: `{ book, totalBooks, activeCount }`. SVG starfield backdrop (9–12 pulsing dots connected by lines). Copy must be book-themed, not generic library stats: `◇ READING MAP` tag, h1 `Tonight, <em>{book.title}</em>`, Playfair italic subtitle referencing the specific book + total library (e.g. "One of {total} volumes on the shelf, currently brightest."). Right column: medium cover with glow.
- [ ] **Step 4:** `pnpm check`. Expected: passes.
- [ ] **Step 5:** Commit `feat(books/system): three hero variants`.

---

## Task 9: Loader — add derived fields

**Files:** Modify `src/routes/books/+page.server.ts`. Add helper in `src/lib/server/books/landing.ts`.

- [ ] **Step 1: Write failing test** at `src/lib/server/__tests__/books-landing.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeStreak14, pickCurrentBook, computeYearProgress } from '../books/landing';

describe('books landing derived fields', () => {
  const now = new Date('2026-04-18T12:00:00Z').getTime();
  it('computeStreak14 returns 14 booleans, most-recent last', () => {
    const sessions = [{ updatedAt: now - 86400_000, durationMs: 1800_000 }];
    const strip = computeStreak14(sessions, now);
    expect(strip).toHaveLength(14);
    expect(strip[12]).toBe(true);  // yesterday
    expect(strip[13]).toBe(false); // today
  });
  it('pickCurrentBook returns most recent within 30d', () => {
    const sessions = [
      { mediaId: 'old', updatedAt: now - 40 * 86400_000, endedAt: null, progress: 0.1 },
      { mediaId: 'new', updatedAt: now - 86400_000, endedAt: null, progress: 0.5 }
    ];
    expect(pickCurrentBook(sessions, now)).toBe('new');
  });
  it('pickCurrentBook returns null when all sessions older than 30d', () => {
    const sessions = [{ mediaId: 'x', updatedAt: now - 40 * 86400_000, endedAt: null, progress: 0.1 }];
    expect(pickCurrentBook(sessions, now)).toBeNull();
  });
  it('computeYearProgress counts distinct completed books this year', () => {
    const jan1 = new Date('2026-01-01T00:00:00Z').getTime();
    const sessions = [
      { mediaId: 'a', completed: 1, updatedAt: jan1 + 86400_000 },
      { mediaId: 'a', completed: 1, updatedAt: jan1 + 172800_000 },
      { mediaId: 'b', completed: 1, updatedAt: jan1 + 200000_000 }
    ];
    expect(computeYearProgress(sessions, now).booksThisYear).toBe(2);
  });
});
```
- [ ] **Step 2: Run, verify it fails:** `pnpm vitest run src/lib/server/__tests__/books-landing.test.ts` — expected: ENOENT on helper module.
- [ ] **Step 3: Create helper** `src/lib/server/books/landing.ts`:
```ts
type SessionRow = { mediaId?: string; updatedAt: number; endedAt?: number | null; durationMs?: number | null; progress?: number | null; completed?: number | null };

const DAY = 86400_000;
const THIRTY_DAYS = 30 * DAY;

export function computeStreak14(sessions: SessionRow[], now: number): boolean[] {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const startOfToday = today.getTime();
  const strip = Array<boolean>(14).fill(false);
  for (const s of sessions) {
    if ((s.durationMs ?? 0) < 60_000) continue;
    const dayIndex = Math.floor((s.updatedAt - startOfToday) / DAY) + 13;
    if (dayIndex >= 0 && dayIndex < 14) strip[dayIndex] = true;
  }
  return strip;
}

export function pickCurrentBook(sessions: SessionRow[], now: number): string | null {
  const active = sessions
    .filter(s => s.mediaId && s.updatedAt >= now - THIRTY_DAYS && (s.progress ?? 0) > 0 && (s.progress ?? 0) < 1)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return active[0]?.mediaId ?? null;
}

export function computeYearProgress(sessions: SessionRow[], now: number, goal = 40): { booksThisYear: number; goal: number } {
  const yearStart = new Date(new Date(now).getFullYear(), 0, 1).getTime();
  const done = new Set<string>();
  for (const s of sessions) {
    if (s.completed && s.updatedAt >= yearStart && s.mediaId) done.add(s.mediaId);
  }
  return { booksThisYear: done.size, goal };
}
```
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5: Wire into loader.** In `+page.server.ts`, replace the `readingStats` block with:
```ts
import { computeStreak14, pickCurrentBook, computeYearProgress } from '$lib/server/books/landing';

// inside load(), after existing sessionRows block and items enrichment:
const now = Date.now();
let currentBook: UnifiedMedia | null = null;
let streak14: boolean[] = Array<boolean>(14).fill(false);
let yearProgress = { booksThisYear: 0, goal: 40 };
let recentHighlight: { text: string; bookTitle: string; chapter?: string; bookId: string } | null = null;

if (userId) {
  const db = getDb();
  const fullSessions = db.select({
    mediaId: schema.playSessions.mediaId,
    updatedAt: schema.playSessions.updatedAt,
    durationMs: schema.playSessions.durationMs,
    progress: schema.playSessions.progress,
    completed: schema.playSessions.completed,
    endedAt: schema.playSessions.endedAt
  })
    .from(schema.playSessions)
    .where(and(
      eq(schema.playSessions.userId, userId),
      eq(schema.playSessions.mediaType, 'book'),
      eq(schema.playSessions.serviceId, calibreConfig.id)
    ))
    .all();

  streak14 = computeStreak14(fullSessions, now);
  yearProgress = computeYearProgress(fullSessions, now);

  const currentId = pickCurrentBook(fullSessions, now);
  if (currentId) currentBook = allBooks.find(b => b.sourceId === currentId) ?? null;

  if (currentBook && adapter?.getServiceData) {
    try {
      const highlights = await adapter.getServiceData(calibreConfig, 'highlights', { bookId: currentBook.sourceId }, userCred) as any[];
      if (highlights && highlights.length > 0) {
        const h = highlights[0];
        recentHighlight = {
          text: h.text ?? h.quote ?? '',
          bookTitle: currentBook.title,
          chapter: h.chapter,
          bookId: currentBook.id
        };
      }
    } catch { /* highlights are optional */ }
  }
}
```
Remove the old `readingStats`, `recentlyAdded`, and `continueReading` fields from the loader return. Add `currentBook`, `streak14`, `yearProgress`, `recentHighlight` instead. If the Calibre adapter doesn't support `'highlights'` as a `getServiceData` kind, leave `recentHighlight = null` and move on — do not block on this.
- [ ] **Step 6:** `pnpm check && pnpm vitest run`. Expected: passes.
- [ ] **Step 7:** Commit `feat(books): landing loader derived fields (currentBook, streak14, yearProgress, recentHighlight)`.

---

## Task 10: Rewrite `+page.svelte`

**Files:** Modify `src/routes/books/+page.svelte` (full rewrite; keep the import list short).

- [ ] **Step 1:** Back up the existing 449-line file via git, then start from scratch. New top-level structure:
```svelte
<script lang="ts">
  import type { PageData } from './$types';
  import HeroCinematic from '$lib/components/books/system/heroes/HeroCinematic.svelte';
  import HeroLiterary  from '$lib/components/books/system/heroes/HeroLiterary.svelte';
  import HeroConstellation from '$lib/components/books/system/heroes/HeroConstellation.svelte';
  import RightRailBlock from '$lib/components/books/system/RightRailBlock.svelte';
  import ProgressThread from '$lib/components/books/system/ProgressThread.svelte';
  import ProseStat from '$lib/components/books/system/ProseStat.svelte';
  import Ornament from '$lib/components/books/system/Ornament.svelte';
  import SectionHeader from '$lib/components/books/system/SectionHeader.svelte';
  import BookCover from '$lib/components/books/system/BookCover.svelte';
  import BookshelfView from '$lib/components/books/BookshelfView.svelte';
  import BookListRow from '$lib/components/books/BookListRow.svelte';
  import SeriesCard from '$lib/components/books/SeriesCard.svelte';
  import SeriesCollapsedCard from '$lib/components/books/SeriesCollapsedCard.svelte';
  import AuthorCard from '$lib/components/books/AuthorCard.svelte';
  import MediaCard from '$lib/components/MediaCard.svelte';

  let { data }: { data: PageData } = $props();
  let viewMode = $state<'grid' | 'list' | 'shelf'>('grid');
  let localQuery = $state('');
  let collapseSeries = $state(false);

  const streakCount = $derived(data.streak14?.filter(Boolean).length ?? 0);
  const activeTab = $derived(data.tab);

  // Preserve from old file: filtered, displayItems, cols, visibleRange,
  // updateVisibleRange, useVirtualScrolling — copy those blocks verbatim.

  function currentPageLabel(book: { progress?: number }): string {
    const pct = Math.round((book.progress ?? 0) * 100);
    return pct > 0 ? `${pct}% · resume` : 'start reading';
  }

  function buildUrl(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    const current = { sort: data.sortBy, category: data.category, author: data.author, status: data.status, tab: data.tab };
    for (const [k, v] of Object.entries({ ...current, ...overrides })) if (v) params.set(k, v);
    return `/books?${params}`;
  }
</script>
```
- [ ] **Step 2:** Outer page wrap:
```svelte
<svelte:head><title>Books — Nexus</title></svelte:head>
<div class="books-page">
  <!-- 1. Hero -->
  {#if !data.hasBookService}
    <!-- onboarding hero (state: no service) -->
  {:else if data.serviceStatus === 'offline'}
    <!-- warning strip -->
  {:else if data.currentBook}
    <HeroCinematic book={data.currentBook} />
  {:else}
    <HeroLiterary totalBooks={data.total} nightsCount={data.streak14.filter(Boolean).length} />
  {/if}

  <!-- 2 + 3 main+rail grid -->
  <div class="main-grid">
    <section class="lib-col" id="library">
      <SectionHeader ordinal="◇ LIBRARY" title="Your library" meta={`${data.total} book${data.total === 1 ? '' : 's'}`} />

      <!-- Tabs (moved INSIDE the library section) -->
      {#if data.series.length > 0 || data.authors.length > 1}
        <nav class="tabs">
          {#each [{id:'all',label:'All Books'},{id:'series',label:'Series'},{id:'authors',label:'Authors'}] as t (t.id)}
            {#if t.id === 'all' || (t.id === 'series' && data.series.length > 0) || (t.id === 'authors' && data.authors.length > 1)}
              <a href={buildUrl({ tab: t.id })} class:active={activeTab === t.id}>{t.label}</a>
            {/if}
          {/each}
        </nav>
      {/if}

      <!-- Filter bar + grid/list/shelf body: copy verbatim from the OLD +page.svelte
           (lines ~213–446 in git show HEAD:src/routes/books/+page.svelte). Specifically:
           - Category chips, Sort segment, Status filter, Collapse-series toggle,
             View-mode toggle, Quick-filter input
           - The three view bodies: shelf (BookshelfView), list (BookListRow),
             grid (with virtual scrolling and SeriesCollapsedCard)
           - Empty/error states (isFailedLoad, isEmptyLibrary)
           Do NOT alter their internals; only the surrounding page structure changed. -->
    </section>

    <aside class="rail">
      <!-- populated in Task 11 -->
    </aside>
  </div>

  <!-- 4. ProseStat divider -->
  <ProseStat>
    {#snippet children()}
      Forty-two nights in flight this season · a streak of <strong>{streakCount}</strong>. <span class="more-link">More in stats →</span>
    {/snippet}
  </ProseStat>

  <!-- 5. Deep-page links -->
  <div class="deep-links">
    <a href="/books/stats" class="deep-card">…</a>
    <a href="/books/notes" class="deep-card">…</a>
  </div>

  <!-- 6. Literary footer -->
  <footer class="lit-footer">
    <Ornament variant="cluster" />
    <ProseStat>{#snippet children()}You've been reading at Nexus for <strong>{streakCount}</strong> nights this season.{/snippet}</ProseStat>
  </footer>
</div>
```
- [ ] **Step 3:** Copy the library tabs + filter bar + grid/list/shelf body from the old file **as-is** (preserve virtual scrolling + series collapsing), with one change: the tab bar (`All Books / Series / Authors`) moves *inside* `.lib-col`, not above the page. Change the "Recently added" sort option to be default when `data.sortBy === ''`.
- [ ] **Step 4:** Responsive CSS (scoped in the `.books-page` style block):
```css
.books-page { padding-bottom:60px; }
.tabs { display:flex; gap:0; border-bottom:1px solid var(--surface); margin:14px 0 18px; }
.tabs a { padding:10px 18px; font-size:13px; font-weight:500; color:var(--muted); position:relative; }
.tabs a.active { color:var(--cream); }
.tabs a.active::after { content:''; position:absolute; left:8px; right:8px; bottom:0; height:2px; background:var(--accent); border-radius:1px; }
.main-grid { display:grid; grid-template-columns:minmax(0,1fr) 280px; gap:32px; padding:20px 28px; }
.rail { position:sticky; top:14px; align-self:start; background:var(--base); border:1px solid rgba(240,235,227,.06); border-radius:10px; padding:4px 16px; }
.deep-links { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:0 28px; }
.lit-footer { text-align:center; padding:40px 28px 60px; }
@media (max-width: 1023px) {
  .main-grid { grid-template-columns:1fr; }
  .rail { position:static; display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
}
@media (max-width: 639px) {
  .rail { display:block; padding:8px 14px; }
  .rail :global(.rr-item:nth-child(n+3)) { display:none; }
  .deep-links { grid-template-columns:1fr; }
}
```
- [ ] **Step 5:** Delete the `ReadingStatsCard` import + render. Grep first: `grep -rn "ReadingStatsCard" src/` — expected: zero other importers (already verified). Leave the file itself (other routes could use it later).
- [ ] **Step 6:** `pnpm check`. Expected: passes.
- [ ] **Step 7:** Commit `feat(books): rewrite /books landing with new layout + system primitives`.

---

## Task 11: Right rail blocks

**Files:** Modify the rail section inside `+page.svelte`.

- [ ] **Step 1:** Populate blocks. Order: Quick Resume (if `data.currentBook`) / "Pick something →" (if not reading but has books) / hidden (if no books). Then Year Progress, then Streak14, then Recent Highlight (if `data.recentHighlight`), then "All highlights →" link.
```svelte
<RightRailBlock label="Tonight">
  {#snippet children()}
    {#if data.currentBook}
      <div class="qr-row">
        <BookCover book={data.currentBook} size="xs" />
        <div>
          <div class="qr-title">{data.currentBook.title}</div>
          <div class="qr-meta">{currentPageLabel(data.currentBook)}</div>
        </div>
        <a class="qr-btn" href="/books/read/{data.currentBook.id}">Open</a>
      </div>
    {:else if data.total > 0}
      <a class="qr-cta" href="#library">Pick something →</a>
    {/if}
  {/snippet}
</RightRailBlock>

<RightRailBlock label="Year progress">
  {#snippet children()}
    <div class="yp-row"><span class="yp-big">{data.yearProgress.booksThisYear}</span><span class="yp-unit">/ {data.yearProgress.goal} books</span></div>
    <ProgressThread value={data.yearProgress.booksThisYear / data.yearProgress.goal} />
  {/snippet}
</RightRailBlock>

<RightRailBlock label="Last 14 nights">
  {#snippet children()}
    <div class="streak">
      {#each data.streak14 as hit}<span class="s" class:on={hit}></span>{/each}
    </div>
  {/snippet}
</RightRailBlock>

{#if data.recentHighlight}
  <RightRailBlock label="Recent highlight" linkText="All highlights" linkHref="/books/notes">
    {#snippet children()}
      <div class="hl-quote">"{data.recentHighlight.text}"</div>
      <div class="hl-cite">{data.recentHighlight.bookTitle} · {data.recentHighlight.chapter ?? ''}</div>
    {/snippet}
  </RightRailBlock>
{/if}
```
- [ ] **Step 2:** `pnpm check && pnpm vitest run`. Expected: passes.
- [ ] **Step 3:** Commit `feat(books): landing right rail`.

---

## Task 12: Full verification

- [ ] **Step 1:** `pnpm check` — expected: clean.
- [ ] **Step 2:** `pnpm test` — expected: all green including new `books-landing.test.ts`.
- [ ] **Step 3:** `pnpm build` — expected: succeeds.
- [ ] **Step 4:** `pnpm dev` and manually walk `/books` in three viewport widths (1440, 768, 375). Verify each state per spec §3.3: service unconfigured, service offline (stop Calibre if possible, otherwise simulate via empty config), no current book, actively reading. Capture one screenshot per state.
- [ ] **Step 5:** Docker smoke: `docker build . && docker run --rm -p 3030:3000 <tag>` — ping `/books` and verify 200.
- [ ] **Step 6:** Final commit if any polish needed; then push branch:
```bash
git push -u origin feature/books-redesign
```
- [ ] **Step 7:** Stay on the branch — do NOT merge. Parker reviews before merge.

---

## Acceptance criteria

- `/books` renders the six slots in order (hero · library · rail · prose · deep-links · footer) on desktop ≥1024px.
- Library tabs (All / Series / Authors), filters, grid/list/shelf, virtual scrolling, series collapsing all still work.
- `currentBook`, `streak14`, `yearProgress`, `recentHighlight` are populated from `play_sessions` and render in the right rail.
- `ReadingStatsCard`, the "Recently Added" `MediaRow`, and the old in-page "Continue Reading" `MediaRow` no longer render on `/books`.
- `pnpm check`, `pnpm test`, `pnpm build` all pass.
- Six primitives + three heroes live in `src/lib/components/books/system/`.
- Branch `feature/books-redesign` is pushed; no merge.

---

## Out of scope (explicit)

- `/books/[id]`, `/books/notes`, `/books/read/[id]`, `/books/series/**`, `/books/authors/**`
- Archiving the 2026-03-26 spec
- New aggregate endpoint for notes
- Mobile polish beyond the locked breakpoints
- e2e test repair

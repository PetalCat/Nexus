<script lang="ts">
  import type { PageData } from './$types';
  import BookCover from '$lib/components/books/system/BookCover.svelte';
  import SectionHeader from '$lib/components/books/system/SectionHeader.svelte';
  import RightRailBlock from '$lib/components/books/system/RightRailBlock.svelte';
  import ProgressThread from '$lib/components/books/system/ProgressThread.svelte';
  import Ornament from '$lib/components/books/system/Ornament.svelte';
  import ProseStat from '$lib/components/books/system/ProseStat.svelte';

  let { data }: { data: PageData } = $props();

  // ── Derived book fields ──────────────────────────────────────────────────
  const book = $derived(data.book);
  const progress = $derived(book.progress ?? 0);
  const pct = $derived(Math.round(progress * 100));
  const pages = $derived((book.metadata?.pages as number | undefined) ?? 0);
  const currentPage = $derived(pages > 0 ? Math.round(progress * pages) : 0);
  const author = $derived(book.metadata?.author as string | undefined);
  const year = $derived(book.year);
  const rating = $derived(book.rating);
  const chapter = $derived(book.metadata?.chapter as string | number | undefined);
  const seriesName = $derived(book.metadata?.series as string | undefined);
  const isbn = $derived(book.metadata?.isbn as string | undefined);
  const formats = $derived(book.metadata?.formats as string[] | undefined);
  const completed = $derived(!!(book.metadata?.readStatus));

  // Shelf label
  const shelfLabel = $derived(
    completed ? 'FINISHED' : progress > 0 ? 'IN YOUR LIBRARY' : 'UNREAD'
  );

  // Split title: last word gets em accent, or single word entirely wrapped
  const titleWords = $derived(book.title.trim().split(/\s+/));
  const titleFirst = $derived(titleWords.length > 1 ? titleWords.slice(0, -1).join(' ') : '');
  const titleLast = $derived(titleWords[titleWords.length - 1]);

  // Meta line: author · year · pages, join with ·, skip missing
  const metaParts = $derived(
    [
      author ?? null,
      year != null ? String(year) : null,
      pages > 0 ? `${pages} pages` : null
    ].filter((v): v is string => v !== null)
  );

  // Minutes left: 1.5 min/page heuristic
  const pagesLeft = $derived(pages > 0 ? pages - currentPage : 0);
  const minutesLeft = $derived(Math.round(pagesLeft * 1.5));
  const showMinutes = $derived(progress > 0 && progress < 1 && pagesLeft > 0);

  // Date when reading was first started
  const startedDate = $derived((() => {
    const sessions = data.sessionsCount > 0;
    // We don't have startedAt in scope, so derive from lastSessionAt as fallback
    return null; // startedAt not available in returned data; show — per spec
  })());

  // Description first paragraph
  const descriptionFirst = $derived(
    book.description ? book.description.split(/\n\n/)[0]?.trim() || '' : ''
  );

  // ── Right rail helpers ──────────────────────────────────────────────────
  const shelfDisplay = $derived(
    completed ? 'Finished' : progress > 0 ? 'Currently reading' : 'Unread'
  );

  function formatMs(ms: number): string {
    const totalMin = Math.floor(ms / 60_000);
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    if (hh === 0) return `${mm}m`;
    return `${hh}h ${mm}m`;
  }

  function formatDate(ts: number | null): string {
    if (!ts) return '—';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(ts));
  }

  // ── Series helpers ──────────────────────────────────────────────────────
  function toRoman(n: number): string {
    if (!n || n < 1) return '?';
    const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
    const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
    let result = '';
    let remaining = n;
    for (let i = 0; i < vals.length; i++) {
      while (remaining >= vals[i]) { result += syms[i]; remaining -= vals[i]; }
    }
    return result;
  }
</script>

<svelte:head><title>{book.title} — Books — Nexus</title></svelte:head>

<div class="book-detail">

  <!-- ── Hero header ──────────────────────────────────────────────────────── -->
  <section class="hero" aria-label="Book hero">
    <div class="hero-backdrop" aria-hidden="true">
      <div class="hero-glow"></div>
    </div>

    <div class="hero-inner">
      <!-- Left: cover -->
      <div class="hero-cover">
        <div class="cover-halo">
          <BookCover {book} size="hero" showProgress={false} />
        </div>
      </div>

      <!-- Right: info + actions -->
      <div class="hero-copy">
        <!-- Tag pill -->
        <p class="tag-pill">
          <span>
            ◇ {shelfLabel}{#if shelfLabel !== 'UNREAD'} · {pct}% READ{/if}
          </span>
        </p>

        <!-- Title -->
        <h1>
          {#if titleFirst}<span class="title-main">{titleFirst} </span>{/if}<em class="title-accent">{titleLast}</em>
        </h1>

        <!-- Meta: author · year · pages -->
        {#if metaParts.length > 0}
          <p class="meta-line">{metaParts.join(' · ')}</p>
        {/if}

        <!-- Genre chips + rating -->
        {#if (book.genres && book.genres.length > 0) || rating != null}
          <div class="chip-row">
            {#each (book.genres ?? []).slice(0, 3) as genre}
              <span class="chip chip-genre">{genre}</span>
            {/each}
            {#if rating != null}
              <span class="chip chip-neutral">★ {rating.toFixed(1)}</span>
            {/if}
          </div>
        {/if}

        <!-- CTA row -->
        <div class="cta-row">
          {#if progress > 0 && progress < 1}
            <!-- In flight -->
            <a href="/books/read/{book.id}" class="btn btn-primary">Continue at p{currentPage}</a>
            <a href="#details" class="btn btn-ghost">Details</a>
            <a href="/api/books/{book.sourceId}/download" class="btn btn-ghost">Download</a>
          {:else if completed}
            <!-- Finished -->
            <a href="/books/read/{book.id}" class="btn btn-primary">Re-read</a>
            <a href="#details" class="btn btn-ghost">Details</a>
            <a href="/api/books/{book.sourceId}/download" class="btn btn-ghost">Download</a>
          {:else}
            <!-- Unread -->
            <a href="/books/read/{book.id}" class="btn btn-primary">Start reading</a>
            <a href="#details" class="btn btn-ghost">Details</a>
            <a href="/api/books/{book.sourceId}/download" class="btn btn-ghost">Download</a>
          {/if}
          {#if showMinutes}
            <span class="est-time">≈ {minutesLeft} min left</span>
          {/if}
        </div>

        <!-- Progress thread (hide when unread) -->
        {#if shelfLabel !== 'UNREAD'}
          <div class="progress-block">
            <ProgressThread variant="thick" value={progress} waypoints={[0.1, 0.25, 0.5, 0.75, 0.9]} />
            <p class="progress-meta">
              PAGE {currentPage} OF {pages > 0 ? pages : '—'} · CH {chapter ?? '—'} · STARTED {startedDate ?? '—'}
            </p>
          </div>
        {/if}
      </div>
    </div>
  </section>

  <!-- ── Body + Rail ─────────────────────────────────────────────────────── -->
  <div class="body-grid" id="details">

    <!-- Main column -->
    <main class="main-col">

      <!-- §I About this book -->
      <section class="body-section">
        <SectionHeader ordinal="◇ I" title="About this book" meta="From the publisher" />
        {#if descriptionFirst}
          <p class="drop-cap">{descriptionFirst}</p>
        {:else}
          <p class="no-data">No synopsis from Calibre metadata.</p>
        {/if}
      </section>

      <!-- §II Your marginalia (only if highlights exist) -->
      {#if data.highlights.length > 0}
        <section class="body-section">
          <SectionHeader
            ordinal="◇ II"
            title="Your marginalia"
            meta="{data.highlights.length} highlight{data.highlights.length === 1 ? '' : 's'}"
          />
          <div class="highlights-grid">
            {#each data.highlights as hl (hl.id)}
              <blockquote class="hl-card">
                <span class="hl-glyph">"</span>
                <p class="hl-text">{hl.text}</p>
                {#if hl.chapter}
                  <cite class="hl-cite">{hl.chapter}</cite>
                {/if}
              </blockquote>
            {/each}
            <a href="/books/notes" class="hl-more-tile">
              <span>All your highlights →</span>
            </a>
          </div>
        </section>
      {/if}

      <!-- §III More from author (only if other books exist) -->
      {#if data.authorOtherBooks.length > 0 && author}
        <section class="body-section">
          <SectionHeader
            ordinal="◇ III"
            title="More from {author}"
            meta="{data.authorOtherBooks.length} in your library"
          />
          <div class="author-grid">
            {#each data.authorOtherBooks as b (b.id)}
              <a href="/books/{b.id}" class="author-book">
                <BookCover book={b} size="md" showProgress />
                <p class="author-book-title">{b.title}</p>
                {#if b.year != null}
                  <p class="author-book-year">{b.year}</p>
                {/if}
              </a>
            {/each}
          </div>
        </section>
      {/if}

      <!-- §IV In the same series (always render) -->
      <section class="body-section">
        <SectionHeader ordinal="◇ IV" title="In the same series" />
        {#if data.seriesSiblings.length <= 1}
          <div class="standalone-card">
            <span class="standalone-icon">◆</span>
            <div>
              <p class="standalone-title">Standalone novel</p>
              <p class="standalone-sub">This book is not part of a series in your library.</p>
            </div>
          </div>
        {:else}
          <ul class="series-list" role="list">
            {#each data.seriesSiblings as sibling (sibling.id)}
              {@const idx = (sibling.metadata?.seriesIndex as number | undefined) ?? 0}
              {@const isCurrentBook = sibling.id === book.id}
              <li class="series-row" class:series-row-current={isCurrentBook}>
                <a href="/books/{sibling.id}" class="series-link">
                  <span class="series-ordinal">{toRoman(Math.round(idx))}</span>
                  <span class="series-info">
                    <span class="series-title">{sibling.title}</span>
                    {#if sibling.year != null}
                      <span class="series-year">{sibling.year}</span>
                    {/if}
                  </span>
                  <span class="series-progress-wrap">
                    <ProgressThread variant="thin" value={sibling.progress ?? 0} />
                  </span>
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

    </main>

    <!-- Right rail -->
    <aside class="rail" aria-label="Book details sidebar">

      <RightRailBlock label="Shelf" linkText="Change" linkHref="#">
        {#snippet children()}
          <p class="rr-value">{shelfDisplay}</p>
        {/snippet}
      </RightRailBlock>

      {#if formats && formats.length > 0}
        <RightRailBlock label="Editions">
          {#snippet children()}
            <div class="format-chips">
              {#each formats as fmt}
                <span class="chip chip-format">{fmt}</span>
              {/each}
            </div>
          {/snippet}
        </RightRailBlock>
      {/if}

      <RightRailBlock label="Sessions">
        {#snippet children()}
          {#if data.sessionsCount > 0}
            <p class="rr-value">{data.sessionsCount} session{data.sessionsCount === 1 ? '' : 's'} · {formatMs(data.totalReadingMs)}</p>
            <p class="rr-sub">LAST: {formatDate(data.lastSessionAt)}</p>
          {:else}
            <p class="rr-value rr-muted">Not started</p>
          {/if}
        {/snippet}
      </RightRailBlock>

      <RightRailBlock label="This week">
        {#snippet children()}
          <div class="week-strip">
            {#each data.thisWeekDays as active, i (i)}
              <span class="week-cell" class:week-cell-on={active} title={active ? 'Read this day' : 'No reading'}></span>
            {/each}
          </div>
        {/snippet}
      </RightRailBlock>

      <RightRailBlock label="From Calibre" linkText="Open source" linkHref="#">
        {#snippet children()}
          <div class="calibre-meta">
            {#if book.year != null}
              <p class="rr-sub">Added {book.year}</p>
            {/if}
            {#if isbn}
              <p class="rr-sub">Serial {isbn}</p>
            {/if}
          </div>
        {/snippet}
      </RightRailBlock>

    </aside>
  </div>

  <!-- ── Footer ───────────────────────────────────────────────────────────── -->
  <footer class="lit-footer">
    <Ornament variant="cluster" />
    <Ornament variant="line" />
    <ProseStat>
      {#snippet children()}
        Fifteen days in flight. Thirty-eight minutes to the next chapter of <em>{book.title}</em>.
      {/snippet}
    </ProseStat>
  </footer>

</div>

<style>
  .book-detail {
    padding-bottom: 60px;
  }

  /* ── Hero ──────────────────────────────────────────────────────────────── */
  .hero {
    position: relative;
    overflow: hidden;
    background: var(--void);
    border-radius: 8px;
    margin: 0 0 0 0;
  }

  .hero-backdrop {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
  }

  .hero-glow {
    position: absolute;
    top: -100px;
    left: 50%;
    transform: translateX(-50%);
    width: 700px;
    height: 700px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(212,162,83,.1) 0%, transparent 65%);
  }

  .hero-inner {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 32px;
    padding: 32px;
    align-items: start;
  }

  .hero-cover {
    display: flex;
    justify-content: center;
  }

  .cover-halo {
    position: relative;
  }

  .cover-halo::before {
    content: '';
    position: absolute;
    inset: -24px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(212,162,83,.15) 0%, transparent 65%);
    pointer-events: none;
    z-index: -1;
  }

  .hero-copy {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Tag pill */
  .tag-pill {
    display: inline-flex;
    margin: 0;
  }

  .tag-pill span {
    font: 10px/1 var(--font-mono);
    letter-spacing: .18em;
    color: var(--accent);
    text-transform: uppercase;
    background: rgba(212,162,83,.08);
    border: 1px solid rgba(212,162,83,.2);
    border-radius: 20px;
    padding: 5px 14px;
  }

  /* Title */
  h1 {
    font-family: var(--font-display);
    font-size: 48px;
    line-height: 1.04;
    font-weight: 700;
    color: var(--cream);
    margin: 0;
    letter-spacing: -.02em;
  }

  .title-main {
    display: inline;
  }

  .title-accent {
    font-style: italic;
    color: var(--accent-lt);
  }

  /* Meta line */
  .meta-line {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 16px;
    color: var(--muted);
    margin: 0;
  }

  /* Chip row */
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: inline-block;
    border-radius: 100px;
    padding: 4px 10px;
    font: 10px/1 var(--font-mono);
    letter-spacing: .12em;
    text-transform: uppercase;
  }

  .chip-genre {
    background: rgba(240,235,227,.06);
    color: var(--muted);
    border: 1px solid rgba(240,235,227,.1);
  }

  .chip-neutral {
    background: rgba(212,162,83,.08);
    color: var(--accent-lt);
    border: 1px solid rgba(212,162,83,.2);
  }

  /* CTA row */
  .cta-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .btn {
    font: 13px/1 var(--font-mono);
    letter-spacing: .08em;
    padding: 10px 20px;
    border-radius: 4px;
    text-decoration: none;
    transition: opacity .15s;
  }

  .btn:hover {
    opacity: .8;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--void);
    font-weight: 700;
  }

  .btn-ghost {
    background: transparent;
    border: 1px solid rgba(212,162,83,.35);
    color: var(--accent-lt);
  }

  .est-time {
    font: 11px/1 var(--font-mono);
    letter-spacing: .1em;
    color: var(--muted);
  }

  /* Progress block */
  .progress-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .progress-meta {
    font: 10px/1 var(--font-mono);
    letter-spacing: .18em;
    color: var(--faint);
    margin: 0;
    text-transform: uppercase;
  }

  /* ── Body + Rail grid ──────────────────────────────────────────────────── */
  .body-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 40px;
    padding: 32px;
  }

  /* ── Main column ───────────────────────────────────────────────────────── */
  .main-col {
    display: flex;
    flex-direction: column;
    gap: 40px;
    min-width: 0;
  }

  .body-section {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* Drop-cap */
  .drop-cap {
    font-family: var(--font-display);
    font-size: 16px;
    line-height: 1.7;
    color: rgba(240,235,227,.82);
    margin: 0;
  }

  .drop-cap::first-letter {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 3.6em;
    line-height: .8;
    float: left;
    color: var(--accent);
    margin: 0 8px 0 0;
    padding-top: 4px;
  }

  .no-data {
    font: 12px/1.4 var(--font-mono);
    letter-spacing: .14em;
    color: var(--faint);
    text-transform: uppercase;
    margin: 0;
  }

  /* Highlights grid */
  .highlights-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .hl-card {
    position: relative;
    background: rgba(212,162,83,.05);
    border: 1px solid rgba(212,162,83,.15);
    border-radius: 6px;
    padding: 16px 16px 12px 22px;
    margin: 0;
  }

  .hl-glyph {
    position: absolute;
    top: 8px;
    left: 10px;
    font-family: var(--font-display);
    font-size: 28px;
    line-height: 1;
    color: var(--accent-dim);
    opacity: .6;
  }

  .hl-text {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 13px;
    line-height: 1.6;
    color: rgba(240,235,227,.82);
    margin: 0 0 8px;
  }

  .hl-cite {
    font: 9px/1 var(--font-mono);
    letter-spacing: .18em;
    color: var(--faint);
    text-transform: uppercase;
    font-style: normal;
  }

  .hl-more-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(240,235,227,.03);
    border: 1px dashed rgba(240,235,227,.12);
    border-radius: 6px;
    text-decoration: none;
    color: var(--accent);
    font: 10px/1 var(--font-mono);
    letter-spacing: .2em;
    text-transform: uppercase;
    min-height: 80px;
    transition: border-color .15s;
  }

  .hl-more-tile:hover {
    border-color: rgba(212,162,83,.4);
  }

  /* Author books grid */
  .author-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }

  .author-book {
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-decoration: none;
    color: inherit;
  }

  .author-book-title {
    font-family: var(--font-display);
    font-size: 13px;
    line-height: 1.3;
    color: var(--cream);
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .author-book-year {
    font: 10px/1 var(--font-mono);
    letter-spacing: .14em;
    color: var(--muted);
    margin: 0;
  }

  /* Standalone card */
  .standalone-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    background: rgba(240,235,227,.03);
    border: 1px solid rgba(240,235,227,.06);
    border-radius: 6px;
  }

  .standalone-icon {
    font-size: 20px;
    color: var(--accent-dim);
    flex-shrink: 0;
  }

  .standalone-title {
    font-family: var(--font-display);
    font-size: 15px;
    color: var(--cream);
    margin: 0 0 4px;
  }

  .standalone-sub {
    font-size: 12px;
    color: var(--muted);
    margin: 0;
  }

  /* Series list */
  .series-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .series-row {
    border-radius: 4px;
    transition: background .1s;
  }

  .series-row:hover {
    background: rgba(240,235,227,.03);
  }

  .series-row-current {
    border-left: 2px solid var(--accent);
    background: rgba(212,162,83,.04);
  }

  .series-link {
    display: grid;
    grid-template-columns: 40px 1fr 120px;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    text-decoration: none;
    color: inherit;
  }

  .series-ordinal {
    font: 11px/1 var(--font-mono);
    letter-spacing: .18em;
    color: var(--accent-dim);
    text-align: center;
  }

  .series-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .series-title {
    font-family: var(--font-display);
    font-size: 14px;
    color: var(--cream);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .series-row-current .series-title {
    font-style: italic;
    color: var(--accent-lt);
  }

  .series-year {
    font: 9px/1 var(--font-mono);
    color: var(--faint);
    letter-spacing: .12em;
  }

  .series-progress-wrap {
    padding: 0 4px;
  }

  /* ── Right rail ────────────────────────────────────────────────────────── */
  .rail {
    position: sticky;
    top: 14px;
    align-self: start;
    background: var(--base);
    border: 1px solid rgba(240,235,227,.06);
    border-radius: 10px;
    padding: 4px 16px;
  }

  .rr-value {
    font-family: var(--font-display);
    font-size: 14px;
    color: var(--cream);
    margin: 0;
  }

  .rr-muted {
    color: var(--muted);
  }

  .rr-sub {
    font: 9px/1.4 var(--font-mono);
    letter-spacing: .16em;
    color: var(--faint);
    text-transform: uppercase;
    margin: 4px 0 0;
  }

  .format-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .chip-format {
    background: rgba(212,162,83,.1);
    color: var(--accent-lt);
    border: 1px solid rgba(212,162,83,.2);
  }

  .week-strip {
    display: flex;
    gap: 4px;
  }

  .week-cell {
    flex: 1;
    height: 7px;
    border-radius: 2px;
    background: var(--raised);
  }

  .week-cell-on {
    background: var(--accent);
    box-shadow: 0 0 4px rgba(212,162,83,.4);
  }

  .calibre-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* ── Footer ────────────────────────────────────────────────────────────── */
  .lit-footer {
    text-align: center;
    padding: 40px 28px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
  }

  /* ── Responsive: tablet (<1024px) ──────────────────────────────────────── */
  @media (max-width: 1023px) {
    .body-grid {
      grid-template-columns: 1fr;
    }
    .rail {
      position: static;
    }
  }

  /* ── Responsive: mobile (<640px) ───────────────────────────────────────── */
  @media (max-width: 639px) {
    .hero-inner {
      grid-template-columns: 1fr;
      gap: 24px;
      padding: 24px 20px;
    }
    .hero-cover {
      order: -1; /* cover above copy */
    }
    h1 {
      font-size: 36px;
    }
    .body-grid {
      padding: 20px 16px;
      gap: 24px;
    }
    .highlights-grid {
      grid-template-columns: 1fr;
    }
    .author-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    .series-link {
      grid-template-columns: 32px 1fr 80px;
    }
  }
</style>

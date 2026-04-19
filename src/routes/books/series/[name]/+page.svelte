<script lang="ts">
  import BookCover from '$lib/components/books/system/BookCover.svelte';
  import SectionHeader from '$lib/components/books/system/SectionHeader.svelte';
  import Ornament from '$lib/components/books/system/Ornament.svelte';
  import ProseStat from '$lib/components/books/system/ProseStat.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const { seriesName, author, yearSpan, volumes, totalVolumes, readCount, totalPages } = $derived(data);

  // Roman numeral helper (handles up to 40 volumes, sufficient for all practical series)
  function roman(n: number | null): string {
    if (n === null || n <= 0) return '?';
    const vals = [10,9,5,4,1];
    const syms = ['X','IX','V','IV','I'];
    let out = '';
    let rem = n;
    for (let i = 0; i < vals.length; i++) {
      while (rem >= vals[i]) { out += syms[i]; rem -= vals[i]; }
    }
    return out;
  }

  // Fan composition: up to 4 covers with rotation
  const fanRotations = [-18, -6, 6, 18];
  const fanTranslates = [-36, -12, 12, 36]; // px X offset
  const fanCovers = $derived(volumes.slice(0, 4));

  // First book genre
  const firstGenre = $derived(
    (volumes[0]?.book.genres?.[0]) ?? 'fiction'
  );

  // Progress percentage
  const pct = $derived(
    totalVolumes > 0 ? Math.round((readCount / totalVolumes) * 100) : 0
  );

  // Year span label
  const yearLabel = $derived(
    yearSpan.first && yearSpan.last
      ? yearSpan.first === yearSpan.last
        ? String(yearSpan.first)
        : `${yearSpan.first}–${yearSpan.last}`
      : '—'
  );

  // Span in years
  const spanYears = $derived(
    yearSpan.first && yearSpan.last ? yearSpan.last - yearSpan.first : 0
  );

  // Prose blurb
  const blurb = $derived(
    spanYears > 0
      ? `A series in ${totalVolumes} volume${totalVolumes !== 1 ? 's' : ''} across ${spanYears} year${spanYears !== 1 ? 's' : ''}.`
      : `A series in ${totalVolumes} volume${totalVolumes !== 1 ? 's' : ''}.`
  );

  // State label builder
  function stateLabel(state: string, progress: number, year: number, gapYears?: number): string {
    if (state === 'finished') return 'FINISHED';
    if (state === 'current') return `CONTINUE ${Math.round(progress * 100)}%`;
    if (state === 'branch') return `BRANCH · ${gapYears}-YEAR GAP`;
    return 'UNREAD · IN LIBRARY';
  }

  // Page estimate from progress (pages * progress)
  function currentPage(pages: number | undefined, progress: number): number {
    if (!pages) return 0;
    return Math.round(pages * progress);
  }
</script>

<svelte:head>
  <title>{seriesName} — Series · Nexus</title>
</svelte:head>

<div class="series-root books-surface">
  <!-- Breadcrumb -->
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="/books">Books</a>
    <span class="sep" aria-hidden="true">›</span>
    <a href="/books?tab=series">Series</a>
    <span class="sep" aria-hidden="true">›</span>
    <span class="crumb-current">{seriesName}</span>
  </nav>

  <!-- Hero -->
  <section class="hero" aria-label="Series overview">
    <div class="hero-inner">
      <!-- Left: copy column -->
      <div class="hero-copy">
        <p class="hero-tag">◇ A SERIES IN {totalVolumes} VOLUME{totalVolumes !== 1 ? 'S' : ''} · {yearLabel}</p>
        <h1 class="hero-title">The cycle of <em>{seriesName}</em></h1>
        <p class="hero-meta">{author} · {firstGenre} · {totalPages ? `${totalPages.toLocaleString()} pages` : '— pages'}</p>
        <p class="hero-blurb">{blurb}</p>
        <div class="hero-stat">
          <span class="stat-big"><em>{readCount}</em> of {totalVolumes} read</span>
          <span class="stat-pct">{pct}%</span>
        </div>
      </div>

      <!-- Right: fan covers -->
      <div class="hero-fan" aria-hidden="true">
        {#each fanCovers as vol, i}
          <div
            class="fan-card"
            class:fan-current={vol.state === 'current'}
            style="--rot:{fanRotations[i]}deg; --tx:{fanTranslates[i]}px;"
          >
            <BookCover book={vol.book} size="md" />
          </div>
        {/each}
      </div>
    </div>
  </section>

  <Ornament variant="line" />

  <!-- Reading order timeline -->
  <section class="timeline-section">
    <SectionHeader
      ordinal="◇ I"
      title="Reading order"
      meta="PUBLICATION · {yearSpan.first} → {yearSpan.last}"
    />

    <ul class="timeline">
      {#each volumes as vol}
        {@const book = vol.book}
        {@const pages = book.metadata?.pages as number | undefined}
        {@const progress = book.progress ?? 0}
        {@const rating = book.rating}
        {@const year = book.year ?? 0}
        {@const isCurrent = vol.state === 'current'}
        {@const page = isCurrent ? currentPage(pages, progress) : 0}
        <li class="tl-item tl-{vol.state}">
          <div class="tl-cover">
            <BookCover {book} size="sm" showProgress />
          </div>
          <div class="tl-info">
            <p class="tl-ord">◇ BOOK {roman(vol.ordinal)} · {year || '—'} · <span class="tl-state-label">{stateLabel(vol.state, progress, year, vol.branchGapYears)}</span></p>
            <h3 class="tl-title">{book.title}</h3>
            <p class="tl-mini">{pages ? `${pages} pages` : ''}{pages && rating ? ' · ' : ''}{rating ? `★ ${rating}` : ''}</p>
            {#if progress > 0}
              <div class="tl-progress">
                <div class="tl-fill" style="width:{Math.round(progress * 100)}%"></div>
              </div>
            {/if}
            <!-- Small screens: action inline -->
            <div class="tl-action-inline">
              <a href="/books/{book.id}" class="btn-action">
                {#if isCurrent}Continue at p{page}{:else}Open{/if}
              </a>
            </div>
          </div>
          <div class="tl-action">
            <a href="/books/{book.id}" class="btn-action">
              {#if isCurrent}Continue at p{page}{:else}Open{/if}
            </a>
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <!-- Footer -->
  <footer class="series-footer">
    <Ornament variant="cluster" />
    <ProseStat>
      {readCount} of {totalVolumes} volume{totalVolumes !== 1 ? 's' : ''} read &mdash; {totalVolumes - readCount} to go.
    </ProseStat>
  </footer>
</div>

<style>
  /* ─── surface scope ─── */
  .series-root {
    max-width: 1080px;
    margin: 0 auto;
    padding: 32px 24px 80px;
    color: var(--cream);
  }

  /* ─── breadcrumb ─── */
  .crumbs {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 10px/1 var(--font-mono);
    letter-spacing: .18em;
    text-transform: uppercase;
    color: var(--faint);
    margin-bottom: 32px;
  }
  .crumbs a { color: var(--muted); text-decoration: none; }
  .crumbs a:hover { color: var(--accent); }
  .sep { color: var(--faint); }
  .crumb-current { color: var(--cream); }

  /* ─── hero ─── */
  .hero {
    background: radial-gradient(ellipse at 70% 40%, rgba(212,162,83,.08) 0%, transparent 65%);
    border-radius: 8px;
    padding: 40px;
    margin-bottom: 28px;
  }
  .hero-inner {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 44px;
    align-items: center;
  }
  .hero-tag {
    font: 10px/1 var(--font-mono);
    letter-spacing: .24em;
    color: var(--accent);
    text-transform: uppercase;
    margin: 0 0 12px;
  }
  .hero-title {
    font-family: var(--font-display);
    font-size: 52px;
    line-height: .96;
    font-weight: 700;
    letter-spacing: -.02em;
    margin: 0 0 14px;
    color: var(--cream);
  }
  .hero-title em {
    font-style: italic;
    color: var(--accent);
  }
  .hero-meta {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 15px;
    color: var(--muted);
    margin: 0 0 12px;
  }
  .hero-blurb {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 14px;
    color: rgba(240,235,227,.6);
    margin: 0 0 24px;
    line-height: 1.5;
  }
  .hero-stat {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .stat-big {
    font-family: var(--font-display);
    font-size: 22px;
    color: var(--cream);
  }
  .stat-big em {
    font-style: normal;
    font-size: 36px;
    color: var(--accent);
    font-weight: 700;
  }
  .stat-pct {
    font: 12px/1 var(--font-mono);
    letter-spacing: .2em;
    color: var(--accent-dim);
    text-transform: uppercase;
  }

  /* ─── fan covers ─── */
  .hero-fan {
    position: relative;
    height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .fan-card {
    position: absolute;
    width: 110px;
    transform: rotate(var(--rot)) translateX(var(--tx));
    transition: box-shadow .2s;
  }
  .fan-card.fan-current {
    filter: drop-shadow(0 0 18px rgba(232,188,106,.45));
    z-index: 2;
  }

  /* ─── timeline ─── */
  .timeline-section {
    margin: 28px 0 40px;
  }
  .timeline {
    list-style: none;
    padding: 0;
    margin: 0;
    position: relative;
  }
  .timeline::before {
    content: '';
    position: absolute;
    left: 14px;
    top: 8px;
    bottom: 8px;
    width: 1px;
    background: linear-gradient(180deg, var(--accent-dim), rgba(212,162,83,.12));
  }

  /* ─── timeline item ─── */
  .tl-item {
    display: grid;
    grid-template-columns: 100px 1fr auto;
    gap: 16px;
    align-items: start;
    padding: 18px 0 18px 32px;
    position: relative;
    border-bottom: 1px solid rgba(240,235,227,.05);
  }
  .tl-item:last-child { border-bottom: none; }

  /* State dot via ::before */
  .tl-item::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 26px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .tl-finished::before {
    background: var(--accent);
    box-shadow: 0 0 8px rgba(212,162,83,.5);
  }
  .tl-current::before {
    background: var(--accent-lt);
    animation: pulse 2s ease-in-out infinite;
  }
  .tl-branch::before {
    background: var(--steel);
    box-shadow: 0 0 6px rgba(61,143,132,.4);
  }
  .tl-unread::before {
    background: transparent;
    border: 1.5px dashed var(--faint);
  }

  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 6px rgba(232,188,106,.3); }
    50%       { box-shadow: 0 0 16px rgba(232,188,106,.7); }
  }

  /* Cover column */
  .tl-cover { padding-top: 4px; }

  /* Info column */
  .tl-ord {
    font: 9px/1 var(--font-mono);
    letter-spacing: .22em;
    color: var(--faint);
    text-transform: uppercase;
    margin: 0 0 6px;
  }
  .tl-state-label { color: var(--accent-dim); }
  .tl-finished .tl-state-label { color: var(--accent); }
  .tl-current .tl-state-label { color: var(--accent-lt); }
  .tl-branch .tl-state-label { color: var(--steel-lt); }

  .tl-title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -.01em;
    margin: 0 0 4px;
    color: var(--cream);
    line-height: 1.2;
  }
  .tl-mini {
    font: 11px/1 var(--font-mono);
    letter-spacing: .14em;
    color: var(--faint);
    margin: 0 0 10px;
  }
  .tl-progress {
    height: 2px;
    background: var(--raised);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 8px;
  }
  .tl-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-dim), var(--accent));
    border-radius: 2px;
  }

  /* Action column (large screens) */
  .tl-action { padding-top: 4px; }
  .tl-action-inline { display: none; margin-top: 10px; }

  .btn-action {
    display: inline-block;
    font: 10px/1 var(--font-mono);
    letter-spacing: .18em;
    text-transform: uppercase;
    color: var(--accent);
    border: 1px solid rgba(212,162,83,.35);
    border-radius: 3px;
    padding: 7px 12px;
    text-decoration: none;
    white-space: nowrap;
    transition: background .15s, color .15s;
  }
  .btn-action:hover {
    background: rgba(212,162,83,.12);
    color: var(--accent-lt);
    border-color: var(--accent);
  }

  /* ─── footer ─── */
  .series-footer {
    text-align: center;
    margin-top: 48px;
  }

  /* ─── responsive ─── */
  @media (max-width: 900px) {
    .hero-inner {
      grid-template-columns: 1fr;
      gap: 28px;
    }
    .hero-title { font-size: 38px; }
    .hero-fan { order: -1; height: 180px; }
    .fan-card { width: 90px; }
  }

  @media (max-width: 640px) {
    .hero { padding: 24px 16px; }
    .hero-title { font-size: 30px; }

    .tl-item {
      grid-template-columns: 80px 1fr;
      padding-left: 28px;
    }
    .tl-action { display: none; }
    .tl-action-inline { display: block; }
  }
</style>

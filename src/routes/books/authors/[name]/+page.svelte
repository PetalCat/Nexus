<script lang="ts">
  import BookCover from '$lib/components/books/system/BookCover.svelte';
  import SectionHeader from '$lib/components/books/system/SectionHeader.svelte';
  import Ornament from '$lib/components/books/system/Ornament.svelte';
  import ProseStat from '$lib/components/books/system/ProseStat.svelte';
  import RightRailBlock from '$lib/components/books/system/RightRailBlock.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const {
    authorName,
    bio,
    dates,
    genres,
    booksInLibrary,
    totalReadingMs,
    totalHighlights,
    pullQuote,
    seriesGroupings,
    influences
  } = $derived(data);

  // ── helpers ──────────────────────────────────────────────────────────────

  function humanDuration(ms: number): string {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (!h) return `${m}m`;
    return `${h}h ${m}m`;
  }

  function roman(n: number): string {
    const vals = [40, 10, 9, 5, 4, 1];
    const syms = ['XL', 'X', 'IX', 'V', 'IV', 'I'];
    let out = '';
    let rem = n;
    for (let i = 0; i < vals.length; i++) {
      while (rem >= vals[i]) { out += syms[i]; rem -= vals[i]; }
    }
    return out;
  }

  // Initials: first letter of first word + first letter of last word.
  // Single-word names duplicate the letter.
  function initials(name: string): string {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0]?.toUpperCase() ?? '?';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0]?.toUpperCase() ?? first) : first;
    return first + last;
  }

  // Accent last word of the author name for the h1
  function accentLastWord(name: string): string {
    const idx = name.lastIndexOf(' ');
    if (idx === -1) return `<em>${name}</em>`;
    return name.slice(0, idx + 1) + `<em>${name.slice(idx + 1)}</em>`;
  }

  // ── derived display values ────────────────────────────────────────────────

  const authorInitials = $derived(initials(authorName));
  const h1Html = $derived(accentLastWord(authorName));

  const datesLine = $derived(() => {
    if (dates.birth && dates.death) return `${dates.birth}–${dates.death}`;
    if (dates.birth) return `b. ${dates.birth}`;
    if (dates.death) return `d. ${dates.death}`;
    return null;
  });

  const genreChips = $derived(genres.slice(0, 3));
  const extraGenres = $derived(Math.max(0, genres.length - 3));

  const fallbackBio = $derived(
    `Over the years, ${authorName} has assembled the ${booksInLibrary}-volume shelf above. ` +
    `Each title reflects a body of work that continues to reward close reading.`
  );

  const finishedCount = $derived(
    seriesGroupings.flatMap(g => g.books).filter(b => (b as any).__state === 'finished').length
  );
  const inFlightCount = $derived(
    seriesGroupings.flatMap(g => g.books).filter(b => (b as any).__state === 'in-flight').length
  );
  const unreadCount = $derived(booksInLibrary - finishedCount - inFlightCount);

  const namedSeries = $derived(seriesGroupings.filter(g => g.name !== 'Standalone works'));
  const seriesLabel = $derived(
    namedSeries.length > 0
      ? namedSeries.map(g => g.name).join(', ')
      : '—'
  );

  // ordinal section counter (skip pull quote section since it's conditional)
  // bibliography starts at I, influences follows
  const bibliographyOrdinal = $derived('◇ I');
  const influencesOrdinal = $derived('◇ II');

  // progress % helper
  function pct(b: any): number {
    return Math.round((b.progress ?? 0) * 100);
  }

  function stateChip(b: any): { label: string; cls: string } {
    const s = (b as any).__state;
    if (s === 'finished') return { label: '◇ READ', cls: 'chip-read' };
    if (s === 'in-flight') return { label: `◇ ${pct(b)}%`, cls: 'chip-inflight' };
    return { label: '◇ UNREAD', cls: 'chip-unread' };
  }
</script>

<svelte:head>
  <title>{authorName} — Author · Nexus</title>
</svelte:head>

<div class="author-root">
  <!-- ── Breadcrumb ── -->
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="/books">Books</a>
    <span class="sep" aria-hidden="true">›</span>
    <a href="/books?tab=authors">Authors</a>
    <span class="sep" aria-hidden="true">›</span>
    <span class="crumb-current">{authorName}</span>
  </nav>

  <!-- ── Hero ── -->
  <section class="hero" aria-label="Author overview">
    <div class="hero-grid">

      <!-- Left: procedural portrait -->
      <div class="hero-portrait">
        <svg
          viewBox="0 0 260 350"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          class="portrait-svg"
        >
          <defs>
            <linearGradient id="pg-bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3a2a1a" />
              <stop offset="100%" stop-color="#0d0b0a" />
            </linearGradient>
            <radialGradient id="pg-glow" cx="50%" cy="40%" r="45%">
              <stop offset="0%" stop-color="#d4a253" stop-opacity="0.18" />
              <stop offset="100%" stop-color="#d4a253" stop-opacity="0" />
            </radialGradient>
          </defs>

          <!-- Background -->
          <rect width="260" height="350" fill="url(#pg-bg)" />
          <rect width="260" height="350" fill="url(#pg-glow)" />

          <!-- Rounded head -->
          <ellipse cx="130" cy="130" rx="52" ry="60" fill="#1c1814" />

          <!-- Hair blob (simple arc over the top of the head) -->
          <path
            d="M78 118 Q80 62 130 60 Q180 62 182 118 Q166 95 130 93 Q94 95 78 118 Z"
            fill="#2a1f14"
          />

          <!-- Body triangle: shoulders to bottom -->
          <path
            d="M60 350 L86 195 Q130 180 174 195 L200 350 Z"
            fill="#1c1814"
          />

          <!-- Neck -->
          <rect x="118" y="186" width="24" height="14" rx="4" fill="#1c1814" />

          <!-- Initials watermark -->
          <text
            x="130"
            y="230"
            text-anchor="middle"
            dominant-baseline="middle"
            font-family="Playfair Display, Georgia, serif"
            font-style="italic"
            font-size="120"
            fill="#f0ebe3"
            fill-opacity="0.08"
          >{authorInitials}</text>

          <!-- Date line at bottom if present -->
          {#if datesLine()}
            <text
              x="130"
              y="334"
              text-anchor="middle"
              font-family="JetBrains Mono, ui-monospace, monospace"
              font-size="10"
              fill="#d4a253"
              fill-opacity="0.7"
              letter-spacing="2"
            >{datesLine()}</text>
          {/if}
        </svg>
      </div>

      <!-- Middle: copy column -->
      <div class="hero-copy">
        <p class="hero-tag">◇ AUTHOR · {booksInLibrary} TITLE{booksInLibrary !== 1 ? 'S' : ''} IN YOUR LIBRARY</p>
        <h1 class="hero-title">{@html h1Html}</h1>

        <!-- Dates or genre fallback line -->
        {#if datesLine()}
          <p class="hero-dates">{datesLine()}</p>
        {:else}
          <p class="hero-dates">Novelist · {genres[0] ?? 'Writer'}</p>
        {/if}

        <!-- Bio with drop cap, or fallback -->
        <p class="hero-bio" class:drop-cap={true}>
          {bio ?? fallbackBio}
        </p>

        <!-- Genre chips -->
        {#if genres.length > 0}
          <div class="genre-chips">
            {#each genreChips as g}
              <span class="chip">{g}</span>
            {/each}
            {#if extraGenres > 0}
              <span class="chip chip-more">+{extraGenres} more</span>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Right: stats block -->
      <div class="hero-stats">
        <RightRailBlock label="In library">
          <p class="stat-primary">{booksInLibrary} title{booksInLibrary !== 1 ? 's' : ''}</p>
          <p class="stat-sub">{finishedCount} read · {inFlightCount} reading · {unreadCount} unread</p>
        </RightRailBlock>

        <RightRailBlock label="Time spent">
          <p class="stat-primary">{totalReadingMs > 0 ? humanDuration(totalReadingMs) : '—'}</p>
        </RightRailBlock>

        <RightRailBlock label="Highlights">
          <p class="stat-primary">{totalHighlights > 0 ? totalHighlights : '—'}</p>
        </RightRailBlock>

        <RightRailBlock label="Series">
          <p class="stat-sub series-label">{seriesLabel}</p>
        </RightRailBlock>
      </div>
    </div>
  </section>

  <!-- ── Pull quote ── -->
  {#if pullQuote}
    <section class="pull-quote-section" aria-label="Highlighted passage">
      <div class="pq-grid">
        <div class="pq-mark" aria-hidden="true">"</div>
        <div class="pq-body">
          <blockquote class="pq-text">{pullQuote.text}</blockquote>
          <p class="pq-cite">
            YOU HIGHLIGHTED THIS FROM · {pullQuote.bookTitle.toUpperCase()}{pullQuote.chapter ? ` · ${pullQuote.chapter}` : ''}
          </p>
        </div>
      </div>
    </section>
  {/if}

  <Ornament variant="line" />

  <!-- ── Bibliography ── -->
  <section class="bibliography" aria-label="Bibliography">
    {#each seriesGroupings as grouping, idx}
      <div class="bib-group">
        <SectionHeader
          ordinal={`${bibliographyOrdinal.replace('I', roman(idx + 1))}`}
          title={grouping.name === 'Standalone works' ? 'Standalone works' : `${grouping.name} cycle`}
          meta={`${grouping.books.length} IN LIBRARY`}
        />
        <div class="bib-grid">
          {#each grouping.books as book}
            {@const chip = stateChip(book)}
            <a href="/books/{book.id}" class="bib-item">
              <BookCover {book} showProgress />
              <span class="bib-chip {chip.cls}">{chip.label}</span>
              <p class="bib-title">{book.title}</p>
              {#if book.year}
                <p class="bib-year">{book.year}</p>
              {/if}
            </a>
          {/each}
        </div>
      </div>
    {/each}
  </section>

  <!-- ── "If you like" influences ── -->
  {#if influences.length > 0}
    <Ornament variant="line" />
    <section class="influences" aria-label="Similar authors">
      <SectionHeader
        ordinal={influencesOrdinal}
        title={`If you like ${authorName.split(' ').slice(-1)[0]}`}
        meta={`${influences.length} AUTHOR${influences.length !== 1 ? 'S' : ''} · SIMILAR TENOR`}
      />
      <div class="influence-pills">
        {#each influences as inf}
          <a
            href="/books/authors/{encodeURIComponent(inf.name)}"
            class="inf-pill"
            aria-label="{inf.name}, {inf.inLibrary} books in library"
          >
            <span class="inf-dot" aria-hidden="true">{initials(inf.name)}</span>
            <span class="inf-info">
              <span class="inf-name">{inf.name}</span>
              <span class="inf-sub">{inf.inLibrary} IN LIBRARY</span>
            </span>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ── Footer ── -->
  <footer class="author-footer">
    <Ornament variant="cluster" />
    <Ornament variant="line" />
    <ProseStat>
      {booksInLibrary} title{booksInLibrary !== 1 ? 's' : ''} by {authorName} — {finishedCount} read, {unreadCount} waiting.
    </ProseStat>
  </footer>
</div>

<style>
  /* ─── root ─── */
  .author-root {
    max-width: 1160px;
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

  /* ─── hero grid ─── */
  .hero {
    background: radial-gradient(ellipse at 30% 45%, rgba(212,162,83,.09) 0%, transparent 60%);
    border-radius: 8px;
    padding: 40px;
    margin-bottom: 32px;
  }
  .hero-grid {
    display: grid;
    grid-template-columns: 260px 1fr 220px;
    gap: 34px;
    align-items: start;
  }

  /* ─── portrait ─── */
  .hero-portrait { flex-shrink: 0; }
  .portrait-svg {
    width: 260px;
    height: 350px;
    aspect-ratio: 3/4;
    border-radius: 6px;
    display: block;
  }

  /* ─── copy ─── */
  .hero-tag {
    font: 10px/1 var(--font-mono);
    letter-spacing: .24em;
    color: var(--accent);
    text-transform: uppercase;
    margin: 0 0 12px;
  }
  .hero-title {
    font-family: var(--font-display);
    font-size: 44px;
    font-weight: 700;
    line-height: .97;
    letter-spacing: -.02em;
    margin: 0 0 10px;
    color: var(--cream);
  }
  :global(.hero-title em) {
    font-style: italic;
    color: var(--accent);
  }
  .hero-dates {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 15px;
    color: var(--muted);
    margin: 0 0 14px;
  }
  .hero-bio {
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.65;
    color: rgba(240,235,227,.75);
    margin: 0 0 18px;
  }
  .hero-bio.drop-cap::first-letter {
    font-family: var(--font-display);
    font-size: 3.2em;
    font-weight: 700;
    float: left;
    line-height: .82;
    margin: 0 6px 0 0;
    color: var(--accent);
  }

  /* Genre chips */
  .genre-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .chip {
    font: 9px/1 var(--font-mono);
    letter-spacing: .2em;
    text-transform: uppercase;
    padding: 5px 10px;
    border: 1px solid rgba(212,162,83,.25);
    border-radius: 20px;
    color: var(--muted);
    background: rgba(212,162,83,.06);
  }
  .chip-more {
    color: var(--faint);
    border-color: rgba(96,88,80,.4);
    background: transparent;
  }

  /* ─── stats rail ─── */
  .hero-stats {
    padding-top: 4px;
  }
  .stat-primary {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 700;
    color: var(--cream);
    margin: 0 0 4px;
  }
  .stat-sub {
    font: 10px/1.4 var(--font-mono);
    letter-spacing: .14em;
    color: var(--faint);
    text-transform: uppercase;
    margin: 0;
  }
  .series-label {
    font-size: 9px;
    color: var(--muted);
    letter-spacing: .12em;
  }

  /* ─── pull quote ─── */
  .pull-quote-section {
    margin: 0 0 32px;
    padding: 28px 40px;
    background: rgba(212,162,83,.04);
    border-left: 2px solid rgba(212,162,83,.2);
    border-radius: 0 6px 6px 0;
  }
  .pq-grid {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 0;
    align-items: start;
  }
  .pq-mark {
    font-family: var(--font-display);
    font-size: 140px;
    line-height: .7;
    color: var(--accent);
    opacity: .4;
    user-select: none;
    padding-top: 8px;
  }
  .pq-text {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 24px;
    line-height: 1.4;
    color: var(--cream);
    margin: 0 0 12px;
    quotes: none;
  }
  .pq-cite {
    font: 9px/1 var(--font-mono);
    letter-spacing: .2em;
    color: var(--faint);
    text-transform: uppercase;
    margin: 0;
  }

  /* ─── bibliography ─── */
  .bibliography {
    margin: 28px 0 40px;
  }
  .bib-group {
    margin-bottom: 40px;
  }
  .bib-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 20px 16px;
  }
  .bib-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-decoration: none;
    color: inherit;
    gap: 6px;
    cursor: pointer;
  }
  .bib-item:hover .bib-title { color: var(--accent-lt); }
  .bib-chip {
    font: 8px/1 var(--font-mono);
    letter-spacing: .18em;
    text-transform: uppercase;
    padding: 3px 7px;
    border-radius: 3px;
    align-self: flex-start;
  }
  .chip-read {
    background: rgba(212,162,83,.18);
    color: var(--accent-lt);
    border: 1px solid rgba(212,162,83,.35);
  }
  .chip-inflight {
    background: rgba(212,162,83,.1);
    color: var(--accent-dim);
    border: 1px solid rgba(212,162,83,.2);
  }
  .chip-unread {
    background: rgba(96,88,80,.15);
    color: var(--faint);
    border: 1px solid rgba(96,88,80,.25);
  }
  .bib-title {
    font-family: var(--font-body);
    font-size: 11px;
    line-height: 1.35;
    color: var(--muted);
    text-align: center;
    margin: 0;
    word-break: break-word;
  }
  .bib-year {
    font: 9px/1 var(--font-mono);
    letter-spacing: .1em;
    color: var(--faint);
    margin: 0;
  }

  /* ─── influences ─── */
  .influences {
    margin: 28px 0 40px;
  }
  .influence-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 8px;
  }
  .inf-pill {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px 8px 8px;
    border: 1px solid rgba(240,235,227,.08);
    border-radius: 40px;
    background: rgba(240,235,227,.03);
    text-decoration: none;
    color: inherit;
    transition: border-color .15s, background .15s;
  }
  .inf-pill:hover {
    border-color: rgba(212,162,83,.35);
    background: rgba(212,162,83,.06);
  }
  .inf-dot {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(212,162,83,.15);
    color: var(--accent);
    font: 13px/40px var(--font-mono);
    text-align: center;
    letter-spacing: .05em;
    flex-shrink: 0;
    text-transform: uppercase;
  }
  .inf-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .inf-name {
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--cream);
  }
  .inf-sub {
    font: 8px/1 var(--font-mono);
    letter-spacing: .18em;
    color: var(--faint);
    text-transform: uppercase;
  }

  /* ─── footer ─── */
  .author-footer {
    text-align: center;
    margin-top: 48px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  /* ─── responsive ─── */
  @media (max-width: 1024px) {
    .hero-grid {
      grid-template-columns: 1fr;
      gap: 28px;
    }
    .hero-portrait {
      display: flex;
      justify-content: center;
    }
    .bib-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media (max-width: 640px) {
    .hero { padding: 24px 16px; }
    .hero-title { font-size: 34px; }
    .bib-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    .pq-grid {
      grid-template-columns: 60px 1fr;
    }
    .pq-mark { font-size: 80px; }
    .pq-text { font-size: 18px; }
  }
</style>

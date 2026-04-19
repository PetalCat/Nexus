<script lang="ts">
  import type { UnifiedMedia } from '$lib/adapters/types';
  import BookCover from '$lib/components/books/system/BookCover.svelte';
  import ProgressThread from '$lib/components/books/system/ProgressThread.svelte';

  let { book }: { book: UnifiedMedia } = $props();

  const progress = $derived(book.progress ?? 0);
  const pct = $derived(Math.round(progress * 100));
  const pages = $derived((book.metadata?.pages as number) ?? 100);
  const currentPage = $derived(Math.round(progress * pages));
  const author = $derived(book.metadata?.author as string | undefined);
  const chapter = $derived(book.metadata?.chapter as string | number | undefined);
  const chapterLabel = $derived(chapter != null ? `CH ${chapter}` : 'CHAPTER —');

  // Split title: last word gets em, everything before is plain
  const titleWords = $derived(book.title.trim().split(/\s+/));
  const titleFirst = $derived(titleWords.length > 1 ? titleWords.slice(0, -1).join(' ') : '');
  const titleLast = $derived(titleWords[titleWords.length - 1]);

  // Meta line: author · year · pages, skip missing
  const metaParts = $derived(
    [
      author,
      book.year != null ? String(book.year) : null,
      book.metadata?.pages != null ? `${book.metadata.pages} pages` : null
    ].filter(Boolean) as string[]
  );

  // First paragraph of description
  const firstParagraph = $derived(
    book.description ? book.description.split(/\n\n/)[0]?.trim() || '' : ''
  );

  // Minutes left estimate: assume average 250 words/page, 250 wpm reading speed
  const pagesLeft = $derived(pages - currentPage);
  const minutesLeft = $derived(Math.round(pagesLeft * 1.5)); // ~1.5 min/page rough estimate
  const showMinutes = $derived(pagesLeft > 0);
</script>

<section class="hero hero-cinematic">
  <!-- Starfield backdrop -->
  <div class="backdrop" aria-hidden="true">
    <svg class="stars" viewBox="0 0 1200 500" preserveAspectRatio="xMidYMid slice">
      <circle cx="89" cy="42" r="1.2" fill="rgba(212,162,83,.45)" />
      <circle cx="234" cy="118" r=".8" fill="rgba(212,162,83,.3)" />
      <circle cx="412" cy="67" r="1" fill="rgba(212,162,83,.5)" />
      <circle cx="580" cy="190" r=".9" fill="rgba(212,162,83,.35)" />
      <circle cx="710" cy="55" r="1.3" fill="rgba(212,162,83,.4)" />
      <circle cx="890" cy="140" r=".7" fill="rgba(212,162,83,.25)" />
      <circle cx="1050" cy="80" r="1.1" fill="rgba(212,162,83,.45)" />
      <circle cx="145" cy="310" r=".6" fill="rgba(212,162,83,.2)" />
      <circle cx="320" cy="270" r="1" fill="rgba(212,162,83,.3)" />
      <circle cx="660" cy="380" r=".8" fill="rgba(212,162,83,.25)" />
      <circle cx="980" cy="350" r="1.2" fill="rgba(212,162,83,.35)" />
      <circle cx="1130" cy="420" r=".7" fill="rgba(212,162,83,.2)" />
    </svg>
    <div class="glow-orb"></div>
  </div>

  <div class="inner">
    <!-- Left column -->
    <div class="col-left">
      <p class="pill-tag">
        <span>◇ CURRENTLY READING · {chapterLabel} · {pct}% COMPLETE</span>
      </p>

      <h1>
        {#if titleFirst}<span class="title-main">{titleFirst}</span>{/if}
        <em class="title-accent">{titleLast}</em>
      </h1>

      {#if metaParts.length > 0}
        <p class="meta-line">{metaParts.join(' · ')}</p>
      {/if}

      {#if firstParagraph}
        <p class="drop-cap">{firstParagraph}</p>
      {/if}

      <div class="action-row">
        <a href="/books/read/{book.id}" class="btn primary">Continue at p{currentPage}</a>
        <a href="/books/{book.id}" class="btn ghost">Details</a>
        {#if showMinutes}
          <span class="est-time">≈ {minutesLeft} min left</span>
        {/if}
      </div>

      <div class="progress-block">
        <ProgressThread variant="thick" value={progress} waypoints={[0.1, 0.25, 0.5, 0.75, 0.9]} />
        <p class="progress-meta">PAGE {currentPage} OF {pages}</p>
      </div>
    </div>

    <!-- Right column -->
    <div class="col-right">
      <div class="cover-halo">
        <BookCover {book} size="hero" showProgress={false} />
      </div>
    </div>
  </div>
</section>

<style>
  .hero-cinematic {
    position: relative;
    overflow: hidden;
    background: var(--void);
    padding: 56px 32px;
    border-radius: 8px;
  }

  /* Backdrop */
  .backdrop {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
  }
  .stars {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: .6;
  }
  .glow-orb {
    position: absolute;
    top: -120px;
    right: 160px;
    width: 560px;
    height: 560px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(212,162,83,.12) 0%, transparent 70%);
    pointer-events: none;
  }

  /* Layout */
  .inner {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 1fr 260px;
    gap: 40px;
    align-items: center;
  }

  .col-left {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  /* Pill tag */
  .pill-tag {
    display: inline-flex;
    align-items: center;
  }
  .pill-tag span {
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
    font-size: 52px;
    line-height: 1.06;
    font-weight: 700;
    color: var(--cream);
    margin: 0;
    letter-spacing: -.02em;
  }
  .title-main { display: inline; }
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

  /* Drop cap */
  .drop-cap {
    font-size: 15px;
    line-height: 1.7;
    color: rgba(240,235,227,.65);
    margin: 0;
    max-width: 56ch;
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

  /* Action row */
  .action-row {
    display: flex;
    align-items: center;
    gap: 12px;
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
  .btn:hover { opacity: .8; }
  .btn.primary {
    background: var(--accent);
    color: var(--void);
    font-weight: 700;
  }
  .btn.ghost {
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
  }

  /* Right column — cover with glow halo */
  .col-right {
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .cover-halo {
    position: relative;
  }
  .cover-halo::before {
    content: '';
    position: absolute;
    inset: -30px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(212,162,83,.18) 0%, transparent 65%);
    pointer-events: none;
    z-index: -1;
  }
</style>

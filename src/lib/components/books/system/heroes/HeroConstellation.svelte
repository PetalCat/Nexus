<script lang="ts">
  import type { UnifiedMedia } from '$lib/adapters/types';
  import BookCover from '$lib/components/books/system/BookCover.svelte';

  let {
    book,
    totalBooks,
    activeCount
  }: {
    book: UnifiedMedia;
    totalBooks: number;
    activeCount: number;
  } = $props();

  const chapter = $derived(book.metadata?.chapter as string | number | undefined);
  const chapterLabel = $derived(chapter != null ? `CH ${chapter}` : 'CH —');

  // Last session time — from metadata if available, else em-dash placeholder
  const lastSession = $derived(
    (book.metadata?.lastSessionTime as string | undefined) ?? '—'
  );

  // Constellation: 9 hand-picked points, 8 connecting lines
  const stars = [
    { cx: 72,   cy: 68,  r: 2.2, delay: '0s'    },
    { cx: 210,  cy: 38,  r: 1.5, delay: '0.4s'  },
    { cx: 390,  cy: 90,  r: 1.8, delay: '0.7s'  },
    { cx: 540,  cy: 45,  r: 1.4, delay: '1.1s'  },
    { cx: 680,  cy: 120, r: 2.0, delay: '0.3s'  },
    { cx: 820,  cy: 60,  r: 1.6, delay: '0.9s'  },
    { cx: 960,  cy: 130, r: 1.9, delay: '0.5s'  },
    { cx: 1080, cy: 55,  r: 1.3, delay: '1.3s'  },
    { cx: 1160, cy: 200, r: 1.7, delay: '0.2s'  }
  ] as const;

  // Lines connecting stars in sequence: 0-1, 1-2, 2-3, 3-4, 4-5, 5-6, 6-7, 7-8
  const lines = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]
  ] as const;
</script>

<section class="hero hero-constellation">
  <!-- SVG starfield overlay -->
  <svg
    class="starfield"
    viewBox="0 0 1200 440"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
  >
    {#each lines as [a, b]}
      <line
        x1={stars[a].cx}
        y1={stars[a].cy}
        x2={stars[b].cx}
        y2={stars[b].cy}
        stroke="rgba(212,162,83,.35)"
        stroke-width=".5"
      />
    {/each}
    {#each stars as star}
      <circle
        cx={star.cx}
        cy={star.cy}
        r={star.r}
        fill="var(--accent)"
        class="star-dot"
        style="animation-delay:{star.delay}"
      />
    {/each}
  </svg>

  <div class="inner">
    <!-- Left column -->
    <div class="col-left">
      <h1>
        <em>{book.title}</em>.
      </h1>

      <p class="subtitle">
        One of {totalBooks} on the shelf. Pick up where you left off.
      </p>

      <!-- 2-cell meta row -->
      <div class="meta-row">
        <div class="meta-cell">
          <span class="meta-value">{lastSession}</span>
          <span class="meta-label">LAST OPENED</span>
        </div>
        <div class="meta-divider" aria-hidden="true">|</div>
        <div class="meta-cell">
          <span class="meta-value">{chapterLabel}</span>
          <span class="meta-label">CHAPTER</span>
        </div>
      </div>
    </div>

    <!-- Right column -->
    <div class="col-right">
      <div class="cover-halo">
        <BookCover {book} size="lg" />
      </div>
    </div>
  </div>
</section>

<style>
  .hero-constellation {
    position: relative;
    overflow: hidden;
    background: var(--void);
    padding: 48px 40px;
    min-height: 440px;
    border-radius: 8px;
  }

  /* SVG overlay */
  .starfield {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }

  /* Pulsing star animation */
  :global(.star-dot) {
    animation: pulse 3s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: .4; }
    50%       { opacity: 1; }
  }

  /* Layout */
  .inner {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 40px;
    align-items: center;
    min-height: calc(440px - 96px); /* account for padding */
  }

  .col-left {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* Heading */
  h1 {
    font-family: var(--font-display);
    font-size: 56px;
    line-height: .98;
    font-weight: 700;
    letter-spacing: -.025em;
    color: var(--cream);
    margin: 0;
  }
  h1 em {
    font-style: italic;
    color: var(--accent-lt);
  }

  /* Subtitle */
  .subtitle {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 17px;
    line-height: 1.6;
    color: rgba(240,235,227,.6);
    max-width: 54ch;
    margin: 0;
  }

  /* 3-cell meta row */
  .meta-row {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-top: 8px;
  }
  .meta-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .meta-value {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 14px;
    color: var(--cream);
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta-label {
    font: 9px/1 var(--font-mono);
    letter-spacing: .18em;
    color: var(--faint);
    text-transform: uppercase;
  }
  .meta-divider {
    font: 14px/1 var(--font-mono);
    color: var(--faint);
    padding-top: 2px;
    user-select: none;
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
    inset: -40px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(212,162,83,.20) 0%, transparent 65%);
    pointer-events: none;
    z-index: -1;
  }
</style>

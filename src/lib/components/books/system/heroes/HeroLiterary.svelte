<script lang="ts">
  import type { UnifiedMedia } from '$lib/adapters/types';
  import Ornament from '$lib/components/books/system/Ornament.svelte';
  import BookCover from '$lib/components/books/system/BookCover.svelte';

  let {
    totalBooks,
    streakCount,
    currentBook = null
  }: {
    totalBooks: number;
    streakCount: number;
    currentBook?: UnifiedMedia | null;
  } = $props();
</script>

<section class="hero hero-literary">
  <div class="inner">
    <div class="orn-top">
      <Ornament variant="cluster" />
    </div>

    <p class="mono-tag">THE READING ROOM · NOW OPEN</p>

    <h1>
      A library at the<br /><em>nexus</em> of the universe
    </h1>

    <p class="subtitle">
      {totalBooks} titles on the shelves.{streakCount > 0 ? ` A ${streakCount}-day streak.` : ''}
      Somewhere between the page you closed last and the one still open, you've been here all along.
    </p>

    {#if currentBook}
      <div class="resume-pill">
        <BookCover book={currentBook} size="xs" showProgress={false} />
        <span class="resume-title">{currentBook.title}</span>
        <a href="/books/read/{currentBook.id}" class="resume-btn">resume →</a>
      </div>
    {/if}

    <div class="orn-bottom">
      <Ornament variant="cluster" />
    </div>
  </div>
</section>

<style>
  .hero-literary {
    position: relative;
    background: var(--void);
    padding: 56px 40px;
    overflow: hidden;
  }
  .hero-literary::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 130%;
    transform: translate(-50%, -50%);
    width: 700px;
    height: 700px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(212,162,83,.10) 0%, transparent 65%);
    pointer-events: none;
  }

  .inner {
    position: relative;
    z-index: 1;
    max-width: 820px;
    margin: 0 auto;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  }

  .orn-top,
  .orn-bottom {
    width: 100%;
  }

  .mono-tag {
    font: 10px/1 var(--font-mono);
    letter-spacing: .2em;
    color: var(--accent);
    text-transform: uppercase;
    margin: 0;
  }

  h1 {
    font-family: var(--font-display);
    font-size: clamp(52px, 7vw, 72px);
    font-weight: 700;
    line-height: 1.06;
    letter-spacing: -.02em;
    color: var(--cream);
    margin: 0;
  }
  h1 em {
    font-style: italic;
    color: var(--accent-lt);
  }

  .subtitle {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 20px;
    line-height: 1.55;
    color: rgba(240,235,227,.65);
    max-width: 60ch;
    margin: 0;
  }

  /* Resume pill */
  .resume-pill {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    background: rgba(240,235,227,.05);
    border: 1px solid rgba(212,162,83,.2);
    border-radius: 40px;
    padding: 8px 16px 8px 10px;
    margin-top: 4px;
  }
  .resume-title {
    font: 13px/1 var(--font-body);
    color: var(--cream);
    max-width: 22ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .resume-btn {
    font: 12px/1 var(--font-mono);
    letter-spacing: .08em;
    color: var(--accent-lt);
    text-decoration: none;
    white-space: nowrap;
    transition: color .15s;
  }
  .resume-btn:hover { color: var(--accent); }
</style>

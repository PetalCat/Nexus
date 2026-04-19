<script lang="ts">
  import type { UnifiedMedia } from '$lib/adapters/types';

  let {
    book,
    size = 'md',
    showProgress = false,
    badge = ''
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
  .cov { position: relative; aspect-ratio: 2/3; border-radius: 4px; overflow: hidden; box-shadow: 0 8px 18px rgba(0,0,0,.4); border: 1px solid rgba(240,235,227,.06); }
  .cov-xs { width: 40px; }
  .cov-sm { width: 60px; }
  .cov-md { width: 100%; max-width: 140px; }
  .cov-lg { width: 100%; max-width: 200px; }
  .cov-hero { width: 100%; max-width: 260px; box-shadow: 0 26px 70px rgba(0,0,0,.55); }
  img, svg { width: 100%; height: 100%; display: block; object-fit: cover; }
  .badge { position: absolute; bottom: 5px; left: 5px; font: 8px/1 var(--font-mono); letter-spacing: .15em; padding: 3px 6px; background: rgba(13,11,10,.85); border-radius: 3px; color: var(--accent-lt); text-transform: uppercase; }
  .prog-wrap { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: rgba(13,11,10,.6); }
  .prog { height: 100%; background: var(--accent); }
</style>

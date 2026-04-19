<script lang="ts">
  let {
    ordinal = '',
    title,
    meta = '',
    variant = 'subsection'
  }: { ordinal?: string; title: string; meta?: string; variant?: 'hero' | 'subsection' | 'aside' } = $props();
</script>

<div class="sh sh-{variant}">
  {#if ordinal}<span class="ord">{ordinal}</span>{/if}
  <h2 class="title">{@html title}</h2>
  {#if meta}<span class="meta">{meta}</span>{/if}
</div>

<style>
  .sh { display: flex; align-items: baseline; gap: 14px; margin-bottom: 16px; }
  .ord { font: 10px/1 var(--font-mono); letter-spacing: .26em; color: var(--accent); text-transform: uppercase; }
  .title { font-family: var(--font-display); font-weight: 700; letter-spacing: -.01em; margin: 0; font-size: 22px; }
  .sh-hero .title { font-size: 48px; line-height: .98; }
  .sh-aside .title { font-size: 15px; }
  .meta { font: 10px/1 var(--font-mono); letter-spacing: .2em; color: var(--faint); margin-left: auto; text-transform: uppercase; }
  :global(.sh .title em) { color: var(--accent); font-style: italic; }
</style>

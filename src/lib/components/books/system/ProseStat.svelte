<script lang="ts">
  let { center = true, children }: { center?: boolean; children: import('svelte').Snippet } = $props();
</script>

<p class="prose-stat" class:center>{@render children()}</p>

<style>
  .prose-stat { font-family: var(--font-display); font-style: italic; font-size: 13px; color: rgba(240,235,227,.72); line-height: 1.55; margin: 14px 0; }
  .prose-stat.center { text-align: center; }
  :global(.prose-stat strong) { color: var(--accent); font-style: normal; font-weight: 700; }
</style>

<script lang="ts">
  let {
    label,
    linkText = '',
    linkHref = '',
    children
  }: { label: string; linkText?: string; linkHref?: string; children: import('svelte').Snippet } = $props();
</script>

<div class="rr-item">
  <div class="rr-label">{label}</div>
  {@render children()}
  {#if linkText && linkHref}<a class="rr-link" href={linkHref}>{linkText} →</a>{/if}
</div>

<style>
  .rr-item { padding: 14px 0; border-bottom: 1px solid rgba(240,235,227,.05); }
  .rr-item:last-child { border: none; }
  .rr-label { font: 9px/1 var(--font-mono); letter-spacing: .22em; color: var(--faint); text-transform: uppercase; margin-bottom: 8px; }
  .rr-link { display: inline-block; margin-top: 8px; font: 10px/1 var(--font-mono); letter-spacing: .22em; color: var(--accent); text-transform: uppercase; }
</style>

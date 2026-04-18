<script lang="ts">
  let { variant = 'cluster' }: { variant?: 'cluster' | 'line' } = $props();
</script>

{#if variant === 'cluster'}
  <div class="orn-cluster" aria-hidden="true">⁜ ⁂ ⁜</div>
{:else}
  <div class="orn-line" aria-hidden="true"></div>
{/if}

<style>
  .orn-cluster { text-align: center; color: var(--faint); letter-spacing: .5em; font-size: 16px; }
  .orn-line { height: 1px; background: linear-gradient(90deg, transparent, rgba(212, 162, 83, .35), transparent); }
</style>

<script lang="ts">
  let {
    value = 0,
    waypoints = [],
    variant = 'thin'
  }: { value?: number; waypoints?: number[]; variant?: 'thick' | 'thin' } = $props();

  const clamped = $derived(Math.max(0, Math.min(1, value)));
</script>

<div class="thread" class:thick={variant === 'thick'} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(clamped * 100)}>
  <div class="track"></div>
  <div class="fill" style="width:{clamped * 100}%"></div>
  {#each waypoints as wp}
    <span class="wp" class:done={wp <= clamped} style="left:{wp * 100}%"></span>
  {/each}
</div>

<style>
  .thread { position: relative; height: 2px; width: 100%; }
  .thread.thick { height: 3px; }
  .track { position: absolute; inset: 0; background: var(--raised); border-radius: 2px; }
  .fill { position: absolute; left: 0; top: 0; height: 100%; background: linear-gradient(90deg, var(--accent-dim), var(--accent)); border-radius: 2px; box-shadow: 0 0 10px rgba(212,162,83,.4); }
  .fill::after { content: ''; position: absolute; right: -3px; top: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent-lt); box-shadow: 0 0 8px var(--accent-lt); }
  .wp { position: absolute; top: -3px; width: 1px; height: 8px; background: rgba(240,235,227,.15); }
  .wp.done { background: var(--accent-dim); }
</style>

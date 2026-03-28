<script lang="ts">
  import MusicNav from '$lib/components/music/MusicNav.svelte';
  import { page } from '$app/state';

  let { children } = $props();
</script>

<MusicNav currentPath={page.url.pathname} />
{@render children()}

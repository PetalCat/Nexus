<script lang="ts">
  import '$lib/styles/books-tokens.css';
  let { children } = $props();
</script>

<div class="books-surface">
  {@render children()}
</div>

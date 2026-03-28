<script lang="ts">
  interface Props {
    currentPath: string;
  }

  let { currentPath }: Props = $props();

  const links = [
    { label: 'Home', href: '/music' },
    { label: 'Albums', href: '/music/albums' },
    { label: 'Artists', href: '/music/artists' },
    { label: 'Songs', href: '/music/songs' },
    { label: 'Playlists', href: '/music/playlists' },
    { label: 'Wanted', href: '/music/wanted' },
  ];

  function isActive(href: string): boolean {
    if (href === '/music') return currentPath === '/music';
    return currentPath.startsWith(href);
  }
</script>

<nav class="music-nav">
  <div class="nav-links">
    {#each links as link (link.href)}
      <a
        href={link.href}
        class="nav-pill"
        class:active={isActive(link.href)}
      >
        {link.label}
      </a>
    {/each}
  </div>

  <a
    href="/music/search"
    class="nav-pill search-pill"
    class:active={currentPath.startsWith('/music/search')}
    aria-label="Search music"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  </a>
</nav>

<style>
  .music-nav {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: rgba(13, 11, 10, 0.9);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(240, 235, 227, 0.04);
  }

  .nav-links {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
    flex: 1;
  }

  .nav-links::-webkit-scrollbar {
    display: none;
  }

  .nav-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 14px;
    border-radius: 9999px;
    font-family: var(--font-body);
    font-size: 12px;
    font-weight: 600;
    color: #a09890;
    text-decoration: none;
    white-space: nowrap;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .nav-pill:hover {
    color: #f0ebe3;
  }

  .nav-pill.active {
    background: rgba(212, 162, 83, 0.12);
    color: #d4a253;
  }

  .search-pill {
    flex-shrink: 0;
  }
</style>

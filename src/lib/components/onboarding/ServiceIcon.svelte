<script lang="ts">
	interface Props {
		type: string;
		size?: number;
	}

	let { type, size = 24 }: Props = $props();
</script>

{#if type === 'jellyfin'}
<!-- Jellyfin official logo - the banner/ribbon shape -->
<svg width={size} height={size} viewBox="0 0 512 512" fill="currentColor">
	<path d="M256 201.6c-20.4 0-37.8 12.8-44.6 30.8L140.6 410c-4 10.6 3.6 21.8 15 21.8h201c11.4 0 19-11.2 15-21.8l-70.8-177.6c-6.8-18-24.2-30.8-44.8-30.8zm0-121.2c-11.6 0-21.6 7.4-25.4 17.6l-19.2 51c-2.6 7 2 14.6 9.4 14.6h70.4c7.4 0 12-7.6 9.4-14.6l-19.2-51c-3.8-10.2-13.8-17.6-25.4-17.6z"/>
</svg>
{:else if type === 'plex'}
<!-- Plex official logo - the forward arrow/play shape -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
	<path d="M11.643 0H4.68l7.679 12L4.68 24h6.963l7.677-12z"/>
</svg>
{:else if type === 'radarr'}
<!-- Radarr - movie reel/radar inspired -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
	<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 110 14 7 7 0 010-14zm0 3a4 4 0 100 8 4 4 0 000-8zm0 2.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/>
</svg>
{:else if type === 'sonarr'}
<!-- Sonarr - sonar/signal waves -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
	<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.14-7-7 3.14-7 7-7zm0 3c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 2.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/>
</svg>
{:else if type === 'lidarr'}
<!-- Lidarr - music/headphone inspired -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
	<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
</svg>
{:else if type === 'overseerr' || type === 'seerr'}
<!-- Overseerr/Seerr - the eye/request icon -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
	<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
</svg>
{:else if type === 'bazarr'}
<!-- Bazarr - subtitle/closed caption -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
	<path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
</svg>
{:else if type === 'streamystats'}
<!-- StreamyStats - analytics chart -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
	<path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/>
</svg>
{:else if type === 'invidious'}
<!-- Invidious - shield/privacy -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
	<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
</svg>
{:else if type === 'romm'}
<!-- RomM - game controller -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
	<path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
</svg>
{:else if type === 'calibre'}
<!-- Calibre - open book -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
	<path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
</svg>
{:else if type === 'prowlarr'}
<!-- Prowlarr - search/index -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
	<path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
</svg>
{:else}
<!-- Fallback generic service -->
<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" opacity="0.6">
	<path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>
</svg>
{/if}
